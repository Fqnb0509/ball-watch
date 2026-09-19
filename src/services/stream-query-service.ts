import { streams as demoStreams } from '../stream-data'
import { getStreamProviders, queryStreamProvider, queryStreamProviders } from '../stream-providers'
import type { StreamProviderAdapter, StreamProviderQuery, StreamProviderQueryResult } from '../stream-providers/types'
import type { Match, Stream } from '../types'
import { getStreamUrlError } from './stream-url-policy'
import { streamMatchIdentity } from './match-stream-resolver'

export type StreamQueryStatus = 'success' | 'success-empty' | 'partial-failure' | 'failure' | 'stale' | 'fallback-active'

export type StreamQueryResult = {
  data: Stream[]
  status: StreamQueryStatus
  providerResults: StreamProviderQueryResult[]
  fetchedAt: string
  stale: boolean
  fallbackActive: boolean
  error: string | null
}

export type StreamQueryOptions = {
  signal?: AbortSignal
  forceRefresh?: boolean
  timeoutMs?: number
}

export type StreamQueryServiceOptions = {
  providers?: readonly StreamProviderAdapter[]
  now?: () => number
  ttlMs?: number
  staleWhileRevalidateMs?: number
  timeoutMs?: number
  maxRetries?: number
}

type CacheEntry = { value: StreamQueryResult; expiresAt: number; staleUntil: number }
type ProviderCircuit = { failures: number; openUntil: number }

const DEFAULT_TTL_MS = 45_000
const DEFAULT_STALE_WHILE_REVALIDATE_MS = 60_000
const DEFAULT_TIMEOUT_MS = 4_000
const DEFAULT_MAX_RETRIES = 2
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 30_000

class ProviderAttemptError extends Error {
  readonly timeout: boolean

  constructor(message: string, timeout = false) {
    super(message)
    this.name = timeout ? 'StreamProviderTimeoutError' : 'StreamProviderError'
    this.timeout = timeout
  }
}

const cloneStream = (stream: Stream): Stream => ({ ...stream })
const cloneResult = (value: StreamQueryResult): StreamQueryResult => ({
  ...value,
  data: value.data.map(cloneStream),
  providerResults: value.providerResults.map((result) => ({ ...result, streams: result.streams.map(cloneStream) })),
})

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    if (signal.reason instanceof Error && signal.reason.name === 'AbortError') throw signal.reason
    const error = new Error('Request aborted')
    error.name = 'AbortError'
    throw error
  }
}

const waitFor = (durationMs: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason)
    return
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, durationMs)
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal?.reason)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
})

const raceWithAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason)
    return
  }
  const onAbort = () => reject(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort)).catch(() => undefined)
})

const isRetryable = (result: StreamProviderQueryResult | null, error: unknown): boolean => {
  if (result?.status === 'timeout') return true
  if (result?.status === 'failure') return true
  return error instanceof ProviderAttemptError || error instanceof Error
}

const isCircuitOpen = (circuits: Map<string, ProviderCircuit>, provider: string, now: number): boolean => {
  const state = circuits.get(provider)
  if (!state) return false
  if (state.openUntil > now) return true
  circuits.set(provider, { failures: CIRCUIT_FAILURE_THRESHOLD - 1, openUntil: 0 })
  return false
}

const recordCircuitFailure = (circuits: Map<string, ProviderCircuit>, provider: string, now: number): void => {
  const current = circuits.get(provider) ?? { failures: 0, openUntil: 0 }
  const failures = current.failures + 1
  circuits.set(provider, {
    failures,
    openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? now + CIRCUIT_COOLDOWN_MS : 0,
  })
}

const candidatePolicyProbe = (stream: Stream): Stream => ({ ...stream, legalStatus: 'authorized' })

const isSafeCandidate = (stream: Stream): boolean => {
  if (stream.legalStatus === 'demo') return !stream.url
  if (stream.legalStatus !== 'authorized' && !stream.url && stream.access === 'player') return true
  return getStreamUrlError(candidatePolicyProbe(stream)) === null
}

const dedupeCandidates = (streams: readonly Stream[], matchId: string): Stream[] => {
  const result = new Map<string, Stream>()
  for (const stream of streams) {
    if (stream.matchId !== matchId || !isSafeCandidate(stream)) continue
    const key = stream.url
      ? `url:${stream.url}`
      : `identity:${stream.provider}:${stream.eventId ?? stream.id}`
    if (!result.has(key)) result.set(key, { ...stream, matchId })
  }
  return [...result.values()]
}

const rankCandidates = (streams: readonly Stream[]): Stream[] => {
  let liveIndex = 0
  return [...streams]
    .sort((left, right) => right.priority - left.priority)
    .map((stream) => {
      if (stream.sourceKind !== 'live') return { ...stream, role: undefined }
      const role = liveIndex === 0 ? 'primary' : 'fallback'
      liveIndex += 1
      return { ...stream, role }
    })
}

const hasSafePlayableCandidate = (streams: readonly Stream[]): boolean => streams.some((stream) => stream.sourceKind === 'live' && stream.enabled && getStreamUrlError(stream) === null)

const summarizeStatus = (
  providerResults: readonly StreamProviderQueryResult[],
  streams: readonly Stream[],
  fallbackActive: boolean,
): { status: StreamQueryStatus; error: string | null } => {
  const failures = providerResults.filter((result) => ['failure', 'timeout', 'circuit-open'].includes(result.status))
  const successes = providerResults.filter((result) => ['success-empty', 'success-with-candidates'].includes(result.status))
  if (fallbackActive) return { status: 'fallback-active', error: failures.length ? '部分直播源 Provider 查询失败，当前使用 fallback。' : null }
  if (hasSafePlayableCandidate(streams)) return { status: failures.length ? 'partial-failure' : 'success', error: failures.length ? '部分直播源 Provider 查询失败，但已有合法来源。' : null }
  if (successes.length > 0 && failures.length === 0) return { status: 'success-empty', error: null }
  if (successes.length > 0) return { status: 'partial-failure', error: '部分直播源 Provider 查询失败。' }
  return { status: 'failure', error: '直播查询全部失败。' }
}

const getDemoCandidates = (match: Match): Stream[] => demoStreams
  .filter((stream) => stream.matchId === match.id)
  .map(cloneStream)

export const createStreamQueryService = (options: StreamQueryServiceOptions = {}) => {
  const providers = options.providers ?? getStreamProviders()
  const now = options.now ?? (() => Date.now())
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const staleWhileRevalidateMs = options.staleWhileRevalidateMs ?? DEFAULT_STALE_WHILE_REVALIDATE_MS
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES)
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, { promise: Promise<StreamQueryResult>; signal?: AbortSignal }>()
  const circuits = new Map<string, ProviderCircuit>()

  const runProvider = async (provider: StreamProviderAdapter, request: StreamProviderQuery): Promise<StreamProviderQueryResult> => {
    const providerId = provider.provider
    if (isCircuitOpen(circuits, providerId, now())) return { provider: providerId, status: 'circuit-open', streams: [], error: '直播源 Provider 暂时熔断。' }

    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs
    let lastError: unknown = null
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      throwIfAborted(request.signal)
      const controller = new AbortController()
      const forwardAbort = () => controller.abort(request.signal?.reason)
      request.signal?.addEventListener('abort', forwardAbort, { once: true })
      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort(new Error('Stream Provider request timed out'))
      }, timeoutMs)
      try {
        const response = await raceWithAbort(queryStreamProvider(provider, { ...request, signal: controller.signal }), controller.signal)
        if (response.status === 'circuit-open') return response
        if (response.status === 'failure' || response.status === 'timeout') throw new ProviderAttemptError(response.error ?? 'Stream Provider query failed', response.status === 'timeout')
        circuits.delete(providerId)
        return response
      } catch (error: unknown) {
        if (request.signal?.aborted) throw error
        lastError = error
        if (attempt < maxRetries && isRetryable(null, error)) {
          await waitFor(120 * (2 ** attempt), request.signal)
          continue
        }
        const timedOutResult = timedOut || error instanceof ProviderAttemptError && error.timeout
        recordCircuitFailure(circuits, providerId, now())
        return {
          provider: providerId,
          status: timedOutResult ? 'timeout' : 'failure',
          streams: [],
          error: timedOutResult ? '直播源 Provider 查询超时。' : '直播源 Provider 查询失败。',
        }
      } finally {
        clearTimeout(timeoutId)
        request.signal?.removeEventListener('abort', forwardAbort)
      }
    }
    recordCircuitFailure(circuits, providerId, now())
    return { provider: providerId, status: 'failure', streams: [], error: lastError instanceof Error ? '直播源 Provider 查询失败。' : '直播源 Provider 查询失败。' }
  }

  const refresh = async (match: Match, key: string, signal?: AbortSignal): Promise<StreamQueryResult> => {
    throwIfAborted(signal)
    const providerResults = await queryStreamProviders(match, {
      providers,
      signal,
      queryProvider: (provider, request) => runProvider(provider, request),
    })
    throwIfAborted(signal)
    const providerStreams = providerResults.flatMap((result) => result.streams)
    const candidates = rankCandidates(dedupeCandidates([...providerStreams, ...getDemoCandidates(match)], match.id))
    const firstPlayable = candidates.find((stream) => stream.sourceKind === 'live' && stream.enabled && getStreamUrlError(stream) === null)
    const fallbackActive = firstPlayable?.role === 'fallback'
    const summary = summarizeStatus(providerResults, candidates, fallbackActive)
    const value: StreamQueryResult = {
      data: candidates,
      status: summary.status,
      providerResults,
      fetchedAt: new Date(now()).toISOString(),
      stale: false,
      fallbackActive,
      error: summary.error,
    }
    cache.set(key, { value: cloneResult(value), expiresAt: now() + ttlMs, staleUntil: now() + ttlMs + staleWhileRevalidateMs })
    return value
  }

  const startRefresh = (match: Match, key: string, signal?: AbortSignal): Promise<StreamQueryResult> => {
    const existing = inFlight.get(key)
    if (existing && !existing.signal?.aborted) return existing.promise
    const promise = refresh(match, key, signal).finally(() => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key)
    })
    inFlight.set(key, { promise, signal })
    return promise
  }

  const query = async (match: Match, queryOptions: StreamQueryOptions = {}): Promise<StreamQueryResult> => {
    throwIfAborted(queryOptions.signal)
    const key = streamMatchIdentity(match)
    const cached = cache.get(key)
    const timestamp = now()
    if (!queryOptions.forceRefresh && cached && cached.expiresAt > timestamp) return cloneResult(cached.value)
    if (!queryOptions.forceRefresh && cached && cached.staleUntil > timestamp) {
      const stale = cloneResult({ ...cached.value, status: 'stale', stale: true, error: null })
      void startRefresh(match, key).catch(() => undefined)
      return stale
    }
    return raceWithAbort(startRefresh(match, key, queryOptions.signal), queryOptions.signal).then(cloneResult)
  }

  return {
    query,
    clear: () => { cache.clear(); inFlight.clear(); circuits.clear() },
  }
}

export const streamQueryService = createStreamQueryService()
export const queryStreamsForMatch = (match: Match, options?: StreamQueryOptions): Promise<StreamQueryResult> => streamQueryService.query(match, options)

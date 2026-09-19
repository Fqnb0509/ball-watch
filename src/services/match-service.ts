import { getMatchProvider, getMatchProvidersForSport, listMatchProviders } from '../match-providers/registry'
import type { MatchProvider, MatchProviderRequest } from '../match-providers/types'
import type { Match, Sport } from '../types'
import { dedupeMatches } from './match-identity'
import { normalizeMatches } from './match-normalizer'
import { isIsoTimestamp, validateMatchCollection } from './match-schema'
import { createRecordFromEntries, createSafeAbortController, createSafeDateTimeFormatter, signalForFetch } from './runtime-compat'

const CACHE_KEY = 'fieldwatch:matches-cache:v2'
const CACHE_SCHEMA_VERSION = 2
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_PERSISTED_CACHE_CHARS = 1_000_000
const MAX_PERSISTED_QUERIES = 8
const DEFAULT_TIMEOUT_MS = 8_000
const MIN_TIMEOUT_MS = 50
const MAX_TIMEOUT_MS = 30_000
const MAX_RETRIES = 2
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 30_000
const DEMO_PROVIDER_ID = 'demo'
const DATA_UNAVAILABLE_ERROR = '赛事数据源暂时不可用'
const PARTIAL_PROVIDER_ERROR = '部分赛事数据源暂时不可用'
const INVALID_RECORD_ERROR = '部分赛事数据记录无效，已安全忽略'
const FALLBACK_ERROR = '赛事数据源暂时不可用，已显示 Demo 数据'

export type MatchQuery = {
  sport?: Sport
  from?: string
  to?: string
  forceRefresh?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

export type MatchDataMetadata = {
  provider: string
  fetchedAt: string | null
  sourceUpdatedAt: string | null
  expiresAt: string | null
  stale: boolean
  error: string | null
  fallback: boolean
}

export type MatchSnapshot = {
  data: Match[]
  metadata: MatchDataMetadata
}

type NormalizedQuery = {
  sport?: Sport
  from?: string
  to?: string
  timeoutMs: number
}

type CacheEnvelope = {
  schemaVersion: typeof CACHE_SCHEMA_VERSION
  provider: string
  fetchedAt: string
  sourceUpdatedAt: string | null
  expiresAt: string
  stale: boolean
  error: string | null
  fallback: boolean
  data: Match[]
}

type PersistedCache = {
  schemaVersion: typeof CACHE_SCHEMA_VERSION
  entries: Array<{ queryKey: string; value: CacheEnvelope }>
}

type ProviderSuccess = {
  status: 'success'
  provider: string
  matches: Match[]
  sourceUpdatedAt: string | null
  expiresAt: string | null
  stale: boolean
  fallback: boolean
  warning: string | null
}

type ProviderFailure = { status: 'failure' | 'skipped'; provider: string }
type ProviderOutcome = ProviderSuccess | ProviderFailure

type ProviderData = {
  provider: string
  matches: Match[]
  sourceUpdatedAt: string | null
  expiresAt: string | null
  stale: boolean
  fallback: boolean
  error: string | null
  refreshFailed: boolean
}

type CircuitState = { consecutiveFailures: number; openUntil: number }

type InFlightEntry = {
  promise: Promise<MatchSnapshot>
  controller: ReturnType<typeof createSafeAbortController>
  subscribers: Set<symbol>
  keepAlive: boolean
  settled: boolean
}

class ProviderTimeoutError extends Error {
  constructor() {
    super('Provider request timed out')
    this.name = 'ProviderTimeoutError'
  }
}

class ProviderDataError extends Error {
  constructor() {
    super('Provider returned invalid data')
    this.name = 'ProviderDataError'
  }
}

const memoryCache = new Map<string, CacheEnvelope>()
const inFlight = new Map<string, InFlightEntry>()
const circuits = new Map<string, CircuitState>()
let storageLoaded = false

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const cloneMatch = (match: Match): Match => ({
  ...match,
  homeTeam: { ...match.homeTeam, players: match.homeTeam.players ? [...match.homeTeam.players] : undefined },
  awayTeam: { ...match.awayTeam, players: match.awayTeam.players ? [...match.awayTeam.players] : undefined },
  score: match.score ? [...match.score] as [number, number] : undefined,
  streamIds: [...match.streamIds],
  externalIds: match.externalIds ? { ...match.externalIds } : undefined,
})

const cloneMatches = (matches: readonly Match[]): Match[] => matches.map(cloneMatch)

const cloneEnvelope = (value: CacheEnvelope): CacheEnvelope => ({
  ...value,
  data: cloneMatches(value.data),
})

const canonicalTimestamp = (value: unknown): string | null => {
  if (!isIsoTimestamp(value)) return null
  return new Date(value).toISOString()
}

const normalizeQueryTimestamp = (value: string | undefined): string | undefined => {
  const timestamp = canonicalTimestamp(value)
  return timestamp ?? undefined
}

const normalizeQuery = (options: MatchQuery): NormalizedQuery => ({
  ...(options.sport ? { sport: options.sport } : {}),
  ...(normalizeQueryTimestamp(options.from) ? { from: normalizeQueryTimestamp(options.from) } : {}),
  ...(normalizeQueryTimestamp(options.to) ? { to: normalizeQueryTimestamp(options.to) } : {}),
  timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Number.isFinite(options.timeoutMs) ? Math.round(options.timeoutMs as number) : DEFAULT_TIMEOUT_MS)),
})

const queryKey = (query: NormalizedQuery) => JSON.stringify([query.sport ?? '*', query.from ?? '', query.to ?? ''])

const getStorage = (): Storage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

const isCacheEnvelope = (value: unknown): value is CacheEnvelope => {
  if (!isRecord(value) || value.schemaVersion !== CACHE_SCHEMA_VERSION) return false
  if (typeof value.provider !== 'string' || !value.provider.trim()) return false
  if (!isIsoTimestamp(value.fetchedAt) || !isIsoTimestamp(value.expiresAt)) return false
  if (value.sourceUpdatedAt !== null && !isIsoTimestamp(value.sourceUpdatedAt)) return false
  if (typeof value.stale !== 'boolean' || typeof value.fallback !== 'boolean') return false
  if (value.error !== null && typeof value.error !== 'string') return false
  if (!Array.isArray(value.data)) return false
  const validated = validateMatchCollection(value.data)
  return validated.length === value.data.length
}

const removePersistedCache = () => {
  try {
    getStorage()?.removeItem(CACHE_KEY)
  } catch {
    // Persistent caching is optional.
  }
}

const hydrateCache = () => {
  if (storageLoaded) return
  storageLoaded = true
  const storage = getStorage()
  if (!storage) return
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return
    if (raw.length > MAX_PERSISTED_CACHE_CHARS) {
      removePersistedCache()
      return
    }
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      removePersistedCache()
      return
    }
    let invalidEntry = false
    for (const entry of parsed.entries.slice(0, MAX_PERSISTED_QUERIES)) {
      if (!isRecord(entry) || typeof entry.queryKey !== 'string' || entry.queryKey.length > 512 || !isCacheEnvelope(entry.value)) {
        invalidEntry = true
        continue
      }
      memoryCache.set(entry.queryKey, cloneEnvelope(entry.value))
    }
    if (invalidEntry || parsed.entries.length > MAX_PERSISTED_QUERIES) {
      if (memoryCache.size === 0) removePersistedCache()
      else persistCache()
    }
  } catch {
    removePersistedCache()
  }
}

const persistCache = () => {
  const storage = getStorage()
  if (!storage) return
  try {
    const candidates = Array.from(memoryCache.entries())
      .sort(([, left], [, right]) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt))
      .slice(0, MAX_PERSISTED_QUERIES)
    const entries: PersistedCache['entries'] = []
    for (const [key, value] of candidates) {
      const next = [...entries, { queryKey: key, value: cloneEnvelope(value) }]
      const serialized = JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, entries: next } satisfies PersistedCache)
      if (serialized.length <= MAX_PERSISTED_CACHE_CHARS) entries.push({ queryKey: key, value: cloneEnvelope(value) })
    }
    storage.setItem(CACHE_KEY, JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, entries } satisfies PersistedCache))
  } catch {
    // The in-memory cache remains available when storage is unavailable or full.
  }
}

const saveEnvelope = (key: string, envelope: CacheEnvelope): CacheEnvelope => {
  const saved = cloneEnvelope(envelope)
  memoryCache.set(key, saved)
  persistCache()
  return cloneEnvelope(saved)
}

const readEnvelope = (key: string): CacheEnvelope | null => {
  hydrateCache()
  const cached = memoryCache.get(key)
  return cached ? cloneEnvelope(cached) : null
}

const toSnapshot = (envelope: CacheEnvelope): MatchSnapshot => ({
  data: cloneMatches(envelope.data),
  metadata: {
    provider: envelope.provider,
    fetchedAt: envelope.fetchedAt,
    sourceUpdatedAt: envelope.sourceUpdatedAt,
    expiresAt: envelope.expiresAt,
    stale: envelope.stale || Date.now() >= Date.parse(envelope.expiresAt),
    error: envelope.error,
    fallback: envelope.fallback,
  },
})

const abortError = (signal?: AbortSignal): Error => {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('Request aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw abortError(signal)
}

const waitFor = (durationMs: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(abortError(signal))
    return
  }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }, durationMs)
  const onAbort = () => {
    clearTimeout(timer)
    reject(abortError(signal))
  }
  signal.addEventListener('abort', onAbort, { once: true })
})

const raceWithAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(abortError(signal))
    return
  }
  const onAbort = () => reject(abortError(signal))
  signal.addEventListener('abort', onAbort, { once: true })
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort)).catch(() => undefined)
})

const runProviderAttempt = async (provider: MatchProvider, request: MatchProviderRequest, outerSignal: AbortSignal): Promise<unknown> => {
  throwIfAborted(outerSignal)
  const controller = createSafeAbortController()
  const forwardAbort = () => controller.abort(outerSignal.reason)
  outerSignal.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new ProviderTimeoutError()), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    return await raceWithAbort(provider.fetch({ ...request, signal: signalForFetch(controller.signal) }), controller.signal)
  } finally {
    clearTimeout(timer)
    outerSignal.removeEventListener('abort', forwardAbort)
  }
}

const errorStatus = (error: unknown): number | null => {
  if (!isRecord(error)) return null
  const status = error.status ?? error.statusCode
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

const isTransientError = (error: unknown): boolean => {
  if (error instanceof ProviderTimeoutError) return true
  const status = errorStatus(error)
  if (status !== null) return status === 408 || status >= 500
  if (error instanceof TypeError) return true
  if (error instanceof Error && error.name === 'AbortError') return true
  if (!isRecord(error)) return false
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : ''
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH', 'NETWORK_ERR'].includes(code)
}

const fetchWithRetry = async (provider: MatchProvider, request: MatchProviderRequest, signal: AbortSignal): Promise<unknown> => {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await runProviderAttempt(provider, request, signal)
    } catch (error) {
      if (signal.aborted) throw abortError(signal)
      lastError = error
      if (attempt === MAX_RETRIES || !isTransientError(error)) throw error
      await waitFor(120 * (2 ** attempt), signal)
    }
  }
  throw lastError
}

const circuitOpen = (providerId: string): boolean => {
  if (providerId === DEMO_PROVIDER_ID) return false
  const state = circuits.get(providerId)
  if (!state) return false
  if (state.openUntil > Date.now()) return true
  if (state.openUntil > 0) circuits.set(providerId, { consecutiveFailures: CIRCUIT_FAILURE_THRESHOLD - 1, openUntil: 0 })
  return false
}

const recordProviderSuccess = (providerId: string) => {
  if (providerId !== DEMO_PROVIDER_ID) circuits.delete(providerId)
}

const recordProviderFailure = (providerId: string) => {
  if (providerId === DEMO_PROVIDER_ID) return
  const current = circuits.get(providerId) ?? { consecutiveFailures: 0, openUntil: 0 }
  const consecutiveFailures = current.consecutiveFailures + 1
  circuits.set(providerId, {
    consecutiveFailures,
    openUntil: consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_COOLDOWN_MS : 0,
  })
}

const inQueryWindow = (match: Match, query: NormalizedQuery): boolean => {
  if (query.sport && match.sport !== query.sport) return false
  const startTime = Date.parse(match.startTime)
  if (!Number.isFinite(startTime)) return false
  if (query.from && startTime < Date.parse(query.from)) return false
  if (query.to && startTime > Date.parse(query.to)) return false
  return true
}

const executeProvidersByPriority = async (
  providers: MatchProvider[],
  query: NormalizedQuery,
  signal: AbortSignal,
): Promise<ProviderOutcome[]> => {
  const ordered = [...providers].sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100))
  const coveredSports = new Set<Sport>()
  const outcomes: ProviderOutcome[] = []

  for (const provider of ordered) {
    if (provider.supportedSports.every((sport) => coveredSports.has(sport))) {
      outcomes.push({ status: 'skipped', provider: provider.id })
      continue
    }
    const outcome = await executeProvider(provider, query, signal)
    outcomes.push(outcome)
    if (outcome.status === 'success') provider.supportedSports.forEach((sport) => coveredSports.add(sport))
  }
  return outcomes
}

const executeProvider = async (provider: MatchProvider, query: NormalizedQuery, signal: AbortSignal): Promise<ProviderOutcome> => {
  if (circuitOpen(provider.id)) return { status: 'skipped', provider: provider.id }
  const request: MatchProviderRequest = {
    ...(query.sport ? { sport: query.sport } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    timeoutMs: query.timeoutMs,
    signal,
  }
  try {
    const raw = await fetchWithRetry(provider, request, signal)
    throwIfAborted(signal)
    const result = provider.normalize(raw, request)
    if (!result
      || result.provider !== provider.id
      || !isIsoTimestamp(result.fetchedAt)
      || (result.sourceUpdatedAt !== null && !isIsoTimestamp(result.sourceUpdatedAt))
      || (result.expiresAt !== null && !isIsoTimestamp(result.expiresAt))
      || typeof result.stale !== 'boolean'
      || (result.error !== null && typeof result.error !== 'string')
      || typeof result.fallback !== 'boolean'
      || !Array.isArray(result.matches)) throw new ProviderDataError()
    const matches = normalizeMatches(result.matches, provider.id).filter((match) => inQueryWindow(match, query))
    if ((result.matches.length > 0 && matches.length === 0) || (result.error && matches.length === 0)) throw new ProviderDataError()
    recordProviderSuccess(provider.id)
    return {
      status: 'success',
      provider: provider.id,
      matches,
      sourceUpdatedAt: canonicalTimestamp(result.sourceUpdatedAt),
      expiresAt: canonicalTimestamp(result.expiresAt),
      stale: Boolean(result.stale),
      fallback: Boolean(result.fallback),
      warning: result.error || matches.length !== result.matches.length ? INVALID_RECORD_ERROR : null,
    }
  } catch {
    if (signal.aborted) throw abortError(signal)
    recordProviderFailure(provider.id)
    return { status: 'failure', provider: provider.id }
  }
}

const latestTimestamp = (values: Array<string | null>): string | null => {
  const valid = values.filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(right) - Date.parse(left))
  return valid[0] ?? null
}

const earliestTimestamp = (values: Array<string | null>): string | null => {
  const valid = values.filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(left) - Date.parse(right))
  return valid[0] ?? null
}

const aggregateProviders = async (providers: MatchProvider[], query: NormalizedQuery, signal: AbortSignal): Promise<ProviderData> => {
  const outcomes = await executeProvidersByPriority(providers, query, signal)
  throwIfAborted(signal)
  const successful = outcomes.filter((outcome): outcome is ProviderSuccess => outcome.status === 'success')
  if (successful.length === 0) throw new ProviderDataError()
  const failedCount = outcomes.filter((outcome): outcome is ProviderFailure => outcome.status === 'failure').length
  const hasWarnings = successful.some((outcome) => outcome.warning)
  return {
    provider: successful.map((outcome) => outcome.provider).sort().join(','),
    matches: dedupeMatches(successful.flatMap((outcome) => outcome.matches)),
    sourceUpdatedAt: latestTimestamp(successful.map((outcome) => outcome.sourceUpdatedAt)),
    expiresAt: earliestTimestamp(successful.map((outcome) => outcome.expiresAt)),
    stale: successful.some((outcome) => outcome.stale),
    fallback: successful.some((outcome) => outcome.fallback),
    error: failedCount > 0 ? PARTIAL_PROVIDER_ERROR : hasWarnings ? INVALID_RECORD_ERROR : null,
    refreshFailed: failedCount > 0,
  }
}

const fetchHybridProviderData = async (
  externalProviders: MatchProvider[],
  demoProvider: MatchProvider,
  query: NormalizedQuery,
  signal: AbortSignal,
): Promise<ProviderData> => {
  const outcomes = await executeProvidersByPriority(externalProviders, query, signal)
  throwIfAborted(signal)

  const successfulExternal = outcomes.filter((outcome): outcome is ProviderSuccess => outcome.status === 'success')
  const externalById = new Map(externalProviders.map((provider) => [provider.id, provider]))
  const configuredExternalSports = new Set<Sport>()
  const successfulExternalSports = new Set<Sport>()

  externalProviders.forEach((provider) => provider.supportedSports.forEach((sport) => configuredExternalSports.add(sport)))
  successfulExternal.forEach((outcome) => {
    externalById.get(outcome.provider)?.supportedSports.forEach((sport) => successfulExternalSports.add(sport))
  })

  // A successful external response is authoritative for every sport it supports,
  // including an explicitly empty result. Demo only fills uncovered or failed sports.
  const demoSports = new Set(demoProvider.supportedSports)
  const demoNeededSports = new Set(Array.from(demoSports).filter((sport) => !successfulExternalSports.has(sport)))
  const failedExternalSports = Array.from(configuredExternalSports)
    .filter((sport) => !successfulExternalSports.has(sport) && demoSports.has(sport))

  let demoOutcome: ProviderOutcome | null = null
  if (demoNeededSports.size > 0) demoOutcome = await executeProvider(demoProvider, query, signal)
  throwIfAborted(signal)

  const demoSuccess = demoOutcome?.status === 'success' ? demoOutcome : null
  const usedDemo = Boolean(demoSuccess && demoNeededSports.size > 0)
  const fallback = Boolean(demoSuccess && failedExternalSports.length > 0)
  const matches = [
    ...successfulExternal.flatMap((outcome) => outcome.matches),
    ...(demoSuccess ? demoSuccess.matches.filter((match) => demoNeededSports.has(match.sport)) : []),
  ]
  const usedSuccesses = [
    ...successfulExternal,
    ...(usedDemo && demoSuccess ? [demoSuccess] : []),
  ]

  if (usedSuccesses.length === 0) throw new ProviderDataError()

  const demoFailed = demoNeededSports.size > 0 && !demoSuccess
  const hasWarnings = usedSuccesses.some((outcome) => outcome.warning)

  return {
    provider: usedSuccesses.map((outcome) => outcome.provider).sort().join(','),
    matches: dedupeMatches(matches),
    sourceUpdatedAt: latestTimestamp(usedSuccesses.map((outcome) => outcome.sourceUpdatedAt)),
    expiresAt: earliestTimestamp(usedSuccesses.map((outcome) => outcome.expiresAt)),
    stale: fallback || usedSuccesses.some((outcome) => outcome.stale),
    fallback: fallback || usedSuccesses.some((outcome) => outcome.fallback),
    error: fallback
      ? FALLBACK_ERROR
      : failedExternalSports.length > 0 || demoFailed
        ? PARTIAL_PROVIDER_ERROR
        : hasWarnings
          ? INVALID_RECORD_ERROR
          : null,
    refreshFailed: failedExternalSports.length > 0 || demoFailed,
  }
}

const providersForQuery = (query: NormalizedQuery) => query.sport ? getMatchProvidersForSport(query.sport) : listMatchProviders()

const fetchConfiguredData = async (query: NormalizedQuery, signal: AbortSignal): Promise<{ data: ProviderData; usedDemoAsPrimary: boolean }> => {
  const providers = providersForQuery(query)
  const externalProviders = providers.filter((provider) => provider.id !== DEMO_PROVIDER_ID)
  const demoProvider = providers.find((provider) => provider.id === DEMO_PROVIDER_ID) ?? getMatchProvider(DEMO_PROVIDER_ID)
  if (externalProviders.length > 0) {
    if (!query.sport && demoProvider) {
      return { data: await fetchHybridProviderData(externalProviders, demoProvider, query, signal), usedDemoAsPrimary: false }
    }
    return { data: await aggregateProviders(externalProviders, query, signal), usedDemoAsPrimary: false }
  }
  if (!demoProvider) throw new ProviderDataError()
  return { data: await aggregateProviders([demoProvider], query, signal), usedDemoAsPrimary: true }
}

const fetchDemoFallback = async (query: NormalizedQuery, signal: AbortSignal): Promise<ProviderData> => {
  const demoProvider = getMatchProvider(DEMO_PROVIDER_ID)
  if (!demoProvider) throw new ProviderDataError()
  const data = await aggregateProviders([demoProvider], query, signal)
  return { ...data, stale: true, fallback: true, error: FALLBACK_ERROR }
}

const buildEnvelope = (data: ProviderData): CacheEnvelope => {
  const fetchedAt = new Date().toISOString()
  const serviceExpiry = Date.parse(fetchedAt) + CACHE_TTL_MS
  const providerExpiry = data.expiresAt ? Date.parse(data.expiresAt) : Number.POSITIVE_INFINITY
  const expiresAtMs = Math.min(serviceExpiry, providerExpiry)
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    provider: data.provider,
    fetchedAt,
    sourceUpdatedAt: data.sourceUpdatedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    stale: data.stale || expiresAtMs <= Date.now(),
    error: data.error,
    fallback: data.fallback,
    data: cloneMatches(data.matches),
  }
}

const refreshQuery = async (query: NormalizedQuery, key: string, previous: CacheEnvelope | null, signal: AbortSignal): Promise<MatchSnapshot> => {
  try {
    const { data } = await fetchConfiguredData(query, signal)
    throwIfAborted(signal)
    if (previous && data.refreshFailed) {
      return toSnapshot(saveEnvelope(key, { ...previous, stale: true, error: DATA_UNAVAILABLE_ERROR }))
    }
    return toSnapshot(saveEnvelope(key, buildEnvelope(data)))
  } catch {
    if (signal.aborted) throw abortError(signal)
    if (previous) {
      return toSnapshot(saveEnvelope(key, { ...previous, stale: true, error: DATA_UNAVAILABLE_ERROR }))
    }
    const externalProvidersExist = providersForQuery(query).some((provider) => provider.id !== DEMO_PROVIDER_ID)
    if (externalProvidersExist) {
      try {
        const fallback = await fetchDemoFallback(query, signal)
        return toSnapshot(saveEnvelope(key, buildEnvelope(fallback)))
      } catch {
        if (signal.aborted) throw abortError(signal)
      }
    }
    throw new Error(DATA_UNAVAILABLE_ERROR)
  }
}

const startRefresh = (query: NormalizedQuery, key: string, previous: CacheEnvelope | null, keepAlive: boolean): InFlightEntry => {
  const existing = inFlight.get(key)
  if (existing && !existing.controller.signal.aborted) {
    existing.keepAlive ||= keepAlive
    return existing
  }
  if (existing) inFlight.delete(key)
  const controller = createSafeAbortController()
  let entry: InFlightEntry
  const promise = refreshQuery(query, key, previous, controller.signal).finally(() => {
    entry.settled = true
    if (inFlight.get(key) === entry) inFlight.delete(key)
  })
  entry = { promise, controller, subscribers: new Set(), keepAlive, settled: false }
  inFlight.set(key, entry)
  return entry
}

const subscribeToRefresh = async (entry: InFlightEntry, signal?: AbortSignal): Promise<MatchSnapshot> => {
  if (signal?.aborted) throw abortError(signal)
  const subscriber = Symbol('match-request')
  entry.subscribers.add(subscriber)
  let rejectAbort: ((reason: Error) => void) | null = null
  const aborted = signal ? new Promise<never>((_, reject) => { rejectAbort = reject }) : null
  const onAbort = () => rejectAbort?.(abortError(signal))
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await (aborted ? Promise.race([entry.promise, aborted]) : entry.promise)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    entry.subscribers.delete(subscriber)
    if (!entry.settled && !entry.keepAlive && entry.subscribers.size === 0) entry.controller.abort(abortError(signal))
  }
}

export const getMatchSnapshot = async (options: MatchQuery = {}): Promise<MatchSnapshot> => {
  if (options.signal?.aborted) throw abortError(options.signal)
  const query = normalizeQuery(options)
  const key = queryKey(query)
  const cached = readEnvelope(key)

  if (!options.forceRefresh && cached) {
    const expired = Date.now() >= Date.parse(cached.expiresAt)
    if (!cached.stale && !expired) return toSnapshot(cached)
    const stale = cached.stale ? cached : saveEnvelope(key, { ...cached, stale: true })
    const entry = startRefresh(query, key, stale, true)
    void entry.promise.catch(() => undefined)
    return toSnapshot(stale)
  }

  const entry = startRefresh(query, key, cached, false)
  return subscribeToRefresh(entry, options.signal)
}

export const getMatches = async (options: MatchQuery = {}): Promise<Match[]> => (await getMatchSnapshot(options)).data

export const getMatchById = async (id: string) => (await getMatches()).find((match) => match.id === id)

const beijingDateFormatter = createSafeDateTimeFormatter('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const toBeijingDateKey = (value: Date | string): string | null => {
  const date = typeof value === 'string' ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return null
  const parts = createRecordFromEntries(beijingDateFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value] as const))
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : null
}

export const getMatchesByDate = async (date: string) => {
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : toBeijingDateKey(date)
  if (!requested) return []
  return (await getMatches()).filter((match) => toBeijingDateKey(match.startTime) === requested)
}

export const getMatchesBySport = async (sport: Sport) => (await getMatches({ sport })).filter((match) => match.sport === sport)

export const getMatchesByLeague = async (league: string) => (await getMatches()).filter((match) => match.league === league)

export const searchMatches = async (query: string) => {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return getMatches()
  return (await getMatches()).filter((match) => [match.homeTeam.name, match.awayTeam.name, match.league, match.description ?? '', ...(match.homeTeam.players ?? []), ...(match.awayTeam.players ?? [])].join(' ').toLocaleLowerCase().includes(needle))
}

export const getLiveMatches = async () => (await getMatches()).filter((match) => match.status === 'live')

export const matchCacheTtlMs = CACHE_TTL_MS

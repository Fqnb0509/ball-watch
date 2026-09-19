import { ApiSportsResponseError, type ApiSportsDiagnostics, type ApiSportsProviderDefinition, type ApiSportsRequestFailure, type ApiSportsRequestOptions, type ApiSportsRequestResult } from './types'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_MAX_BODY_LENGTH = 2_000_000
const RETRY_DELAYS_MS = [120, 240]
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 30_000
const MAX_SAFE_ERROR_TEXT_LENGTH = 200
type CircuitState = { consecutiveFailures: number; openUntil: number }
type InFlightRequest = Promise<ApiSportsRequestResult>

const circuits = new Map<string, CircuitState>()
const inFlight = new Map<string, InFlightRequest>()

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `api-sports-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

const hasAsciiControlCharacters = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const replaceAsciiControlCharacters = (value: string): string => {
  let sanitized = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    sanitized += code <= 0x1f || code === 0x7f ? ' ' : value[index]
  }
  return sanitized
}

const redactDiagnosticText = (value: string, secret: string): string | null => {
  let sanitized = secret ? value.split(secret).join('[redacted]') : value
  sanitized = sanitized
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/(?:x-apisports-key|authorization|cookie|set-cookie|api[-_]?key|token|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;}]+)/gi, '[redacted-field]')
    .replace(/[?&](?:api[-_]?key|key|token|secret|signature|authorization)=[^&\s]+/gi, '[redacted-query]')
  sanitized = replaceAsciiControlCharacters(sanitized).slice(0, MAX_SAFE_ERROR_TEXT_LENGTH)
  return sanitized || null
}

const readProperty = (value: unknown, property: string): unknown => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    return (value as Record<string, unknown>)[property]
  } catch {
    return undefined
  }
}

const safeErrorField = (value: unknown, secret: string): string | null => {
  if (typeof value === 'string') return redactDiagnosticText(value, secret)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

const applySafeError = (diagnostics: ApiSportsDiagnostics, error: unknown, secret: string): void => {
  const cause = readProperty(error, 'cause')
  const message = typeof error === 'string' ? error : readProperty(error, 'message')
  diagnostics.errorName = safeErrorField(readProperty(error, 'name'), secret)
  diagnostics.safeErrorMessage = safeErrorField(message, secret)
  diagnostics.hasCause = cause !== undefined && cause !== null
  diagnostics.causeName = safeErrorField(readProperty(cause, 'name'), secret)
  diagnostics.causeCode = safeErrorField(readProperty(cause, 'code'), secret)
}

const clearSafeError = (diagnostics: ApiSportsDiagnostics): void => {
  diagnostics.errorName = null
  diagnostics.safeErrorMessage = null
  diagnostics.hasCause = false
  diagnostics.causeName = null
  diagnostics.causeCode = null
}

const createDiagnostics = (key: string, url: string, providerOrigin: string, providerPath: string): ApiSportsDiagnostics => {
  const trimmedKey = key.trim()
  let upstreamUrlValid = false
  let upstreamOrigin: string | null = null
  try {
    const parsed = new URL(url)
    upstreamOrigin = parsed.origin === providerOrigin ? parsed.origin : null
    upstreamUrlValid = parsed.protocol === 'https:' && parsed.origin === providerOrigin && parsed.pathname === providerPath
  } catch {
    upstreamOrigin = null
  }

  return {
    requestId: createRequestId(),
    keyPresent: trimmedKey.length > 0,
    keyLength: key.length,
    keyHasLeadingOrTrailingWhitespace: key !== trimmedKey,
    keyHasControlCharacters: hasAsciiControlCharacters(key),
    cacheHit: false,
    upstreamStatus: null,
    upstreamOk: null,
    upstreamRequestDurationMs: null,
    timeout: false,
    abort: false,
    upstreamUrlValid,
    upstreamOrigin,
    errorName: null,
    errorCode: null,
    safeErrorMessage: null,
    hasCause: false,
    causeName: null,
    causeCode: null,
    invalidJson: false,
    upstreamErrorsPresent: false,
    upstreamErrorKeys: [],
    upstreamErrorMessages: [],
    responseIsArray: null,
    responseCount: null,
    validFixtureCount: null,
    bodyTooLarge: false,
    responseStatus: null,
  }
}

const mapUpstreamStatus = (status: number): number => status === 429 ? 429 : status >= 500 ? 503 : 424

const isRetryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof ApiSportsResponseError) return error.code === 'UPSTREAM_TIMEOUT' || error.code === 'UPSTREAM_NON_2XX' && error.upstreamStatus !== null && isRetryableStatus(error.upstreamStatus)
  if (error instanceof TypeError) return true
  if (error instanceof Error && error.name === 'AbortError') return true
  const code = typeof readProperty(error, 'code') === 'string' ? String(readProperty(error, 'code')).toUpperCase() : ''
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH', 'NETWORK_ERR'].includes(code)
}

const waitForRetry = (durationMs: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(signal.reason)
    return
  }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }, durationMs)
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal.reason)
  }
  signal.addEventListener('abort', onAbort, { once: true })
})

const raceWithAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(signal.reason)
    return
  }
  const onAbort = () => reject(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort)).catch(() => undefined)
})

type JsonResult = { value: unknown; tooLarge: false; invalidJson: false } | { value: null; tooLarge: true; invalidJson: false } | { value: null; tooLarge: false; invalidJson: true }

const readJson = async (response: Response, maxBodyLength: number): Promise<JsonResult> => {
  const contentLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > maxBodyLength) return { value: null, tooLarge: true, invalidJson: false }
  const text = await response.text()
  if (text.length > maxBodyLength) return { value: null, tooLarge: true, invalidJson: false }
  try {
    return { value: JSON.parse(text) as unknown, tooLarge: false, invalidJson: false }
  } catch {
    return { value: null, tooLarge: false, invalidJson: true }
  }
}

const circuitKey = (providerId: string, cacheKey: Request): string => `${providerId}:${cacheKey.url}`

const circuitIsOpen = (providerId: string): boolean => {
  const state = circuits.get(providerId)
  if (!state) return false
  if (state.openUntil > Date.now()) return true
  circuits.set(providerId, { consecutiveFailures: CIRCUIT_FAILURE_THRESHOLD - 1, openUntil: 0 })
  return false
}

const recordCircuitFailure = (providerId: string): void => {
  const current = circuits.get(providerId) ?? { consecutiveFailures: 0, openUntil: 0 }
  const consecutiveFailures = current.consecutiveFailures + 1
  circuits.set(providerId, {
    consecutiveFailures,
    openUntil: consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_COOLDOWN_MS : 0,
  })
}

const recordCircuitSuccess = (providerId: string): void => {
  circuits.delete(providerId)
}

const notify = (options: ApiSportsRequestOptions, level: 'log' | 'error', event: string, diagnostics: ApiSportsDiagnostics): void => {
  options.log?.(level, event, diagnostics)
}

const finishDiagnostics = (diagnostics: ApiSportsDiagnostics, startedAt: number, timedOut: boolean, controller: AbortController): void => {
  diagnostics.upstreamRequestDurationMs = Math.max(0, Date.now() - startedAt)
  diagnostics.timeout = timedOut
  diagnostics.abort = controller.signal.aborted
}

const failure = (options: ApiSportsRequestOptions, diagnostics: ApiSportsDiagnostics, code: ApiSportsDiagnostics['errorCode'], status: number, error?: unknown): ApiSportsRequestFailure => {
  if (error !== undefined) applySafeError(diagnostics, error, options.key)
  diagnostics.errorCode = code
  diagnostics.responseStatus = status
  return { ok: false, status, code: code ?? 'FETCH_FAILED', diagnostics }
}

const executeFresh = async (options: ApiSportsRequestOptions, diagnostics: ApiSportsDiagnostics): Promise<ApiSportsRequestResult> => {
  const operationController = new AbortController()
  const forwardAbort = () => operationController.abort(options.requestSignal.reason)
  options.requestSignal.addEventListener('abort', forwardAbort, { once: true })
  const startedAt = Date.now()
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES)
  const maxBodyLength = options.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH
  let timedOut = false
  let lastError: unknown = null

  try {
    if (options.requestSignal.aborted) {
      operationController.abort(options.requestSignal.reason)
      finishDiagnostics(diagnostics, startedAt, false, operationController)
      return failure(options, diagnostics, 'ABORTED', 502, options.requestSignal.reason)
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const forwardOperationAbort = () => controller.abort(operationController.signal.reason)
      operationController.signal.addEventListener('abort', forwardOperationAbort, { once: true })
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort(new Error('API-Sports upstream request timed out'))
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      try {
        const response = await options.dependencies.fetch(options.url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            [options.provider.authHeader]: options.key,
          },
          credentials: 'omit',
          redirect: 'manual',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        })
        diagnostics.upstreamStatus = response.status
        diagnostics.upstreamOk = response.ok

        if (response.status >= 300 && response.status < 400) throw new ApiSportsResponseError('UPSTREAM_REDIRECT', 502, response.status)
        if (!response.ok) throw new ApiSportsResponseError('UPSTREAM_NON_2XX', mapUpstreamStatus(response.status), response.status)

        const json = await readJson(response, maxBodyLength)
        diagnostics.invalidJson = json.invalidJson
        diagnostics.bodyTooLarge = json.tooLarge
        if (json.tooLarge) throw new ApiSportsResponseError('RESPONSE_TOO_LARGE')
        if (json.invalidJson) throw new ApiSportsResponseError('INVALID_JSON')

        const result = options.buildResponse(json.value, options.dependencies.now(), diagnostics)
        finishDiagnostics(diagnostics, startedAt, false, operationController)
        diagnostics.responseStatus = result.status
        clearSafeError(diagnostics)
        diagnostics.errorCode = null
        recordCircuitSuccess(options.provider.id)
        return { ok: true, response: result, cacheHit: false, diagnostics }
      } catch (error: unknown) {
        lastError = error
        if (error instanceof ApiSportsResponseError && error.code === 'UPSTREAM_NON_2XX' && error.upstreamStatus !== null) {
          diagnostics.upstreamStatus = error.upstreamStatus
          diagnostics.upstreamOk = false
        }
        if (operationController.signal.aborted && !timedOut) {
          finishDiagnostics(diagnostics, startedAt, false, operationController)
          recordCircuitFailure(options.provider.id)
          const result = failure(options, diagnostics, 'ABORTED', 502, error)
          notify(options, 'error', 'ABORTED', diagnostics)
          return result
        }
        if (attempt < maxRetries && isRetryableError(error)) {
          await waitForRetry(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 240, operationController.signal)
          continue
        }

        finishDiagnostics(diagnostics, startedAt, timedOut, operationController)
        const code = timedOut
          ? 'UPSTREAM_TIMEOUT'
          : error instanceof ApiSportsResponseError ? error.code : 'FETCH_FAILED'
        const status = timedOut ? 504 : error instanceof ApiSportsResponseError ? error.status : 502
        recordCircuitFailure(options.provider.id)
        const result = failure(options, diagnostics, code, status, error)
        notify(options, 'error', code, diagnostics)
        return result
      } finally {
        clearTimeout(timeoutId)
        operationController.signal.removeEventListener('abort', forwardOperationAbort)
      }
    }
  } catch (error: unknown) {
    finishDiagnostics(diagnostics, startedAt, timedOut, operationController)
    recordCircuitFailure(options.provider.id)
    const result = failure(options, diagnostics, timedOut ? 'UPSTREAM_TIMEOUT' : 'FETCH_FAILED', timedOut ? 504 : 502, error ?? lastError ?? undefined)
    notify(options, 'error', result.code, diagnostics)
    return result
  } finally {
    options.requestSignal.removeEventListener('abort', forwardAbort)
  }

  finishDiagnostics(diagnostics, startedAt, timedOut, operationController)
  recordCircuitFailure(options.provider.id)
  const result = failure(options, diagnostics, timedOut ? 'UPSTREAM_TIMEOUT' : 'FETCH_FAILED', timedOut ? 504 : 502, lastError ?? undefined)
  notify(options, 'error', result.code, diagnostics)
  return result
}

export const readApiSportsCredential = (
  env: { API_FOOTBALL_KEY?: string; FOOTBALL_DATA_TOKEN?: string },
  provider: ApiSportsProviderDefinition,
): string => {
  const value = env[provider.keyEnv]
  return typeof value === 'string' ? value.trim() : ''
}

export const readApiSportsKey = (env: { API_FOOTBALL_KEY?: string }): string => (
  typeof env.API_FOOTBALL_KEY === 'string' ? env.API_FOOTBALL_KEY.trim() : ''
)

export const executeApiSportsRequest = async (options: ApiSportsRequestOptions): Promise<ApiSportsRequestResult> => {
  const diagnostics = createDiagnostics(options.key, options.url, options.provider.origin, options.provider.path ?? '')
  const key = circuitKey(options.provider.id, options.cacheKey)

  if (!diagnostics.upstreamUrlValid) return failure(options, diagnostics, 'FETCH_FAILED', 502)
  if (options.requestSignal.aborted) {
    diagnostics.abort = true
    return failure(options, diagnostics, 'ABORTED', 502, options.requestSignal.reason)
  }

  if (options.dependencies.cache) {
    try {
      const cached = await options.dependencies.cache.match(options.cacheKey)
      if (cached) {
        diagnostics.cacheHit = true
        diagnostics.responseStatus = cached.status
        return { ok: true, response: cached, cacheHit: true, diagnostics }
      }
    } catch (error: unknown) {
      applySafeError(diagnostics, error, options.key)
      diagnostics.errorName ||= 'CACHE_FAILED'
      diagnostics.errorCode = 'CACHE_FAILED'
      notify(options, 'error', 'CACHE_READ_FAILED', diagnostics)
      clearSafeError(diagnostics)
      diagnostics.errorCode = null
    }
  }

  if (circuitIsOpen(options.provider.id)) {
    const result = failure(options, diagnostics, 'CIRCUIT_OPEN', 503)
    notify(options, 'error', 'CIRCUIT_OPEN', diagnostics)
    return result
  }

  const existing = inFlight.get(key)
  if (existing) return raceWithAbort(existing, options.requestSignal)

  const operation = executeFresh(options, diagnostics).then(async (result) => {
    if (!result.ok || result.cacheHit || !options.dependencies.cache) return result
    const cacheWrite = options.dependencies.cache.put(options.cacheKey, result.response.clone()).catch((error: unknown) => {
      const writeDiagnostics = result.diagnostics
      applySafeError(writeDiagnostics, error, options.key)
      writeDiagnostics.errorName ||= 'CACHE_FAILED'
      writeDiagnostics.errorCode = 'CACHE_FAILED'
      notify(options, 'error', 'CACHE_WRITE_FAILED', writeDiagnostics)
    })
    if (options.waitUntil) options.waitUntil(cacheWrite)
    else await cacheWrite
    return result
  }).finally(() => {
    if (inFlight.get(key) === operation) inFlight.delete(key)
  })

  inFlight.set(key, operation)
  return raceWithAbort(operation, options.requestSignal)
}

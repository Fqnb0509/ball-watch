export type ApiSportsSport = 'football' | 'basketball' | 'baseball' | 'tennis' | (string & {})

export type ApiSportsProviderDefinition = {
  readonly id: string
  readonly sport: ApiSportsSport
  readonly origin: string
  readonly path: string | null
  readonly keyEnv: 'API_FOOTBALL_KEY'
  readonly enabled: boolean
}

export type ApiSportsSecretEnv = {
  API_FOOTBALL_KEY?: string
}

export type ApiSportsCache = Pick<Cache, 'match' | 'put'>

export type ApiSportsDependencies = {
  fetch: typeof fetch
  now: () => Date
  cache: ApiSportsCache | null
}

export type ApiSportsErrorCode =
  | 'CACHE_FAILED'
  | 'FETCH_FAILED'
  | 'ABORTED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_REDIRECT'
  | 'UPSTREAM_NON_2XX'
  | 'INVALID_JSON'
  | 'UPSTREAM_ERRORS'
  | 'INVALID_RESPONSE_SCHEMA'
  | 'RESPONSE_TOO_LARGE'
  | 'CIRCUIT_OPEN'

export type ApiSportsDiagnostics = {
  requestId: string
  keyPresent: boolean
  keyLength: number
  keyHasLeadingOrTrailingWhitespace: boolean
  keyHasControlCharacters: boolean
  cacheHit: boolean
  upstreamStatus: number | null
  upstreamOk: boolean | null
  upstreamRequestDurationMs: number | null
  timeout: boolean
  abort: boolean
  upstreamUrlValid: boolean
  upstreamOrigin: string | null
  errorName: string | null
  errorCode: ApiSportsErrorCode | null
  safeErrorMessage: string | null
  hasCause: boolean
  causeName: string | null
  causeCode: string | null
  invalidJson: boolean
  upstreamErrorsPresent: boolean
  upstreamErrorKeys: string[]
  upstreamErrorMessages: string[]
  responseIsArray: boolean | null
  responseCount: number | null
  validFixtureCount: number | null
  bodyTooLarge: boolean
  responseStatus: number | null
}

export class ApiSportsResponseError extends Error {
  readonly code: ApiSportsErrorCode
  readonly status: number
  readonly upstreamStatus: number | null

  constructor(code: ApiSportsErrorCode, status = 502, upstreamStatus: number | null = null) {
    super(code)
    this.name = 'ApiSportsResponseError'
    this.code = code
    this.status = status
    this.upstreamStatus = upstreamStatus
  }
}

export type ApiSportsRequestSuccess = {
  ok: true
  response: Response
  cacheHit: boolean
  diagnostics: ApiSportsDiagnostics
}

export type ApiSportsRequestFailure = {
  ok: false
  status: number
  code: ApiSportsErrorCode
  diagnostics: ApiSportsDiagnostics
}

export type ApiSportsRequestResult = ApiSportsRequestSuccess | ApiSportsRequestFailure

export type ApiSportsDiagnosticLogger = (
  level: 'log' | 'error',
  event: string,
  diagnostics: ApiSportsDiagnostics,
) => void

export type ApiSportsRequestOptions = {
  provider: ApiSportsProviderDefinition
  url: string
  cacheKey: Request
  key: string
  requestSignal: AbortSignal
  dependencies: ApiSportsDependencies
  waitUntil?: (promise: Promise<unknown>) => void
  timeoutMs?: number
  maxRetries?: number
  maxBodyLength?: number
  buildResponse: (raw: unknown, fetchedAt: Date, diagnostics: ApiSportsDiagnostics) => Response
  log?: ApiSportsDiagnosticLogger
}

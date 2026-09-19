import { executeApiSportsRequest, readApiSportsKey } from './api-sports/base-provider'
import { apiFootballProvider } from './api-sports/registry'
import { ApiSportsResponseError, type ApiSportsCache, type ApiSportsSecretEnv } from './api-sports/types'

const API_FOOTBALL_FIXTURES_URL = `${apiFootballProvider.origin}${apiFootballProvider.path ?? ''}`
const DEFAULT_LEAGUE_ID = '39'
const DEFAULT_SEASON = '2026'
const DEFAULT_RANGE_DAYS = 7
const MAX_RANGE_DAYS = 14
const UPSTREAM_TIMEOUT_MS = 8_000
const EDGE_CACHE_TTL_SECONDS = 300
const MAX_UPSTREAM_BODY_LENGTH = 2_000_000
const DAY_MS = 86_400_000
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const OFFSET_DATE_TIME_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i

export type MatchDateRange = {
  from: string
  to: string
}

export type ApiFootballFixtureDto = {
  fixture: {
    id: number
    date: string
    timezone: string | null
    status: { short: string }
    venue: { name: string | null }
  }
  league: {
    id: number
    name: string
    round: string | null
    season: number
  }
  teams: {
    home: { id: number; name: string }
    away: { id: number; name: string }
  }
  goals: {
    home: number | null
    away: number | null
  }
}

export type ApiFootballMatchesPayload = {
  provider: 'api-football'
  fetchedAt: string
  sourceUpdatedAt: null
  expiresAt: string
  matches: ApiFootballFixtureDto[]
}

type ApiFootballEnv = ApiSportsSecretEnv & {
  API_FOOTBALL_LEAGUE_ID?: string
  API_FOOTBALL_SEASON?: string
}

type PagesFunctionContext = {
  request: Request
  env: ApiFootballEnv
  waitUntil?: (promise: Promise<unknown>) => void
}

type MatchesFunctionDependencies = {
  fetch: typeof fetch
  now: () => Date
  cache: Pick<Cache, 'match' | 'put'> | null
}

type DiagnosticErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_DATE'
  | 'INVALID_RANGE'
  | 'CONFIG_INVALID'
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

type MatchDiagnostics = {
  requestId: string
  from: string | null
  to: string | null
  leagueId: string
  season: string
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
  errorCode: DiagnosticErrorCode | null
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

type DateRangeResult =
  | { ok: true; value: MatchDateRange }
  | { ok: false; code: 'INVALID_QUERY' | 'INVALID_DATE' | 'INVALID_RANGE' }

type MinimizedResponse =
  | { ok: true; matches: ApiFootballFixtureDto[] }
  | { ok: false }

type ApiFootballConfig = {
  key: string
  leagueId: string
  season: string
}

const formatUtcDateKey = (date: Date): string => date.toISOString().slice(0, 10)

const parseDateKey = (value: string): number | null => {
  if (!DATE_KEY_PATTERN.test(value)) return null

  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const timestamp = Date.UTC(year, month - 1, day)

  if (!Number.isFinite(timestamp)) return null
  return formatUtcDateKey(new Date(timestamp)) === value ? timestamp : null
}

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `matches-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

const diagnosticConfigValue = (
  value: string | undefined,
  pattern: RegExp,
  fallback: string,
): string => {
  if (value === undefined) return fallback
  const normalized = value.trim()
  return pattern.test(normalized) ? normalized : 'invalid'
}

const MAX_SAFE_ERROR_TEXT_LENGTH = 200

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
  let sanitized = value
  if (secret) sanitized = sanitized.split(secret).join('[redacted]')
  sanitized = sanitized
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/(?:x-apisports-key|authorization|cookie|set-cookie|api[-_]?key|token|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;}]+)/gi, '[redacted-field]')
    .replace(/[?&](?:api[-_]?key|key|token|secret|signature|authorization)=[^&\s]+/gi, '[redacted-query]')
  sanitized = replaceAsciiControlCharacters(sanitized).slice(0, MAX_SAFE_ERROR_TEXT_LENGTH)
  return sanitized || null
}

const createDiagnostics = (env: ApiFootballEnv): MatchDiagnostics => {
  const rawKey = typeof env.API_FOOTBALL_KEY === 'string' ? env.API_FOOTBALL_KEY : ''
  const trimmedKey = rawKey.trim()
  return {
    requestId: createRequestId(),
    from: null,
    to: null,
    leagueId: diagnosticConfigValue(env.API_FOOTBALL_LEAGUE_ID, /^\d{1,10}$/, DEFAULT_LEAGUE_ID),
    season: diagnosticConfigValue(env.API_FOOTBALL_SEASON, /^\d{4}$/, DEFAULT_SEASON),
    keyPresent: trimmedKey.length > 0,
    keyLength: rawKey.length,
    keyHasLeadingOrTrailingWhitespace: rawKey !== trimmedKey,
    keyHasControlCharacters: hasAsciiControlCharacters(rawKey),
    cacheHit: false,
    upstreamStatus: null,
    upstreamOk: null,
    upstreamRequestDurationMs: null,
    timeout: false,
    abort: false,
    upstreamUrlValid: false,
    upstreamOrigin: null,
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

const logDiagnostics = (
  level: 'log' | 'error',
  event: string,
  diagnostics: MatchDiagnostics,
): void => {
  const entry = { service: 'matches', event, ...diagnostics }
  if (level === 'error') console.error(entry)
  else console.log(entry)
}

const addUtcDays = (dateKey: string, days: number): string => {
  const timestamp = parseDateKey(dateKey)
  if (timestamp === null) throw new Error('A validated date key is required')
  return formatUtcDateKey(new Date(timestamp + days * DAY_MS))
}

/** Parses only the public query parameters accepted by this endpoint. */
export const parseMatchDateRange = (searchParams: URLSearchParams, now: Date): DateRangeResult => {
  let hasUnexpectedParameter = false
  searchParams.forEach((_value, key) => {
    if (key !== 'from' && key !== 'to') hasUnexpectedParameter = true
  })

  if (hasUnexpectedParameter || searchParams.getAll('from').length > 1 || searchParams.getAll('to').length > 1) {
    return { ok: false, code: 'INVALID_QUERY' }
  }

  const nowTimestamp = now.getTime()
  if (!Number.isFinite(nowTimestamp)) return { ok: false, code: 'INVALID_DATE' }

  const today = formatUtcDateKey(now)
  const from = searchParams.get('from') ?? today
  const fromTimestamp = parseDateKey(from)
  if (fromTimestamp === null) return { ok: false, code: 'INVALID_DATE' }

  const to = searchParams.get('to') ?? addUtcDays(from, DEFAULT_RANGE_DAYS)
  const toTimestamp = parseDateKey(to)

  if (toTimestamp === null) return { ok: false, code: 'INVALID_DATE' }
  if (toTimestamp < fromTimestamp || toTimestamp - fromTimestamp > MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, code: 'INVALID_RANGE' }
  }

  return { ok: true, value: { from, to } }
}

const readRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const readPositiveInteger = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
)

const readScore = (value: unknown): number | null | undefined => {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

const readText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= maxLength ? text : null
}

const readNullableText = (value: unknown, maxLength: number): string | null | undefined => {
  if (value === null || value === undefined) return null
  return readText(value, maxLength) ?? undefined
}

const hasUpstreamErrors = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  const record = readRecord(value)
  return record ? Object.keys(record).length > 0 : value !== null && value !== undefined
}

const MAX_UPSTREAM_ERROR_ITEMS = 20
const SENSITIVE_UPSTREAM_ERROR_KEY_PATTERN = /(?:api[-_]?key|token|password|authorization|secret|cookie)/i

const upstreamErrorTypeMarker = (value: unknown): string => {
  if (value === null) return '[null]'
  if (Array.isArray(value)) return '[array]'
  switch (typeof value) {
    case 'boolean': return '[boolean]'
    case 'function': return '[function]'
    case 'number': return '[number]'
    case 'object': return '[object]'
    case 'string': return '[string]'
    case 'symbol': return '[symbol]'
    case 'undefined': return '[undefined]'
    default: return '[unknown]'
  }
}

const safeUpstreamErrorKey = (key: string, secret: string): string => {
  const sanitized = redactDiagnosticText(key, secret)
  if (!sanitized) return '[empty-key]'
  return SENSITIVE_UPSTREAM_ERROR_KEY_PATTERN.test(sanitized) ? '[sensitive-key]' : sanitized
}

const safeUpstreamErrorMessage = (value: unknown, secret: string): string => {
  if (typeof value !== 'string') return upstreamErrorTypeMarker(value)
  return redactDiagnosticText(value, secret) ?? '[empty-string]'
}

const summarizeUpstreamErrors = (
  value: unknown,
  secret: string,
): Pick<MatchDiagnostics, 'upstreamErrorKeys' | 'upstreamErrorMessages'> => {
  const record = readRecord(value)
  if (record) {
    const entries = Object.entries(record).slice(0, MAX_UPSTREAM_ERROR_ITEMS)
    return {
      upstreamErrorKeys: entries.map(([key]) => safeUpstreamErrorKey(key, secret)),
      upstreamErrorMessages: entries.map(([, message]) => safeUpstreamErrorMessage(message, secret)),
    }
  }

  if (Array.isArray(value)) {
    return {
      upstreamErrorKeys: [],
      upstreamErrorMessages: value
        .slice(0, MAX_UPSTREAM_ERROR_ITEMS)
        .map((message) => safeUpstreamErrorMessage(message, secret)),
    }
  }

  if (value !== null && value !== undefined) {
    return { upstreamErrorKeys: [], upstreamErrorMessages: [safeUpstreamErrorMessage(value, secret)] }
  }

  return { upstreamErrorKeys: [], upstreamErrorMessages: [] }
}

const minimizeFixture = (value: unknown): ApiFootballFixtureDto | null => {
  const item = readRecord(value)
  const fixture = readRecord(item?.fixture)
  const status = readRecord(fixture?.status)
  const venue = fixture?.venue === null ? null : readRecord(fixture?.venue)
  const league = readRecord(item?.league)
  const teams = readRecord(item?.teams)
  const home = readRecord(teams?.home)
  const away = readRecord(teams?.away)
  const goals = readRecord(item?.goals)

  const fixtureId = readPositiveInteger(fixture?.id)
  const fixtureDate = readText(fixture?.date, 64)
  const timezone = readNullableText(fixture?.timezone, 64)
  const statusShort = readText(status?.short, 16)
  const venueName = venue ? readNullableText(venue.name, 200) : null
  const leagueId = readPositiveInteger(league?.id)
  const leagueName = readText(league?.name, 200)
  const leagueRound = readNullableText(league?.round, 200)
  const leagueSeason = readPositiveInteger(league?.season)
  const homeId = readPositiveInteger(home?.id)
  const homeName = readText(home?.name, 200)
  const awayId = readPositiveInteger(away?.id)
  const awayName = readText(away?.name, 200)
  const homeGoals = readScore(goals?.home)
  const awayGoals = readScore(goals?.away)

  if (
    fixtureId === null
    || !fixtureDate
    || !OFFSET_DATE_TIME_PATTERN.test(fixtureDate)
    || !Number.isFinite(Date.parse(fixtureDate))
    || timezone === undefined
    || !statusShort
    || venueName === undefined
    || leagueId === null
    || !leagueName
    || leagueRound === undefined
    || leagueSeason === null
    || homeId === null
    || !homeName
    || awayId === null
    || !awayName
    || homeGoals === undefined
    || awayGoals === undefined
  ) return null

  return {
    fixture: {
      id: fixtureId,
      date: fixtureDate,
      timezone,
      status: { short: statusShort },
      venue: { name: venueName },
    },
    league: {
      id: leagueId,
      name: leagueName,
      round: leagueRound,
      season: leagueSeason,
    },
    teams: {
      home: { id: homeId, name: homeName },
      away: { id: awayId, name: awayName },
    },
    goals: { home: homeGoals, away: awayGoals },
  }
}

/** Removes all upstream fields that FIELDWATCH does not consume. */
export const minimizeApiFootballResponse = (raw: unknown): MinimizedResponse => {
  const body = readRecord(raw)
  if (!body || hasUpstreamErrors(body.errors) || !Array.isArray(body.response)) return { ok: false }

  const matches = body.response
    .map(minimizeFixture)
    .filter((fixture): fixture is ApiFootballFixtureDto => fixture !== null)

  if (body.response.length > 0 && matches.length === 0) return { ok: false }
  return { ok: true, matches }
}

const inspectApiFootballResponse = (raw: unknown, secret: string): Pick<
  MatchDiagnostics,
  | 'upstreamErrorsPresent'
  | 'upstreamErrorKeys'
  | 'upstreamErrorMessages'
  | 'responseIsArray'
  | 'responseCount'
  | 'validFixtureCount'
> => {
  const body = readRecord(raw)
  const response = body?.response
  const responseIsArray = Array.isArray(response)
  const responseCount = responseIsArray ? response.length : null
  const validFixtureCount = responseIsArray
    ? response.filter((item) => minimizeFixture(item) !== null).length
    : null
  const errorSummary = summarizeUpstreamErrors(body?.errors, secret)

  return {
    upstreamErrorsPresent: hasUpstreamErrors(body?.errors),
    ...errorSummary,
    responseIsArray,
    responseCount,
    validFixtureCount,
  }
}

const resolveConfig = (env: ApiFootballEnv): ApiFootballConfig | null => {
  const key = readApiSportsKey(env)
  const leagueId = typeof env.API_FOOTBALL_LEAGUE_ID === 'string'
    ? env.API_FOOTBALL_LEAGUE_ID.trim()
    : DEFAULT_LEAGUE_ID
  const season = typeof env.API_FOOTBALL_SEASON === 'string'
    ? env.API_FOOTBALL_SEASON.trim()
    : DEFAULT_SEASON

  if (!key || !/^\d{1,10}$/.test(leagueId) || !/^\d{4}$/.test(season)) return null
  return { key, leagueId, season }
}

/** Builds the one fixed upstream URL. No client-controlled URL or query is forwarded. */
export const buildApiFootballFixturesUrl = (
  range: MatchDateRange,
  leagueId: string,
  season: string,
): string => {
  const url = new URL(API_FOOTBALL_FIXTURES_URL)
  url.searchParams.set('from', range.from)
  url.searchParams.set('to', range.to)
  url.searchParams.set('league', leagueId)
  url.searchParams.set('season', season)
  url.searchParams.set('timezone', 'UTC')
  return url.toString()
}

const securityHeaders = (): Headers => {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'")
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  return headers
}

const jsonResponse = (payload: unknown, status: number, cacheable = false): Response => {
  const headers = securityHeaders()
  if (cacheable) {
    headers.set('Cache-Control', `public, max-age=60, s-maxage=${EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=60`)
    headers.set('CDN-Cache-Control', `public, max-age=${EDGE_CACHE_TTL_SECONDS}`)
  } else {
    headers.set('Cache-Control', 'no-store')
  }
  return new Response(JSON.stringify(payload), { status, headers })
}

const errorResponse = (
  status: number,
  code: 'INVALID_QUERY' | 'INVALID_DATE' | 'INVALID_RANGE' | 'SERVICE_UNAVAILABLE' | 'UPSTREAM_TIMEOUT',
): Response => jsonResponse({ error: { code, message: 'Match data is currently unavailable.' } }, status)

const buildCacheKey = (
  requestUrl: string,
  range: MatchDateRange,
  config: Pick<ApiFootballConfig, 'leagueId' | 'season'>,
): Request => {
  const url = new URL(requestUrl)
  url.search = ''
  url.searchParams.set('from', range.from)
  url.searchParams.set('to', range.to)
  url.searchParams.set('__league', config.leagueId)
  url.searchParams.set('__season', config.season)
  return new Request(url.toString(), { method: 'GET' })
}

const responseWithCacheStatus = (response: Response, status: 'HIT' | 'MISS'): Response => {
  const headers = new Headers(response.headers)
  headers.set('X-Fieldwatch-Cache', status)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const runtimeCache = (): ApiSportsCache | null => {
  const runtime = globalThis as unknown as { caches?: { default?: ApiSportsCache } }
  return runtime.caches?.default ?? null
}

const defaultDependencies = (): MatchesFunctionDependencies => ({
  fetch: globalThis.fetch.bind(globalThis),
  now: () => new Date(),
  cache: runtimeCache(),
})

export const handleMatchesRequest = async (
  context: PagesFunctionContext,
  dependencies: MatchesFunctionDependencies = defaultDependencies(),
): Promise<Response> => {
  const diagnostics = createDiagnostics(context.env)
  const url = new URL(context.request.url)
  const dateRange = parseMatchDateRange(url.searchParams, dependencies.now())
  if (!dateRange.ok) {
    diagnostics.errorName = dateRange.code
    diagnostics.errorCode = dateRange.code
    diagnostics.responseStatus = 400
    logDiagnostics('error', 'REQUEST_REJECTED', diagnostics)
    return errorResponse(400, dateRange.code)
  }

  diagnostics.from = dateRange.value.from
  diagnostics.to = dateRange.value.to

  const config = resolveConfig(context.env)
  if (!config) {
    diagnostics.errorName = 'CONFIG_INVALID'
    diagnostics.errorCode = 'CONFIG_INVALID'
    diagnostics.responseStatus = 503
    logDiagnostics('error', 'CONFIG_INVALID', diagnostics)
    return errorResponse(503, 'SERVICE_UNAVAILABLE')
  }

  diagnostics.leagueId = config.leagueId
  diagnostics.season = config.season

  const cacheKey = buildCacheKey(context.request.url, dateRange.value, config)

  const upstreamUrl = buildApiFootballFixturesUrl(dateRange.value, config.leagueId, config.season)
  const requestResult = await executeApiSportsRequest({
    provider: apiFootballProvider,
    url: upstreamUrl,
    cacheKey,
    key: config.key,
    requestSignal: context.request.signal,
    dependencies,
    waitUntil: context.waitUntil,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    maxRetries: 2,
    maxBodyLength: MAX_UPSTREAM_BODY_LENGTH,
    log: (level, event, baseDiagnostics) => {
      Object.assign(diagnostics, baseDiagnostics)
      logDiagnostics(level, event, diagnostics)
    },
    buildResponse: (raw, fetchedAtDate, baseDiagnostics) => {
      Object.assign(baseDiagnostics, inspectApiFootballResponse(raw, config.key))
      const minimized = minimizeApiFootballResponse(raw)
      if (!minimized.ok) {
        const errorCode = baseDiagnostics.upstreamErrorsPresent
          ? 'UPSTREAM_ERRORS'
          : 'INVALID_RESPONSE_SCHEMA'
        baseDiagnostics.errorName = errorCode
        baseDiagnostics.errorCode = errorCode
        throw new ApiSportsResponseError(errorCode)
      }

      const fetchedAt = fetchedAtDate.toISOString()
      const expiresAt = new Date(fetchedAtDate.getTime() + EDGE_CACHE_TTL_SECONDS * 1_000).toISOString()
      const payload: ApiFootballMatchesPayload = {
        provider: 'api-football',
        fetchedAt,
        sourceUpdatedAt: null,
        expiresAt,
        matches: minimized.matches,
      }
      return jsonResponse(payload, 200, true)
    },
  })

  Object.assign(diagnostics, requestResult.diagnostics)
  if (!requestResult.ok) {
    const publicCode = requestResult.code === 'UPSTREAM_TIMEOUT' ? 'UPSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE'
    return errorResponse(requestResult.status, publicCode)
  }

  diagnostics.responseStatus = requestResult.response.status
  logDiagnostics('log', requestResult.cacheHit ? 'CACHE_HIT' : 'UPSTREAM_OK', diagnostics)
  return responseWithCacheStatus(requestResult.response, requestResult.cacheHit ? 'HIT' : 'MISS')
}

export const onRequestGet = (context: PagesFunctionContext): Promise<Response> => handleMatchesRequest(context)

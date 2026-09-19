const API_FOOTBALL_FIXTURES_URL = 'https://v3.football.api-sports.io/fixtures'
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

type ApiFootballEnv = {
  API_FOOTBALL_KEY?: string
  API_FOOTBALL_LEAGUE_ID?: string
  API_FOOTBALL_SEASON?: string
}

type PagesFunctionContext = {
  request: Request
  env: ApiFootballEnv
  waitUntil?: (promise: Promise<unknown>) => void
}

type EdgeCache = Pick<Cache, 'match' | 'put'>

type MatchesFunctionDependencies = {
  fetch: typeof fetch
  now: () => Date
  cache: EdgeCache | null
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

const resolveConfig = (env: ApiFootballEnv): ApiFootballConfig | null => {
  const key = typeof env.API_FOOTBALL_KEY === 'string' ? env.API_FOOTBALL_KEY.trim() : ''
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

const runtimeCache = (): EdgeCache | null => {
  const runtime = globalThis as unknown as { caches?: { default?: EdgeCache } }
  return runtime.caches?.default ?? null
}

const defaultDependencies = (): MatchesFunctionDependencies => ({
  fetch: globalThis.fetch.bind(globalThis),
  now: () => new Date(),
  cache: runtimeCache(),
})

const readUpstreamJson = async (response: Response): Promise<unknown | null> => {
  const contentLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_BODY_LENGTH) return null

  const text = await response.text()
  if (text.length > MAX_UPSTREAM_BODY_LENGTH) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export const handleMatchesRequest = async (
  context: PagesFunctionContext,
  dependencies: MatchesFunctionDependencies = defaultDependencies(),
): Promise<Response> => {
  const url = new URL(context.request.url)
  const dateRange = parseMatchDateRange(url.searchParams, dependencies.now())
  if (!dateRange.ok) return errorResponse(400, dateRange.code)

  const config = resolveConfig(context.env)
  if (!config) return errorResponse(503, 'SERVICE_UNAVAILABLE')

  const cacheKey = buildCacheKey(context.request.url, dateRange.value, config)
  if (dependencies.cache) {
    try {
      const cached = await dependencies.cache.match(cacheKey)
      if (cached) return responseWithCacheStatus(cached, 'HIT')
    } catch {
      // An unavailable edge cache must not make the data source unavailable.
    }
  }

  const controller = new AbortController()
  let timedOut = false
  const abortForClient = () => controller.abort()
  if (context.request.signal.aborted) controller.abort()
  else context.request.signal.addEventListener('abort', abortForClient, { once: true })

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, UPSTREAM_TIMEOUT_MS)

  let upstreamResponse: Response
  let raw: unknown | null
  try {
    upstreamResponse = await dependencies.fetch(
      buildApiFootballFixturesUrl(dateRange.value, config.leagueId, config.season),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-apisports-key': config.key,
        },
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      },
    )

    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status === 429 ? 429 : upstreamResponse.status >= 500 ? 503 : 424
      return errorResponse(status, 'SERVICE_UNAVAILABLE')
    }

    raw = await readUpstreamJson(upstreamResponse)
  } catch {
    return errorResponse(timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE')
  } finally {
    clearTimeout(timeoutId)
    context.request.signal.removeEventListener('abort', abortForClient)
  }

  const minimized = minimizeApiFootballResponse(raw)
  if (!minimized.ok) return errorResponse(502, 'SERVICE_UNAVAILABLE')

  const fetchedAtDate = dependencies.now()
  const fetchedAt = fetchedAtDate.toISOString()
  const expiresAt = new Date(fetchedAtDate.getTime() + EDGE_CACHE_TTL_SECONDS * 1_000).toISOString()
  const payload: ApiFootballMatchesPayload = {
    provider: 'api-football',
    fetchedAt,
    sourceUpdatedAt: null,
    expiresAt,
    matches: minimized.matches,
  }
  const response = jsonResponse(payload, 200, true)

  if (dependencies.cache) {
    const cacheWrite = dependencies.cache.put(cacheKey, response.clone()).catch(() => undefined)
    if (context.waitUntil) context.waitUntil(cacheWrite)
    else await cacheWrite
  }

  return responseWithCacheStatus(response, 'MISS')
}

export const onRequestGet = (context: PagesFunctionContext): Promise<Response> => handleMatchesRequest(context)

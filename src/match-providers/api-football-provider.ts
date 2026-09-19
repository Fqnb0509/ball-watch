import { normalizeMatches } from '../services/match-normalizer'
import type { Match, Sport } from '../types'
import {
  API_FOOTBALL_PROVIDER_ID,
  mapApiFootballStatus,
  parseApiFootballEnvelope,
} from './api-football-schema'
import type { ApiFootballFixtureDto, ParsedApiFootballEnvelope } from './api-football-schema'
import type { MatchProvider, MatchProviderRequest, MatchProviderResult, ProviderMetadata } from './types'
import { buildMatchApiPath } from '../runtime-config'
const SUPPORTED_SPORTS: readonly Sport[] = ['football']
const INVALID_RESPONSE_ERROR = '赛事数据服务返回了无效数据'
const INVALID_RECORD_ERROR = '部分赛事数据记录无效，已安全忽略'

const METADATA: ProviderMetadata = {
  id: API_FOOTBALL_PROVIDER_ID,
  name: 'API-Football Match Provider',
  sourceName: 'API-Football',
  supportedSports: SUPPORTED_SPORTS,
}

export class ApiFootballProviderError extends Error {
  readonly status: number

  constructor(status: number) {
    super(status === 400
      ? '赛事数据请求无效'
      : status === 429
        ? '赛事数据服务请求额度暂时受限'
        : '赛事数据服务暂时不可用')
    this.name = 'ApiFootballProviderError'
    this.status = status
  }
}

const toDateParameter = (value: string | undefined): string | null => {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null
}

export const buildApiFootballRequestPath = (request?: MatchProviderRequest): string => {
  const parameters = new URLSearchParams([['provider', API_FOOTBALL_PROVIDER_ID]])
  const from = toDateParameter(request?.from)
  const to = toDateParameter(request?.to)
  if (from) parameters.set('from', from)
  if (to) parameters.set('to', to)
  const query = parameters.toString()
  return buildMatchApiPath(query)
}

const mapFixture = (item: ApiFootballFixtureDto): Match => {
  const eventId = String(item.fixture.id)
  const startTime = new Date(item.fixture.date).toISOString()
  const completeScore = item.goals.home !== null && item.goals.away !== null

  return {
    id: `${API_FOOTBALL_PROVIDER_ID}-${eventId}`,
    sport: 'football',
    league: item.league.name.trim(),
    ...(item.league.round ? { round: item.league.round.trim() } : {}),
    homeTeam: {
      id: `${API_FOOTBALL_PROVIDER_ID}:team:${item.teams.home.id}`,
      name: item.teams.home.name.trim(),
    },
    awayTeam: {
      id: `${API_FOOTBALL_PROVIDER_ID}:team:${item.teams.away.id}`,
      name: item.teams.away.name.trim(),
    },
    startTime,
    date: startTime,
    status: mapApiFootballStatus(item.fixture.status.short),
    ...(item.fixture.venue.name ? { venue: item.fixture.venue.name.trim() } : {}),
    ...(completeScore ? { score: [item.goals.home as number, item.goals.away as number] as [number, number] } : {}),
    streamIds: [],
    sourceProvider: API_FOOTBALL_PROVIDER_ID,
    providerEventId: eventId,
    originalStartTime: item.fixture.date,
    ...(item.fixture.timezone ? { timezone: item.fixture.timezone } : {}),
    externalIds: { [API_FOOTBALL_PROVIDER_ID]: eventId },
  }
}

const resultMetadata = (
  envelope: Pick<ParsedApiFootballEnvelope, 'fetchedAt' | 'sourceUpdatedAt' | 'expiresAt'>,
  error: string | null,
): ProviderMetadata => ({
  ...METADATA,
  fetchedAt: envelope.fetchedAt,
  sourceUpdatedAt: envelope.sourceUpdatedAt,
  expiresAt: envelope.expiresAt,
  stale: Date.now() >= Date.parse(envelope.expiresAt),
  error,
  fallback: false,
})

const invalidResult = (): MatchProviderResult => {
  const fetchedAt = new Date().toISOString()
  return {
    provider: API_FOOTBALL_PROVIDER_ID,
    matches: [],
    metadata: { ...METADATA, fetchedAt, sourceUpdatedAt: null, expiresAt: null, stale: false, error: INVALID_RESPONSE_ERROR, fallback: false },
    fetchedAt,
    sourceUpdatedAt: null,
    expiresAt: null,
    stale: false,
    error: INVALID_RESPONSE_ERROR,
    fallback: false,
  }
}

const normalizeResponse = (raw: unknown): MatchProviderResult => {
  const envelope = parseApiFootballEnvelope(raw)
  if (!envelope) return invalidResult()

  const mapped = envelope.matches.map(mapFixture)
  const matches = normalizeMatches(mapped, API_FOOTBALL_PROVIDER_ID)
  const discardedCount = envelope.invalidRecordCount + mapped.length - matches.length
  const error = discardedCount > 0 ? INVALID_RECORD_ERROR : null
  const stale = Date.now() >= Date.parse(envelope.expiresAt)

  return {
    provider: API_FOOTBALL_PROVIDER_ID,
    matches,
    metadata: resultMetadata(envelope, error),
    fetchedAt: envelope.fetchedAt,
    sourceUpdatedAt: envelope.sourceUpdatedAt,
    expiresAt: envelope.expiresAt,
    stale,
    error,
    fallback: false,
  }
}

export const apiFootballMatchProvider: MatchProvider = {
  id: API_FOOTBALL_PROVIDER_ID,
  priority: 20,
  supportedSports: SUPPORTED_SPORTS,
  metadata: METADATA,
  fetch: async (request) => {
    const response = await fetch(buildApiFootballRequestPath(request), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: request?.signal,
    })
    if (!response.ok) throw new ApiFootballProviderError(response.status)
    return response.json() as Promise<unknown>
  },
  normalize: normalizeResponse,
}

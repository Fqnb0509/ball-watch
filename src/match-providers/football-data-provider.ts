import { normalizeMatches } from '../services/match-normalizer'
import type { Match, Sport } from '../types'
import {
  FOOTBALL_DATA_PROVIDER_ID,
  mapFootballDataStatus,
  parseFootballDataEnvelope,
} from './football-data-schema'
import type { FootballDataMatchDto, ParsedFootballDataEnvelope } from './football-data-schema'
import type { MatchProvider, MatchProviderRequest, MatchProviderResult, ProviderMetadata } from './types'
import { buildMatchApiPath } from '../runtime-config'
const SUPPORTED_SPORTS: readonly Sport[] = ['football']
const INVALID_RESPONSE_ERROR = '赛事数据服务返回了无效数据'
const INVALID_RECORD_ERROR = '部分赛事数据记录无效，已安全忽略'

const METADATA: ProviderMetadata = {
  id: FOOTBALL_DATA_PROVIDER_ID,
  name: 'football-data.org Match Provider',
  sourceName: 'football-data.org',
  supportedSports: SUPPORTED_SPORTS,
}

export class FootballDataProviderError extends Error {
  readonly status: number

  constructor(status: number) {
    super(status === 429 ? '赛事数据服务请求额度暂时受限' : '赛事数据服务暂时不可用')
    this.name = 'FootballDataProviderError'
    this.status = status
  }
}

const toDateParameter = (value: string | undefined): string | null => {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null
}

export const buildFootballDataRequestPath = (request?: MatchProviderRequest): string => {
  const parameters = new URLSearchParams([['provider', FOOTBALL_DATA_PROVIDER_ID]])
  const from = toDateParameter(request?.from)
  const to = toDateParameter(request?.to)
  if (from) parameters.set('from', from)
  if (to) parameters.set('to', to)
  return buildMatchApiPath(parameters.toString())
}

const mapMatch = (item: FootballDataMatchDto): Match => {
  const eventId = String(item.id)
  const startTime = new Date(item.utcDate).toISOString()
  const completeScore = item.score.fullTime.home !== null && item.score.fullTime.away !== null

  return {
    id: `${FOOTBALL_DATA_PROVIDER_ID}-${eventId}`,
    sport: 'football',
    league: item.competition.name.trim(),
    ...(item.matchday !== null ? { round: `Matchday ${item.matchday}` } : {}),
    homeTeam: {
      id: `${FOOTBALL_DATA_PROVIDER_ID}:team:${item.homeTeam.id}`,
      name: item.homeTeam.name.trim(),
    },
    awayTeam: {
      id: `${FOOTBALL_DATA_PROVIDER_ID}:team:${item.awayTeam.id}`,
      name: item.awayTeam.name.trim(),
    },
    startTime,
    date: startTime,
    status: mapFootballDataStatus(item.status),
    ...(item.venue ? { venue: item.venue.trim() } : {}),
    ...(completeScore
      ? { score: [item.score.fullTime.home as number, item.score.fullTime.away as number] as [number, number] }
      : {}),
    streamIds: [],
    sourceProvider: FOOTBALL_DATA_PROVIDER_ID,
    providerEventId: eventId,
    originalStartTime: item.utcDate,
    timezone: 'UTC',
    externalIds: { [FOOTBALL_DATA_PROVIDER_ID]: eventId },
  }
}

const resultMetadata = (
  envelope: Pick<ParsedFootballDataEnvelope, 'fetchedAt' | 'sourceUpdatedAt' | 'expiresAt'>,
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
    provider: FOOTBALL_DATA_PROVIDER_ID,
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
  const envelope = parseFootballDataEnvelope(raw)
  if (!envelope) return invalidResult()

  const mapped = envelope.matches.map(mapMatch)
  const matches = normalizeMatches(mapped, FOOTBALL_DATA_PROVIDER_ID)
  const discardedCount = envelope.invalidRecordCount + mapped.length - matches.length
  const error = discardedCount > 0 ? INVALID_RECORD_ERROR : null
  const stale = Date.now() >= Date.parse(envelope.expiresAt)

  return {
    provider: FOOTBALL_DATA_PROVIDER_ID,
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

export const footballDataMatchProvider: MatchProvider = {
  id: FOOTBALL_DATA_PROVIDER_ID,
  priority: 10,
  supportedSports: SUPPORTED_SPORTS,
  metadata: METADATA,
  fetch: async (request) => {
    const response = await fetch(buildFootballDataRequestPath(request), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: request?.signal,
    })
    if (!response.ok) throw new FootballDataProviderError(response.status)
    return response.json() as Promise<unknown>
  },
  normalize: normalizeResponse,
}

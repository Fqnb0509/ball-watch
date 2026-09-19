import { isIsoTimestamp } from '../services/match-schema'
import type { MatchStatus } from '../types'

export const FOOTBALL_DATA_PROVIDER_ID = 'football-data'

const STATUS_MAP = {
  SCHEDULED: 'upcoming',
  TIMED: 'upcoming',
  IN_PLAY: 'live',
  PAUSED: 'live',
  FINISHED: 'finished',
  POSTPONED: 'postponed',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  AWARDED: 'finished',
} as const satisfies Record<string, MatchStatus>

export type FootballDataStatusCode = keyof typeof STATUS_MAP

export type FootballDataMatchDto = {
  id: number
  utcDate: string
  status: FootballDataStatusCode
  competition: { name: string }
  matchday: number | null
  homeTeam: { id: number; name: string }
  awayTeam: { id: number; name: string }
  venue: string | null
  score: { fullTime: { home: number | null; away: number | null } }
}

export type FootballDataEnvelope = {
  provider: typeof FOOTBALL_DATA_PROVIDER_ID
  fetchedAt: string
  sourceUpdatedAt: null
  expiresAt: string
  matches: FootballDataMatchDto[]
}

export type ParsedFootballDataEnvelope = Omit<FootballDataEnvelope, 'matches'> & {
  matches: FootballDataMatchDto[]
  invalidRecordCount: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isNullableString = (value: unknown): value is string | null => value === null || isNonEmptyString(value)
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const isNullableNonNegativeInteger = (value: unknown): value is number | null => value === null || (Number.isSafeInteger(value) && Number(value) >= 0)

const hasOnlyKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

const isTeam = (value: unknown): value is FootballDataMatchDto['homeTeam'] => isRecord(value)
  && hasOnlyKeys(value, ['id', 'name'])
  && isPositiveInteger(value.id)
  && isNonEmptyString(value.name)

const isScore = (value: unknown): value is FootballDataMatchDto['score'] => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['fullTime'])) return false
  const fullTime = value.fullTime
  return isRecord(fullTime)
    && hasOnlyKeys(fullTime, ['home', 'away'])
    && isNullableNonNegativeInteger(fullTime.home)
    && isNullableNonNegativeInteger(fullTime.away)
}

export const isFootballDataMatchDto = (value: unknown): value is FootballDataMatchDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'utcDate', 'status', 'competition', 'matchday', 'homeTeam', 'awayTeam', 'venue', 'score'])) return false
  const competition = value.competition
  return isPositiveInteger(value.id)
    && isIsoTimestamp(value.utcDate)
    && typeof value.status === 'string'
    && Object.prototype.hasOwnProperty.call(STATUS_MAP, value.status)
    && isRecord(competition)
    && hasOnlyKeys(competition, ['name'])
    && isNonEmptyString(competition.name)
    && (value.matchday === null || isPositiveInteger(value.matchday))
    && isTeam(value.homeTeam)
    && isTeam(value.awayTeam)
    && isNullableString(value.venue)
    && isScore(value.score)
}

export const mapFootballDataStatus = (status: FootballDataStatusCode): MatchStatus => STATUS_MAP[status]

/** Root metadata is all-or-nothing; malformed match entries are isolated individually. */
export const parseFootballDataEnvelope = (value: unknown): ParsedFootballDataEnvelope | null => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['provider', 'fetchedAt', 'sourceUpdatedAt', 'expiresAt', 'matches'])
    || value.provider !== FOOTBALL_DATA_PROVIDER_ID
    || !isIsoTimestamp(value.fetchedAt)
    || value.sourceUpdatedAt !== null
    || !isIsoTimestamp(value.expiresAt)
    || !Array.isArray(value.matches)) return null

  const matches = value.matches.filter(isFootballDataMatchDto)
  return {
    provider: FOOTBALL_DATA_PROVIDER_ID,
    fetchedAt: new Date(value.fetchedAt).toISOString(),
    sourceUpdatedAt: null,
    expiresAt: new Date(value.expiresAt).toISOString(),
    matches,
    invalidRecordCount: value.matches.length - matches.length,
  }
}

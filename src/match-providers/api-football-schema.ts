import { isIsoTimestamp } from '../services/match-schema'
import type { MatchStatus } from '../types'

export const API_FOOTBALL_PROVIDER_ID = 'api-football'

const STATUS_MAP = {
  NS: 'upcoming',
  TBD: 'upcoming',
  '1H': 'live',
  HT: 'live',
  '2H': 'live',
  ET: 'live',
  P: 'live',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'suspended',
  CANC: 'cancelled',
  ABD: 'cancelled',
  AWD: 'cancelled',
  WO: 'cancelled',
} as const satisfies Record<string, MatchStatus>

export type ApiFootballStatusCode = keyof typeof STATUS_MAP

export type ApiFootballFixtureDto = {
  fixture: {
    id: number
    date: string
    timezone: string | null
    status: { short: ApiFootballStatusCode }
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

export type ApiFootballEnvelope = {
  provider: typeof API_FOOTBALL_PROVIDER_ID
  fetchedAt: string
  sourceUpdatedAt: null
  expiresAt: string
  matches: ApiFootballFixtureDto[]
}

export type ParsedApiFootballEnvelope = Omit<ApiFootballEnvelope, 'matches'> & {
  matches: ApiFootballFixtureDto[]
  invalidRecordCount: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isNullableString = (value: unknown): value is string | null => value === null || isNonEmptyString(value)
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const isNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const isNullableScore = (value: unknown): value is number | null => value === null || isNonNegativeInteger(value)

const isTimezone = (value: unknown): value is string | null => {
  if (value === null) return true
  if (!isNonEmptyString(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

const hasOnlyKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

const isStatus = (value: unknown): value is { short: ApiFootballStatusCode } => isRecord(value)
  && hasOnlyKeys(value, ['short'])
  && typeof value.short === 'string'
  && Object.prototype.hasOwnProperty.call(STATUS_MAP, value.short)

const isVenue = (value: unknown): value is { name: string | null } => isRecord(value)
  && hasOnlyKeys(value, ['name'])
  && isNullableString(value.name)

const isFixture = (value: unknown): value is ApiFootballFixtureDto['fixture'] => isRecord(value)
  && hasOnlyKeys(value, ['id', 'date', 'timezone', 'status', 'venue'])
  && isPositiveInteger(value.id)
  && isIsoTimestamp(value.date)
  && isTimezone(value.timezone)
  && isStatus(value.status)
  && isVenue(value.venue)

const isLeague = (value: unknown): value is ApiFootballFixtureDto['league'] => isRecord(value)
  && hasOnlyKeys(value, ['id', 'name', 'round', 'season'])
  && isPositiveInteger(value.id)
  && isNonEmptyString(value.name)
  && isNullableString(value.round)
  && isPositiveInteger(value.season)

const isTeam = (value: unknown): value is ApiFootballFixtureDto['teams']['home'] => isRecord(value)
  && hasOnlyKeys(value, ['id', 'name'])
  && isPositiveInteger(value.id)
  && isNonEmptyString(value.name)

const isTeams = (value: unknown): value is ApiFootballFixtureDto['teams'] => isRecord(value)
  && hasOnlyKeys(value, ['home', 'away'])
  && isTeam(value.home)
  && isTeam(value.away)

const isGoals = (value: unknown): value is ApiFootballFixtureDto['goals'] => isRecord(value)
  && hasOnlyKeys(value, ['home', 'away'])
  && isNullableScore(value.home)
  && isNullableScore(value.away)

export const isApiFootballFixtureDto = (value: unknown): value is ApiFootballFixtureDto => isRecord(value)
  && hasOnlyKeys(value, ['fixture', 'league', 'teams', 'goals'])
  && isFixture(value.fixture)
  && isLeague(value.league)
  && isTeams(value.teams)
  && isGoals(value.goals)

export const mapApiFootballStatus = (status: ApiFootballStatusCode): MatchStatus => STATUS_MAP[status]

/** Root metadata is all-or-nothing; malformed match entries are isolated individually. */
export const parseApiFootballEnvelope = (value: unknown): ParsedApiFootballEnvelope | null => {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['provider', 'fetchedAt', 'sourceUpdatedAt', 'expiresAt', 'matches'])
    || value.provider !== API_FOOTBALL_PROVIDER_ID
    || !isIsoTimestamp(value.fetchedAt)
    || value.sourceUpdatedAt !== null
    || !isIsoTimestamp(value.expiresAt)
    || !Array.isArray(value.matches)) return null

  const matches = value.matches.filter(isApiFootballFixtureDto)
  return {
    provider: API_FOOTBALL_PROVIDER_ID,
    fetchedAt: new Date(value.fetchedAt).toISOString(),
    sourceUpdatedAt: null,
    expiresAt: new Date(value.expiresAt).toISOString(),
    matches,
    invalidRecordCount: value.matches.length - matches.length,
  }
}

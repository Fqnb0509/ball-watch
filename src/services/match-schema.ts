import type { Match, MatchStatus, Sport, Team } from '../types'

const sports: readonly Sport[] = ['football', 'basketball', 'baseball', 'tennis', 'esports']
const statuses: readonly MatchStatus[] = ['upcoming', 'live', 'finished', 'cancelled', 'postponed', 'suspended']
const explicitOffsetPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/i

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isOptionalString = (value: unknown): value is string | undefined => value === undefined || isNonEmptyString(value)

/** Only accepts unambiguous ISO 8601 instants with an explicit UTC/offset suffix. */
export const isIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const parts = explicitOffsetPattern.exec(value)
  if (!parts) return false
  const [, year, month, day, hour, minute, second = '0', , offsetHour = '0', offsetMinute = '0'] = parts
  const numericYear = Number(year)
  const numericMonth = Number(month)
  const numericDay = Number(day)
  if (numericMonth < 1 || numericMonth > 12) return false
  const leapYear = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][numericMonth - 1]
  if (numericDay < 1 || numericDay > daysInMonth) return false
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false
  if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false
  return Number.isFinite(Date.parse(value))
}

const isTimezone = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

const isTeam = (value: unknown): value is Team => {
  if (!isPlainRecord(value)) return false
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isOptionalString(value.shortName)
    && (value.players === undefined
      || (Array.isArray(value.players) && value.players.every(isNonEmptyString)))
}

const isExternalIds = (value: unknown): value is Record<string, string> => isPlainRecord(value)
  && Object.entries(value).length > 0
  && Object.entries(value).every(([key, externalId]) => isNonEmptyString(key) && isNonEmptyString(externalId))

export const isSport = (value: unknown): value is Sport => typeof value === 'string' && sports.includes(value as Sport)
export const isMatchStatus = (value: unknown): value is MatchStatus => typeof value === 'string' && statuses.includes(value as MatchStatus)

export const isMatchRecord = (value: unknown): value is Match => {
  if (!isPlainRecord(value)) return false
  const match = value as Partial<Match>
  if (!isIsoTimestamp(match.startTime) || !isIsoTimestamp(match.date)) return false

  const startTimestamp = Date.parse(match.startTime)
  const dateTimestamp = Date.parse(match.date)
  const validScore = match.score === undefined
    || (Array.isArray(match.score)
      && match.score.length === 2
      && match.score.every((score) => typeof score === 'number' && Number.isFinite(score)))

  return startTimestamp === dateTimestamp
    && isNonEmptyString(match.id)
    && isSport(match.sport)
    && isNonEmptyString(match.league)
    && isTeam(match.homeTeam)
    && isTeam(match.awayTeam)
    && isMatchStatus(match.status)
    && Array.isArray(match.streamIds)
    && match.streamIds.every(isNonEmptyString)
    && isOptionalString(match.round)
    && isOptionalString(match.logo)
    && isOptionalString(match.description)
    && isOptionalString(match.venue)
    && validScore
    && (match.sourceProvider === undefined || isNonEmptyString(match.sourceProvider))
    && (match.providerEventId === undefined || isNonEmptyString(match.providerEventId))
    && (match.sourceUpdatedAt === undefined || isIsoTimestamp(match.sourceUpdatedAt))
    && (match.updatedAt === undefined || isIsoTimestamp(match.updatedAt))
    && (match.originalStartTime === undefined || isNonEmptyString(match.originalStartTime))
    && (match.timezone === undefined || isTimezone(match.timezone))
    && (match.externalIds === undefined || isExternalIds(match.externalIds))
}

/** Invalid records are isolated so one malformed provider item cannot reject the batch. */
export const validateMatchCollection = (value: unknown): Match[] => Array.isArray(value) ? value.filter(isMatchRecord) : []

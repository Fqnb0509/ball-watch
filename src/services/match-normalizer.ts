import type { Match, MatchStatus, Sport, Team } from '../types'
import { isIsoTimestamp, isMatchRecord } from './match-schema'

const statuses: Record<string, MatchStatus> = {
  scheduled: 'upcoming',
  not_started: 'upcoming',
  upcoming: 'upcoming',
  live: 'live',
  in_play: 'live',
  in_progress: 'live',
  inprogress: 'live',
  finished: 'finished',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  postponed: 'postponed',
  suspended: 'suspended',
  paused: 'suspended',
}
const sports: readonly Sport[] = ['football', 'basketball', 'baseball', 'tennis', 'esports']

const recordOf = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null
}

const cleanString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined

const normalizeTeam = (value: unknown): Team | null => {
  const team = recordOf(value)
  const id = cleanString(team?.id)
  const name = cleanString(team?.name)
  if (!id || !name) return null
  const players = Array.isArray(team?.players)
    ? team.players.map(cleanString).filter((item): item is string => Boolean(item))
    : undefined
  const shortName = cleanString(team?.shortName)
  return { id, name, ...(shortName ? { shortName } : {}), ...(players?.length ? { players } : {}) }
}

const normalizeStatus = (value: unknown): MatchStatus | null => {
  const status = cleanString(value)?.toLowerCase().replace(/[-\s]+/g, '_')
  return status ? statuses[status] ?? null : null
}

const normalizeSportValue = (value: unknown): Sport | null => {
  const sport = cleanString(value)?.toLowerCase() as Sport | undefined
  return sport && sports.includes(sport) ? sport : null
}

const normalizeTimestamp = (value: unknown): string | undefined => {
  const timestamp = cleanString(value)
  if (!timestamp || !isIsoTimestamp(timestamp)) return undefined
  return new Date(timestamp).toISOString()
}

const normalizeTimezone = (value: unknown): string | undefined => {
  const timezone = cleanString(value)
  if (!timezone) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
    return timezone
  } catch {
    return undefined
  }
}

const normalizeExternalIds = (value: unknown): Record<string, string> | undefined => {
  const externalIds = recordOf(value)
  if (!externalIds) return undefined
  const entries = Object.entries(externalIds)
    .map(([key, item]) => [key.trim(), cleanString(item)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
  return entries.length ? Object.fromEntries(entries) : undefined
}

export const normalizeMatch = (value: unknown, providerId?: string): Match | null => {
  const input = recordOf(value)
  if (!input) return null

  const id = cleanString(input.id)
  const league = cleanString(input.league)
  const homeTeam = normalizeTeam(input.homeTeam)
  const awayTeam = normalizeTeam(input.awayTeam)
  const rawStartTime = cleanString(input.startTime) ?? cleanString(input.originalStartTime)
  const startTime = normalizeTimestamp(rawStartTime)
  const sport = normalizeSportValue(input.sport)
  const status = normalizeStatus(input.status)
  if (!id || !league || !homeTeam || !awayTeam || !rawStartTime || !startTime || !sport || !status) return null

  const sourceProvider = cleanString(input.sourceProvider) ?? cleanString(providerId)
  const providerEventId = cleanString(input.providerEventId)
  const sourceUpdatedAt = normalizeTimestamp(input.sourceUpdatedAt)
  const updatedAt = normalizeTimestamp(input.updatedAt)
  const timezone = normalizeTimezone(input.timezone)
  const streamIds = Array.isArray(input.streamIds)
    ? input.streamIds.map(cleanString).filter((item): item is string => Boolean(item))
    : []
  const externalIds = normalizeExternalIds(input.externalIds)
  const round = cleanString(input.round)
  const logo = cleanString(input.logo)
  const description = cleanString(input.description)
  const venue = cleanString(input.venue)
  const score = Array.isArray(input.score)
    && input.score.length === 2
    && input.score.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [input.score[0] as number, input.score[1] as number] as [number, number]
    : undefined

  const match: Match = {
    id,
    sport,
    league,
    homeTeam,
    awayTeam,
    startTime,
    date: startTime,
    status,
    streamIds,
    ...(round ? { round } : {}),
    ...(logo ? { logo } : {}),
    ...(description ? { description } : {}),
    ...(venue ? { venue } : {}),
    ...(score ? { score } : {}),
    ...(sourceProvider ? { sourceProvider } : {}),
    ...(providerEventId ? { providerEventId } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(rawStartTime ? { originalStartTime: rawStartTime } : {}),
    ...(timezone ? { timezone } : {}),
    ...(externalIds ? { externalIds } : {}),
  }
  return isMatchRecord(match) ? match : null
}

/** Each record is normalized independently so malformed entries do not poison a valid batch. */
export const normalizeMatches = (values: readonly unknown[], providerId?: string): Match[] => values
  .map((value) => normalizeMatch(value, providerId))
  .filter((match): match is Match => Boolean(match))

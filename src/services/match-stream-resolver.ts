import type { Match, Sport } from '../types'
import type { AuthorizedStreamConfig } from '../stream-providers/types'

export const MATCH_STREAM_TIME_WINDOW_MS = 5 * 60 * 1000

export type MatchStreamMatchStrategy = 'match-id' | 'provider-event-id' | 'external-id' | 'team-ids-time' | 'team-names-time'
export type MatchStreamResolutionStatus = 'matched' | 'unmatched'

export type MatchStreamResolution = {
  status: MatchStreamResolutionStatus
  strategy: MatchStreamMatchStrategy | null
}

export type MatchStreamCollectionResolution = {
  status: 'matched' | 'unmatched' | 'ambiguous'
  match: Match | null
  strategy: MatchStreamMatchStrategy | null
}

const normalizeText = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  : ''

const normalizedId = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const exactTextMatches = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizeText(left)
  const normalizedRight = normalizeText(right)
  return Boolean(normalizedLeft && normalizedLeft === normalizedRight)
}

const sameTime = (left: string, right: string): boolean => {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= MATCH_STREAM_TIME_WINDOW_MS
}

const hasCompleteTeamIds = (config: AuthorizedStreamConfig): boolean => Boolean(
  config.sport
  && config.league
  && config.homeTeamId
  && config.awayTeamId
  && config.startTime,
)

const hasCompleteTeamNames = (config: AuthorizedStreamConfig): boolean => Boolean(
  config.sport
  && config.league
  && config.homeTeamName
  && config.awayTeamName
  && config.startTime,
)

const matchesExternalIds = (match: Match, externalIds: Record<string, string>): boolean => {
  if (!match.externalIds || !Object.keys(externalIds).length) return false
  return Object.entries(externalIds).every(([namespace, id]) => normalizedId(match.externalIds?.[namespace]) === normalizedId(id) && Boolean(normalizedId(id)))
}

const matchesProviderEvent = (match: Match, config: AuthorizedStreamConfig): boolean => {
  const provider = config.sourceProvider ?? ''
  const eventId = config.providerEventId ?? config.eventId ?? ''
  return Boolean(provider && eventId)
    && normalizedId(match.sourceProvider) === normalizedId(provider)
    && normalizedId(match.providerEventId) === normalizedId(eventId)
}

const matchesSharedFields = (match: Match, config: AuthorizedStreamConfig): boolean => {
  if (config.sport && config.sport !== match.sport) return false
  if (config.league && !exactTextMatches(config.league, match.league)) return false
  if (config.startTime && !sameTime(config.startTime, match.startTime)) return false
  return true
}

/** Resolves one configured candidate without accepting partial or fuzzy identity. */
export const resolveStreamMatch = (match: Match, config: AuthorizedStreamConfig): MatchStreamResolution => {
  if (config.matchId) {
    return config.matchId === match.id && matchesSharedFields(match, config)
      ? { status: 'matched', strategy: 'match-id' }
      : { status: 'unmatched', strategy: null }
  }

  if (config.providerEventId || config.eventId || config.sourceProvider) {
    return matchesProviderEvent(match, config) && matchesSharedFields(match, config)
      ? { status: 'matched', strategy: 'provider-event-id' }
      : { status: 'unmatched', strategy: null }
  }

  if (config.externalIds) {
    return matchesExternalIds(match, config.externalIds) && matchesSharedFields(match, config)
      ? { status: 'matched', strategy: 'external-id' }
      : { status: 'unmatched', strategy: null }
  }

  if (hasCompleteTeamIds(config)) {
    return config.sport === match.sport
      && exactTextMatches(config.league, match.league)
      && normalizedId(config.homeTeamId) === normalizedId(match.homeTeam.id)
      && normalizedId(config.awayTeamId) === normalizedId(match.awayTeam.id)
      && sameTime(config.startTime ?? '', match.startTime)
      ? { status: 'matched', strategy: 'team-ids-time' }
      : { status: 'unmatched', strategy: null }
  }

  if (hasCompleteTeamNames(config)) {
    return config.sport === match.sport
      && exactTextMatches(config.league, match.league)
      && exactTextMatches(config.homeTeamName, match.homeTeam.name)
      && exactTextMatches(config.awayTeamName, match.awayTeam.name)
      && sameTime(config.startTime ?? '', match.startTime)
      ? { status: 'matched', strategy: 'team-names-time' }
      : { status: 'unmatched', strategy: null }
  }

  return { status: 'unmatched', strategy: null }
}

/** Resolves a candidate against a collection and refuses to choose among multiple matches. */
export const resolveStreamMatches = (matches: readonly Match[], config: AuthorizedStreamConfig): MatchStreamCollectionResolution => {
  const matched = matches
    .map((match) => ({ match, resolution: resolveStreamMatch(match, config) }))
    .filter((item) => item.resolution.status === 'matched')
  if (matched.length !== 1) return {
    status: matched.length > 1 ? 'ambiguous' : 'unmatched',
    match: null,
    strategy: null,
  }
  return { status: 'matched', match: matched[0].match, strategy: matched[0].resolution.strategy }
}

/** Backward-compatible boolean helper used by the existing configured providers. */
export const matchesConfiguredEvent = (match: Match, config: AuthorizedStreamConfig): boolean => resolveStreamMatch(match, config).status === 'matched'

export const streamMatchIdentity = (match: Match): string => JSON.stringify([
  match.id,
  match.sourceProvider ?? '',
  match.providerEventId ?? '',
  match.startTime,
  match.sport,
  match.league,
])

export type MatchStreamSport = Sport

import type { Match, Team } from '../types'

const normalizeLabel = (value: unknown) => typeof value === 'string'
  ? value.trim().toLowerCase().replace(/\s+/g, ' ')
  : ''
const normalizeIdentifier = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const timestampOf = (match: Match): number | null => {
  for (const value of [match.sourceUpdatedAt, match.updatedAt]) {
    if (!value) continue
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return timestamp
  }
  return null
}

const utcStart = (match: Match): string | null => {
  const time = Date.parse(match.startTime)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

const encodeIdentity = (parts: readonly string[]) => JSON.stringify(parts)
const teamIdentity = (team: Team) => encodeIdentity([normalizeIdentifier(team.id), normalizeLabel(team.name)])

const identityKeys = (match: Match): string[] => {
  const provider = normalizeLabel(match.sourceProvider)
  const eventId = normalizeIdentifier(match.providerEventId)
  const keys: string[] = []
  if (provider && eventId) keys.push(`provider:${encodeIdentity([provider, eventId])}`)

  const external = match.externalIds
    ? Object.entries(match.externalIds)
      .map(([key, value]) => [normalizeLabel(key), normalizeIdentifier(value)] as const)
      .filter(([key, value]) => Boolean(key && value))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
      .map(([key, value]) => `external:${encodeIdentity([key, value])}`)
    : []
  keys.push(...external)

  const start = utcStart(match)
  if (start) {
    keys.push(`teams:${encodeIdentity([
      normalizeLabel(match.sport),
      normalizeLabel(match.league),
      teamIdentity(match.homeTeam),
      teamIdentity(match.awayTeam),
      start,
    ])}`)
    keys.push(`names:${encodeIdentity([
      normalizeLabel(match.sport),
      normalizeLabel(match.league),
      normalizeLabel(match.homeTeam.name),
      normalizeLabel(match.awayTeam.name),
      start,
    ])}`)
  }

  return keys.length ? keys : [`invalid:${encodeIdentity([normalizeIdentifier(match.id)])}`]
}

/**
 * Generates a stable identity without fuzzy team matching. Provider/event
 * identity wins, followed by namespaced external IDs and the strict UTC tuple.
 */
export const getMatchIdentity = (match: Match): string => {
  return identityKeys(match)[0]
}

const preferIncomingRecord = (existing: Match, incoming: Match): boolean => {
  const existingTimestamp = timestampOf(existing)
  const incomingTimestamp = timestampOf(incoming)
  if (incomingTimestamp === null) return false
  if (existingTimestamp === null) return true
  return incomingTimestamp >= existingTimestamp
}

const mergeTeam = (existing: Team, incoming: Team, preferIncoming: boolean): Team => {
  const preferred = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming
  return {
    id: preferred.id || secondary.id,
    name: preferred.name || secondary.name,
    ...(preferred.shortName || secondary.shortName ? { shortName: preferred.shortName || secondary.shortName } : {}),
    ...(preferred.players?.length || secondary.players?.length
      ? { players: [...(preferred.players?.length ? preferred.players : secondary.players ?? [])] }
      : {}),
  }
}

const preferredValue = <T>(existing: T | undefined, incoming: T | undefined, preferIncoming: boolean): T | undefined => {
  const preferred = preferIncoming ? incoming : existing
  return preferred ?? (preferIncoming ? existing : incoming)
}

/** Merge duplicates without allowing an undated sparse record to erase known data. */
export const mergeMatchRecords = (existing: Match, incoming: Match): Match => {
  const preferIncoming = preferIncomingRecord(existing, incoming)
  const preferred = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming
  const startTime = preferred.startTime || secondary.startTime
  const streamIds = Array.from(new Set([...preferred.streamIds, ...secondary.streamIds]))
  const externalIds = preferIncoming
    ? { ...(existing.externalIds ?? {}), ...(incoming.externalIds ?? {}) }
    : { ...(incoming.externalIds ?? {}), ...(existing.externalIds ?? {}) }
  const sourceProvider = preferred.sourceProvider ?? secondary.sourceProvider
  const sameProvider = Boolean(preferred.sourceProvider && secondary.sourceProvider
    && normalizeLabel(preferred.sourceProvider) === normalizeLabel(secondary.sourceProvider))
  const providerEventId = preferred.providerEventId
    ?? (sameProvider || !preferred.sourceProvider ? secondary.providerEventId : undefined)
  const score = preferredValue(existing.score, incoming.score, preferIncoming)

  return {
    ...secondary,
    ...preferred,
    id: existing.id || incoming.id,
    league: preferred.league || secondary.league,
    homeTeam: mergeTeam(existing.homeTeam, incoming.homeTeam, preferIncoming),
    awayTeam: mergeTeam(existing.awayTeam, incoming.awayTeam, preferIncoming),
    startTime,
    date: startTime,
    streamIds,
    round: preferredValue(existing.round, incoming.round, preferIncoming),
    logo: preferredValue(existing.logo, incoming.logo, preferIncoming),
    description: preferredValue(existing.description, incoming.description, preferIncoming),
    venue: preferredValue(existing.venue, incoming.venue, preferIncoming),
    score: score ? [...score] as [number, number] : undefined,
    sourceProvider,
    providerEventId,
    sourceUpdatedAt: preferredValue(existing.sourceUpdatedAt, incoming.sourceUpdatedAt, preferIncoming),
    updatedAt: preferredValue(existing.updatedAt, incoming.updatedAt, preferIncoming),
    originalStartTime: preferredValue(existing.originalStartTime, incoming.originalStartTime, preferIncoming),
    timezone: preferredValue(existing.timezone, incoming.timezone, preferIncoming),
    ...(Object.keys(externalIds).length ? { externalIds } : {}),
  }
}

export const dedupeMatches = (matches: readonly Match[]): Match[] => {
  const results: Array<Match | null> = []
  const identityIndexes = new Map<string, number>()
  for (const match of matches) {
    const keys = identityKeys(match)
    const existingIndexes = Array.from(new Set(keys
      .map((key) => identityIndexes.get(key))
      .filter((index): index is number => index !== undefined && results[index] !== null)))
    if (!existingIndexes.length) {
      const index = results.push(match) - 1
      for (const key of keys) identityIndexes.set(key, index)
      continue
    }

    const targetIndex = existingIndexes[0]
    let merged = results[targetIndex] as Match
    for (const index of existingIndexes.slice(1)) {
      const duplicate = results[index]
      if (!duplicate) continue
      merged = mergeMatchRecords(merged, duplicate)
      results[index] = null
      for (const key of identityKeys(duplicate)) identityIndexes.set(key, targetIndex)
    }
    merged = mergeMatchRecords(merged, match)
    results[targetIndex] = merged
    for (const key of identityKeys(merged)) identityIndexes.set(key, targetIndex)
    for (const key of keys) identityIndexes.set(key, targetIndex)
  }
  return results.filter((match): match is Match => match !== null)
}

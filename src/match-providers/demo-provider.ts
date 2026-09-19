import { matches as demoMatches } from '../matches-data'
import type { Match, Sport } from '../types'
import type { MatchProvider, MatchProviderRequest, MatchProviderResult, ProviderMetadata } from './types'

const DEMO_SPORTS: readonly Sport[] = ['football', 'basketball', 'baseball', 'tennis', 'esports']

const DEMO_METADATA: ProviderMetadata = {
  id: 'demo',
  name: 'Demo Match Provider',
  sourceName: 'FIELDWATCH demo fixtures',
  supportedSports: DEMO_SPORTS,
}

const cloneMatch = (match: Match): Match => ({
  ...match,
  homeTeam: { ...match.homeTeam, players: match.homeTeam.players ? [...match.homeTeam.players] : undefined },
  awayTeam: { ...match.awayTeam, players: match.awayTeam.players ? [...match.awayTeam.players] : undefined },
  streamIds: [...match.streamIds],
})

const cloneMatches = (items: readonly Match[]) => items.map(cloneMatch)

const isTeam = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const team = value as { id?: unknown; name?: unknown }
  return typeof team.id === 'string' && typeof team.name === 'string'
}

const isMatch = (value: unknown): value is Match => {
  if (!value || typeof value !== 'object') return false
  const match = value as Partial<Match>
  return typeof match.id === 'string'
    && typeof match.sport === 'string'
    && typeof match.league === 'string'
    && isTeam(match.homeTeam)
    && isTeam(match.awayTeam)
    && typeof match.startTime === 'string'
    && typeof match.date === 'string'
    && typeof match.status === 'string'
    && Array.isArray(match.streamIds)
}

const inRequestedWindow = (match: Match, request?: MatchProviderRequest) => {
  const matchTime = Date.parse(match.startTime)
  if (!Number.isFinite(matchTime)) return false
  if (request?.from) {
    const from = Date.parse(request.from)
    if (Number.isFinite(from) && matchTime < from) return false
  }
  if (request?.to) {
    const to = Date.parse(request.to)
    if (Number.isFinite(to) && matchTime > to) return false
  }
  return true
}

const filterDemoMatches = (request?: MatchProviderRequest) => demoMatches
  .filter((match) => !request?.sport || match.sport === request.sport)
  .filter((match) => inRequestedWindow(match, request))

const resultMetadata = (fetchedAt: string, error: string | null): ProviderMetadata => ({
  ...DEMO_METADATA,
  fetchedAt,
  sourceUpdatedAt: null,
  expiresAt: null,
  stale: false,
  error,
  fallback: false,
})

const buildResult = (raw: unknown, fetchedAt: string, request?: MatchProviderRequest): MatchProviderResult => {
  if (!Array.isArray(raw)) {
    const error = 'Demo provider returned an invalid match collection'
    return {
      provider: DEMO_METADATA.id,
      matches: [],
      metadata: resultMetadata(fetchedAt, error),
      fetchedAt,
      sourceUpdatedAt: null,
      expiresAt: null,
      stale: false,
      error,
      fallback: false,
    }
  }

  const validMatches = raw.filter(isMatch)
  const error = validMatches.length === raw.length ? null : 'Demo provider discarded invalid match records'
  const filteredMatches = filterDemoMatches(request)
  const matches = raw === demoMatches
    ? filteredMatches
    : validMatches.filter((match) => !request?.sport || match.sport === request.sport).filter((match) => inRequestedWindow(match, request))

  return {
    provider: DEMO_METADATA.id,
    matches: cloneMatches(matches),
    metadata: resultMetadata(fetchedAt, error),
    fetchedAt,
    sourceUpdatedAt: null,
    expiresAt: null,
    stale: false,
    error,
    fallback: false,
  }
}

export const demoMatchProvider: MatchProvider = {
  id: 'demo',
  supportedSports: DEMO_SPORTS,
  metadata: DEMO_METADATA,
  fetch: async (request) => {
    if (request?.signal?.aborted) throw request.signal.reason
    return cloneMatches(filterDemoMatches(request))
  },
  normalize: (raw, request) => buildResult(raw, new Date().toISOString(), request),
}

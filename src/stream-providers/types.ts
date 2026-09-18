import type { Match, Stream, StreamAccess, StreamProvider, StreamType } from '../types'

export type ConfiguredProvider = Exclude<StreamProvider, 'demo'>

export type AuthorizedStreamConfig = {
  id: string
  matchId?: string
  eventId?: string
  league?: string
  homeTeamId?: string
  awayTeamId?: string
  startTime?: string
  provider: ConfiguredProvider
  name: string
  type: StreamType
  url?: string
  videoId?: string
  officialPageUrl?: string
  priority: number
  enabled: boolean
  fallbackEnabled?: boolean
  access?: StreamAccess
}

const MATCH_TIME_WINDOW_MS = 30 * 60 * 1000

export const matchesConfiguredEvent = (match: Match, config: AuthorizedStreamConfig): boolean => {
  const hasExactIdentity = Boolean(config.matchId || config.eventId)
  const hasCompositeIdentity = Boolean(config.league && config.homeTeamId && config.awayTeamId && config.startTime)
  if (!hasExactIdentity && !hasCompositeIdentity) return false
  if (config.matchId && config.matchId !== match.id) return false
  if (config.eventId && config.eventId !== match.providerEventId) return false
  if (config.league && config.league !== match.league) return false
  if (config.homeTeamId && config.homeTeamId !== match.homeTeam.id) return false
  if (config.awayTeamId && config.awayTeamId !== match.awayTeam.id) return false
  if (config.startTime) {
    const configuredTime = Date.parse(config.startTime)
    const matchTime = Date.parse(match.startTime)
    if (!Number.isFinite(configuredTime) || !Number.isFinite(matchTime) || Math.abs(configuredTime - matchTime) > MATCH_TIME_WINDOW_MS) return false
  }
  return true
}

export const toAuthorizedStream = (config: AuthorizedStreamConfig, url = config.url ?? ''): Stream => ({
  id: config.id,
  matchId: config.matchId ?? '',
  name: config.name,
  type: config.type,
  url,
  priority: config.priority,
  enabled: config.enabled,
  status: 'unknown',
  lastCheckedAt: null,
  errorMessage: null,
  latency: null,
  fallbackEnabled: config.fallbackEnabled ?? true,
  provider: config.provider,
  legalStatus: 'authorized',
  officialPageUrl: config.officialPageUrl ?? null,
  eventId: config.eventId ?? null,
  access: config.access ?? (config.officialPageUrl && !url ? 'official-page' : 'player'),
})

export type StreamProviderAdapter = {
  provider: ConfiguredProvider
  getStreams: (match: Match) => Stream[]
}

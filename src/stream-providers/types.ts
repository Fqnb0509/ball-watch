import type { Match, Sport, Stream, StreamAccess, StreamProvider, StreamSourceKind, StreamType } from '../types'

// Compatibility export for legacy providers; the resolver remains the single implementation.
export { matchesConfiguredEvent } from '../services/match-stream-resolver'

export type StreamCandidateRole = 'primary' | 'fallback'

export type StreamProviderResultStatus = 'success-empty' | 'success-with-candidates' | 'failure' | 'timeout' | 'circuit-open'

export type StreamProviderQuery = {
  match: Match
  signal?: AbortSignal
  timeoutMs?: number
}

export type StreamProviderQueryResult = {
  provider: StreamProvider
  status: StreamProviderResultStatus
  streams: Stream[]
  error: string | null
}

export type ConfiguredProvider = Exclude<StreamProvider, 'demo'>

export type AuthorizedStreamConfig = {
  id: string
  matchId?: string
  eventId?: string
  sourceProvider?: string
  providerEventId?: string
  externalIds?: Record<string, string>
  sport?: Sport
  league?: string
  homeTeamId?: string
  awayTeamId?: string
  homeTeamName?: string
  awayTeamName?: string
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
  role?: StreamCandidateRole
  sourceKind?: StreamSourceKind
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
  ...(config.role ? { role: config.role } : {}),
  sourceKind: config.sourceKind ?? 'unknown',
})

export type StreamProviderAdapter = {
  provider: ConfiguredProvider
  getStreams?: (match: Match) => Stream[]
  query?: (request: StreamProviderQuery) => Promise<StreamProviderQueryResult | readonly Stream[]> | StreamProviderQueryResult | readonly Stream[]
}

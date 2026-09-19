export type Sport = 'football' | 'basketball' | 'baseball' | 'tennis' | 'esports'
export type MatchStatus = 'upcoming' | 'live' | 'finished' | 'cancelled' | 'postponed' | 'suspended'
export type StreamType = 'hls' | 'dash' | 'mp4' | 'embed'
export type StreamProvider = 'demo' | 'official' | 'youtube' | 'external-api' | 'manual'
export type StreamLegalStatus = 'demo' | 'authorized' | 'unverified'
export type StreamAccess = 'player' | 'official-page'
export type StreamHealth = 'online' | 'offline' | 'timeout' | 'unknown'
export type Team = { id: string; name: string; shortName?: string; players?: string[] }
export type Match = {
  id: string
  sport: Sport
  league: string
  round?: string
  homeTeam: Team
  awayTeam: Team
  startTime: string
  date: string
  status: MatchStatus
  logo?: string
  description?: string
  venue?: string
  score?: [number, number]
  streamIds: string[]
  /** Provider that supplied the normalized record. */
  sourceProvider?: string
  providerEventId?: string
  /** Provider-side update timestamp, kept separate from local cache time. */
  sourceUpdatedAt?: string
  /** Local normalization/update timestamp when supplied by a provider. */
  updatedAt?: string
  /** Original provider timestamp before normalization to ISO UTC. */
  originalStartTime?: string
  /** IANA timezone supplied by the provider, when known. */
  timezone?: string
  /** Stable provider identifiers used for cross-provider identity matching. */
  externalIds?: Record<string, string>
}
export type Stream = {
  id: string
  matchId: string
  name: string
  type: StreamType
  url: string
  priority: number
  enabled: boolean
  status: StreamHealth
  lastCheckedAt: string | null
  errorMessage: string | null
  latency: number | null
  fallbackEnabled: boolean
  provider: StreamProvider
  legalStatus: StreamLegalStatus
  officialPageUrl: string | null
  eventId: string | null
  access: StreamAccess
}

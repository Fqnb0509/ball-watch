export type Sport = 'football' | 'basketball' | 'tennis' | 'esports'
export type MatchStatus = 'upcoming' | 'live' | 'finished'
export type StreamType = 'hls' | 'dash' | 'mp4' | 'embed'
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
}

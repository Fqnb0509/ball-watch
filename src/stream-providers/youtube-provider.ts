import type { Match, Stream, StreamLegalStatus, StreamSourceKind } from '../types'
import { toAuthorizedStream, type AuthorizedStreamConfig } from './types'
import { matchesConfiguredEvent } from '../services/match-stream-resolver'

export type YouTubeStreamConfig = {
  id?: string
  matchId: string
  provider: 'youtube'
  videoId?: string
  title: string
  legalStatus: StreamLegalStatus
  enabled: boolean
  priority?: number
  fallbackEnabled?: boolean
  eventId?: string
  league?: string
  homeTeamId?: string
  awayTeamId?: string
  startTime?: string
  sourceKind?: StreamSourceKind
}

// Add a source only after the official channel, embeddability and rights are verified.
export const youtubeStreamConfigs: readonly YouTubeStreamConfig[] = [
  {
    id: 'youtube-savannah-bananas-test',
    matchId: 'youtube-savannah-bananas-test',
    provider: 'youtube',
    videoId: 'T4bVbVd03mM',
    title: 'YouTube 官方授权测试源',
    legalStatus: 'authorized',
    enabled: true,
    priority: 100,
    sourceKind: 'vod',
  },
]

const isYouTubeVideoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value)

export const createYouTubeEmbedUrl = (videoId: string): string | null => isYouTubeVideoId(videoId)
  ? `https://www.youtube.com/embed/${videoId}`
  : null

export const getYouTubeStreams = (match: Match): Stream[] => youtubeStreamConfigs
  .filter((config) => config.legalStatus === 'authorized' && config.enabled && isYouTubeVideoId(config.videoId ?? ''))
  .flatMap((config) => {
    const videoId = config.videoId ?? ''
    const url = createYouTubeEmbedUrl(videoId)
    if (!url) return []
    const stream: AuthorizedStreamConfig = {
      id: config.id ?? `youtube-${config.matchId}-${videoId}`,
      matchId: config.matchId,
      eventId: config.eventId,
      league: config.league,
      homeTeamId: config.homeTeamId,
      awayTeamId: config.awayTeamId,
      startTime: config.startTime,
      provider: 'youtube',
      name: config.title,
      type: 'embed',
      priority: config.priority ?? 100,
      enabled: config.enabled,
      fallbackEnabled: config.fallbackEnabled ?? true,
      access: 'player',
      sourceKind: config.sourceKind ?? 'unknown',
    }
    if (!matchesConfiguredEvent(match, stream)) return []
    return [toAuthorizedStream(stream, url)]
  })

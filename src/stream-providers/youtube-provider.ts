import type { Match, Stream } from '../types'
import { matchesConfiguredEvent, toAuthorizedStream, type AuthorizedStreamConfig } from './types'

export type YouTubeStreamConfig = Omit<AuthorizedStreamConfig, 'provider' | 'type' | 'videoId'> & {
  provider: 'youtube'
  type: 'embed'
  videoId: string
}

// A video ID is added only after the official channel, embeddability and rights are verified.
export const youtubeStreamConfigs: readonly YouTubeStreamConfig[] = []

const isYouTubeVideoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value)

export const createYouTubeEmbedUrl = (videoId: string): string | null => isYouTubeVideoId(videoId)
  ? `https://www.youtube-nocookie.com/embed/${videoId}`
  : null

export const getYouTubeStreams = (match: Match): Stream[] => youtubeStreamConfigs
  .filter((config) => matchesConfiguredEvent(match, config))
  .flatMap((config) => {
    const url = createYouTubeEmbedUrl(config.videoId)
    if (!url) return []
    const stream: AuthorizedStreamConfig = { ...config, type: 'embed', access: config.access ?? 'player' }
    return [toAuthorizedStream(stream, url)]
  })

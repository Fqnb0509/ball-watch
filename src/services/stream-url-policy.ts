import type { Stream } from '../types'

const allowedEmbedOrigins = new Set([
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
])

// Direct media playback stays disabled until an origin is explicitly reviewed.
// This prevents a future config mistake from turning the player into an arbitrary URL loader.
const allowedDirectMediaOrigins = new Set<string>()

// Keep this list deliberately small. Add an origin only with a documented official embedding policy.
const allowedOfficialPageOrigins = new Set([
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://www.plus.fifa.com',
  'https://www.uefa.tv',
  'https://www.nba.com',
  'https://www.tennistv.com',
  'https://www.laliga.com',
])

const parseHttpsUrl = (value: string, label: string): { url: URL } | { error: string } => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { error: `${label}地址格式无效。` }
  }
  if (url.protocol !== 'https:') return { error: `${label}地址必须使用 HTTPS。` }
  if (url.username || url.password) return { error: `${label}地址不能包含登录凭据。` }
  return { url }
}

export const getOfficialPageUrlError = (stream: Stream): string | null => {
  if (!stream.enabled) return '当前直播源已禁用。'
  if (stream.legalStatus !== 'authorized') return '该官方观看入口尚未完成授权核验。'
  if (!stream.officialPageUrl) return '当前没有可用的官方观看入口。'
  const parsed = parseHttpsUrl(stream.officialPageUrl, '官方观看入口')
  if ('error' in parsed) return parsed.error
  if (!allowedOfficialPageOrigins.has(parsed.url.origin)) return '该官方观看入口尚未加入允许的来源列表。'
  return null
}

export const getSafeOfficialPageUrl = (stream: Stream): string | null => getOfficialPageUrlError(stream) ? null : stream.officialPageUrl

export const getStreamUrlError = (stream: Stream): string | null => {
  if (!stream.enabled) return '当前直播源已禁用。'
  if (stream.legalStatus === 'demo') return '暂无合法直播源。当前仅保留 Demo 配置，未添加已授权直播地址。'
  if (stream.legalStatus !== 'authorized') return '该直播源尚未完成授权核验。'

  if (stream.access === 'official-page') return getOfficialPageUrlError(stream)
  if (!stream.url) return '暂无合法直播源。'

  const parsed = parseHttpsUrl(stream.url, '直播源')
  if ('error' in parsed) return parsed.error
  if (stream.type === 'embed') {
    if (stream.provider !== 'youtube' || !allowedEmbedOrigins.has(parsed.url.origin) || !/^\/embed\/[A-Za-z0-9_-]{11}$/.test(parsed.url.pathname)) {
      return '该嵌入来源尚未获得授权。'
    }
  } else if (!allowedDirectMediaOrigins.has(parsed.url.origin)) {
    return '该直播源地址尚未加入允许的来源列表。'
  }
  return null
}

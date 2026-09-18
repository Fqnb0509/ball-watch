import type { Stream } from '../types'

// Embed providers stay blocked until the owner explicitly authorizes an origin.
const allowedEmbedOrigins = new Set<string>()

export const getStreamUrlError = (stream: Stream): string | null => {
  if (!stream.enabled) return '当前直播源已禁用。'
  if (!stream.url) return '当前是安全的 Demo 配置，尚未添加合法直播地址。'

  let url: URL
  try {
    url = new URL(stream.url)
  } catch {
    return '直播源地址格式无效。'
  }

  if (url.protocol !== 'https:') return '直播源地址必须使用 HTTPS。'
  if (url.username || url.password) return '直播源地址不能包含登录凭据。'
  if (stream.type === 'embed' && !allowedEmbedOrigins.has(url.origin)) return '该嵌入来源尚未获得授权。'
  return null
}

import type { Stream, StreamHealth } from '../types'
import { getStreamUrlError } from './stream-url-policy'

export type HealthResult = { streamId: string; status: StreamHealth; lastCheckedAt: string; latency: number | null; errorMessage: string | null }
const DEFAULT_TIMEOUT_MS = 4000

const unknownResult = (stream: Stream, message: string, startedAt: number): HealthResult => ({ streamId: stream.id, status: 'unknown', lastCheckedAt: new Date().toISOString(), latency: Date.now() - startedAt, errorMessage: message })

export const checkStreamHealth = async (stream: Stream, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<HealthResult> => {
  const startedAt = Date.now()
  if (signal?.aborted) return unknownResult(stream, '检测已取消', startedAt)
  const policyError = getStreamUrlError(stream)
  if (policyError) return { ...unknownResult(stream, policyError, startedAt), status: stream.enabled ? 'unknown' : 'offline' }
  if (stream.access === 'official-page') return unknownResult(stream, '官方观看入口状态需由官方页面确认', startedAt)
  if (stream.type === 'embed') return unknownResult(stream, '嵌入源状态需由播放器确认', startedAt)

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(stream.url, { method: 'HEAD', mode: 'cors', signal: controller.signal })
    const latency = Date.now() - startedAt
    return { streamId: stream.id, status: response.ok ? 'online' : 'offline', lastCheckedAt: new Date().toISOString(), latency, errorMessage: response.ok ? null : `HTTP ${response.status}` }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ...unknownResult(stream, '直播源检测超时', startedAt), status: 'timeout' }
    return unknownResult(stream, '浏览器无法跨域确认该直播源', startedAt)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

export const createHealthService = () => ({ check: checkStreamHealth, checkMany: (items: Stream[]) => Promise.all(items.map((item) => checkStreamHealth(item))) })

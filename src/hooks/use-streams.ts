import { useCallback, useEffect, useRef, useState } from 'react'
import { getStreamQueryResultForMatch } from '../services/stream-service'
import type { StreamQueryResult } from '../services/stream-query-service'
import { streamMatchIdentity } from '../services/match-stream-resolver'
import { createSafeAbortController } from '../services/runtime-compat'
import type { Match, Stream } from '../types'

const EMPTY_STREAMS: Stream[] = []
type StreamState = StreamQueryResult & { key: string; refreshing: boolean; cacheHit: boolean }
export const useStreams = (match: Match | null) => {
  const key = match ? streamMatchIdentity(match) : ''
  const [state, setState] = useState<StreamState | null>(null)
  const matchRef = useRef(match)
  const controllerRef = useRef<ReturnType<typeof createSafeAbortController> | null>(null)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => { matchRef.current = match }, [match])

  const load = useCallback(async (forceRefresh: boolean) => {
    const currentMatch = matchRef.current
    if (!currentMatch || !key || controllerRef.current) return
    const controller = createSafeAbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    const startedAt = Date.now()
    const current = () => !controller.signal.aborted && requestId === requestIdRef.current
    const publish = (result: StreamQueryResult, refreshing: boolean, cacheHit: boolean) => setState((previous) => ({
      ...result,
      ...(result.status === 'failure' && previous?.key === key && previous.data.length ? { data: previous.data, stale: true } : {}),
      key, refreshing, cacheHit,
    }))
    try {
      let result = await getStreamQueryResultForMatch(currentMatch, { forceRefresh, signal: controller.signal })
      if (!current()) return
      publish(result, result.stale, !forceRefresh && Date.parse(result.fetchedAt) < startedAt)
      if (result.stale) {
        // Join the service's existing SWR request and publish its result.
        result = await getStreamQueryResultForMatch(currentMatch, { forceRefresh: true, signal: controller.signal })
        if (current()) publish(result, false, false)
      }
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setState((previous) => ({
        data: previous?.key === key ? previous.data : [],
        providerResults: previous?.key === key ? previous.providerResults : [],
        fetchedAt: previous?.key === key ? previous.fetchedAt : new Date().toISOString(),
        key, status: 'failure', error: error instanceof Error && error.name === 'AbortError' ? '直播源请求已取消，请稍后重试' : '直播源查询失败，请稍后重试',
        stale: previous?.key === key && previous.data.length > 0,
        fallbackActive: false, refreshing: false, cacheHit: false,
      }))
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [key])

  const refresh = useCallback(() => {
    if (!key || controllerRef.current) return
    setState((previous) => previous?.key === key ? { ...previous, refreshing: true } : previous)
    void load(true)
  }, [key, load])

  useEffect(() => {
    mountedRef.current = true
    void load(false)
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [load])

  const current = state?.key === key ? state : null
  const loading = Boolean(key) && !current
  return {
    data: current?.data ?? EMPTY_STREAMS,
    loading,
    refreshing: current?.refreshing ?? false,
    error: current?.error ?? null,
    status: loading ? 'loading' as const : current?.status ?? 'success-empty' as const,
    stale: current?.stale ?? false,
    cacheHit: current?.cacheHit ?? false,
    fallbackActive: current?.fallbackActive ?? false,
    providerResults: current?.providerResults ?? [],
    refresh,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMatchSnapshot } from '../services/match-service'
import { createSafeAbortController } from '../services/runtime-compat'
import type { MatchSnapshot } from '../services/match-service'
import type { Match } from '../types'

export type MatchesState = {
  data: Match[]
  loading: boolean
  error: string | null
  lastUpdated: number | null
  provider: string | null
  sourceUpdatedAt: string | null
  expiresAt: string | null
  stale: boolean
  fallback: boolean
  refreshing: boolean
  backgroundRefreshing: boolean
  cacheHit: boolean
}

const initialState: MatchesState = {
  data: [],
  loading: true,
  error: null,
  lastUpdated: null,
  provider: null,
  sourceUpdatedAt: null,
  expiresAt: null,
  stale: false,
  fallback: false,
  refreshing: false,
  backgroundRefreshing: false,
  cacheHit: false,
}

const stateFromSnapshot = (snapshot: MatchSnapshot): MatchesState => {
  const fetchedAt = snapshot.metadata.fetchedAt ? Date.parse(snapshot.metadata.fetchedAt) : Number.NaN
  return {
    data: snapshot.data,
    loading: false,
    error: snapshot.metadata.error,
    lastUpdated: Number.isFinite(fetchedAt) ? fetchedAt : null,
    provider: snapshot.metadata.provider || null,
    sourceUpdatedAt: snapshot.metadata.sourceUpdatedAt,
    expiresAt: snapshot.metadata.expiresAt,
    stale: snapshot.metadata.stale,
    fallback: snapshot.metadata.fallback,
    refreshing: false,
    backgroundRefreshing: false,
    cacheHit: false,
  }
}

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'

export const useMatches = () => {
  const [state, setState] = useState<MatchesState>(initialState)
  const controllerRef = useRef<ReturnType<typeof createSafeAbortController> | null>(null)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (controllerRef.current) return
    const controller = createSafeAbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    setState((current) => ({ ...current, refreshing: true }))
    try {
      const snapshot = await getMatchSnapshot({ forceRefresh: true, signal: controller.signal })
      if (requestId === requestIdRef.current && !controller.signal.aborted) setState(stateFromSnapshot(snapshot))
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState((current) => ({ ...current, loading: false, refreshing: false, error: isAbortError(error) ? '赛事数据请求已取消，请稍后重试' : '赛事数据加载失败' }))
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const controller = createSafeAbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    const load = async () => {
      const startedAt = Date.now()
      try {
        const snapshot = await getMatchSnapshot({ signal: controller.signal })
        if (requestId !== requestIdRef.current || controller.signal.aborted) return
        setState({ ...stateFromSnapshot(snapshot), cacheHit: Date.parse(snapshot.metadata.fetchedAt ?? '') < startedAt, backgroundRefreshing: snapshot.metadata.stale })
        if (snapshot.metadata.stale) {
          const refreshed = await getMatchSnapshot({ forceRefresh: true, signal: controller.signal })
          if (requestId === requestIdRef.current && !controller.signal.aborted) setState(stateFromSnapshot(refreshed))
        }
      } catch (error) {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setState((current) => ({ ...current, loading: false, backgroundRefreshing: false, error: isAbortError(error) ? '赛事数据请求已取消，请稍后重试' : '赛事数据加载失败' }))
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    }
    void load()
    return () => {
      mountedRef.current = false
      controller.abort()
      controllerRef.current?.abort()
      controllerRef.current = null
      requestIdRef.current += 1
    }
  }, [])

  return { ...state, refresh }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMatchSnapshot } from '../services/match-service'
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
  }
}

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'

export const useMatches = () => {
  const [state, setState] = useState<MatchesState>(initialState)
  const controllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const snapshot = await getMatchSnapshot({ forceRefresh: true, signal: controller.signal })
      if (requestId === requestIdRef.current && !controller.signal.aborted) setState(stateFromSnapshot(snapshot))
    } catch (error) {
      if (!isAbortError(error) && requestId === requestIdRef.current) {
        setState((current) => ({ ...current, loading: false, error: '赛事数据加载失败' }))
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    const load = async () => {
      try {
        const snapshot = await getMatchSnapshot({ signal: controller.signal })
        if (requestId !== requestIdRef.current || controller.signal.aborted) return
        setState(stateFromSnapshot(snapshot))
        if (snapshot.metadata.stale && !snapshot.metadata.fallback) {
          const refreshed = await getMatchSnapshot({ forceRefresh: true, signal: controller.signal })
          if (requestId === requestIdRef.current && !controller.signal.aborted) setState(stateFromSnapshot(refreshed))
        }
      } catch (error) {
        if (!isAbortError(error) && requestId === requestIdRef.current) {
          setState((current) => ({ ...current, loading: false, error: '赛事数据加载失败' }))
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      controllerRef.current?.abort()
      controllerRef.current = null
      requestIdRef.current += 1
    }
  }, [])

  return { ...state, refresh }
}

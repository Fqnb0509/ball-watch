import { useCallback, useEffect, useRef, useState } from 'react'
import { getStreamQueryResultForMatch } from '../services/stream-service'
import type { StreamQueryStatus } from '../services/stream-query-service'
import type { StreamProviderQueryResult } from '../stream-providers/types'
import type { Match, Stream } from '../types'

type StreamState = {
  matchId: string | null
  data: Stream[]
  loading: boolean
  error: string | null
  status: StreamQueryStatus
  stale: boolean
  fallbackActive: boolean
  providerResults: StreamProviderQueryResult[]
}

const initialState: StreamState = {
  matchId: null,
  data: [],
  loading: false,
  error: null,
  status: 'success-empty',
  stale: false,
  fallbackActive: false,
  providerResults: [],
}

export const useStreams = (match: Match | null) => {
  const matchId = match?.id ?? null
  const [state, setState] = useState<StreamState>(initialState)
  const requestIdRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async (forceRefresh: boolean) => {
    if (!matchId) return
    const requestId = ++requestIdRef.current
    const requestMatchId = matchId
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState((current) => ({ ...current, matchId: requestMatchId, loading: true, error: null }))
    try {
      const result = await getStreamQueryResultForMatch(match ?? requestMatchId, { forceRefresh, signal: controller.signal })
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setState({
        matchId: requestMatchId,
        data: result.data,
        loading: false,
        error: result.error,
        status: result.status,
        stale: result.stale,
        fallbackActive: result.fallbackActive,
        providerResults: result.providerResults,
      })
    } catch (error: unknown) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setState((current) => ({
        ...current,
        matchId: requestMatchId,
        loading: false,
        error: error instanceof Error ? error.message : '直播源加载失败',
        status: 'failure',
        stale: false,
        fallbackActive: false,
      }))
    }
  }, [match, matchId])

  const refresh = useCallback(() => { void load(true) }, [load])

  useEffect(() => {
    if (!matchId) {
      requestIdRef.current += 1
      controllerRef.current?.abort()
      return
    }
    void load(false)
    return () => {
      requestIdRef.current += 1
      controllerRef.current?.abort()
    }
  }, [load, matchId])

  const isCurrentMatch = state.matchId === matchId
  return {
    data: isCurrentMatch ? state.data : [],
    loading: Boolean(matchId) && (state.loading || !isCurrentMatch),
    error: isCurrentMatch ? state.error : null,
    status: isCurrentMatch ? state.status : 'success-empty' as const,
    stale: isCurrentMatch && state.stale,
    fallbackActive: isCurrentMatch && state.fallbackActive,
    providerResults: isCurrentMatch ? state.providerResults : [],
    refresh,
  }
}

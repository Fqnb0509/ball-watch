import { useCallback, useEffect, useRef, useState } from 'react'
import { getStreamsForMatch } from '../services/stream-service'
import type { Match, Stream } from '../types'

export const useStreams = (match: Match | null) => {
  const matchId = match?.id ?? null
  const [state, setState] = useState<{ matchId: string | null; data: Stream[]; loading: boolean; error: string | null }>({ matchId: null, data: [], loading: false, error: null })
  const requestIdRef = useRef(0)
  const activeMatchIdRef = useRef<string | null>(null)
  const refresh = useCallback(async () => {
    if (!matchId) return
    const requestId = ++requestIdRef.current
    const requestMatchId = matchId
    setState((current) => ({ ...current, matchId: requestMatchId, loading: true, error: null }))
    try {
      const data = await getStreamsForMatch(match ?? requestMatchId)
      if (requestId !== requestIdRef.current || activeMatchIdRef.current !== requestMatchId) return
      setState({ matchId: requestMatchId, data, loading: false, error: null })
    } catch (error) {
      if (requestId !== requestIdRef.current || activeMatchIdRef.current !== requestMatchId) return
      setState((current) => ({ ...current, matchId: requestMatchId, loading: false, error: error instanceof Error ? error.message : '直播源加载失败' }))
    }
  }, [match, matchId])

  useEffect(() => {
    activeMatchIdRef.current = matchId
    if (!matchId) {
      requestIdRef.current += 1
      return
    }
    const requestId = ++requestIdRef.current
    let active = true
    const requestMatchId = matchId
    void getStreamsForMatch(match ?? requestMatchId).then((data) => {
      if (active && requestId === requestIdRef.current && activeMatchIdRef.current === requestMatchId) setState({ matchId: requestMatchId, data, loading: false, error: null })
    }).catch((error: unknown) => {
      if (active && requestId === requestIdRef.current && activeMatchIdRef.current === requestMatchId) setState((current) => ({ ...current, matchId: requestMatchId, loading: false, error: error instanceof Error ? error.message : '直播源加载失败' }))
    })
    return () => {
      active = false
      requestIdRef.current += 1
      if (activeMatchIdRef.current === requestMatchId) activeMatchIdRef.current = null
    }
  }, [match, matchId])

  const isCurrentMatch = state.matchId === matchId
  return { data: isCurrentMatch ? state.data : [], loading: Boolean(matchId) && (state.loading || !isCurrentMatch), error: isCurrentMatch ? state.error : null, refresh }
}

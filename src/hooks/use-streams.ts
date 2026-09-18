import { useCallback, useEffect, useState } from 'react'
import { getStreamsForMatch } from '../services/stream-service'
import type { Stream } from '../types'

export const useStreams = (matchId: string | null) => {
  const [state, setState] = useState<{ matchId: string | null; data: Stream[]; loading: boolean; error: string | null }>({ matchId: null, data: [], loading: false, error: null })
  const refresh = useCallback(async () => {
    if (!matchId) return
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      setState({ matchId, data: await getStreamsForMatch(matchId), loading: false, error: null })
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : '直播源加载失败' }))
    }
  }, [matchId])

  useEffect(() => {
    if (!matchId) return
    let active = true
    void getStreamsForMatch(matchId).then((data) => {
      if (active) setState({ matchId, data, loading: false, error: null })
    }).catch((error: unknown) => {
      if (active) setState((current) => ({ ...current, matchId, loading: false, error: error instanceof Error ? error.message : '直播源加载失败' }))
    })
    return () => { active = false }
  }, [matchId])

  return { data: state.data, loading: Boolean(matchId) && (state.loading || state.matchId !== matchId), error: state.error, refresh }
}

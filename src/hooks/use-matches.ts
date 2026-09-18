import { useCallback, useEffect, useState } from 'react'
import { getMatches } from '../services/match-service'
import type { Match } from '../types'

export type MatchesState = { data: Match[]; loading: boolean; error: string | null; lastUpdated: number | null }

export const useMatches = () => {
  const [state, setState] = useState<MatchesState>({ data: [], loading: true, error: null, lastUpdated: null })

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await getMatches({ forceRefresh: true })
      setState({ data, loading: false, error: null, lastUpdated: Date.now() })
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : '赛事数据加载失败' }))
    }
  }, [])

  useEffect(() => {
    let active = true
    void getMatches().then((data) => {
      if (active) setState({ data, loading: false, error: null, lastUpdated: Date.now() })
    }).catch((error: unknown) => {
      if (active) setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : '赛事数据加载失败' }))
    })
    return () => { active = false }
  }, [])

  return { ...state, refresh }
}

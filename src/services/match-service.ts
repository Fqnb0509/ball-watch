import { matches as demoMatches } from '../matches-data'
import type { Match, Sport } from '../types'

const CACHE_KEY = 'fieldwatch:matches-cache:v1'
const CACHE_TTL_MS = 5 * 60 * 1000

type CachedMatches = { data: Match[]; cachedAt: number }

const cloneMatches = (items: Match[]) => items.map((match) => ({
  ...match,
  homeTeam: { ...match.homeTeam, players: match.homeTeam.players ? [...match.homeTeam.players] : undefined },
  awayTeam: { ...match.awayTeam, players: match.awayTeam.players ? [...match.awayTeam.players] : undefined },
  streamIds: [...match.streamIds],
}))

const readCache = (): CachedMatches | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as Partial<CachedMatches>
    if (!Array.isArray(cached.data) || typeof cached.cachedAt !== 'number') return null
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return { data: cloneMatches(cached.data), cachedAt: cached.cachedAt }
  } catch {
    return null
  }
}

const writeCache = (data: Match[], cachedAt: number) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, cachedAt } satisfies CachedMatches))
  } catch {
    // Storage is optional; the in-memory fallback remains usable.
  }
}

let memoryCache: CachedMatches | null = null

/** Reserved boundary for a future legal API adapter. No credentials are read in the client. */
const fetchFromConfiguredApi = async (): Promise<Match[] | null> => null

export const getMatches = async (options: { forceRefresh?: boolean } = {}): Promise<Match[]> => {
  if (!options.forceRefresh) {
    if (memoryCache && Date.now() - memoryCache.cachedAt <= CACHE_TTL_MS) return cloneMatches(memoryCache.data)
    const cached = readCache()
    if (cached) {
      memoryCache = cached
      return cloneMatches(cached.data)
    }
  }

  try {
    const apiData = await fetchFromConfiguredApi()
    const data = cloneMatches(apiData ?? demoMatches)
    const cachedAt = Date.now()
    memoryCache = { data, cachedAt }
    writeCache(data, cachedAt)
    return cloneMatches(data)
  } catch (error) {
    if (memoryCache) return cloneMatches(memoryCache.data)
    const cached = readCache()
    if (cached) {
      memoryCache = cached
      return cloneMatches(cached.data)
    }
    throw error instanceof Error ? error : new Error('赛事数据加载失败')
  }
}

export const getMatchById = async (id: string) => (await getMatches()).find((match) => match.id === id)

export const getMatchesByDate = async (date: string) => {
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : toDateKey(new Date(date))
  return (await getMatches()).filter((match) => toDateKey(new Date(match.date)) === requested)
}

export const getMatchesBySport = async (sport: Sport) => (await getMatches()).filter((match) => match.sport === sport)

export const getMatchesByLeague = async (league: string) => (await getMatches()).filter((match) => match.league === league)

export const searchMatches = async (query: string) => {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return getMatches()
  return (await getMatches()).filter((match) => [match.homeTeam.name, match.awayTeam.name, match.league, match.description ?? '', ...(match.homeTeam.players ?? []), ...(match.awayTeam.players ?? [])].join(' ').toLocaleLowerCase().includes(needle))
}

export const getLiveMatches = async () => (await getMatches()).filter((match) => match.status === 'live')

export const matchCacheTtlMs = CACHE_TTL_MS

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export type FavoriteState = { matches: string[]; teams: string[]; leagues: string[] }
export type RecentWatch = { matchId: string; viewedAt: string }
const FAVORITES_KEY = 'fieldwatch:favorites:v1'
const RECENT_KEY = 'fieldwatch:recent:v1'
const read = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }
const write = <T,>(key: string, value: T) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage can be unavailable */ } }
const isId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 512
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter(isId))] : []
export const getFavorites = (): FavoriteState => {
  const value = read<unknown>(FAVORITES_KEY, {})
  const saved = value && typeof value === 'object' ? value as Partial<FavoriteState> : {}
  return { matches: ids(saved.matches), teams: ids(saved.teams), leagues: ids(saved.leagues) }
}
export const toggleFavorite = (kind: keyof FavoriteState, id: string) => { const next = getFavorites(); next[kind] = next[kind].includes(id) ? next[kind].filter((value) => value !== id) : [...next[kind], id]; write(FAVORITES_KEY, next); return next }
export const getRecentWatches = () => {
  const value = read<unknown>(RECENT_KEY, [])
  if (!Array.isArray(value)) return []
  return value.filter((item): item is RecentWatch => Boolean(item) && typeof item === 'object' && isId((item as RecentWatch).matchId) && typeof (item as RecentWatch).viewedAt === 'string' && Number.isFinite(Date.parse((item as RecentWatch).viewedAt)))
    .sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt))
    .filter((item, index, items) => items.findIndex((other) => other.matchId === item.matchId) === index)
    .slice(0, 10)
}
export const recordRecentWatch = (matchId: string) => { const next = [{ matchId, viewedAt: new Date().toISOString() }, ...getRecentWatches().filter((item) => item.matchId !== matchId)].slice(0, 10); write(RECENT_KEY, next); return next }

import type { Match, MatchStatus, Stream, StreamHealth, StreamSourceKind } from '../types'
import type { StreamQueryStatus } from '../services/stream-query-service'
import { getStreamUrlError } from '../services/stream-url-policy'

export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const partsFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SHANGHAI_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const validDate = (value: Date | string) => Number.isFinite(new Date(value).getTime())
export const formatTime = (value: string) => validDate(value) ? timeFormatter.format(new Date(value)) : '时间待定'
export const formatDate = (value: string) => validDate(value) ? dateFormatter.format(new Date(value)) : '日期待定'
export const dateKey = (value: Date | string): string => {
  if (!validDate(value)) return ''
  const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export const addDays = (offset: number, now = new Date()): Date => {
  const [year, month, day] = dateKey(now).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + offset, 4))
}
export const statusLabels: Record<MatchStatus, string> = { upcoming: '即将开始', live: '进行中', suspended: '暂停', finished: '已结束', postponed: '已延期', cancelled: '已取消' }
export const statusOrder: MatchStatus[] = ['live', 'suspended', 'upcoming', 'finished', 'postponed', 'cancelled']
export const sourceKindLabels: Record<StreamSourceKind, string> = { live: '直播 · Live', vod: '录播 · VOD', unknown: '未知 · Unknown' }
export const healthLabels: Record<StreamHealth, string> = { online: '在线', offline: '不可用', timeout: '检测超时', unknown: '未确认' }
export const getSourceKind = (stream: Stream): StreamSourceKind => stream.sourceKind === 'live' || stream.sourceKind === 'vod' ? stream.sourceKind : 'unknown'
export const matchSearchText = (match: Match) => [match.homeTeam.name, match.awayTeam.name, match.homeTeam.shortName, match.awayTeam.shortName, match.league, match.round, match.venue, match.description, ...(match.homeTeam.players ?? []), ...(match.awayTeam.players ?? [])].filter(Boolean).join(' ').toLocaleLowerCase()
export const NO_LIVE_SOURCE = '比赛存在，但暂无免费合法直播源'
export const visibleSources = (streams: readonly Stream[]) => streams.filter((stream) => stream.legalStatus !== 'demo' && stream.provider !== 'demo')
export const isAuthorizedSource = (source: Stream) => source.legalStatus === 'authorized' && !getStreamUrlError(source)
export const canPlaySource = (source: Stream, explicitlySelected: boolean) => isAuthorizedSource(source) && source.access === 'player' && (getSourceKind(source) === 'live' || getSourceKind(source) === 'vod' && explicitlySelected)
export const selectSource = (streams: readonly Stream[], selectedId: string | null): Stream | undefined => {
  const sources = visibleSources(streams)
  return sources.find((source) => source.id === selectedId)
    ?? [...sources].sort((a, b) => b.priority - a.priority).find((source) => source.sourceKind === 'live' && source.access === 'player' && isAuthorizedSource(source))
}
export const streamSummary = (input: { streams: readonly Stream[]; status: StreamQueryStatus; loading?: boolean; refreshing?: boolean; stale?: boolean; fallbackActive?: boolean; cacheHit?: boolean }): string => {
  const sources = visibleSources(input.streams)
  const legal = sources.filter(isAuthorizedSource)
  if (input.loading && !sources.length) return '正在查询播放来源'
  const base = input.status === 'failure' ? '直播源查询失败，请稍后重试'
    : input.status === 'partial-failure' ? (legal.length ? '部分来源查询失败，已有来源仍可使用' : '部分来源查询失败，暂未找到可用来源')
      : input.fallbackActive ? '当前使用备用直播源（fallback）'
        : legal.some((s) => s.sourceKind === 'live') ? '已找到合法直播来源'
          : legal.some((s) => s.sourceKind === 'vod') ? '回放来源：录播视频，非实时直播'
            : sources.some((s) => getSourceKind(s) === 'unknown') ? '来源类型未知，不自动播放'
              : NO_LIVE_SOURCE
  const freshness = input.stale ? ' · 缓存可能已过期' : input.cacheHit ? ' · 已读取缓存' : ''
  return base + freshness + (input.refreshing ? ' · 正在刷新' : '')
}
export const matchDataSummary = (input: { loading: boolean; refreshing?: boolean; backgroundRefreshing?: boolean; stale?: boolean; cacheHit?: boolean; error: string | null; fallback: boolean; provider: string | null; lastUpdated: number | null; hasData: boolean }): string => {
  if (input.loading && !input.hasData) return '正在加载赛事'
  const providers = (input.provider ?? '').split(',')
  const names = [providers.includes('football-data') ? 'football-data.org' : '', providers.includes('api-football') ? 'API-Football' : '', providers.includes('demo') ? '演示赛事' : ''].filter(Boolean).join('、')
  const base = input.error ? (input.hasData ? '部分赛事暂时无法更新，保留已加载数据' : '赛事数据加载失败，请稍后重试') : names ? `数据来源：${names}` : '赛事已加载'
  return base + (input.fallback ? ' · 包含演示替代数据' : '') + (input.stale ? ' · 缓存可能已过期' : input.cacheHit ? ' · 已读取缓存' : '') + (input.refreshing || input.backgroundRefreshing ? ' · 正在刷新' : '') + (input.lastUpdated !== null ? ` · 更新于 ${formatDate(new Date(input.lastUpdated).toISOString())} ${formatTime(new Date(input.lastUpdated).toISOString())}` : '')
}

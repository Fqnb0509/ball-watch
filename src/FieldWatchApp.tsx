import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, SyntheticEvent } from 'react'
import { sportIcons, sportLabels } from './matches-data'
import { useMatches } from './hooks/use-matches'
import { useStreams } from './hooks/use-streams'
import { getFavorites, getRecentWatches, recordRecentWatch, toggleFavorite } from './storage'
import type { FavoriteState, RecentWatch } from './storage'
import { checkStreamHealth } from './services/stream-health-service'
import { getNextSource, getPlayableSources, hasLegalSourceForMatch } from './services/stream-service'
import { getSafeOfficialPageUrl, getStreamUrlError } from './services/stream-url-policy'
import type { Match, MatchStatus, Sport, Stream, StreamHealth } from './types'
import './fieldwatch.css'

type View = 'home' | 'favorites' | 'recent'
type DayMode = 'today' | 'tomorrow' | 'day-after' | 'custom'
type HealthSnapshot = { status: StreamHealth; lastCheckedAt: string; latency: number | null; errorMessage: string | null }

const statusLabels: Record<MatchStatus, string> = { live: '进行中', upcoming: '即将开始', finished: '已结束' }
const healthLabels: Record<StreamHealth, string> = { online: '在线', offline: '失效', timeout: '超时', unknown: '待检测' }
const sportOrder: Array<Sport | 'all'> = ['all', 'football', 'basketball', 'tennis', 'esports']
const BEIJING_TIME_ZONE = 'Asia/Shanghai'

function beijingDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BEIJING_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(value)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])) as Record<string, number>
}

function dateKey(value: Date | string) {
  const date = beijingDateParts(typeof value === 'string' ? new Date(value) : value)
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}
function addDays(offset: number) { const date = beijingDateParts(new Date()); return new Date(Date.UTC(date.year, date.month - 1, date.day + offset, 12)) }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: BEIJING_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: BEIJING_TIME_ZONE, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value)) }
function matchSearchText(match: Match) { return [match.homeTeam.name, match.awayTeam.name, match.league, match.description ?? '', ...(match.homeTeam.players ?? []), ...(match.awayTeam.players ?? [])].join(' ').toLocaleLowerCase() }

export default function FieldWatchApp() {
  const { data: matches, loading: matchesLoading, error: matchesError, lastUpdated, refresh: refreshMatches } = useMatches()
  const [view, setView] = useState<View>('home')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sport, setSport] = useState<Sport | 'all'>('all')
  const [league, setLeague] = useState('all')
  const [query, setQuery] = useState('')
  const [dayMode, setDayMode] = useState<DayMode>('today')
  const [customDate, setCustomDate] = useState(dateKey(new Date()))
  const [favorites, setFavorites] = useState<FavoriteState>(() => getFavorites())
  const [recent, setRecent] = useState<RecentWatch[]>(() => getRecentWatches())
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [sourceHealth, setSourceHealth] = useState<Record<string, HealthSnapshot>>({})
  const [playerMessage, setPlayerMessage] = useState<string | null>(null)
  const selected = matches.find((match) => match.id === selectedId) ?? null
  const { data: streams, loading: streamsLoading, error: streamsError, refresh: refreshStreams } = useStreams(selectedId)
  const selectedDate = dayMode === 'custom' ? customDate : dateKey(addDays(dayMode === 'today' ? 0 : dayMode === 'tomorrow' ? 1 : 2))
  const leagues = useMemo(() => Array.from(new Set(matches.filter((match) => sport === 'all' || match.sport === sport).map((match) => match.league))).sort(), [matches, sport])
  const recentMatches = useMemo(() => recent.map((item) => matches.find((match) => match.id === item.matchId)).filter((match): match is Match => Boolean(match)), [matches, recent])
  const listedMatches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const list = matches.filter((match) => {
      const favorite = favorites.matches.includes(match.id) || favorites.teams.includes(match.homeTeam.id) || favorites.teams.includes(match.awayTeam.id) || favorites.leagues.includes(match.league)
      return (view !== 'home' || dateKey(match.date) === selectedDate) && (sport === 'all' || match.sport === sport) && (league === 'all' || match.league === league) && (!needle || matchSearchText(match).includes(needle)) && (view !== 'favorites' || favorite) && (view !== 'recent' || recent.some((item) => item.matchId === match.id))
    })
    if (view === 'recent') { const ordering = new Map(recent.map((item, index) => [item.matchId, index])); return list.sort((left, right) => (ordering.get(left.id) ?? 99) - (ordering.get(right.id) ?? 99)) }
    return list.sort((left, right) => Number(right.status === 'live') - Number(left.status === 'live') || new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
  }, [favorites, league, matches, query, recent, selectedDate, sport, view])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    if (streams.length) void Promise.all(streams.map(checkStreamHealth)).then((results) => {
      if (active) setSourceHealth((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.streamId, { status: result.status, lastCheckedAt: result.lastCheckedAt, latency: result.latency, errorMessage: result.errorMessage }])) }))
    })
    return () => { active = false }
  }, [selectedId, streams])

  const openMatch = (match: Match) => { setPlayerMessage(null); setSourceId(null); setSourceHealth({}); setRecent(recordRecentWatch(match.id)); setSelectedId(match.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const toggle = (kind: keyof FavoriteState, id: string) => setFavorites(toggleFavorite(kind, id))
  const isFavorite = (kind: keyof FavoriteState, id: string) => favorites[kind].includes(id)
  const switchView = (next: View) => { setSelectedId(null); setView(next) }

  return <div className="fw-shell">
    <header className="fw-topbar"><div className="fw-topbar-inner"><button className="fw-brand" onClick={() => switchView('home')} aria-label="返回赛事中心"><span className="fw-brand-mark"><i /></span><span><b>FIELD</b><small>WATCH</small></span></button><nav aria-label="主导航"><button className={view === 'home' && !selected ? 'fw-nav active' : 'fw-nav'} onClick={() => switchView('home')}>赛事中心</button><button className={view === 'favorites' ? 'fw-nav active' : 'fw-nav'} onClick={() => switchView('favorites')}>我的收藏</button><button className={view === 'recent' ? 'fw-nav active' : 'fw-nav'} onClick={() => switchView('recent')}>最近观看</button></nav><div className="fw-actions"><label className="fw-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); if (!selected) setView('home') }} placeholder="搜索球队、球员或赛事" aria-label="搜索比赛" /><kbd>⌘ K</kbd></label><button className="fw-counter" onClick={() => switchView('favorites')} title="我的收藏">★<small>{favorites.matches.length}</small></button><button className="fw-counter" onClick={() => switchView('recent')} title="最近观看">◷<small>{recent.length}</small></button></div></div></header>
    <main className={selected ? 'fw-main fw-watch-mode' : 'fw-main'}>{selected ? <Watch match={selected} sources={streams} streamsLoading={streamsLoading} streamsError={streamsError} sourceId={sourceId} sourceHealth={sourceHealth} favorite={isFavorite('matches', selected.id)} onFavorite={() => toggle('matches', selected.id)} onTeamFavorite={(id) => toggle('teams', id)} onLeagueFavorite={() => toggle('leagues', selected.league)} isTeamFavorite={(id) => isFavorite('teams', id)} isLeagueFavorite={isFavorite('leagues', selected.league)} onSelectSource={setSourceId} onHealth={(id, result) => setSourceHealth((current) => ({ ...current, [id]: result }))} onRefreshSources={refreshStreams} message={playerMessage} setMessage={setPlayerMessage} back={() => setSelectedId(null)} /> : <Home view={view} sport={sport} league={league} query={query} selectedDate={selectedDate} dayMode={dayMode} customDate={customDate} leagues={leagues} list={listedMatches} recentMatches={recentMatches} isFavorite={(id) => isFavorite('matches', id)} onSport={(next) => { setSport(next); setLeague('all') }} onLeague={setLeague} onDay={setDayMode} onCustomDate={(value) => { setCustomDate(value); setDayMode('custom') }} onToggleFavorite={(id) => toggle('matches', id)} onOpen={openMatch} loading={matchesLoading} error={matchesError} lastUpdated={lastUpdated} onRefresh={refreshMatches} />}</main>
    <footer className="fw-footer"><span>FIELDWATCH · 个人赛事空间</span><span>数据、播放器和直播源独立配置 · 无广告、无弹窗 · 仅提供已核验官方入口</span></footer>
  </div>
}

type HomeProps = { view: View; sport: Sport | 'all'; league: string; query: string; selectedDate: string; dayMode: DayMode; customDate: string; leagues: string[]; list: Match[]; recentMatches: Match[]; isFavorite: (id: string) => boolean; onSport: (sport: Sport | 'all') => void; onLeague: (league: string) => void; onDay: (mode: DayMode) => void; onCustomDate: (date: string) => void; onToggleFavorite: (id: string) => void; onOpen: (match: Match) => void; loading: boolean; error: string | null; lastUpdated: number | null; onRefresh: () => void }
function Home(props: HomeProps) {
  const heading = props.view === 'favorites' ? '我的收藏' : props.view === 'recent' ? '最近观看' : '今日赛程'
  const dayItems: Array<[DayMode, string, number]> = [['today', '今天', 0], ['tomorrow', '明天', 1], ['day-after', '后天', 2]]
  return <><section className="fw-hero"><div><p className="fw-eyebrow"><i />LIVE SPORTS HUB</p><h1>你关注的比赛，<em>都在这里。</em></h1><p className="fw-hero-copy">清爽、专注、无干扰。赛事数据与直播源分层管理。</p></div><div className="fw-date"><span>北京时间</span><b>{formatDate(new Date().toISOString())}</b><small>实时赛程视图</small></div></section><section className="fw-sports" aria-label="体育项目筛选">{sportOrder.map((item) => <button key={item} className={props.sport === item ? 'fw-sport active' : 'fw-sport'} onClick={() => props.onSport(item)}><span>{sportIcons[item]}</span>{sportLabels[item]}</button>)}</section><section className="fw-schedule"><div className="fw-heading"><div><p className="fw-eyebrow muted">SCHEDULE</p><h2>{heading}</h2><p className="fw-data-status">{props.loading ? '正在加载赛事数据…' : props.error ? `数据刷新失败：${props.error}` : props.lastUpdated ? `最后更新 ${new Intl.DateTimeFormat('zh-CN', { timeZone: BEIJING_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(props.lastUpdated)}` : 'Demo 赛事数据'}</p></div><div className="fw-heading-actions"><span>{props.list.length} 场比赛</span><select value={props.league} onChange={(event) => props.onLeague(event.target.value)} aria-label="赛事筛选"><option value="all">全部赛事</option>{props.leagues.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="fw-refresh" onClick={props.onRefresh} disabled={props.loading} aria-label="刷新赛事数据">{props.loading ? '…' : '刷新'}</button></div></div><div className="fw-days" aria-label="日期筛选">{dayItems.map(([mode, label, offset]) => <button key={mode} className={props.dayMode === mode ? 'selected' : ''} onClick={() => props.onDay(mode)}><small>{label}</small><b>{beijingDateParts(addDays(offset)).day}</b></button>)}<label className={props.dayMode === 'custom' ? 'fw-custom-date selected' : 'fw-custom-date'}><small>自定义</small><input type="date" value={props.customDate} onChange={(event) => props.onCustomDate(event.target.value)} aria-label="自定义日期" /></label></div>{props.query && <p className="fw-filter-summary">“{props.query}” 的搜索结果</p>}{props.view === 'home' && props.recentMatches.length > 0 && <section className="fw-recent"><div className="fw-group-title"><h3>最近观看</h3><span>自动保留最近 10 场</span></div><div className="fw-recent-list">{props.recentMatches.slice(0, 4).map((match) => <button key={match.id} onClick={() => props.onOpen(match)}>{match.homeTeam.name}<i>vs</i>{match.awayTeam.name}</button>)}</div></section>}{props.loading && !props.list.length ? <div className="fw-empty"><strong>正在加载赛事数据</strong><span>请稍候，正在读取缓存或 Demo 数据。</span></div> : props.list.length ? <div className="fw-groups"><MatchGroup title="正在进行" status="live" list={props.list} favorite={props.isFavorite} onToggleFavorite={props.onToggleFavorite} onOpen={props.onOpen} /><MatchGroup title="即将开始" status="upcoming" list={props.list} favorite={props.isFavorite} onToggleFavorite={props.onToggleFavorite} onOpen={props.onOpen} /><MatchGroup title="已结束" status="finished" list={props.list} favorite={props.isFavorite} onToggleFavorite={props.onToggleFavorite} onOpen={props.onOpen} /></div> : <EmptyState view={props.view} />}</section></>
}
function EmptyState({ view }: { view: View }) { const message = view === 'favorites' ? '还没有收藏的比赛' : view === 'recent' ? '还没有观看记录' : '这个筛选条件下没有比赛'; const detail = view === 'favorites' ? '在比赛卡片或观看页点击星标即可收藏。' : view === 'recent' ? '打开任意比赛观看页后，会自动保存在这里。' : '试试切换日期、项目、赛事，或调整搜索词。'; return <div className="fw-empty"><strong>{message}</strong><span>{detail}</span></div> }
function MatchGroup({ title, status, list, favorite, onToggleFavorite, onOpen }: { title: string; status: MatchStatus; list: Match[]; favorite: (id: string) => boolean; onToggleFavorite: (id: string) => void; onOpen: (match: Match) => void }) { const group = list.filter((match) => match.status === status); if (!group.length) return null; return <section className="fw-match-group"><div className="fw-group-title"><h3>{title}</h3><span>{group.length} 场</span></div><div className="fw-list">{group.map((match) => <MatchCard key={match.id} match={match} favorite={favorite(match.id)} onToggleFavorite={onToggleFavorite} onOpen={onOpen} />)}</div></section> }
 function MatchCard({ match, favorite, onToggleFavorite, onOpen }: { match: Match; favorite: boolean; onToggleFavorite: (id: string) => void; onOpen: (match: Match) => void }) { const open = () => onOpen(match); return <article className={`fw-card ${match.status}`} role="button" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') open() }}><div className="fw-card-inner"><div className="fw-time"><b>{formatTime(match.startTime)}</b><span className={`fw-status ${match.status}`}>{match.status === 'live' && <i />}{statusLabels[match.status]}</span></div><div className="fw-teams"><div className="fw-league"><span>{sportIcons[match.sport]}</span>{match.league}<small>{match.round}</small></div><div className="fw-team-row"><b>{match.homeTeam.name}</b><span className="fw-badge home">{match.homeTeam.shortName?.slice(0, 2)}</span><span className="fw-vs">{match.score ? `${match.score[0]} : ${match.score[1]}` : 'VS'}</span><span className="fw-badge away">{match.awayTeam.shortName?.slice(0, 2)}</span><b>{match.awayTeam.name}</b></div></div><div className="fw-card-meta"><span>{hasLegalSourceForMatch(match) ? '● 已核验来源配置' : '○ 暂无合法直播源'}</span><small>{match.venue}</small></div><button className={favorite ? 'fw-favorite active' : 'fw-favorite'} onClick={(event) => { event.stopPropagation(); onToggleFavorite(match.id) }} title={favorite ? '取消收藏比赛' : '收藏比赛'} aria-label={favorite ? '取消收藏比赛' : '收藏比赛'}>{favorite ? '★' : '☆'}</button><button className="fw-watch-btn" onClick={(event) => { event.stopPropagation(); open() }}>{match.status === 'live' ? '立即观看' : '查看详情'} <span>→</span></button></div></article> }

type WatchProps = { match: Match; sources: Stream[]; streamsLoading: boolean; streamsError: string | null; sourceId: string | null; sourceHealth: Record<string, HealthSnapshot>; favorite: boolean; onFavorite: () => void; onTeamFavorite: (id: string) => void; onLeagueFavorite: () => void; isTeamFavorite: (id: string) => boolean; isLeagueFavorite: boolean; onSelectSource: (id: string) => void; onHealth: (id: string, result: HealthSnapshot) => void; onRefreshSources: () => void; message: string | null; setMessage: (message: string | null) => void; back: () => void }
function Watch(props: WatchProps) {
  const playerRef = useRef<HTMLDivElement>(null)
  const failedIdsRef = useRef<Set<string>>(new Set())
  const healthRequestRef = useRef(0)
  const [failedState, setFailedState] = useState<{ matchId: string; ids: Set<string> }>(() => ({ matchId: props.match.id, ids: new Set() }))
  const failedIds = failedState.matchId === props.match.id ? failedState.ids : new Set<string>()
  const source = props.sources.find((item) => item.id === props.sourceId)
    ?? getPlayableSources(props.sources)[0]
    ?? props.sources.find((item) => item.access === 'official-page' && getSafeOfficialPageUrl(item))
    ?? props.sources[0]
  const playableSources = getPlayableSources(props.sources)
  const allPlayableSourcesFailed = playableSources.length > 0 && playableSources.every((item) => failedIds.has(item.id))
  const status = source ? props.sourceHealth[source.id]?.status ?? source.status : 'unknown'
  const accent = props.match.sport === 'basketball' ? '#ff8a4c' : props.match.sport === 'tennis' ? '#bfef63' : '#8b7bff'
  const style = { '--fw-accent': accent } as CSSProperties
  useEffect(() => { failedIdsRef.current = new Set() }, [props.match.id])
  useEffect(() => {
    healthRequestRef.current += 1
    return () => { healthRequestRef.current += 1 }
  }, [props.match.id, source?.id, source?.url])
  const reportHealth = (stream: Stream, next: HealthSnapshot) => { props.onHealth(stream.id, next); if (next.status === 'offline' || next.status === 'timeout') { failedIdsRef.current.add(stream.id); setFailedState((current) => { const ids = current.matchId === props.match.id ? new Set(current.ids) : new Set<string>(); ids.add(stream.id); return { matchId: props.match.id, ids } }) } }
  const failover = (failedSource: Stream) => {
    failedIdsRef.current.add(failedSource.id)
    const next = getNextSource(props.sources, failedIdsRef.current)
    if (next) {
      props.onSelectSource(next.id)
      props.setMessage(`“${failedSource.name}”播放失败，已自动切换到“${next.name}”。`)
    } else {
      props.setMessage('直播源不可用：所有合法直播源均已失败。')
    }
  }
  const onMediaError = (event: SyntheticEvent<HTMLVideoElement | HTMLIFrameElement>) => {
    if (!source || source.access !== 'player') return
    if (!failedIdsRef.current.has(source.id)) {
      reportHealth(source, { status: 'offline', lastCheckedAt: new Date().toISOString(), latency: null, errorMessage: '播放器加载失败' })
      failover(source)
    }
    event.currentTarget.removeAttribute('src')
  }
  const refresh = () => {
    if (!source) return
    const requestId = healthRequestRef.current
    const requestSource = source
    void checkStreamHealth(requestSource).then((result) => {
      if (requestId !== healthRequestRef.current) return
      const snapshot = { status: result.status, lastCheckedAt: result.lastCheckedAt, latency: result.latency, errorMessage: result.errorMessage }
      reportHealth(requestSource, snapshot)
      props.setMessage(result.errorMessage ?? `健康状态：${healthLabels[result.status]}`)
    })
  }
  const fullscreen = () => { const target = playerRef.current; if (!target?.requestFullscreen) { props.setMessage('当前浏览器不支持全屏播放器。'); return } void target.requestFullscreen().catch(() => props.setMessage('无法进入全屏模式。')) }
  const officialPageUrl = source?.access === 'official-page' ? getSafeOfficialPageUrl(source) : null
  let playerError: string | null = null
  if (props.streamsLoading) playerError = '正在检测直播源'
  else if (props.streamsError) playerError = `直播源加载失败：${props.streamsError}`
  else if (source?.access === 'official-page') playerError = officialPageUrl ? null : '暂无合法直播源'
  else if (!source || playableSources.length === 0) playerError = '暂无合法直播源'
  else if (allPlayableSourcesFailed) playerError = '直播源不可用：所有合法直播源均已失败。'
  else if (source.access !== 'player') playerError = '暂无合法直播源'
  else playerError = getStreamUrlError(source) ?? (status === 'offline' || status === 'timeout' ? '直播源不可用，请切换备用源。' : null)
  const retrySources = () => { healthRequestRef.current += 1; failedIdsRef.current = new Set(); setFailedState({ matchId: props.match.id, ids: new Set() }); props.setMessage(null); props.onRefreshSources() }
  const playerNote = officialPageUrl ? '该来源仅提供官方观看入口，本站不会提取或绕过受保护的直播流。' : playerError ?? '本站播放器不包含广告、弹窗或外部跳转。'
  return <section className="fw-watch" style={style}><button className="fw-back" onClick={props.back}>← 返回赛事中心</button><div className="fw-watch-head"><div><p className="fw-eyebrow muted">{props.match.league} · {props.match.round}</p><h1>{props.match.homeTeam.name} <span>vs</span> {props.match.awayTeam.name}</h1><p className="fw-watch-sub"><i className={props.match.status === 'live' ? 'live' : ''} />{statusLabels[props.match.status]} · {formatDate(props.match.startTime)} {formatTime(props.match.startTime)} · {props.match.venue}</p><div className="fw-watch-favorites"><button className={props.favorite ? 'active' : ''} onClick={props.onFavorite}>{props.favorite ? '★ 已收藏比赛' : '☆ 收藏比赛'}</button><button className={props.isTeamFavorite(props.match.homeTeam.id) ? 'active' : ''} onClick={() => props.onTeamFavorite(props.match.homeTeam.id)}>收藏 {props.match.homeTeam.name}</button><button className={props.isLeagueFavorite ? 'active' : ''} onClick={props.onLeagueFavorite}>收藏 {props.match.league}</button></div></div></div><div className="fw-player-layout"><div><div className="fw-player" ref={playerRef}><div className="fw-player-label"><span>{props.match.league}</span><span>FIELDWATCH PLAYER</span></div>{officialPageUrl ? <div className="fw-player-center"><div className="fw-play-ring">↗</div><strong>官方观看入口</strong><p>该来源由官方页面提供，播放权限和地区可用性以官方页面为准。</p><a className="fw-official-link" href={officialPageUrl} target="_blank" rel="noopener noreferrer">打开官方观看入口</a></div> : source && source.access === 'player' && !playerError && source.url ? <MediaElement key={`${source.id}:${source.url}`} source={source} onError={onMediaError} /> : <div className="fw-player-center"><div className="fw-play-ring">{playerError ? '!' : '▶'}</div><strong>{playerError ?? '播放器已就绪'}</strong><p>{source ? `当前源：${source.name} · ${source.type.toUpperCase()}` : '请选择一个直播源。'}</p></div>}<div className="fw-controls"><button onClick={fullscreen} title="全屏播放器">⛶</button><i><b /></i><button onClick={refresh} title="检查当前直播源">↻</button></div></div><div className={playerError ? 'fw-player-note error' : 'fw-player-note'}><span>{playerError ? '!' : '✓'}</span>{props.message ?? playerNote}<button onClick={() => props.setMessage(null)}>清除提示</button></div></div><aside className="fw-source-panel"><div className="fw-panel-head"><div><p className="fw-eyebrow muted">STREAM SOURCES</p><h3>直播源</h3></div><small>{props.sources.length} 个</small></div>{props.streamsLoading ? <p className="fw-no-source">正在检测直播源…</p> : props.streamsError ? <p className="fw-no-source">{props.streamsError}</p> : <div className="fw-source-list">{props.sources.length ? props.sources.map((item) => { const itemStatus = props.sourceHealth[item.id]?.status ?? item.status; const accessLabel = item.access === 'official-page' ? '官方入口' : item.provider === 'demo' ? 'DEMO · 待授权' : item.type.toUpperCase(); return <button key={item.id} className={item.id === source?.id ? 'selected' : ''} disabled={!item.enabled || failedIds.has(item.id)} onClick={() => { props.onSelectSource(item.id); props.setMessage(null) }}><i /><span><b>{item.name}</b><small>{accessLabel} · 优先级 {item.priority}{item.enabled ? '' : ' · 已禁用'}</small></span><em className={itemStatus === 'online' ? 'ready' : itemStatus === 'offline' || itemStatus === 'timeout' ? 'down' : ''}>{item.legalStatus === 'authorized' ? healthLabels[itemStatus] : '待授权'}</em></button> }) : <p className="fw-no-source">暂无合法直播源。</p>}</div>}<div className="fw-tip"><i>i</i>仅自动尝试已授权且通过 URL 校验的备用源；Demo 源不会伪装成真实直播。</div><button className="fw-source-refresh" onClick={retrySources}>刷新直播源</button></aside></div></section>
}
function MediaElement({ source, onError }: { source: Stream; onError: (event: SyntheticEvent<HTMLVideoElement | HTMLIFrameElement>) => void }) { if (source.type === 'embed') return <EmbedElement source={source} onError={onError} />; return <VideoElement source={source} onError={onError} /> }
function VideoElement({ source, onError }: { source: Stream; onError: (event: SyntheticEvent<HTMLVideoElement>) => void }) {
  const mediaRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const media = mediaRef.current
    return () => { if (media) { media.pause(); media.removeAttribute('src'); media.load() } }
  }, [])
  return <video ref={mediaRef} className="fw-media" src={source.url} controls autoPlay playsInline onError={onError} />
}
function EmbedElement({ source, onError }: { source: Stream; onError: (event: SyntheticEvent<HTMLIFrameElement>) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const frame = frameRef.current
    return () => { frame?.removeAttribute('src') }
  }, [])
  return <iframe ref={frameRef} className="fw-media" src={source.url} title={source.name} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; fullscreen; picture-in-picture" referrerPolicy="no-referrer" loading="lazy" onError={onError} />
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, SyntheticEvent } from 'react'
import { sportIcons, sportLabels } from './matches-data'
import { useMatches } from './hooks/use-matches'
import { useStreams } from './hooks/use-streams'
import { getFavorites, getRecentWatches, recordRecentWatch, toggleFavorite } from './storage'
import type { FavoriteState, RecentWatch } from './storage'
import { checkStreamHealth } from './services/stream-health-service'
import { getNextSource, hasLegalSourceForMatch } from './services/stream-service'
import { getSafeOfficialPageUrl } from './services/stream-url-policy'
import { createRecordFromEntries, createSafeAbortController } from './services/runtime-compat'
import type { Match, MatchStatus, Sport, Stream, StreamHealth } from './types'
import type { StreamQueryStatus } from './services/stream-query-service'
import { addDays, dateKey, formatDate, formatTime, statusLabels, statusOrder, healthLabels, sourceKindLabels, getSourceKind, matchSearchText, matchDataSummary, streamSummary, visibleSources, canPlaySource, selectSource, isAuthorizedSource, NO_LIVE_SOURCE } from './ui/presentation'
import './fieldwatch.css'

type View = 'home' | 'favorites' | 'recent'
type DayMode = 'today' | 'tomorrow' | 'day-after' | 'custom'
type HealthSnapshot = { status: StreamHealth; lastCheckedAt: string; latency: number | null; errorMessage: string | null }

const sportOrder: Array<Sport | 'all'> = ['all', 'football', 'basketball', 'baseball', 'tennis', 'esports']

export default function FieldWatchApp() {
  const matchQuery = useMatches()
  const { data: matches, loading: matchesLoading, error: matchesError, lastUpdated, provider: matchesProvider, fallback: matchesFallback, refresh: refreshMatches } = matchQuery
  const [view, setView] = useState<View>('home')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openedMatch, setOpenedMatch] = useState<Match | null>(null)
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
  const selected = matches.find((match) => match.id === selectedId) ?? (openedMatch?.id === selectedId ? openedMatch : null)
  const { data: streams, loading: streamsLoading, refreshing: streamsRefreshing, cacheHit: streamsCacheHit, error: streamsError, status: streamsStatus, stale: streamsStale, refresh: refreshStreams } = useStreams(selected)
  const selectedDate = dayMode === 'custom' ? customDate : dateKey(addDays(dayMode === 'today' ? 0 : dayMode === 'tomorrow' ? 1 : 2))
  const leagues = useMemo(() => Array.from(new Set(matches.filter((match) => sport === 'all' || match.sport === sport).map((match) => match.league))).sort(), [matches, sport])
  const matchIndex = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches])
  const recentMatches = useMemo(() => recent.map((item) => matchIndex.get(item.matchId)).filter((match): match is Match => Boolean(match)), [matchIndex, recent])
  const savedMissingCount = view === 'favorites' ? favorites.matches.filter((id) => !matchIndex.has(id)).length : view === 'recent' ? recent.filter((item) => !matchIndex.has(item.matchId)).length : 0
  const listedMatches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const list = matches.filter((match) => {
      const favorite = favorites.matches.includes(match.id) || favorites.teams.includes(match.homeTeam.id) || favorites.teams.includes(match.awayTeam.id) || favorites.leagues.includes(match.league)
      return (view !== 'home' || dateKey(match.startTime) === selectedDate) && (sport === 'all' || match.sport === sport) && (league === 'all' || match.league === league) && (!needle || matchSearchText(match).includes(needle)) && (view !== 'favorites' || favorite) && (view !== 'recent' || recent.some((item) => item.matchId === match.id))
    })
    if (view === 'recent') { const ordering = new Map(recent.map((item, index) => [item.matchId, index])); return list.sort((left, right) => (ordering.get(left.id) ?? 99) - (ordering.get(right.id) ?? 99)) }
    return list.sort((left, right) => Number(right.status === 'live') - Number(left.status === 'live') || new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
  }, [favorites, league, matches, query, recent, selectedDate, sport, view])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    const controller = createSafeAbortController()
    if (streams.length) void Promise.all(visibleSources(streams).filter(isAuthorizedSource).map((stream) => checkStreamHealth(stream, undefined, controller.signal))).then((results) => {
      if (active) setSourceHealth((current) => ({ ...current, ...createRecordFromEntries(results.map((result) => [result.streamId, { status: result.status, lastCheckedAt: result.lastCheckedAt, latency: result.latency, errorMessage: result.errorMessage }] as const)) }))
    })
    return () => { active = false; controller.abort() }
  }, [selectedId, streams])

  const openMatch = (match: Match) => { setPlayerMessage(null); setSourceId(null); setSourceHealth({}); setRecent(recordRecentWatch(match.id)); setOpenedMatch(match); setSelectedId(match.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const toggle = (kind: keyof FavoriteState, id: string) => setFavorites(toggleFavorite(kind, id))
  const isFavorite = (kind: keyof FavoriteState, id: string) => favorites[kind].includes(id)
  const switchView = (next: View) => { setSelectedId(null); setView(next) }

  return <div className="fw-shell">
    <header className="fw-topbar"><div className="fw-topbar-inner"><button className="fw-brand" onClick={() => switchView('home')} aria-label="返回赛事中心"><span className="fw-brand-mark"><i /></span><span><b>FIELD</b><small>WATCH</small></span></button><nav aria-label="主导航"><button className={view === 'home' && !selected ? 'fw-nav active' : 'fw-nav'} onClick={() => switchView('home')}>赛事中心</button><button className={view === 'favorites' ? 'fw-nav active' : 'fw-nav'} onClick={() => switchView('favorites')}>我的收藏</button><button className={view === 'recent' ? 'fw-nav active' : 'fw-nav'} onClick={() => switchView('recent')}>最近观看</button></nav><div className="fw-actions"><label className="fw-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); setView('home') }} placeholder="搜索球队、球员或赛事" aria-label="搜索比赛" /></label><button className="fw-counter" onClick={() => switchView('favorites')} title="我的收藏">★<small>{favorites.matches.length}</small></button><button className="fw-counter" onClick={() => switchView('recent')} title="最近观看">◷<small>{recent.length}</small></button></div></div></header>
    <main className={selected ? 'fw-main fw-watch-mode' : 'fw-main'}>{selected ? <Watch key={selected.id} match={selected} sources={streams} streamsLoading={streamsLoading} streamsError={streamsError} streamsStatus={streamsStatus} streamsStale={streamsStale} streamsRefreshing={streamsRefreshing} streamsCacheHit={streamsCacheHit} sourceId={sourceId} sourceHealth={sourceHealth} favorite={isFavorite('matches', selected.id)} onFavorite={() => toggle('matches', selected.id)} onTeamFavorite={(id) => toggle('teams', id)} onLeagueFavorite={() => toggle('leagues', selected.league)} isTeamFavorite={(id) => isFavorite('teams', id)} isLeagueFavorite={isFavorite('leagues', selected.league)} onSelectSource={setSourceId} onHealth={(id, result) => setSourceHealth((current) => ({ ...current, [id]: result }))} onRefreshSources={refreshStreams} message={playerMessage} setMessage={setPlayerMessage} back={() => setSelectedId(null)} /> : <Home view={view} sport={sport} league={league} query={query} selectedDate={selectedDate} dayMode={dayMode} customDate={customDate} leagues={leagues} list={listedMatches} recentMatches={recentMatches} isFavorite={(id) => isFavorite('matches', id)} onSport={(next) => { setSport(next); setLeague('all') }} onLeague={setLeague} onDay={setDayMode} onCustomDate={(value) => { setCustomDate(value); setDayMode('custom') }} onToggleFavorite={(id) => toggle('matches', id)} onOpen={openMatch} loading={matchesLoading} refreshing={matchQuery.refreshing || matchQuery.backgroundRefreshing} summary={matchDataSummary({ ...matchQuery, hasData: matches.length > 0 })} savedMissingCount={savedMissingCount} error={matchesError} lastUpdated={lastUpdated} provider={matchesProvider} fallback={matchesFallback} onRefresh={refreshMatches} />}</main>
    <footer className="fw-footer"><span>FIELDWATCH · 个人赛事空间</span><span>数据、播放器和直播源独立配置 · 无广告、无弹窗 · 仅提供已核验官方入口</span></footer>
  </div>
}

type HomeProps = { view: View; sport: Sport | 'all'; league: string; query: string; selectedDate: string; dayMode: DayMode; customDate: string; leagues: string[]; list: Match[]; recentMatches: Match[]; isFavorite: (id: string) => boolean; onSport: (sport: Sport | 'all') => void; onLeague: (league: string) => void; onDay: (mode: DayMode) => void; onCustomDate: (date: string) => void; onToggleFavorite: (id: string) => void; onOpen: (match: Match) => void; loading: boolean; refreshing: boolean; summary: string; savedMissingCount: number; error: string | null; lastUpdated: number | null; provider: string | null; fallback: boolean; onRefresh: () => void }
function Home(props: HomeProps) {
  const heading = props.view === 'favorites' ? '我的收藏' : props.view === 'recent' ? '最近观看' : '赛事日程'
  const dayItems: Array<[DayMode, string, number]> = [['today', '今天', 0], ['tomorrow', '明天', 1], ['day-after', '后天', 2]]
  const dataStatus = props.summary
  return <><section className="fw-hero"><div><p className="fw-eyebrow"><i />LIVE SPORTS HUB</p><h1>你关注的比赛，<em>都在这里。</em></h1><p className="fw-hero-copy">清爽、专注、无干扰。赛事数据与直播源分层管理。</p></div><div className="fw-date"><span>北京时间</span><b>{formatDate(new Date().toISOString())}</b><small>实时赛程视图</small></div></section><section className="fw-sports" aria-label="体育项目筛选">{sportOrder.map((item) => <button key={item} className={props.sport === item ? 'fw-sport active' : 'fw-sport'} onClick={() => props.onSport(item)}><span>{sportIcons[item]}</span>{sportLabels[item]}</button>)}</section><section className="fw-schedule"><div className="fw-heading"><div><p className="fw-eyebrow muted">SCHEDULE</p><h2>{heading}</h2><p className="fw-data-status" role="status" aria-live="polite">{dataStatus}</p></div><div className="fw-heading-actions"><span>{props.list.length} 场比赛</span><select value={props.league} onChange={(event) => props.onLeague(event.target.value)} aria-label="赛事筛选"><option value="all">全部赛事</option>{props.leagues.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="fw-refresh" onClick={props.onRefresh} disabled={props.loading || props.refreshing} title="刷新赛事" aria-label="刷新赛事数据">{props.loading || props.refreshing ? '…' : '↻'}</button></div></div><div className="fw-days" aria-label="日期筛选">{dayItems.map(([mode, label, offset]) => <button key={mode} className={props.dayMode === mode ? 'selected' : ''} onClick={() => props.onDay(mode)}><small>{label}</small><b>{Number(dateKey(addDays(offset)).slice(-2))}</b></button>)}<label className={props.dayMode === 'custom' ? 'fw-custom-date selected' : 'fw-custom-date'}><small>自定义</small><input type="date" value={props.customDate} onChange={(event) => props.onCustomDate(event.target.value)} aria-label="自定义日期" /></label></div>{props.query && <p className="fw-filter-summary">“{props.query}” 的搜索结果</p>}{props.view === 'home' && props.recentMatches.length > 0 && <section className="fw-recent"><div className="fw-group-title"><h3>最近观看</h3><span>自动保留最近 10 场</span></div><div className="fw-recent-list">{props.recentMatches.slice(0, 4).map((match) => <button key={match.id} onClick={() => props.onOpen(match)}>{match.homeTeam.name}<i>vs</i>{match.awayTeam.name}</button>)}</div></section>}{props.loading && !props.list.length ? <div className="fw-empty"><strong>正在加载赛事数据</strong><span>请稍候。</span></div> : props.list.length ? <div className="fw-groups">{props.view === 'recent' ? <div className="fw-list">{props.list.map((match) => <MatchCard key={match.id} match={match} favorite={props.isFavorite(match.id)} onToggleFavorite={props.onToggleFavorite} onOpen={props.onOpen} />)}</div> : statusOrder.map((status) => <MatchGroup key={status} title={statusLabels[status]} status={status} list={props.list} favorite={props.isFavorite} onToggleFavorite={props.onToggleFavorite} onOpen={props.onOpen} />)}</div> : props.error ? <div className="fw-empty" role="alert"><strong>赛事数据加载失败</strong><span>请稍后刷新重试。</span></div> : <EmptyState view={props.view} filtered={Boolean(props.query || props.sport !== 'all' || props.league !== 'all')} />}{props.savedMissingCount > 0 && <p className="fw-data-status">有 {props.savedMissingCount} 场已保存的比赛不在本次加载范围内，收藏与记录仍已保留。</p>}</section></>
}
function EmptyState({ view, filtered }: { view: View; filtered: boolean }) { const message = filtered ? '没有匹配的赛事' : view === 'favorites' ? '暂无已加载的收藏赛事' : view === 'recent' ? '暂无已加载的观看记录' : '所选日期暂无赛事'; const detail = view === 'favorites' ? '在比赛卡片或观看页点击星标即可收藏。' : view === 'recent' ? '打开任意比赛观看页后，会自动保存在这里。' : '试试切换日期、项目、赛事，或调整搜索词。'; return <div className="fw-empty"><strong>{message}</strong><span>{detail}</span></div> }
function MatchGroup({ title, status, list, favorite, onToggleFavorite, onOpen }: { title: string; status: MatchStatus; list: Match[]; favorite: (id: string) => boolean; onToggleFavorite: (id: string) => void; onOpen: (match: Match) => void }) { const group = list.filter((match) => match.status === status); if (!group.length) return null; return <section className="fw-match-group"><div className="fw-group-title"><h3>{title}</h3><span>{group.length} 场</span></div><div className="fw-list">{group.map((match) => <MatchCard key={match.id} match={match} favorite={favorite(match.id)} onToggleFavorite={onToggleFavorite} onOpen={onOpen} />)}</div></section> }
 export function MatchCard({ match, favorite, onToggleFavorite, onOpen }: { match: Match; favorite: boolean; onToggleFavorite: (id: string) => void; onOpen: (match: Match) => void }) { const open = () => onOpen(match); return <article className={`fw-card ${match.status}`} role="button" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open() } }}><div className="fw-card-inner"><div className="fw-time"><time dateTime={match.startTime}><b>{formatTime(match.startTime)}</b></time><small>{dateKey(match.startTime)}</small><span className={`fw-status ${match.status}`}>{match.status === 'live' && <i />}{statusLabels[match.status]}</span></div><div className="fw-teams"><div className="fw-league"><span>{sportIcons[match.sport]}</span>{match.league}<small>{match.round}</small></div><div className="fw-team-row"><b>{match.homeTeam.name}</b><span className="fw-badge home">{match.homeTeam.shortName?.slice(0, 2)}</span><span className="fw-vs">{match.score ? `${match.score[0]} : ${match.score[1]}` : 'VS'}</span><span className="fw-badge away">{match.awayTeam.shortName?.slice(0, 2)}</span><b>{match.awayTeam.name}</b></div></div><div className="fw-card-meta"><span>{match.sourceProvider === 'demo' ? '演示赛事' : hasLegalSourceForMatch(match) ? '已核验直播来源' : '查看播放来源'}</span><small>{match.venue}</small></div><button className={favorite ? 'fw-favorite active' : 'fw-favorite'} onClick={(event) => { event.stopPropagation(); onToggleFavorite(match.id) }} title={favorite ? '取消收藏比赛' : '收藏比赛'} aria-label={favorite ? '取消收藏比赛' : '收藏比赛'}>{favorite ? '★' : '☆'}</button><button className="fw-watch-btn" onClick={(event) => { event.stopPropagation(); open() }}>查看详情 <span>→</span></button></div></article> }

type WatchProps = {
  match: Match; sources: Stream[]; streamsLoading: boolean; streamsRefreshing: boolean; streamsCacheHit: boolean
  streamsError: string | null; streamsStatus: StreamQueryStatus | 'loading'; streamsStale: boolean
  sourceId: string | null; sourceHealth: Record<string, HealthSnapshot>; favorite: boolean
  onFavorite: () => void; onTeamFavorite: (id: string) => void; onLeagueFavorite: () => void
  isTeamFavorite: (id: string) => boolean; isLeagueFavorite: boolean; onSelectSource: (id: string) => void
  onHealth: (id: string, result: HealthSnapshot) => void; onRefreshSources: () => void
  message: string | null; setMessage: (message: string | null) => void; back: () => void
}
export function Watch(props: WatchProps) {
  const playerRef = useRef<HTMLDivElement>(null)
  const failedIdsRef = useRef(new Set<string>())
  const healthControllerRef = useRef<AbortController | null>(null)
  const [failedIds, setFailedIds] = useState(new Set<string>())
  const [checking, setChecking] = useState(false)
  const sources = useMemo(() => visibleSources(props.sources), [props.sources])
  const source = selectSource(sources, props.sourceId)
  const explicitlySelected = source?.id === props.sourceId
  const activeFallback = Boolean(source?.sourceKind === 'live' && source.role === 'fallback' && failedIds.size)
  const summary = streamSummary({
    streams: sources, status: props.streamsStatus === 'loading' ? 'success-empty' : props.streamsStatus,
    loading: props.streamsLoading, refreshing: props.streamsRefreshing, stale: props.streamsStale,
    fallbackActive: activeFallback, cacheHit: props.streamsCacheHit,
  })
  const status = source ? props.sourceHealth[source.id]?.status ?? source.status : 'unknown'
  const officialPageUrl = source?.access === 'official-page' && explicitlySelected ? getSafeOfficialPageUrl(source) : null
  const playable = Boolean(source && canPlaySource(source, explicitlySelected) && !failedIds.has(source.id) && status !== 'offline' && status !== 'timeout')
  const hasVod = sources.some((item) => item.sourceKind === 'vod' && isAuthorizedSource(item))
  const playerMessage = source && !isAuthorizedSource(source) ? '此来源暂不可播放'
    : source && getSourceKind(source) === 'unknown' ? '来源类型未知，不自动播放'
      : source && (failedIds.has(source.id) || status === 'offline' || status === 'timeout') ? '当前来源不可用，可刷新或选择其他来源'
        : !source && hasVod ? '已找到回放，请选择录播来源'
          : !source ? summary : source.sourceKind === 'vod' ? '录播回放 · 非实时直播' : summary
  const style = { '--fw-accent': props.match.sport === 'basketball' ? '#ff8a4c' : props.match.sport === 'tennis' ? '#bfef63' : '#5bdbc2' } as CSSProperties

  useEffect(() => () => { healthControllerRef.current?.abort() }, [source?.id, source?.url])

  const onMediaError = (event: SyntheticEvent<HTMLVideoElement | HTMLIFrameElement>) => {
    event.currentTarget.removeAttribute('src')
    if (!source || failedIdsRef.current.has(source.id)) return
    failedIdsRef.current.add(source.id)
    setFailedIds(new Set(failedIdsRef.current))
    props.onHealth(source.id, { status: 'offline', lastCheckedAt: new Date().toISOString(), latency: null, errorMessage: null })
    const next = source.sourceKind === 'live' && source.fallbackEnabled
      ? getNextSource(sources, failedIdsRef.current) : undefined
    if (next) {
      props.onSelectSource(next.id)
      props.setMessage('主来源播放失败，已切换到备用直播源（fallback）')
    } else props.setMessage('当前来源播放失败，请选择其他来源或稍后刷新')
  }
  const refreshHealth = async () => {
    if (!source || healthControllerRef.current && !healthControllerRef.current.signal.aborted) return
    const controller = createSafeAbortController()
    healthControllerRef.current = controller
    setChecking(true)
    try {
      const result = await checkStreamHealth(source, undefined, controller.signal)
      if (!controller.signal.aborted) {
        props.onHealth(source.id, { status: result.status, lastCheckedAt: result.lastCheckedAt, latency: result.latency, errorMessage: null })
        props.setMessage(source.type === 'embed' ? '嵌入视频可用性以播放器结果为准' : `健康状态：${healthLabels[result.status]}`)
      }
    } finally {
      if (healthControllerRef.current === controller && !controller.signal.aborted) setChecking(false)
      if (healthControllerRef.current === controller) healthControllerRef.current = null
    }
  }
  const fullscreen = () => {
    if (!playerRef.current?.requestFullscreen) { props.setMessage('当前浏览器不支持全屏'); return }
    void playerRef.current.requestFullscreen().catch(() => props.setMessage('无法进入全屏模式'))
  }
  const retrySources = () => {
    if (props.streamsLoading || props.streamsRefreshing) return
    failedIdsRef.current.clear()
    setFailedIds(new Set())
    props.setMessage(null)
    props.onRefreshSources()
  }
  return <section className="fw-watch" style={style}>
    <button className="fw-back" onClick={props.back}>← 返回赛事中心</button>
    <div className="fw-watch-head"><div>
      <p className="fw-eyebrow muted">{props.match.league} · {props.match.round}</p>
      <h1>{props.match.homeTeam.name} <span>vs</span> {props.match.awayTeam.name}</h1>
      <p className="fw-watch-sub"><span className={`fw-status ${props.match.status}`}>{statusLabels[props.match.status]}</span> · <time dateTime={props.match.startTime}>{formatDate(props.match.startTime)} {formatTime(props.match.startTime)}</time> · 北京时间{props.match.venue ? ` · ${props.match.venue}` : ''}</p>
      {props.match.score && <p className="fw-score">比分 {props.match.score[0]} : {props.match.score[1]}</p>}
      {props.match.sourceProvider === 'demo' && <p className="fw-data-status">演示赛事 · 不代表当前真实赛程</p>}
      <div className="fw-watch-favorites">
        <button aria-pressed={props.favorite} className={props.favorite ? 'active' : ''} onClick={props.onFavorite}>{props.favorite ? '★ 已收藏比赛' : '☆ 收藏比赛'}</button>
        {[props.match.homeTeam, props.match.awayTeam].map((team) => <button key={team.id} aria-pressed={props.isTeamFavorite(team.id)} className={props.isTeamFavorite(team.id) ? 'active' : ''} onClick={() => props.onTeamFavorite(team.id)}>收藏 {team.name}</button>)}
        <button aria-pressed={props.isLeagueFavorite} className={props.isLeagueFavorite ? 'active' : ''} onClick={props.onLeagueFavorite}>收藏 {props.match.league}</button>
      </div>
    </div></div>
    <div className="fw-player-layout"><div>
      <div className="fw-player" ref={playerRef}>
        {officialPageUrl ? <div className="fw-player-center"><strong>官方观看入口</strong><a className="fw-official-link" href={officialPageUrl} target="_blank" rel="noopener noreferrer">打开官方观看入口</a></div>
          : source && playable ? <MediaElement key={`${source.id}:${source.url}`} source={source} onError={onMediaError} />
            : <div className="fw-player-center"><strong>{playerMessage}</strong>{source && <p>{source.name} · {sourceKindLabels[getSourceKind(source)]}</p>}</div>}
      </div>
      <div className="fw-player-note"><span>{playable ? '✓' : 'i'}</span><p role="status">{props.message ?? playerMessage}</p>
        <button onClick={fullscreen} title="全屏播放器" aria-label="全屏播放器">⛶</button>
        <button onClick={() => { void refreshHealth() }} disabled={!source || checking} title="检查来源健康状态" aria-label="检查来源健康状态">↻</button>
      </div>
    </div><aside className="fw-source-panel" aria-busy={props.streamsLoading || props.streamsRefreshing}>
      <div className="fw-panel-head"><div><p className="fw-eyebrow muted">SOURCES</p><h3>播放来源</h3></div><small>{sources.length} 个</small></div>
      <p className="fw-source-state" role="status" aria-live="polite">{summary}</p>
      <div className="fw-source-list">
        {sources.length ? sources.map((item) => {
          const itemStatus = props.sourceHealth[item.id]?.status ?? item.status
          const role = item.sourceKind === 'live' && item.legalStatus === 'authorized' ? item.role === 'fallback' ? '备用 · fallback' : '主源 · primary' : ''
          const health = checking && item.id === source?.id || !props.sourceHealth[item.id] && isAuthorizedSource(item) ? '检测中' : healthLabels[itemStatus]
          return <button key={item.id} className={item.id === source?.id ? 'selected' : ''} aria-pressed={item.id === source?.id}
            disabled={!isAuthorizedSource(item) || getSourceKind(item) === 'unknown' || failedIds.has(item.id)}
            onClick={() => { healthControllerRef.current?.abort(); setChecking(false); props.onSelectSource(item.id); props.setMessage(null) }}>
            <i /><span><b>{item.name}</b><small>{sourceKindLabels[getSourceKind(item)]} · {item.legalStatus === 'authorized' ? '已授权' : '未授权'}</small>
              <small>{item.access === 'official-page' ? '官方入口' : item.type.toUpperCase()}{role ? ` · ${role}` : ''}</small></span>
            <em className={itemStatus === 'online' ? 'ready' : itemStatus === 'offline' || itemStatus === 'timeout' ? 'down' : ''}>{health}</em>
          </button>
        }) : !props.streamsLoading && <p className="fw-no-source">{props.streamsStatus === 'failure' || props.streamsStatus === 'partial-failure' ? '可稍后重新查询。' : NO_LIVE_SOURCE}</p>}
      </div>
      <button className="fw-source-refresh" onClick={retrySources} disabled={props.streamsLoading || props.streamsRefreshing}>{props.streamsLoading || props.streamsRefreshing ? '正在查询…' : '刷新播放来源'}</button>
    </aside></div>
  </section>
}
function MediaElement({ source, onError }: { source: Stream; onError: (event: SyntheticEvent<HTMLVideoElement | HTMLIFrameElement>) => void }) { if (source.type === 'embed') return <EmbedElement source={source} onError={onError} />; return <VideoElement source={source} onError={onError} /> }
function VideoElement({ source, onError }: { source: Stream; onError: (event: SyntheticEvent<HTMLVideoElement>) => void }) {
  const mediaRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const media = mediaRef.current
    if (media?.getAttribute('src') !== source.url) media?.setAttribute('src', source.url)
    return () => { if (media) { media.pause(); media.removeAttribute('src'); media.load() } }
  }, [source.url])
  return <video ref={mediaRef} className="fw-media" src={source.url} controls autoPlay={source.sourceKind === 'live'} playsInline onError={onError} />
}
function EmbedElement({ source, onError }: { source: Stream; onError: (event: SyntheticEvent<HTMLIFrameElement>) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const frame = frameRef.current
    if (frame?.getAttribute('src') !== source.url) frame?.setAttribute('src', source.url)
    return () => { frame?.removeAttribute('src') }
  }, [source.url])
  return <iframe ref={frameRef} className="fw-media" src={source.url} title={source.name} sandbox="allow-scripts allow-same-origin allow-presentation" allow={source.sourceKind === 'live' ? 'autoplay; fullscreen; picture-in-picture' : 'fullscreen; picture-in-picture'} referrerPolicy="strict-origin-when-cross-origin" loading="lazy" onError={onError} />
}

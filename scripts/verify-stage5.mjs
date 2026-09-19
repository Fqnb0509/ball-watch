import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const tests = []
const test = (name, run) => tests.push({ name, run })
const originalFetch = globalThis.fetch
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let fetchCalls = 0
globalThis.fetch = async () => { fetchCalls += 1; throw new Error('Stage 5 tests prohibit network access') }
const vite = await createServer({
  root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'error',
  resolve: { preserveSymlinks: true },
  ssr: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  oxc: { jsx: { runtime: 'automatic' } },
  server: { middlewareMode: true, hmr: false },
})
const match = {
  id: 'football-data-501', sport: 'football', league: 'Premier League', round: 'Week 5',
  homeTeam: { id: 'home', name: 'Home FC', shortName: 'HFC', players: ['Player Example'] },
  awayTeam: { id: 'away', name: 'Away FC' }, status: 'upcoming',
  startTime: '2026-09-19T16:30:00Z', date: '1900-01-01', streamIds: [], sourceProvider: 'football-data',
}
const stream = (overrides = {}) => ({
  id: 'live', matchId: match.id, provider: 'youtube', legalStatus: 'authorized', sourceKind: 'live',
  name: 'Fixture source', url: 'https://www.youtube.com/embed/T4bVbVd03mM', type: 'embed', access: 'player',
  enabled: true, priority: 100, fallbackEnabled: true, role: 'primary', status: 'unknown',
  lastCheckedAt: null, errorMessage: null, latency: null, officialPageUrl: null, eventId: null, ...overrides,
})
const noop = () => {}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

try {
  const ui = await vite.ssrLoadModule('/src/ui/presentation.ts')
  const app = await vite.ssrLoadModule('/src/FieldWatchApp.tsx')
  const storage = await vite.ssrLoadModule('/src/storage.ts')
  const query = await vite.ssrLoadModule('/src/services/stream-query-service.ts')
  const youtube = await vite.ssrLoadModule('/src/stream-providers/youtube-provider.ts')
  const { matches } = await vite.ssrLoadModule('/src/matches-data.ts')
  const renderWatch = (overrides = {}) => renderToStaticMarkup(createElement(app.Watch, {
    match, sources: [], streamsLoading: false, streamsRefreshing: false, streamsCacheHit: false,
    streamsError: null, streamsStatus: 'success-empty', streamsStale: false, sourceId: null,
    sourceHealth: {}, favorite: false, onFavorite: noop, onTeamFavorite: noop, onLeagueFavorite: noop,
    isTeamFavorite: () => false, isLeagueFavorite: false, onSelectSource: noop, onHealth: noop,
    onRefreshSources: noop, message: null, setMessage: noop, back: noop, ...overrides,
  }))
  const renderCard = (value) => renderToStaticMarkup(createElement(app.MatchCard, { match: value, favorite: false, onToggleFavorite: noop, onOpen: noop }))

  test('Shanghai midnight conversion ignores the legacy date field', () => {
    assert.equal(ui.dateKey(match.startTime), '2026-09-20')
    assert.equal(ui.formatTime(match.startTime), '00:30')
    assert.equal(ui.formatTime('2026-09-20T00:30:00+08:00'), '00:30')
    assert.equal(ui.dateKey(ui.addDays(1, new Date('2026-12-31T16:30:00Z'))), '2027-01-02')
    assert.equal(ui.formatTime('invalid'), '时间待定')
    assert.match(ui.formatDate(match.startTime), /2026年9月20日/)
  })
  test('List and detail render the same startTime and all six normalized statuses', () => {
    for (const status of ['upcoming', 'live', 'suspended', 'finished', 'postponed', 'cancelled']) {
      const value = { ...match, status }
      for (const html of [renderCard(value), renderWatch({ match: value })]) {
        assert.ok(html.includes(ui.statusLabels[status]))
        assert.ok(html.includes('00:30'))
        assert.match(html, /datetime="2026-09-19T16:30:00Z"/i)
        assert.equal(html.includes('1900-01-01'), false)
      }
    }
  })
  test('Only an authorized live source is selected automatically', () => {
    for (const sourceKind of ['vod', 'unknown', undefined]) assert.equal(ui.selectSource([stream({ sourceKind })], null), undefined)
    for (const legalStatus of ['demo', 'unverified']) assert.equal(ui.canPlaySource(stream({ legalStatus }), true), false)
    assert.equal(ui.canPlaySource(stream(), false), true)
    assert.equal(ui.canPlaySource(stream({ sourceKind: 'unknown' }), true), false)
    assert.equal(ui.canPlaySource(stream({ sourceKind: 'vod' }), false), false)
    assert.equal(ui.canPlaySource(stream({ sourceKind: 'vod' }), true), true)
  })
  test('Verified YouTube VOD remains available only after manual selection', () => {
    const testMatch = matches.find((value) => value.id === 'youtube-savannah-bananas-test')
    const sources = youtube.getYouTubeStreams(testMatch)
    assert.equal(sources[0].sourceKind, 'vod')
    assert.equal(renderWatch({ match: testMatch, sources }).includes('<iframe'), false)
    const html = renderWatch({ match: testMatch, sources, sourceId: sources[0].id })
    assert.ok(html.includes('https://www.youtube.com/embed/T4bVbVd03mM'))
    assert.ok(html.includes('录播回放'))
    assert.ok(html.includes('sandbox="allow-scripts allow-same-origin allow-presentation"'))
    assert.ok(html.includes('allow="fullscreen; picture-in-picture"'))
  })
  test('Unknown and unverified sources are labelled and disabled; Demo is hidden', () => {
    const sources = [stream({ id: 'unknown', sourceKind: 'unknown' }), stream({ id: 'unverified', legalStatus: 'unverified' }), stream({ id: 'demo', name: 'HiddenDemo', legalStatus: 'demo' })]
    const html = renderWatch({ sources })
    assert.ok(html.includes('未知 · Unknown'))
    assert.ok(html.includes('未授权'))
    assert.equal(html.includes('HiddenDemo'), false)
    assert.equal(html.includes('<iframe'), false)
  })
  test('Empty sources and source query failure have different safe messages', () => {
    assert.ok(renderWatch().includes(ui.NO_LIVE_SOURCE))
    const html = renderWatch({ streamsStatus: 'failure', streamsError: 'SECRET https://private.example/?token=hidden' })
    assert.ok(html.includes('直播源查询失败'))
    assert.equal(html.includes('SECRET'), false)
    assert.equal(html.includes('private.example'), false)
  })
  test('Partial failure and refreshing do not unmount usable media', () => {
    for (const streamsStatus of ['partial-failure', 'failure', 'stale']) {
      const html = renderWatch({ sources: [stream()], streamsStatus, streamsRefreshing: true, streamsStale: true })
      assert.ok(html.includes('<iframe'))
      assert.ok(html.includes('正在刷新'))
      assert.ok(html.includes('disabled=""'))
    }
  })
  test('Primary and fallback roles, authorization and health are visible', () => {
    const html = renderWatch({ sources: [stream(), stream({ id: 'backup', role: 'fallback', priority: 90 })], sourceHealth: { live: { status: 'online' } } })
    for (const label of ['primary', 'fallback', '已授权', '在线', '直播 · Live']) assert.ok(html.includes(label))
  })
  test('Match loading, refresh, cache, stale, errors and Demo fallback are labelled safely', () => {
    const base = { loading: false, error: null, fallback: false, provider: 'demo,football-data', lastUpdated: 0, hasData: true }
    assert.ok(ui.matchDataSummary(base).includes('football-data.org'))
    assert.ok(ui.matchDataSummary({ ...base, loading: true, hasData: false }).includes('正在加载'))
    assert.ok(ui.matchDataSummary({ ...base, refreshing: true }).includes('正在刷新'))
    assert.ok(ui.matchDataSummary({ ...base, cacheHit: true }).includes('已读取缓存'))
    assert.ok(ui.matchDataSummary({ ...base, stale: true, backgroundRefreshing: true }).includes('缓存可能已过期'))
    assert.ok(ui.matchDataSummary({ ...base, fallback: true }).includes('演示替代'))
    assert.equal(ui.matchDataSummary({ ...base, error: 'SECRET' }).includes('SECRET'), false)
  })
  test('Search includes real teams, short names, players, league and round', () => {
    const text = ui.matchSearchText(match)
    for (const needle of ['home fc', 'away fc', 'hfc', 'player example', 'premier league', 'week 5']) assert.ok(text.includes(needle))
  })
  test('Favorites toggle real IDs; corrupt storage recovers without exceptions', () => {
    const memory = new Map()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) } })
    assert.deepEqual(storage.toggleFavorite('matches', match.id).matches, [match.id])
    assert.deepEqual(storage.toggleFavorite('matches', match.id).matches, [])
    memory.set('fieldwatch:favorites:v1', '{broken')
    assert.deepEqual(storage.getFavorites(), { matches: [], teams: [], leagues: [] })
    memory.set('fieldwatch:favorites:v1', JSON.stringify({ matches: [null, {}, '', match.id, match.id], teams: 'bad', leagues: [1] }))
    assert.deepEqual(storage.getFavorites(), { matches: [match.id], teams: [], leagues: [] })
    memory.set('fieldwatch:recent:v1', JSON.stringify([{ matchId: match.id, viewedAt: 'invalid' }, null]))
    assert.deepEqual(storage.getRecentWatches(), [])
    storage.recordRecentWatch(match.id)
    storage.recordRecentWatch(match.id)
    assert.equal(storage.getRecentWatches().length, 1)
    for (let index = 0; index < 12; index += 1) storage.recordRecentWatch(`real-${index}`)
    assert.equal(storage.getRecentWatches().length, 10)
  })
  test('Unavailable localStorage never blocks favorites or recent views', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Denied') } })
    assert.deepEqual(storage.getFavorites().matches, [])
    assert.deepEqual(storage.getRecentWatches(), [])
    assert.doesNotThrow(() => storage.toggleFavorite('matches', match.id))
    assert.doesNotThrow(() => storage.recordRecentWatch(match.id))
  })
  test('Manual refresh deduplicates and updates the existing service cache', async () => {
    let calls = 0
    let gate = deferred()
    const service = query.createStreamQueryService({ providers: [{ provider: 'youtube', query: async () => { calls += 1; await gate.promise; return [stream({ name: `Result ${calls}` })] } }] })
    const one = service.query(match)
    const two = service.query(match, { forceRefresh: true })
    gate.resolve()
    await Promise.all([one, two])
    assert.equal(calls, 1)
    await service.query(match)
    assert.equal(calls, 1)
    gate = deferred()
    const refresh = service.query(match, { forceRefresh: true })
    gate.resolve()
    await refresh
    assert.equal((await service.query(match)).data[0].name, 'Result 2')
  })
  test('SWR serves existing data and publishes the background result', async () => {
    let now = 1000
    let calls = 0
    const service = query.createStreamQueryService({ now: () => now, ttlMs: 10, providers: [{ provider: 'youtube', query: async () => [stream({ name: `Result ${++calls}` })] }] })
    await service.query(match)
    now += 20
    const stale = await service.query(match)
    assert.equal(stale.stale, true)
    assert.equal(stale.data[0].name, 'Result 1')
    const fresh = await service.query(match, { forceRefresh: true })
    assert.equal(fresh.data[0].name, 'Result 2')
    assert.equal(fresh.stale, false)
  })
  test('Aborted requests reject promptly and do not poison the next mount', async () => {
    let calls = 0
    const service = query.createStreamQueryService({ maxRetries: 0, providers: [{ provider: 'youtube', query: ({ signal }) => {
      calls += 1
      if (calls > 1) return []
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve([]), { once: true }))
    } }] })
    const controller = new AbortController()
    const pending = service.query(match, { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal((await service.query(match)).status, 'success-empty')
    assert.equal(calls, 2)
  })
  test('An already aborted signal does not start a provider or mutate its reason', async () => {
    let calls = 0
    const service = query.createStreamQueryService({ providers: [{ provider: 'youtube', query: async () => { calls += 1; return [] } }] })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(service.query(match, { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(controller.signal.reason.name, 'AbortError')
    assert.equal(calls, 0)
  })
  test('Mobile layout provides wrapping, constrained tracks and stable media sizing', async () => {
    const css = await readFile('src/fieldwatch.css', 'utf8')
    for (const rule of ['max-width: 640px', 'max-width: 900px', 'minmax(0, 1fr)', 'min-width: 0', 'overflow-wrap: anywhere', 'flex-wrap: wrap', 'aspect-ratio: 16 / 9']) assert.ok(css.includes(rule))
    assert.ok(css.includes('.fw-source-list button > span'))
  })
  test('Effects guard late completions and clean up requests and media', async () => {
    const hooks = await Promise.all(['src/hooks/use-streams.ts', 'src/hooks/use-matches.ts'].map((file) => readFile(file, 'utf8')))
    for (const hook of hooks) {
      assert.ok(hook.includes('return () =>'))
      assert.ok(hook.includes('controllerRef.current?.abort()'))
      assert.ok(hook.includes('requestIdRef.current'))
      assert.equal(hook.includes('error.message'), false)
    }
    const source = await readFile('src/FieldWatchApp.tsx', 'utf8')
    assert.ok(source.includes('media.pause()'))
    assert.ok(source.includes("frame?.removeAttribute('src')"))
    assert.ok(source.includes("frame?.setAttribute('src', source.url)"))
    assert.ok(source.includes("media?.setAttribute('src', source.url)"))
    assert.ok(source.includes('controller.abort()'))
    assert.equal(source.includes('dangerouslySetInnerHTML'), false)
    assert.equal(source.includes('match.date'), false)
  })
  test('React escapes match text and URL policy prevents arbitrary playback', () => {
    const html = renderCard({ ...match, homeTeam: { id: 'x', name: '<script>alert(1)</script>' } })
    assert.equal(html.includes('<script>'), false)
    for (const url of ['http://www.youtube.com/embed/T4bVbVd03mM', 'https://evil.example/test', 'javascript:alert(1)']) {
      assert.equal(renderWatch({ sources: [stream({ url })], sourceId: 'live' }).includes('<iframe'), false)
    }
  })
  test('CSP and credential boundary remain intact; all tests are offline', async () => {
    const headers = await readFile('public/_headers', 'utf8')
    assert.ok(headers.includes("script-src 'self'"))
    assert.ok(headers.includes('https://www.youtube.com https://www.youtube-nocookie.com'))
    assert.equal(fetchCalls, 0)
  })
  let failures = 0
  for (const { name, run } of tests) {
    try { await run(); console.log(`ok - ${name}`) }
    catch (error) { failures += 1; console.error(`not ok - ${name}`); console.error(error) }
  }
  if (failures) throw new Error(`${failures} Stage 5 checks failed`)
  console.log(`\n${tests.length} Stage 5 offline checks passed.`)
} finally {
  globalThis.fetch = originalFetch
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
  else delete globalThis.localStorage
  await vite.close()
}

import assert from 'node:assert/strict'
import { createServer } from 'vite'

const projectRoot = process.cwd()
const tests = []
const test = (name, run) => tests.push({ name, run })

const match = (overrides = {}) => ({
  id: 'real-match',
  sport: 'football',
  league: 'Premier League',
  homeTeam: { id: 'home-1', name: 'Home FC' },
  awayTeam: { id: 'away-2', name: 'Away FC' },
  startTime: '2026-09-20T12:30:00.000Z',
  date: '2026-09-20',
  status: 'upcoming',
  streamIds: [],
  ...overrides,
})

const stream = (overrides = {}) => ({
  id: 'stream-1',
  matchId: 'real-match',
  name: 'Authorized test stream',
  type: 'embed',
  url: 'https://www.youtube.com/embed/aaaaaaaaaaa',
  priority: 100,
  enabled: true,
  status: 'unknown',
  lastCheckedAt: null,
  errorMessage: null,
  latency: null,
  fallbackEnabled: true,
  provider: 'youtube',
  legalStatus: 'authorized',
  officialPageUrl: null,
  eventId: null,
  access: 'player',
  ...overrides,
})

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))

const vite = await createServer({
  root: projectRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
})

try {
  const resolver = await vite.ssrLoadModule('/src/services/match-stream-resolver.ts')
  const queryModule = await vite.ssrLoadModule('/src/services/stream-query-service.ts')
  const streamService = await vite.ssrLoadModule('/src/services/stream-service.ts')
  const youtube = await vite.ssrLoadModule('/src/stream-providers/youtube-provider.ts')
  const matchesData = await vite.ssrLoadModule('/src/matches-data.ts')

  test('providerEventId is matched exactly', () => {
    const result = resolver.resolveStreamMatch(match({ sourceProvider: 'football-data', providerEventId: '123' }), {
      id: 'configured', provider: 'manual', name: 'configured', type: 'embed', sourceProvider: 'football-data', providerEventId: '123', enabled: true, priority: 1,
    })
    assert.equal(result.status, 'matched')
    assert.equal(result.strategy, 'provider-event-id')
  })

  test('externalIds are matched by namespace and ID', () => {
    const result = resolver.resolveStreamMatch(match({ externalIds: { 'football-data': '123' } }), {
      id: 'configured', provider: 'manual', name: 'configured', type: 'embed', externalIds: { 'football-data': '123' }, enabled: true, priority: 1,
    })
    assert.equal(result.status, 'matched')
    assert.equal(result.strategy, 'external-id')
  })

  test('team IDs and strict time window are required', () => {
    const result = resolver.resolveStreamMatch(match(), {
      id: 'configured', provider: 'manual', name: 'configured', type: 'embed', sport: 'football', league: 'Premier League', homeTeamId: 'home-1', awayTeamId: 'away-2', startTime: '2026-09-20T12:34:00.000Z', enabled: true, priority: 1,
    })
    assert.equal(result.status, 'matched')
    assert.equal(result.strategy, 'team-ids-time')
  })

  test('complete team names can match only within the strict time window', () => {
    const result = resolver.resolveStreamMatch(match(), {
      id: 'configured', provider: 'manual', name: 'configured', type: 'embed', sport: 'football', league: 'Premier League', homeTeamName: 'Home FC', awayTeamName: 'Away FC', startTime: '2026-09-20T12:34:00.000Z', enabled: true, priority: 1,
    })
    assert.equal(result.status, 'matched')
    assert.equal(result.strategy, 'team-names-time')
  })

  test('reversed teams, one team, and out-of-window times are rejected', () => {
    const base = { id: 'configured', provider: 'manual', name: 'configured', type: 'embed', sport: 'football', league: 'Premier League', enabled: true, priority: 1 }
    assert.equal(resolver.resolveStreamMatch(match(), { ...base, homeTeamId: 'away-2', awayTeamId: 'home-1', startTime: match().startTime }).status, 'unmatched')
    assert.equal(resolver.resolveStreamMatch(match(), { ...base, homeTeamId: 'home-1', startTime: match().startTime }).status, 'unmatched')
    assert.equal(resolver.resolveStreamMatch(match(), { ...base, homeTeamId: 'home-1', awayTeamId: 'away-2', startTime: '2026-09-20T12:36:00.001Z' }).status, 'unmatched')
  })

  test('ambiguous identity never chooses a match', () => {
    const result = resolver.resolveStreamMatches([
      match({ id: 'first' }),
      match({ id: 'second' }),
    ], { id: 'configured', provider: 'manual', name: 'configured', type: 'embed', sport: 'football', league: 'Premier League', homeTeamId: 'home-1', awayTeamId: 'away-2', startTime: match().startTime, enabled: true, priority: 1 })
    assert.equal(result.status, 'ambiguous')
    assert.equal(result.match, null)
  })

  test('one Provider failure does not block another Provider', async () => {
    const result = await queryModule.createStreamQueryService({
      maxRetries: 0,
      providers: [
        { provider: 'official', query: async () => { throw new Error('mock failure') } },
        { provider: 'youtube', query: async () => [stream()] },
      ],
    }).query(match())
    assert.equal(result.status, 'partial-failure')
    assert.equal(result.providerResults.find((item) => item.provider === 'official')?.status, 'failure')
    assert.equal(result.providerResults.find((item) => item.provider === 'youtube')?.status, 'success-with-candidates')
    assert.equal(result.data.length, 1)
  })

  test('success-empty and failure remain distinct', async () => {
    const result = await queryModule.createStreamQueryService({
      maxRetries: 0,
      providers: [
        { provider: 'official', query: async () => [] },
        { provider: 'manual', query: async () => { throw new Error('mock failure') } },
      ],
    }).query(match())
    assert.equal(result.providerResults[0].status, 'success-empty')
    assert.equal(result.providerResults[1].status, 'failure')
    assert.equal(result.status, 'partial-failure')
  })

  test('primary and fallback are ranked and fallbackEnabled is respected', async () => {
    const result = await queryModule.createStreamQueryService({ providers: [
      { provider: 'official', query: async () => [stream({ id: 'primary', priority: 100, url: 'https://www.youtube.com/embed/bbbbbbbbbbb' })] },
      { provider: 'youtube', query: async () => [stream({ id: 'fallback', priority: 90, url: 'https://www.youtube.com/embed/ccccccccccc' })] },
    ] }).query(match())
    const primary = result.data.find((item) => item.id === 'primary')
    const fallback = result.data.find((item) => item.id === 'fallback')
    assert.equal(primary?.role, 'primary')
    assert.equal(fallback?.role, 'fallback')
    assert.equal(streamService.getNextSource(result.data, new Set(['primary']))?.id, 'fallback')
    assert.equal(streamService.getNextSource(result.data.map((item) => item.id === 'primary' ? { ...item, fallbackEnabled: false } : item), new Set(['primary'])), undefined)
  })

  test('authorized, unverified, and Demo candidates are not treated as equally playable', async () => {
    const result = await queryModule.createStreamQueryService({ providers: [{ provider: 'official', query: async () => [
      stream({ id: 'authorized', priority: 80 }),
      stream({ id: 'unverified', priority: 110, legalStatus: 'unverified', url: 'https://www.youtube.com/embed/ddddddddddd' }),
      stream({ id: 'demo', priority: 100, legalStatus: 'demo', url: '' }),
    ] }] }).query(match())
    assert.equal(result.data.length, 3)
    assert.deepEqual(streamService.getPlayableSources(result.data).map((item) => item.id), ['authorized'])
  })

  test('duplicate candidates are removed by URL', async () => {
    const result = await queryModule.createStreamQueryService({ providers: [
      { provider: 'official', query: async () => [stream({ id: 'one' })] },
      { provider: 'youtube', query: async () => [stream({ id: 'two' })] },
    ] }).query(match())
    assert.equal(result.data.length, 1)
  })

  test('cache, stale-while-revalidate, and in-flight dedup work offline', async () => {
    let now = 1_000
    let calls = 0
    const service = queryModule.createStreamQueryService({
      now: () => now,
      ttlMs: 100,
      staleWhileRevalidateMs: 500,
      providers: [{ provider: 'youtube', query: async () => { calls += 1; await wait(10); return [stream()] } }],
    })
    const [first, second] = await Promise.all([service.query(match()), service.query(match())])
    assert.equal(first.data.length, 1)
    assert.equal(second.data.length, 1)
    assert.equal(calls, 1)
    now += 150
    const stale = await service.query(match())
    assert.equal(stale.status, 'stale')
    assert.equal(stale.stale, true)
    await wait(20)
    assert.equal(calls, 2)
  })

  test('retry succeeds after a transient Provider failure', async () => {
    let calls = 0
    const result = await queryModule.createStreamQueryService({ maxRetries: 1, providers: [{ provider: 'youtube', query: async () => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return [stream()]
    } }] }).query(match())
    assert.equal(calls, 2)
    assert.equal(result.status, 'success')
  })

  test('timeout is reported and repeated failures open the circuit', async () => {
    let now = 10_000
    const service = queryModule.createStreamQueryService({ now: () => now, maxRetries: 0, timeoutMs: 5, providers: [{ provider: 'youtube', query: async () => wait(30).then(() => [stream()]) }] })
    const first = await service.query(match(), { forceRefresh: true })
    assert.equal(first.status, 'failure')
    assert.equal(first.providerResults[0].status, 'timeout')
    assert.equal((await service.query(match(), { forceRefresh: true })).status, 'failure')
    assert.equal((await service.query(match(), { forceRefresh: true })).status, 'failure')
    assert.equal((await service.query(match(), { forceRefresh: true })).providerResults[0].status, 'circuit-open')
  })

  test('YouTube test match still resolves to the verified video', () => {
    const testMatch = matchesData.matches.find((item) => item.id === 'youtube-savannah-bananas-test')
    assert.ok(testMatch)
    const sources = youtube.getYouTubeStreams(testMatch)
    assert.equal(sources.length, 1)
    assert.equal(sources[0].url, 'https://www.youtube.com/embed/T4bVbVd03mM')
    assert.equal(sources[0].legalStatus, 'authorized')
  })

  test('a real API Match with no configured source does not receive a fabricated Stream', async () => {
    const result = await queryModule.createStreamQueryService({ providers: [
      { provider: 'official', query: async () => [] },
      { provider: 'youtube', query: async () => [] },
      { provider: 'external-api', query: async () => [] },
      { provider: 'manual', query: async () => [] },
    ] }).query(match({ id: 'api-football-999', sourceProvider: 'api-football', providerEventId: '999' }))
    assert.equal(result.data.length, 0)
    assert.equal(result.status, 'success-empty')
  })

  let failures = 0
  for (const { name, run } of tests) {
    try {
      await run()
      console.log(`ok - ${name}`)
    } catch (error) {
      failures += 1
      console.error(`not ok - ${name}`)
      console.error(error)
    }
  }
  if (failures > 0) throw new Error(`${failures} Stage 4 verification test(s) failed`)
  console.log(`\n${tests.length} Stage 4 offline checks passed.`)
} finally {
  await vite.close()
}

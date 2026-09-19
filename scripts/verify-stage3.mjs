import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const projectRoot = process.cwd()
const fixedNow = new Date('2026-09-19T00:00:00.000Z')
const fetchedAt = '2026-09-19T00:00:00.000Z'
const expiresAt = '2099-09-19T00:05:00.000Z'

const fixture = (overrides = {}) => ({
  fixture: {
    id: 123456,
    date: '2026-09-20T12:30:00+08:00',
    timezone: 'Asia/Shanghai',
    status: { short: 'NS' },
    venue: { name: 'Verification Stadium' },
  },
  league: { id: 39, name: 'Premier League', round: 'Regular Season - 1', season: 2026 },
  teams: {
    home: { id: 101, name: 'Home FC' },
    away: { id: 202, name: 'Away FC' },
  },
  goals: { home: null, away: null },
  ...overrides,
})

const envelope = (matches) => ({
  provider: 'api-football',
  fetchedAt,
  sourceUpdatedAt: null,
  expiresAt,
  matches,
})

const footballDataMatch = (overrides = {}) => ({
  id: 987654,
  utcDate: '2026-09-20T04:30:00.000Z',
  status: 'SCHEDULED',
  competition: { name: 'Premier League' },
  matchday: 5,
  homeTeam: { id: 61, name: 'Home FC' },
  awayTeam: { id: 62, name: 'Away FC' },
  venue: 'Football Data Stadium',
  score: { fullTime: { home: null, away: null } },
  ...overrides,
})

const footballDataEnvelope = (matches) => ({
  provider: 'football-data',
  fetchedAt,
  sourceUpdatedAt: null,
  expiresAt,
  matches,
})

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
})

const tests = []
const test = (name, run) => tests.push({ name, run })

const readTextFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await readTextFiles(absolute))
    else if (/\.(?:css|html|js|json|txt)$/.test(entry.name) || entry.name === '_headers') files.push(absolute)
  }
  return files
}

const vite = await createServer({
  root: projectRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
})

const originalFetch = globalThis.fetch

try {
  const functionModule = await vite.ssrLoadModule('/functions/api/matches.ts')
  const schemaModule = await vite.ssrLoadModule('/src/match-providers/api-football-schema.ts')
  const providerModule = await vite.ssrLoadModule('/src/match-providers/api-football-provider.ts')
  const footballDataSchema = await vite.ssrLoadModule('/src/match-providers/football-data-schema.ts')
  const footballDataProvider = await vite.ssrLoadModule('/src/match-providers/football-data-provider.ts')
  const identityModule = await vite.ssrLoadModule('/src/services/match-identity.ts')
  const matchService = await vite.ssrLoadModule('/src/services/match-service.ts')
  const youtubeModule = await vite.ssrLoadModule('/src/stream-providers/youtube-provider.ts')

  test('Function validates and defaults date ranges', () => {
    const defaultRange = functionModule.parseMatchDateRange(new URLSearchParams(), fixedNow)
    assert.deepEqual(defaultRange, { ok: true, value: { from: '2026-09-19', to: '2026-09-26' } })
    assert.equal(functionModule.parseMatchDateRange(new URLSearchParams('from=2026-02-30&to=2026-03-01'), fixedNow).ok, false)
    assert.equal(functionModule.parseMatchDateRange(new URLSearchParams('from=2026-09-20&to=2026-09-19'), fixedNow).ok, false)
    assert.equal(functionModule.parseMatchDateRange(new URLSearchParams('from=2026-09-01&to=2026-09-16'), fixedNow).ok, false)
    assert.equal(functionModule.parseMatchDateRange(new URLSearchParams('from=2026-09-01&to=2026-09-15'), fixedNow).ok, true)
    assert.equal(functionModule.parseMatchDateRange(new URLSearchParams('from=2026-09-01&host=example.com'), fixedNow).ok, false)
  })

  test('Function minimizes valid fixtures and isolates invalid records', () => {
    const valid = fixture()
    const invalid = fixture({ fixture: { ...valid.fixture, id: 0 } })
    const mixed = functionModule.minimizeApiFootballResponse({ errors: [], response: [valid, invalid] })
    assert.equal(mixed.ok, true)
    assert.equal(mixed.matches.length, 1)
    assert.equal(functionModule.minimizeApiFootballResponse({ errors: [], response: [invalid] }).ok, false)
    assert.equal(functionModule.minimizeApiFootballResponse({ errors: { quota: 'limited' }, response: [] }).ok, false)
  })

  test('Function uses only the fixed upstream and server-side auth header', async () => {
    const fakeSecret = 'test-only-not-a-real-key'
    let requestUrl = ''
    let requestInit
    const response = await functionModule.handleMatchesRequest({
      request: new Request('https://fieldwatch.example/api/matches?provider=api-football&from=2026-09-19&to=2026-09-20'),
      env: {
        API_FOOTBALL_KEY: fakeSecret,
        API_FOOTBALL_LEAGUE_ID: '39',
        API_FOOTBALL_SEASON: '2026',
      },
    }, {
      now: () => fixedNow,
      cache: null,
      fetch: async (url, init) => {
        requestUrl = String(url)
        requestInit = init
        return jsonResponse({ errors: [], response: [fixture()] })
      },
    })

    assert.equal(response.status, 200)
    const upstream = new URL(requestUrl)
    assert.equal(`${upstream.origin}${upstream.pathname}`, 'https://v3.football.api-sports.io/fixtures')
    assert.deepEqual([...upstream.searchParams.keys()].sort(), ['from', 'league', 'season', 'timezone', 'to'])
    assert.equal(new Headers(requestInit.headers).get('x-apisports-key'), fakeSecret)
    assert.equal(requestInit.redirect, 'manual')
    const publicBody = await response.text()
    assert.equal(publicBody.includes(fakeSecret), false)
    assert.equal(publicBody.includes('x-apisports-key'), false)
  })

  test('Function blocks upstream redirects without forwarding upstream data', async () => {
    let calls = 0
    let requestInit
    const redirectLocation = 'https://redirect.example/private?marker=location'
    const upstreamBody = 'upstream-response-body-marker'
    const upstreamHeader = 'upstream-header-marker'
    const response = await functionModule.handleMatchesRequest({
      request: new Request('https://fieldwatch.example/api/matches?provider=api-football&from=2026-09-19&to=2026-09-20'),
      env: { API_FOOTBALL_KEY: 'test-only-not-a-real-key' },
    }, {
      now: () => fixedNow,
      cache: null,
      fetch: async (_url, init) => {
        calls += 1
        requestInit = init
        return new Response(upstreamBody, {
          status: 302,
          headers: {
            Location: redirectLocation,
            'X-Upstream-Only': upstreamHeader,
          },
        })
      },
    })

    assert.equal(requestInit.redirect, 'manual')
    assert.equal(calls, 1)
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('Location'), null)
    assert.equal(response.headers.get('X-Upstream-Only'), null)
    const publicBody = await response.text()
    assert.equal(publicBody.includes(redirectLocation), false)
    assert.equal(publicBody.includes(upstreamBody), false)
    assert.equal(publicBody.includes(upstreamHeader), false)
  })

  test('Function proxies football-data through the fixed origin and auth header', async () => {
    const fakeToken = 'test-only-not-a-real-token'
    let requestUrl = ''
    let requestInit
    const response = await functionModule.handleMatchesRequest({
      request: new Request('https://fieldwatch.example/api/matches?from=2026-09-19&to=2026-09-20'),
      env: { FOOTBALL_DATA_TOKEN: fakeToken },
    }, {
      now: () => fixedNow,
      cache: null,
      fetch: async (url, init) => {
        requestUrl = String(url)
        requestInit = init
        return jsonResponse({ matches: [footballDataMatch()] })
      },
    })

    assert.equal(response.status, 200)
    const upstream = new URL(requestUrl)
    assert.equal(`${upstream.origin}${upstream.pathname}`, 'https://api.football-data.org/v4/competitions/PL/matches')
    assert.deepEqual([...upstream.searchParams.keys()].sort(), ['dateFrom', 'dateTo'])
    assert.equal(new Headers(requestInit.headers).get('X-Auth-Token'), fakeToken)
    assert.equal(requestInit.redirect, 'manual')
    const publicBody = await response.text()
    assert.equal(publicBody.includes(fakeToken), false)
    assert.equal(publicBody.includes('X-Auth-Token'), false)
  })

  test('Function minimizes football-data records and isolates malformed entries', () => {
    const valid = footballDataMatch()
    const invalid = footballDataMatch({ id: 0 })
    const mixed = functionModule.minimizeFootballDataResponse({ matches: [valid, invalid] })
    assert.equal(mixed.ok, true)
    assert.equal(mixed.matches.length, 1)
    assert.equal(functionModule.minimizeFootballDataResponse({ matches: [invalid] }).ok, false)
    assert.equal(functionModule.minimizeFootballDataResponse({ matches: [] }).ok, true)
  })

  test('Function rejects arbitrary query passthrough before upstream access', async () => {
    let calls = 0
    const response = await functionModule.handleMatchesRequest({
      request: new Request('https://fieldwatch.example/api/matches?from=2026-09-19&url=https://example.com'),
      env: { API_FOOTBALL_KEY: 'test-only-not-a-real-key' },
    }, {
      now: () => fixedNow,
      cache: null,
      fetch: async () => { calls += 1; return jsonResponse({ errors: [], response: [] }) },
    })
    assert.equal(response.status, 400)
    assert.equal(calls, 0)
  })

  test('Provider maps every supported API-Football status', () => {
    const expected = {
      NS: 'upcoming', TBD: 'upcoming',
      '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', P: 'live',
      FT: 'finished', AET: 'finished', PEN: 'finished',
      PST: 'suspended',
      CANC: 'cancelled', ABD: 'cancelled', AWD: 'cancelled', WO: 'cancelled',
    }
    for (const [status, mapped] of Object.entries(expected)) {
      assert.equal(schemaModule.mapApiFootballStatus(status), mapped)
    }
  })

  test('Provider produces stable identity, UTC time, derived date and no streams', () => {
    const result = providerModule.apiFootballMatchProvider.normalize(envelope([fixture()]))
    assert.equal(result.error, null)
    assert.equal(result.matches.length, 1)
    const match = result.matches[0]
    assert.equal(match.id, 'api-football-123456')
    assert.equal(match.sourceProvider, 'api-football')
    assert.equal(match.providerEventId, '123456')
    assert.equal(match.externalIds['api-football'], '123456')
    assert.equal(match.homeTeam.id, 'api-football:team:101')
    assert.equal(match.awayTeam.id, 'api-football:team:202')
    assert.equal(match.startTime, '2026-09-20T04:30:00.000Z')
    assert.equal(match.date, match.startTime)
    assert.deepEqual(match.streamIds, [])
  })

  test('Provider rejects malformed roots and isolates malformed fixtures', () => {
    const valid = fixture()
    const unknownStatus = fixture({ fixture: { ...valid.fixture, status: { short: 'UNKNOWN' } } })
    const result = providerModule.apiFootballMatchProvider.normalize(envelope([valid, unknownStatus]))
    assert.equal(result.matches.length, 1)
    assert.match(result.error, /无效/)
    const invalidRoot = providerModule.apiFootballMatchProvider.normalize({ matches: [] })
    assert.equal(invalidRoot.matches.length, 0)
    assert.match(invalidRoot.error, /无效/)
  })

  test('football-data maps status, identity, UTC time and score', () => {
    const result = footballDataProvider.footballDataMatchProvider.normalize(footballDataEnvelope([
      footballDataMatch({ status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } }),
    ]))
    assert.equal(result.error, null)
    assert.equal(result.matches.length, 1)
    const match = result.matches[0]
    assert.equal(match.id, 'football-data-987654')
    assert.equal(match.sourceProvider, 'football-data')
    assert.equal(match.providerEventId, '987654')
    assert.equal(match.externalIds['football-data'], '987654')
    assert.equal(match.startTime, '2026-09-20T04:30:00.000Z')
    assert.equal(match.date, match.startTime)
    assert.equal(match.status, 'finished')
    assert.deepEqual(match.score, [2, 1])
    assert.equal(match.homeTeam.id, 'football-data:team:61')
  })

  test('football-data schema maps every supported status', () => {
    const expected = {
      SCHEDULED: 'upcoming', TIMED: 'upcoming', IN_PLAY: 'live', PAUSED: 'live',
      FINISHED: 'finished', POSTPONED: 'postponed', SUSPENDED: 'suspended',
      CANCELLED: 'cancelled', AWARDED: 'finished',
    }
    for (const [status, mapped] of Object.entries(expected)) {
      assert.equal(footballDataSchema.mapFootballDataStatus(status), mapped)
    }
  })

  test('Browser provider requests only the same-origin Function path', async () => {
    let requested = ''
    let init
    globalThis.fetch = async (input, options) => {
      requested = String(input)
      init = options
      return jsonResponse(envelope([]))
    }
    await providerModule.apiFootballMatchProvider.fetch({
      from: '2026-09-19T00:00:00.000Z',
      to: '2026-09-20T23:59:59.000Z',
    })
    assert.equal(requested, '/api/matches?provider=api-football&from=2026-09-19&to=2026-09-20')
    assert.deepEqual([...new Headers(init.headers).keys()], ['accept'])
  })

  test('football-data failure falls back to API-Football', async () => {
    let calls = 0
    globalThis.fetch = async (input) => {
      calls += 1
      if (String(input).includes('provider=football-data')) return new Response(null, { status: 503 })
      return jsonResponse(envelope([fixture()]))
    }
    const snapshot = await matchService.getMatchSnapshot({
      sport: 'football',
      from: '2026-09-19T00:00:00.000Z',
      to: '2026-09-21T23:59:59.000Z',
      forceRefresh: true,
    })
    assert.equal(calls, 4)
    assert.equal(snapshot.data.some((match) => match.id === 'api-football-123456'), true)
    assert.equal(snapshot.data.some((match) => match.sourceProvider === 'demo'), false)
  })

  test('API failure without cache falls back to all Demo sports', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return new Response(null, { status: 502 })
    }
    const snapshot = await matchService.getMatchSnapshot({ forceRefresh: true })
    assert.equal(snapshot.metadata.fallback, true)
    assert.equal(snapshot.metadata.stale, true)
    assert.equal(snapshot.data.some((match) => match.sport === 'football'), true)
    assert.equal(snapshot.data.some((match) => match.id === 'youtube-savannah-bananas-test'), true)
    assert.equal(calls, 6)
  })

  test('Successful API data retains non-football Demo matches', async () => {
    globalThis.fetch = async () => jsonResponse(envelope([fixture()]))
    const snapshot = await matchService.getMatchSnapshot({ forceRefresh: true })
    assert.equal(snapshot.metadata.fallback, false)
    assert.equal(snapshot.data.some((match) => match.id === 'api-football-123456'), true)
    assert.equal(snapshot.data.some((match) => match.sport === 'basketball'), true)
    assert.equal(snapshot.data.some((match) => match.id === 'youtube-savannah-bananas-test'), true)
    assert.equal(snapshot.data.some((match) => match.sport === 'football' && match.sourceProvider !== 'api-football'), false)
  })

  test('Refresh failure preserves the previous real snapshot', async () => {
    globalThis.fetch = async () => new Response(null, { status: 502 })
    const snapshot = await matchService.getMatchSnapshot({ forceRefresh: true })
    assert.equal(snapshot.data.some((match) => match.id === 'api-football-123456'), true)
    assert.equal(snapshot.metadata.stale, true)
    assert.match(snapshot.metadata.error, /暂时不可用/)
  })

  test('Successful empty API response does not invent Demo football', async () => {
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return jsonResponse(envelope([])) }
    const snapshot = await matchService.getMatchSnapshot({ forceRefresh: true })
    assert.equal(snapshot.metadata.fallback, false)
    assert.equal(snapshot.data.some((match) => match.sport === 'football'), false)
    assert.equal(snapshot.data.some((match) => match.sport !== 'football'), true)
    assert.equal(snapshot.data.some((match) => match.id === 'youtube-savannah-bananas-test'), true)
    const cached = await matchService.getMatchSnapshot()
    assert.equal(cached.data.some((match) => match.sport === 'football'), false)
    assert.equal(calls, 1)
  })

  test('football-data success with an empty result does not call API-Football or invent Demo football', async () => {
    let calls = 0
    globalThis.fetch = async (input) => {
      calls += 1
      assert.equal(String(input).includes('provider=football-data'), true)
      return jsonResponse(footballDataEnvelope([]))
    }
    const snapshot = await matchService.getMatchSnapshot({
      sport: 'football',
      from: '2031-09-19T00:00:00.000Z',
      to: '2031-09-20T23:59:59.000Z',
      forceRefresh: true,
    })
    assert.equal(calls, 1)
    assert.equal(snapshot.data.some((match) => match.sport === 'football'), false)
  })

  test('same football event from both providers is deduplicated by exact names and UTC start', () => {
    const apiMatch = providerModule.apiFootballMatchProvider.normalize(envelope([fixture()])).matches[0]
    const dataMatch = footballDataProvider.footballDataMatchProvider.normalize(footballDataEnvelope([footballDataMatch()])).matches[0]
    assert.equal(identityModule.dedupeMatches([apiMatch, dataMatch]).length, 1)
  })

  test('Identical concurrent queries share one in-flight Provider request', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      return jsonResponse(envelope([fixture()]))
    }
    const query = {
      sport: 'football',
      from: '2026-09-20T00:00:00.000Z',
      to: '2026-09-21T00:00:00.000Z',
      forceRefresh: true,
    }
    const [first, second] = await Promise.all([
      matchService.getMatchSnapshot(query),
      matchService.getMatchSnapshot(query),
    ])
    assert.equal(calls, 1)
    assert.equal(first.data[0].id, 'api-football-123456')
    assert.equal(second.data[0].id, 'api-football-123456')
  })

  test('Savannah YouTube source remains configured and valid', () => {
    const source = youtubeModule.youtubeStreamConfigs.find((item) => item.matchId === 'youtube-savannah-bananas-test')
    assert.equal(source?.videoId, 'T4bVbVd03mM')
    assert.equal(source?.enabled, true)
    assert.equal(source?.legalStatus, 'authorized')
    assert.equal(youtubeModule.createYouTubeEmbedUrl(source.videoId), 'https://www.youtube.com/embed/T4bVbVd03mM')
  })

  test('Production frontend bundle contains no server credential boundary markers', async () => {
    const files = await readTextFiles(path.join(projectRoot, 'dist'))
    const bundle = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
    assert.equal(bundle.includes('API_FOOTBALL_KEY'), false)
    assert.equal(bundle.includes('x-apisports-key'), false)
    assert.equal(bundle.includes('v3.football.api-sports.io'), false)
    assert.equal(bundle.includes('FOOTBALL_DATA_TOKEN'), false)
    assert.equal(bundle.includes('X-Auth-Token'), false)
    assert.equal(bundle.includes('api.football-data.org'), false)
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

  if (failures > 0) throw new Error(`${failures} Stage 3 verification test(s) failed`)
  console.log(`\n${tests.length} Stage 3 offline checks passed.`)
} finally {
  globalThis.fetch = originalFetch
  await vite.close()
}

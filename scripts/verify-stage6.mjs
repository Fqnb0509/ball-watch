import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const projectRoot = process.cwd()
const tests = []
const test = (name, run) => tests.push({ name, run })
const originalAbortController = globalThis.AbortController
const originalFetch = globalThis.fetch
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalDateTimeFormat = Intl.DateTimeFormat

const footballDataEnvelope = {
  provider: 'football-data',
  fetchedAt: '2026-09-19T00:00:00.000Z',
  sourceUpdatedAt: null,
  expiresAt: '2099-09-19T00:05:00.000Z',
  matches: [{
    id: 7001,
    utcDate: '2026-09-20T12:30:00.000Z',
    status: 'SCHEDULED',
    competition: { name: 'Premier League' },
    matchday: 5,
    homeTeam: { id: 61, name: 'Home FC' },
    awayTeam: { id: 62, name: 'Away FC' },
    venue: 'Verification Stadium',
    score: { fullTime: { home: null, away: null } },
  }],
}

const vite = await createServer({
  root: projectRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  resolve: { preserveSymlinks: true },
  server: { middlewareMode: true, hmr: false },
})

try {
  const compat = await vite.ssrLoadModule('/src/services/runtime-compat.ts')
  const matchesSource = await readFile('src/hooks/use-matches.ts', 'utf8')
  const streamsSource = await readFile('src/hooks/use-streams.ts', 'utf8')

  test('AbortController support uses native cancellation when available', () => {
    assert.equal(compat.supportsAbortController(), typeof originalAbortController === 'function')
    const controller = compat.createSafeAbortController()
    let aborted = false
    controller.signal.addEventListener('abort', () => { aborted = true }, { once: true })
    controller.abort(new Error('offline test'))
    assert.equal(controller.signal.aborted, true)
    assert.equal(aborted, true)
  })

  test('Missing AbortController has a safe fallback and does not pass a synthetic signal to fetch', () => {
    globalThis.AbortController = undefined
    assert.equal(compat.supportsAbortController(), false)
    const controller = compat.createSafeAbortController()
    let aborted = false
    controller.signal.addEventListener('abort', () => { aborted = true })
    assert.equal(compat.signalForFetch(controller.signal), undefined)
    controller.abort()
    assert.equal(controller.signal.aborted, true)
    assert.equal(aborted, true)
    globalThis.AbortController = originalAbortController
  })

  test('Asia/Shanghai formatting works in the normal runtime', () => {
    const formatter = compat.createSafeDateTimeFormatter('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    assert.equal(formatter.format(new Date('2026-09-19T16:30:00.000Z')), '00:30')
  })

  test('Unsupported Asia/Shanghai falls back without throwing during module initialization', async () => {
    const NativeDateTimeFormat = originalDateTimeFormat
    Intl.DateTimeFormat = function DateTimeFormat(locale, options) {
      if (options?.timeZone === 'Asia/Shanghai') throw new RangeError('Unsupported timezone')
      return new NativeDateTimeFormat(locale, options)
    }
    const formatter = compat.createSafeDateTimeFormatter('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    assert.doesNotThrow(() => formatter.formatToParts(new Date('2026-09-19T16:30:00.000Z')))
    const matchesData = await vite.ssrLoadModule('/src/matches-data.ts?stage6-intl-fallback')
    assert.ok(matchesData.matches.length > 0)
    Intl.DateTimeFormat = NativeDateTimeFormat
  })

  test('Missing formatToParts uses the UTC fallback without blocking module initialization', async () => {
    const NativeDateTimeFormat = originalDateTimeFormat
    Intl.DateTimeFormat = function DateTimeFormat(locale, options) {
      const formatter = new NativeDateTimeFormat(locale, options)
      return { format: formatter.format.bind(formatter) }
    }
    const formatter = compat.createSafeDateTimeFormatter('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    assert.equal(formatter.format(new Date('2026-09-19T16:30:00.000Z')), '2026-09-19')
    assert.deepEqual(formatter.formatToParts(new Date('2026-09-19T16:30:00.000Z')).map((part) => part.type), ['year', 'month', 'day'])
    const matchesData = await vite.ssrLoadModule('/src/matches-data.ts?stage6-missing-format-to-parts')
    assert.ok(matchesData.matches.length > 0)
    Intl.DateTimeFormat = NativeDateTimeFormat
  })

  test('Production bundle targets old Safari syntax compatibility', async () => {
    const assetNames = (await readdir('dist/assets')).filter((name) => name.endsWith('.js'))
    assert.ok(assetNames.length > 0, 'production JavaScript asset is missing; run pnpm run build first')
    const source = (await Promise.all(assetNames.map((name) => readFile(`dist/assets/${name}`, 'utf8')))).join('\n')
    assert.equal((source.match(/\?\./g) ?? []).length, 0)
    assert.equal((source.match(/\?\?/g) ?? []).length, 0)
  })

  test('Offline match request succeeds without AbortController and resolves loading data', async () => {
    globalThis.AbortController = undefined
    let fetchCalls = 0
    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1
      assert.equal(init?.signal, undefined)
      return new Response(JSON.stringify(footballDataEnvelope), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const matchService = await vite.ssrLoadModule('/src/services/match-service.ts?stage6-no-abort')
    const snapshot = await matchService.getMatchSnapshot({ sport: 'football', from: '2026-09-20', to: '2026-09-26', forceRefresh: true })
    assert.equal(snapshot.data.length, 1)
    assert.equal(snapshot.metadata.error, null)
    assert.equal(fetchCalls, 1)
    globalThis.AbortController = originalAbortController
    globalThis.fetch = originalFetch
  })

  test('Concurrent StrictMode-style executions share one offline request', async () => {
    globalThis.AbortController = undefined
    let fetchCalls = 0
    globalThis.fetch = async () => {
      fetchCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response(JSON.stringify(footballDataEnvelope), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const matchService = await vite.ssrLoadModule('/src/services/match-service.ts?stage6-dedup')
    await Promise.all([
      matchService.getMatchSnapshot({ sport: 'football', from: '2026-09-21', to: '2026-09-26', forceRefresh: true }),
      matchService.getMatchSnapshot({ sport: 'football', from: '2026-09-21', to: '2026-09-26', forceRefresh: true }),
    ])
    assert.equal(fetchCalls, 1)
    globalThis.AbortController = originalAbortController
    globalThis.fetch = originalFetch
  })

  test('Cleanup aborts do not publish errors, while active failures clear loading', () => {
    assert.match(matchesSource, /mountedRef\.current = false/)
    assert.match(matchesSource, /loading: false, refreshing: false/)
    assert.match(matchesSource, /loading: false, backgroundRefreshing: false/)
    assert.match(streamsSource, /mountedRef\.current = false/)
    assert.match(streamsSource, /status: 'failure'/)
    assert.match(streamsSource, /refreshing: false/)
  })

  test('Desktop and mobile user agents have no separate application branch', async () => {
    const files = await Promise.all(['src/main.tsx', 'src/FieldWatchApp.tsx', 'src/hooks/use-matches.ts', 'src/hooks/use-streams.ts'].map((file) => readFile(file, 'utf8')))
    assert.equal(files.some((source) => /userAgent|matchMedia|navigator\.userAgent/.test(source)), false)
  })

  test('Corrupt localStorage still returns an empty safe state', async () => {
    const storage = await vite.ssrLoadModule('/src/storage.ts?stage6-storage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '{broken', setItem: () => {}, removeItem: () => {} } })
    assert.deepEqual(storage.getFavorites(), { matches: [], teams: [], leagues: [] })
    assert.deepEqual(storage.getRecentWatches(), [])
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
    } finally {
      globalThis.AbortController = originalAbortController
      globalThis.fetch = originalFetch
      Intl.DateTimeFormat = originalDateTimeFormat
    }
  }
  if (failures) throw new Error(`${failures} Stage 6 checks failed`)
  console.log(`\n${tests.length} Stage 6 offline checks passed.`)
} finally {
  globalThis.AbortController = originalAbortController
  globalThis.fetch = originalFetch
  Intl.DateTimeFormat = originalDateTimeFormat
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else delete globalThis.localStorage
  await vite.close()
}

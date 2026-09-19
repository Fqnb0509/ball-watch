import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { build as viteBuild } from 'vite'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()
const read = (file) => readFile(path.join(root, file), 'utf8')

const runtimeConfig = await read('src/runtime-config.ts')
const apiFootballProvider = await read('src/match-providers/api-football-provider.ts')
const footballDataProvider = await read('src/match-providers/football-data-provider.ts')
const viteConfig = await read('vite.config.ts')
const functionSource = await read('functions/api/matches.ts')
const indexSource = await read('index.html')
const workflow = await read('.github/workflows/deploy-pages.yml')
const streamPolicy = await read('src/services/stream-url-policy.ts')
const storage = await read('src/storage.ts')

assert.match(runtimeConfig, /https:\/\/ball-watch\.pages\.dev/)
assert.match(runtimeConfig, /configuredOrigin === PUBLIC_MATCH_API_ORIGIN/)
assert.match(runtimeConfig, /\/api\/matches/)
assert.doesNotMatch(runtimeConfig, /API_FOOTBALL_KEY|FOOTBALL_DATA_TOKEN|authorization|x-apisports-key/i)
assert.match(apiFootballProvider, /buildMatchApiPath\(query\)/)
assert.match(footballDataProvider, /buildMatchApiPath\(parameters\.toString\(\)\)/)
assert.doesNotMatch(apiFootballProvider + footballDataProvider, /api\.football-data\.org|v3\.football|x-apisports-key/i)

assert.match(viteConfig, /VITE_BASE_PATH/)
assert.match(viteConfig, /base:\s*normalizeBasePath/)
assert.match(indexSource, /href="%BASE_URL%favicon\.svg"/)
assert.match(indexSource, /connect-src 'self' https:\/\/ball-watch\.pages\.dev/)
assert.doesNotMatch(indexSource, /connect-src[^;]*\*/)
assert.match(indexSource, /frame-src[^;]*https:\/\/www\.youtube\.com[^;]*https:\/\/www\.youtube-nocookie\.com/)

for (const origin of ['https://fqnb0509.github.io', 'https://ball-watch.pages.dev']) {
  assert.match(functionSource, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}
assert.match(functionSource, /Access-Control-Allow-Origin/)
assert.match(functionSource, /Access-Control-Allow-Methods.*GET, OPTIONS/)
assert.match(functionSource, /Access-Control-Allow-Headers.*Content-Type/)
assert.match(functionSource, /export const onRequestOptions/)
assert.match(functionSource, /Cross-Origin-Resource-Policy.*cross-origin/)
assert.doesNotMatch(functionSource, /Access-Control-Allow-Origin['"],\s*['"]\*['"]|same-origin/)

assert.match(workflow, /branches: \[main\]/)
assert.match(workflow, /actions\/checkout@v4/)
assert.match(workflow, /pnpm\/action-setup@v4/)
assert.match(workflow, /pnpm install --frozen-lockfile/)
assert.match(workflow, /VITE_BASE_PATH:\s*\/ball-watch\//)
assert.match(workflow, /VITE_MATCH_API_ORIGIN:\s*https:\/\/ball-watch\.pages\.dev/)
assert.match(workflow, /actions\/configure-pages@v5/)
assert.match(workflow, /actions\/upload-pages-artifact@v3/)
assert.match(workflow, /actions\/deploy-pages@v4/)
assert.match(workflow, /contents:\s*read/)
assert.match(workflow, /pages:\s*write/)
assert.match(workflow, /id-token:\s*write/)
assert.match(workflow, /name:\s*github-pages/)
assert.doesNotMatch(workflow, /API_FOOTBALL_KEY|FOOTBALL_DATA_TOKEN|VITE_\w*(KEY|TOKEN|SECRET)/i)

assert.match(streamPolicy, /www\.youtube\.com/)
assert.match(streamPolicy, /www\.youtube-nocookie\.com/)
assert.match(storage, /localStorage/)

const moduleServer = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
})
try {
  const matchesFunction = await moduleServer.ssrLoadModule('/functions/api/matches.ts')
  const allowedOrigin = 'https://fqnb0509.github.io'
  const allowedOptions = matchesFunction.onRequestOptions({
    request: new Request('https://ball-watch.pages.dev/api/matches', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'GET' },
    }),
    env: {},
  })
  assert.equal(allowedOptions.status, 204)
  assert.equal(allowedOptions.headers.get('Access-Control-Allow-Origin'), allowedOrigin)
  assert.equal(allowedOptions.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')
  assert.equal(allowedOptions.headers.get('Access-Control-Allow-Headers'), 'Content-Type')

  const blockedOptions = matchesFunction.onRequestOptions({
    request: new Request('https://ball-watch.pages.dev/api/matches', {
      method: 'OPTIONS',
      headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'GET' },
    }),
    env: {},
  })
  assert.equal(blockedOptions.status, 403)
  assert.equal(blockedOptions.headers.get('Access-Control-Allow-Origin'), null)

  const allowedGet = await matchesFunction.handleMatchesRequest(
    {
      request: new Request('https://ball-watch.pages.dev/api/matches?from=invalid', {
        headers: { Origin: allowedOrigin },
      }),
      env: {},
    },
    { fetch: async () => { throw new Error('offline test must not fetch') }, now: () => new Date('2026-09-20T00:00:00.000Z'), cache: null },
  )
  assert.equal(allowedGet.status, 400)
  assert.equal(allowedGet.headers.get('Access-Control-Allow-Origin'), allowedOrigin)
  assert.equal(allowedGet.headers.get('Vary'), 'Origin')

  const blockedGet = await matchesFunction.handleMatchesRequest({
    request: new Request('https://ball-watch.pages.dev/api/matches?from=invalid', {
      headers: { Origin: 'https://untrusted.example' },
    }),
    env: {},
  })
  assert.equal(blockedGet.status, 403)
} finally {
  await moduleServer.close()
}

await viteBuild({
  root,
  configFile: false,
  base: '/ball-watch/',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MATCH_API_ORIGIN': JSON.stringify('https://ball-watch.pages.dev'),
  },
  build: {
    target: 'safari12',
  },
})

const distIndex = await read('dist/index.html')
assert.match(distIndex, /href="\/ball-watch\/favicon\.svg"/)
const assetReferences = [...distIndex.matchAll(/(?:src|href)="(\/ball-watch\/assets\/[^"?#]+)"/g)].map((match) => match[1])
assert.ok(assetReferences.length > 0, 'dist/index.html has no /ball-watch/ asset references')
for (const asset of assetReferences) {
  const assetPath = path.join(root, 'dist', asset.replace(/^\/ball-watch\//, ''))
  await readFile(assetPath)
}

const distFiles = []
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await visit(file)
    else distFiles.push(file)
  }
}
await visit(path.join(root, 'dist'))
for (const file of distFiles) {
  const content = await readFile(file, 'utf8')
  assert.doesNotMatch(content, /API_FOOTBALL_KEY|FOOTBALL_DATA_TOKEN|x-apisports-key|X-Auth-Token/i)
}

console.log(`GitHub Pages migration checks passed (${assetReferences.length} base-path assets verified).`)

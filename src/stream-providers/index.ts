import type { Match, Stream } from '../types'
import { getExternalApiStreams } from './external-api-provider'
import { getManualStreams } from './manual-provider'
import { getOfficialStreams } from './official-provider'
import { getYouTubeStreams } from './youtube-provider'
import type { StreamProviderAdapter, StreamProviderQuery, StreamProviderQueryResult, StreamProviderResultStatus } from './types'

const providers: readonly StreamProviderAdapter[] = [
  { provider: 'official', getStreams: getOfficialStreams },
  { provider: 'youtube', getStreams: getYouTubeStreams },
  { provider: 'external-api', getStreams: getExternalApiStreams },
  { provider: 'manual', getStreams: getManualStreams },
]

export const getStreamProviders = (): readonly StreamProviderAdapter[] => providers

const successStatus = (streams: readonly Stream[]): StreamProviderResultStatus => streams.length
  ? 'success-with-candidates'
  : 'success-empty'

const attachMatchId = (streams: readonly Stream[], matchId: string): Stream[] => streams.map((stream) => ({ ...stream, matchId }))
const isStreamList = (value: StreamProviderQueryResult | readonly Stream[]): value is readonly Stream[] => Array.isArray(value)

const asProviderResult = (provider: StreamProviderAdapter, value: StreamProviderQueryResult | readonly Stream[], matchId: string): StreamProviderQueryResult => {
  if (isStreamList(value)) {
    return { provider: provider.provider, status: successStatus(value), streams: attachMatchId(value, matchId), error: null }
  }
  return {
    provider: value.provider ?? provider.provider,
    status: value.status,
    streams: Array.isArray(value.streams) ? attachMatchId(value.streams, matchId) : [],
    error: typeof value.error === 'string' ? value.error : null,
  }
}

export const queryStreamProvider = async (
  provider: StreamProviderAdapter,
  request: StreamProviderQuery,
): Promise<StreamProviderQueryResult> => {
  const value = provider.query
    ? await provider.query(request)
    : provider.getStreams
      ? provider.getStreams(request.match)
      : []
  return asProviderResult(provider, value, request.match.id)
}

export type StreamProviderQueryOptions = {
  providers?: readonly StreamProviderAdapter[]
  signal?: AbortSignal
  queryProvider?: (provider: StreamProviderAdapter, request: StreamProviderQuery) => Promise<StreamProviderQueryResult>
}

/** Queries every configured Provider independently; one rejection becomes a provider failure. */
export const queryStreamProviders = async (
  match: Match,
  options: StreamProviderQueryOptions = {},
): Promise<StreamProviderQueryResult[]> => {
  const request: StreamProviderQuery = { match, signal: options.signal }
  const configured = options.providers ?? providers
  const settled = await Promise.allSettled(configured.map((provider) => options.queryProvider
    ? options.queryProvider(provider, request)
    : queryStreamProvider(provider, request)))
  return settled.map((item, index) => {
    const provider = configured[index]
    if (item.status === 'fulfilled') return asProviderResult(provider, item.value, match.id)
    return { provider: provider.provider, status: 'failure', streams: [], error: '直播源 Provider 查询失败' }
  })
}

/** Legacy synchronous access retained for existing configured sources and tests. */
export const getConfiguredStreamsForMatch = (match: Match): Stream[] => providers
  .flatMap((provider) => provider.getStreams ? provider.getStreams(match) : [])
  .map((stream) => ({ ...stream, matchId: match.id }))

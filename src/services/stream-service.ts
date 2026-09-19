import { streams as demoStreams } from '../stream-data'
import { getConfiguredStreamsForMatch } from '../stream-providers'
import { queryStreamsForMatch, type StreamQueryOptions, type StreamQueryResult } from './stream-query-service'
import { getStreamUrlError } from './stream-url-policy'
import { getMatches } from './match-service'
import type { Match, Stream } from '../types'

const cloneStream = (stream: Stream): Stream => ({ ...stream })
const mergeStreams = (items: Stream[]) => Array.from(new Map(items.map((stream) => [`${stream.matchId}:${stream.id}`, stream])).values())
const emptyQueryResult = (): StreamQueryResult => ({
  data: [],
  status: 'success-empty',
  providerResults: [],
  fetchedAt: new Date().toISOString(),
  stale: false,
  fallbackActive: false,
  error: null,
})

const resolveMatch = async (match: string | Match): Promise<Match | null> => {
  if (typeof match !== 'string') return match
  return (await getMatches()).find((item) => item.id === match) ?? null
}

export const getStreamQueryResultForMatch = async (
  match: string | Match,
  options?: StreamQueryOptions,
): Promise<StreamQueryResult> => {
  const resolved = await resolveMatch(match)
  return resolved ? queryStreamsForMatch(resolved, options) : emptyQueryResult()
}

export const getStreams = async (runtimeMatches?: readonly Match[]): Promise<Stream[]> => {
  const matches = runtimeMatches ?? await getMatches()
  const queried = await Promise.all(matches.map((match) => queryStreamsForMatch(match)))
  return mergeStreams([
    ...demoStreams,
    ...queried.flatMap((result) => result.data),
  ]).map(cloneStream)
}

export const getStreamsForMatch = async (match: string | Match): Promise<Stream[]> => {
  const result = await getStreamQueryResultForMatch(match)
  return result.data.map(cloneStream).sort((left, right) => right.priority - left.priority)
}

export const getEnabledStreamsForMatch = async (match: string | Match): Promise<Stream[]> => (await getStreamsForMatch(match)).filter((stream) => stream.enabled)

export const sortSourcesByPriority = (sources: Stream[]) => [...sources].filter((source) => source.enabled).sort((left, right) => right.priority - left.priority)

export const getPlayableSources = (sources: Stream[]) => sortSourcesByPriority(sources).filter((source) => source.access === 'player' && source.legalStatus === 'authorized' && !getStreamUrlError(source))

export const hasLegalSourceForMatch = (match: Match) => [...demoStreams.filter((stream) => stream.matchId === match.id), ...getConfiguredStreamsForMatch(match)].some((source) => !getStreamUrlError(source))

export const getNextSource = (sources: Stream[], failedIds: ReadonlySet<string>) => {
  const failed = sources.find((source) => failedIds.has(source.id))
  if (failed && !failed.fallbackEnabled) return undefined
  const playable = getPlayableSources(sources)
  const primary = playable.find((source) => source.role === 'primary') ?? playable[0]
  return playable
    .filter((source) => source.id !== primary?.id && (source.role === 'fallback' || source.role === undefined))
    .find((source) => !failedIds.has(source.id) && source.fallbackEnabled)
}

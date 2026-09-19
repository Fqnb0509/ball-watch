import { streams as demoStreams } from '../stream-data'
import { getConfiguredStreamsForMatch } from '../stream-providers'
import { getStreamUrlError } from './stream-url-policy'
import { getMatches } from './match-service'
import type { Match, Stream } from '../types'

const cloneStream = (stream: Stream): Stream => ({ ...stream })
const mergeStreams = (items: Stream[]) => Array.from(new Map(items.map((stream) => [`${stream.matchId}:${stream.id}`, stream])).values())

export const getStreams = async (runtimeMatches?: readonly Match[]): Promise<Stream[]> => {
  const matches = runtimeMatches ?? await getMatches()
  return mergeStreams([
    ...demoStreams,
    ...matches.flatMap((match) => getConfiguredStreamsForMatch(match)),
  ]).map(cloneStream)
}

export const getStreamsForMatch = async (match: string | Match): Promise<Stream[]> => {
  const matchId = typeof match === 'string' ? match : match.id
  const streams = typeof match === 'string' ? await getStreams() : await getStreams([match])
  return streams
    .filter((stream) => stream.matchId === matchId)
    .sort((left, right) => right.priority - left.priority)
}

export const getEnabledStreamsForMatch = async (match: string | Match): Promise<Stream[]> => (await getStreamsForMatch(match)).filter((stream) => stream.enabled)

export const sortSourcesByPriority = (sources: Stream[]) => [...sources].filter((source) => source.enabled).sort((left, right) => right.priority - left.priority)

export const getPlayableSources = (sources: Stream[]) => sortSourcesByPriority(sources).filter((source) => source.access === 'player' && source.legalStatus === 'authorized' && !getStreamUrlError(source))

export const hasLegalSourceForMatch = (match: Match) => [...demoStreams.filter((stream) => stream.matchId === match.id), ...getConfiguredStreamsForMatch(match)].some((source) => !getStreamUrlError(source))

export const getNextSource = (sources: Stream[], failedIds: ReadonlySet<string>) => getPlayableSources(sources)
  .find((source) => !failedIds.has(source.id) && source.fallbackEnabled)

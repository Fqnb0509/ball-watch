import { streams as demoStreams } from '../stream-data'
import { matches } from '../matches-data'
import { getConfiguredStreamsForMatch } from '../stream-providers'
import { getStreamUrlError } from './stream-url-policy'
import type { Match, Stream } from '../types'

const cloneStream = (stream: Stream): Stream => ({ ...stream })
const mergeStreams = (items: Stream[]) => Array.from(new Map(items.map((stream) => [`${stream.matchId}:${stream.id}`, stream])).values())

export const getStreams = async (): Promise<Stream[]> => mergeStreams([
  ...demoStreams,
  ...matches.flatMap((match) => getConfiguredStreamsForMatch(match)),
]).map(cloneStream)

export const getStreamsForMatch = async (matchId: string): Promise<Stream[]> => (await getStreams())
  .filter((stream) => stream.matchId === matchId)
  .sort((left, right) => right.priority - left.priority)

export const getEnabledStreamsForMatch = async (matchId: string): Promise<Stream[]> => (await getStreamsForMatch(matchId)).filter((stream) => stream.enabled)

export const sortSourcesByPriority = (sources: Stream[]) => [...sources].filter((source) => source.enabled).sort((left, right) => right.priority - left.priority)

export const getPlayableSources = (sources: Stream[]) => sortSourcesByPriority(sources).filter((source) => source.access === 'player' && source.legalStatus === 'authorized' && !getStreamUrlError(source))

export const hasLegalSourceForMatch = (match: Match) => getConfiguredStreamsForMatch(match).some((source) => !getStreamUrlError(source))

export const getNextSource = (sources: Stream[], failedIds: ReadonlySet<string>) => getPlayableSources(sources)
  .find((source) => !failedIds.has(source.id) && source.fallbackEnabled)

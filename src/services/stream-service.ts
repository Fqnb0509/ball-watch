import { streams as demoStreams } from '../stream-data'
import type { Stream } from '../types'

const cloneStream = (stream: Stream): Stream => ({ ...stream })

export const getStreams = async (): Promise<Stream[]> => demoStreams.map(cloneStream)

export const getStreamsForMatch = async (matchId: string): Promise<Stream[]> => (await getStreams())
  .filter((stream) => stream.matchId === matchId)
  .sort((left, right) => right.priority - left.priority)

export const getEnabledStreamsForMatch = async (matchId: string): Promise<Stream[]> => (await getStreamsForMatch(matchId)).filter((stream) => stream.enabled)

export const sortSourcesByPriority = (sources: Stream[]) => [...sources].filter((source) => source.enabled).sort((left, right) => right.priority - left.priority)

export const getNextSource = (sources: Stream[], failedIds: ReadonlySet<string>) => sortSourcesByPriority(sources).find((source) => !failedIds.has(source.id) && source.fallbackEnabled)

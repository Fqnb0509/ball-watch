import type { Match, Stream } from '../types'
import { getExternalApiStreams } from './external-api-provider'
import { getManualStreams } from './manual-provider'
import { getOfficialStreams } from './official-provider'
import { getYouTubeStreams } from './youtube-provider'
import type { StreamProviderAdapter } from './types'

const providers: readonly StreamProviderAdapter[] = [
  { provider: 'official', getStreams: getOfficialStreams },
  { provider: 'youtube', getStreams: getYouTubeStreams },
  { provider: 'external-api', getStreams: getExternalApiStreams },
  { provider: 'manual', getStreams: getManualStreams },
]

export const getConfiguredStreamsForMatch = (match: Match): Stream[] => providers
  .flatMap((provider) => provider.getStreams(match))
  .map((stream) => ({ ...stream, matchId: match.id }))

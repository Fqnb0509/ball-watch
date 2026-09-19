import type { Match, Stream } from '../types'
import { toAuthorizedStream, type AuthorizedStreamConfig } from './types'
import { matchesConfiguredEvent } from '../services/match-stream-resolver'

// Official pages are supported without extracting manifests or bypassing access controls.
export const officialPageConfigs: readonly AuthorizedStreamConfig[] = []

export const getOfficialStreams = (match: Match): Stream[] => officialPageConfigs
  .filter((config) => config.provider === 'official' && matchesConfiguredEvent(match, config))
  .map((config) => toAuthorizedStream(config))

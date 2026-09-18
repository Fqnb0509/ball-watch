import type { Match, Stream } from '../types'
import { matchesConfiguredEvent, toAuthorizedStream, type AuthorizedStreamConfig } from './types'

// Keep this list empty until every source has been manually checked and authorized.
export const manualStreamConfigs: readonly AuthorizedStreamConfig[] = []

export const getManualStreams = (match: Match): Stream[] => manualStreamConfigs
  .filter((config) => config.provider === 'manual' && matchesConfiguredEvent(match, config))
  .map((config) => toAuthorizedStream(config))

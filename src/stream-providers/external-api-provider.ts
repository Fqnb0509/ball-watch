import type { Match, Stream } from '../types'

/**
 * Reserved for a server-side provider. API keys and provider responses must not
 * be fetched directly from the browser or turned into unverified video URLs.
 */
export const getExternalApiStreams = (_match: Match): Stream[] => []

import type { Match, Sport } from '../types'

export type MatchProviderRequest = {
  sport?: Sport
  from?: string
  to?: string
  forceRefresh?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

export type ProviderMetadata = {
  id: string
  name: string
  sourceName: string
  supportedSports: readonly Sport[]
  fetchedAt?: string
  sourceUpdatedAt?: string | null
  expiresAt?: string | null
  stale?: boolean
  error?: string | null
  fallback?: boolean
}

export type MatchProviderResult = {
  provider: string
  matches: Match[]
  metadata: ProviderMetadata
  fetchedAt: string
  sourceUpdatedAt: string | null
  expiresAt: string | null
  stale: boolean
  error: string | null
  fallback: boolean
}

export type MatchProvider = {
  readonly id: string
  readonly supportedSports: readonly Sport[]
  readonly metadata: ProviderMetadata
  fetch: (request?: MatchProviderRequest) => Promise<unknown>
  normalize: (raw: unknown, request?: MatchProviderRequest) => MatchProviderResult
}

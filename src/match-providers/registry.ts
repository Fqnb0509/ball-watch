import type { Sport } from '../types'
import { apiFootballMatchProvider } from './api-football-provider'
import { demoMatchProvider } from './demo-provider'
import type { MatchProvider } from './types'

const providers = new Map<string, MatchProvider>()

export const registerMatchProvider = (provider: MatchProvider): boolean => {
  if (providers.has(provider.id)) return false
  providers.set(provider.id, provider)
  return true
}

export const getMatchProvider = (id: string): MatchProvider | undefined => providers.get(id)

export const getMatchProvidersForSport = (sport: Sport): MatchProvider[] => Array.from(providers.values())
  .filter((provider) => provider.supportedSports.includes(sport))

export const listMatchProviders = (): MatchProvider[] => Array.from(providers.values())

registerMatchProvider(apiFootballMatchProvider)
registerMatchProvider(demoMatchProvider)

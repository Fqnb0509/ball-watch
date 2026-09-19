import type { ApiSportsProviderDefinition } from './types'

export const apiFootballProvider: ApiSportsProviderDefinition = {
  id: 'api-football',
  sport: 'football',
  origin: 'https://v3.football.api-sports.io',
  path: '/fixtures',
  keyEnv: 'API_FOOTBALL_KEY',
  authHeader: 'x-apisports-key',
  enabled: true,
}

export const footballDataProvider: ApiSportsProviderDefinition = {
  id: 'football-data',
  sport: 'football',
  origin: 'https://api.football-data.org',
  path: '/v4/competitions/PL/matches',
  keyEnv: 'FOOTBALL_DATA_TOKEN',
  authHeader: 'X-Auth-Token',
  enabled: true,
}

export const apiBasketballProvider: ApiSportsProviderDefinition = {
  id: 'api-basketball',
  sport: 'basketball',
  origin: 'https://v1.basketball.api-sports.io',
  path: null,
  keyEnv: 'API_FOOTBALL_KEY',
  authHeader: 'x-apisports-key',
  enabled: false,
}

export const apiBaseballProvider: ApiSportsProviderDefinition = {
  id: 'api-baseball',
  sport: 'baseball',
  origin: 'https://v1.baseball.api-sports.io',
  path: null,
  keyEnv: 'API_FOOTBALL_KEY',
  authHeader: 'x-apisports-key',
  enabled: false,
}

export const apiTennisProvider: ApiSportsProviderDefinition = {
  id: 'api-tennis',
  sport: 'tennis',
  origin: 'https://v1.tennis.api-sports.io',
  path: null,
  keyEnv: 'API_FOOTBALL_KEY',
  authHeader: 'x-apisports-key',
  enabled: false,
}

export const apiSportsProviders: readonly ApiSportsProviderDefinition[] = [
  apiFootballProvider,
  apiBasketballProvider,
  apiBaseballProvider,
  apiTennisProvider,
]

export const getApiSportsProvider = (id: string): ApiSportsProviderDefinition | undefined => apiSportsProviders.find((provider) => provider.id === id)

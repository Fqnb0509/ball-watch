const PUBLIC_MATCH_API_ORIGIN = 'https://ball-watch.pages.dev'

const configuredOrigin = typeof import.meta.env.VITE_MATCH_API_ORIGIN === 'string'
  ? import.meta.env.VITE_MATCH_API_ORIGIN.trim().replace(/\/+$/, '')
  : ''

// Only the fixed public API origin is accepted; an invalid value keeps same-origin behavior.
export const MATCH_API_ORIGIN = configuredOrigin === PUBLIC_MATCH_API_ORIGIN ? configuredOrigin : ''

export const buildMatchApiPath = (query = ''): string => {
  const normalizedQuery = query.replace(/^\?+/, '')
  return `${MATCH_API_ORIGIN}/api/matches${normalizedQuery ? `?${normalizedQuery}` : ''}`
}

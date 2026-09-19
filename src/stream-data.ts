import type { Stream } from './types'

const demoStream = (stream: Omit<Stream, 'provider' | 'legalStatus' | 'officialPageUrl' | 'eventId' | 'access'>): Stream => ({
  ...stream,
  provider: 'demo',
  legalStatus: 'demo',
  officialPageUrl: null,
  eventId: null,
  access: 'player',
  sourceKind: 'unknown',
})

export const streams: Stream[] = [
  demoStream({ id: 'ucl-main', matchId: 'ucl', name: '主源 · Demo', type: 'hls', url: '', priority: 100, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'ucl-backup', matchId: 'ucl', name: '备用源 1 · Demo', type: 'hls', url: '', priority: 90, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'nba-main', matchId: 'nba', name: '主源 · Demo', type: 'hls', url: '', priority: 100, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'nba-backup', matchId: 'nba', name: '备用源 1 · Demo', type: 'dash', url: '', priority: 90, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'atp-main', matchId: 'atp', name: '主源 · Demo', type: 'mp4', url: '', priority: 100, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'laliga-main', matchId: 'laliga', name: '主源 · Demo', type: 'hls', url: '', priority: 100, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'laliga-backup', matchId: 'laliga', name: '备用源 1 · Demo', type: 'embed', url: '', priority: 90, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'cba-main', matchId: 'cba', name: '主源 · Demo', type: 'hls', url: '', priority: 100, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
  demoStream({ id: 'cba-backup', matchId: 'cba', name: '备用源 1 · Demo', type: 'embed', url: '', priority: 90, enabled: true, status: 'unknown', lastCheckedAt: null, errorMessage: null, latency: null, fallbackEnabled: true }),
]
export const streamsFor = (matchId: string) => streams.filter((stream) => stream.matchId === matchId && stream.enabled).sort((a, b) => b.priority - a.priority)

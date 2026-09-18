export type StreamKind = 'HLS' | 'DASH' | 'EMBED'
export type StreamState = 'unconfigured' | 'ready' | 'offline'

// Stream addresses are intentionally blank until a lawful source is confirmed.
export type StreamConfig = {
  id: string
  label: string
  kind: StreamKind
  url: string
  priority: number
  state: StreamState
}

export const createStreamConfig = (id: string, label = '主源', kind: StreamKind = 'HLS', priority = 1): StreamConfig => ({
  id,
  label,
  kind,
  url: '',
  priority,
  state: 'unconfigured',
})

export type SafeAbortController = {
  signal: AbortSignal
  abort: (reason?: unknown) => void
}

const nativeAbortController = (): typeof AbortController | null => {
  if (typeof globalThis === 'undefined' || typeof globalThis.AbortController !== 'function') return null
  return globalThis.AbortController
}

export const supportsAbortController = (): boolean => nativeAbortController() !== null

/** Keeps cancellation semantics available without passing an invalid signal to old fetch implementations. */
export const createSafeAbortController = (): SafeAbortController => {
  const NativeAbortController = nativeAbortController()
  if (NativeAbortController) return new NativeAbortController()

  let aborted = false
  let reason: unknown
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const signal = {
    get aborted() { return aborted },
    get reason() { return reason },
    onabort: null as ((this: AbortSignal, event: Event) => unknown) | null,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (type === 'abort' && listener) listeners.add(listener)
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (type === 'abort' && listener) listeners.delete(listener)
    },
  } as unknown as AbortSignal

  return {
    signal,
    abort: (abortReason?: unknown) => {
      if (aborted) return
      aborted = true
      reason = abortReason
      const event = { type: 'abort' } as Event
      for (const listener of listeners) {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
      signal.onabort?.call(signal, event)
    },
  }
}

/** Old fetch implementations may reject a non-native AbortSignal. */
export const signalForFetch = (signal?: AbortSignal): AbortSignal | undefined => supportsAbortController() ? signal : undefined

export type SafeDateTimeFormatter = {
  format: (value?: Date | number) => string
  formatToParts: (value?: Date | number) => Intl.DateTimeFormatPart[]
}

const utcParts = (value: Date | number): Record<string, string> => {
  const date = new Date(value)
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const pad = (item: number) => item < 10 ? `0${item}` : String(item)
  return {
    year: String(date.getUTCFullYear()),
    month: pad(date.getUTCMonth() + 1),
    day: pad(date.getUTCDate()),
    hour: pad(date.getUTCHours()),
    minute: pad(date.getUTCMinutes()),
    second: pad(date.getUTCSeconds()),
    weekday: weekdays[date.getUTCDay()],
  }
}

const fallbackFormatter = (options: Intl.DateTimeFormatOptions): SafeDateTimeFormatter => ({
  formatToParts: (value = new Date()) => {
    const parts = utcParts(value)
    const result: Intl.DateTimeFormatPart[] = []
    if (options.weekday) result.push({ type: 'weekday', value: parts.weekday })
    if (options.year) result.push({ type: 'year', value: parts.year })
    if (options.month) result.push({ type: 'month', value: options.month === '2-digit' ? parts.month : String(Number(parts.month)) })
    if (options.day) result.push({ type: 'day', value: options.day === '2-digit' ? parts.day : String(Number(parts.day)) })
    if (options.hour) result.push({ type: 'hour', value: parts.hour })
    if (options.minute) result.push({ type: 'minute', value: parts.minute })
    if (options.second) result.push({ type: 'second', value: parts.second })
    return result
  },
  format: (value = new Date()) => {
    const parts = utcParts(value)
    if (options.hour || options.minute) return `${parts.hour}:${parts.minute}`
    return `${parts.year}-${parts.month}-${parts.day}`
  },
})

const supportsTimeZone = (timeZone: string): boolean => {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

export const createSafeDateTimeFormatter = (locale: string, options: Intl.DateTimeFormatOptions): SafeDateTimeFormatter => {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return fallbackFormatter(options)
  const timeZone = options.timeZone
  const safeOptions = { ...options, ...(timeZone ? { timeZone: supportsTimeZone(timeZone) ? timeZone : 'UTC' } : {}) }
  try {
    return new Intl.DateTimeFormat(locale, safeOptions)
  } catch {
    try {
      return new Intl.DateTimeFormat('en-US', { year: options.year, month: options.month, day: options.day, hour: options.hour, minute: options.minute, second: options.second, timeZone: 'UTC' })
    } catch {
      return fallbackFormatter(options)
    }
  }
}

export const createRecordFromEntries = <T,>(entries: readonly (readonly [string, T])[]): Record<string, T> => {
  const result: Record<string, T> = {}
  for (const [key, value] of entries) result[key] = value
  return result
}

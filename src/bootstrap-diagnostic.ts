export type BootstrapDiagnosticSnapshot = {
  errorName: string
  message: string
  stack: string
  pathname: string
  userAgent: string
  createRootExecuted: boolean
  fieldWatchEntered: boolean
}

type NormalizedError = Pick<BootstrapDiagnosticSnapshot, 'errorName' | 'message' | 'stack'>

const MAX_STACK_LENGTH = 1000

const redact = (value: string): string => value
  .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
  .replace(/([?&](?:api[_-]?key|token|authorization|cookie|password|secret)=)[^&#\s]*/gi, '$1[redacted]')
  .replace(/((?:api[_-]?key|token|authorization|cookie|password|secret)\s*[:=]\s*)[^\s,;)]+/gi, '$1[redacted]')

const safeText = (value: unknown, fallback: string, limit = MAX_STACK_LENGTH): string => {
  if (typeof value !== 'string') return fallback
  return redact(value).slice(0, limit)
}

const normalizeError = (value: unknown, fallbackName: string): NormalizedError => {
  if (value && typeof value === 'object') {
    const record = value as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      errorName: safeText(record.name, fallbackName, 120),
      message: safeText(record.message, fallbackName),
      stack: safeText(record.stack, '', MAX_STACK_LENGTH),
    }
  }
  return {
    errorName: fallbackName,
    message: safeText(value, fallbackName),
    stack: '',
  }
}

const getPathname = (): string => {
  try {
    return typeof window !== 'undefined' && typeof window.location?.pathname === 'string' ? window.location.pathname : ''
  } catch {
    return ''
  }
}

const getUserAgent = (): string => {
  try {
    return typeof window !== 'undefined' && typeof window.navigator?.userAgent === 'string' ? window.navigator.userAgent : ''
  } catch {
    return ''
  }
}

const diagnosticText = (snapshot: BootstrapDiagnosticSnapshot): string => [
  'FIELDWATCH bootstrap diagnostic',
  `errorName: ${snapshot.errorName}`,
  `message: ${snapshot.message}`,
  `stack: ${snapshot.stack}`,
  `pathname: ${snapshot.pathname}`,
  `userAgent: ${snapshot.userAgent}`,
  `createRootExecuted: ${snapshot.createRootExecuted}`,
  `fieldWatchEntered: ${snapshot.fieldWatchEntered}`,
].join('\n')

const copyDiagnostic = async (value: string): Promise<boolean> => {
  try {
    const clipboard = typeof window !== 'undefined' ? window.navigator?.clipboard : undefined
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(value)
      return true
    }
  } catch {
    // Use the legacy path below when clipboard permission is unavailable.
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}

export const createBootstrapDiagnostic = () => {
  let createRootExecuted = false
  let fieldWatchEntered = false
  let reactMounted = false
  let lastError: NormalizedError | null = null
  let installed = false

  const snapshot = (): BootstrapDiagnosticSnapshot => ({
    errorName: lastError?.errorName ?? 'UnknownBootstrapError',
    message: lastError?.message ?? 'FIELDWATCH 未能完成启动。',
    stack: lastError?.stack ?? '',
    pathname: getPathname(),
    userAgent: getUserAgent(),
    createRootExecuted,
    fieldWatchEntered,
  })

  const show = () => {
    if (reactMounted || typeof document === 'undefined') return
    let root = document.getElementById('root')
    if (!root && document.body) {
      root = document.createElement('div')
      root.id = 'root'
      document.body.appendChild(root)
    }
    if (!root) return

    root.textContent = ''
    const page = document.createElement('main')
    page.setAttribute('data-bootstrap-diagnostic', 'true')
    page.style.cssText = 'min-height:100vh;box-sizing:border-box;padding:32px 20px;color:#f4f4f6;background:#0b0f13;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;'

    const heading = document.createElement('h1')
    heading.textContent = 'FIELDWATCH 启动失败'
    heading.style.margin = '0 0 20px'
    page.appendChild(heading)

    const current = snapshot()
    const details = [
      ['错误类型', current.errorName],
      ['错误', current.message],
      ['路径', current.pathname],
      ['createRoot 已执行', String(current.createRootExecuted)],
      ['已进入 FieldWatchApp', String(current.fieldWatchEntered)],
    ] as const
    for (const [label, value] of details) {
      const paragraph = document.createElement('p')
      paragraph.style.margin = '8px 0'
      const labelNode = document.createElement('strong')
      labelNode.textContent = `${label}：`
      paragraph.appendChild(labelNode)
      paragraph.appendChild(document.createTextNode(value))
      page.appendChild(paragraph)
    }

    if (current.stack) {
      const stack = document.createElement('pre')
      stack.textContent = current.stack
      stack.style.cssText = 'max-width:100%;overflow:auto;white-space:pre-wrap;color:#aab8bd;background:#14191f;padding:12px;font-size:12px;'
      page.appendChild(stack)
    }

    const retry = document.createElement('p')
    retry.textContent = '请刷新页面后重试。'
    page.appendChild(retry)

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.textContent = '复制诊断信息'
    copy.style.cssText = 'min-height:36px;border:1px solid #5bdbc2;border-radius:4px;padding:0 12px;color:#071311;background:#5bdbc2;cursor:pointer;'
    copy.addEventListener('click', () => {
      void copyDiagnostic(diagnosticText(current)).then((copied) => { copy.textContent = copied ? '已复制诊断信息' : '复制失败，请手动查看' })
    })
    page.appendChild(copy)
    root.appendChild(page)
  }

  const capture = (value: unknown, fallbackName: string) => {
    if (reactMounted || lastError) return
    lastError = normalizeError(value, fallbackName)
    show()
  }

  const install = () => {
    if (installed || typeof window === 'undefined') return
    installed = true
    window.onerror = (message, _source, _line, _column, error) => {
      capture(error ?? message, 'WindowError')
      return false
    }
    window.onunhandledrejection = (event) => {
      capture(event.reason, 'UnhandledRejection')
    }
  }

  return {
    install,
    markCreateRootExecuted: () => { createRootExecuted = true },
    markFieldWatchEntered: () => { fieldWatchEntered = true },
    markReactMounted: () => { reactMounted = true },
    capture,
    snapshot,
  }
}

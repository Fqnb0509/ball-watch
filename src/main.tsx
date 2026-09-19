import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BootstrapApp } from './bootstrap-app'
import { createBootstrapDiagnostic } from './bootstrap-diagnostic'

const diagnostic = createBootstrapDiagnostic()
diagnostic.install()

const start = async () => {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    diagnostic.capture(new Error('Root element not found'), 'BootstrapError')
    return
  }

  try {
    const { default: FieldWatchApp } = await import('./FieldWatchApp.tsx')
    if (typeof FieldWatchApp !== 'function') throw new Error('FieldWatchApp module has no component export')
    diagnostic.markCreateRootExecuted()
    const root = createRoot(rootElement, {
      onUncaughtError: (error) => diagnostic.capture(error, 'ReactUncaughtError'),
      onCaughtError: (error) => diagnostic.capture(error, 'ReactCaughtError'),
    })
    root.render(
      <StrictMode>
        <BootstrapApp App={FieldWatchApp} onEntered={diagnostic.markFieldWatchEntered} onMounted={diagnostic.markReactMounted} />
      </StrictMode>,
    )
  } catch (error) {
    diagnostic.capture(error, 'BootstrapError')
  }
}

void start()

import { type ComponentType, useLayoutEffect } from 'react'

type BootstrapAppProps = {
  App: ComponentType
  onEntered: () => void
  onMounted: () => void
}

export function BootstrapApp({ App, onEntered, onMounted }: BootstrapAppProps) {
  onEntered()
  useLayoutEffect(() => { onMounted() }, [onMounted])
  return <App />
}

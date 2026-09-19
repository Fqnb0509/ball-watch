import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const normalizeBasePath = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed === '/') return '/'
  if (!trimmed.startsWith('/')) return '/'
  return `${trimmed.replace(/\/+$/, '')}/`
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [react()],
  build: {
    target: 'safari12',
  },
})

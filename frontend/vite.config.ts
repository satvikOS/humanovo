import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { constantChatPlugin } from './vite-chat-plugin'

// Mock-auth gate: VITE_ENABLE_MOCK_AUTH defaults to "true" in dev /
// non-production builds, "false" in production. Vite passes `mode`
// at config-eval time — `vite build` sets it to "production",
// `vite dev` to "development". The Tauri release workflow runs
// `vite build` (production); local dev + the Tauri debug shell
// run `vite dev` (development). Operator can override either way
// via the VITE_ENABLE_MOCK_AUTH env var on the build command.
export default defineConfig(({ mode }) => ({
  // plotly.js (modular, used via lib/plotlyMin.ts) was authored for
  // Node and references `global` at module-init time. Browser globals
  // resolve via globalThis; without this define every page that
  // imports a Plotly chart errored at mount with "global is not
  // defined" (49/49 missing in the chart-type coverage spec). Define
  // is preferable to a runtime polyfill because it's a static rewrite
  // — no runtime cost, no shim shipped to the user.
  define: {
    global: 'globalThis',
    // Bake the mock-auth gate at build time. Default: enabled in dev,
    // disabled in production. Operator can override either way via
    // VITE_ENABLE_MOCK_AUTH=true|false on the build command.
    'import.meta.env.VITE_ENABLE_MOCK_AUTH': JSON.stringify(
      process.env.VITE_ENABLE_MOCK_AUTH ?? (mode === 'production' ? 'false' : 'true')
    ),
  },
  plugins: [
    react(),
    constantChatPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
}))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { constantChatPlugin } from './vite-chat-plugin'

export default defineConfig({
  // plotly.js (modular, used via lib/plotlyMin.ts) was authored for
  // Node and references `global` at module-init time. Browser globals
  // resolve via globalThis; without this define every page that
  // imports a Plotly chart errored at mount with "global is not
  // defined" (49/49 missing in the chart-type coverage spec). Define
  // is preferable to a runtime polyfill because it's a static rewrite
  // — no runtime cost, no shim shipped to the user.
  define: {
    global: 'globalThis',
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
})

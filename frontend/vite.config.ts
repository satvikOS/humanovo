import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { constantChatPlugin } from './vite-chat-plugin'

export default defineConfig({
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
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})

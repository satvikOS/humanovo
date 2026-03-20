/**
 * Vite dev-server plugin that proxies /api/v1/orchestrator/chat to the
 * real FastAPI backend. Returns a clear error when the backend is unavailable
 * instead of falling back to hardcoded knowledge.
 *
 * No mock data — all responses come from the real backend.
 */

import type { Plugin } from 'vite'

export function constantChatPlugin(): Plugin {
  return {
    name: 'constant-chat-handler',
    configureServer(server) {
      // Intercept chat route — try the real backend first, return error if down
      server.middlewares.use('/api/v1/orchestrator/chat', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', async () => {
          try {
            // Proxy to real backend
            const backendUrl = process.env.VITE_API_URL || 'http://localhost:8000'
            const resp = await fetch(`${backendUrl}/api/v1/orchestrator/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            })
            if (resp.ok) {
              const data = await resp.json()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(data))
            } else {
              res.writeHead(resp.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                response: `Backend returned ${resp.status}. Please ensure the FastAPI backend is running.`,
              }))
            }
          } catch {
            // Backend not reachable
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              response: 'The backend API is not available. Please start the FastAPI server (docker-compose up) to use Constant AI.',
            }))
          }
        })
      })

      // Health check
      server.middlewares.use('/health', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'vite-dev-proxy' }))
      })
    },
  }
}

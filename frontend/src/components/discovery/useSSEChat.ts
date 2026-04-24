// useSSEChat — hook wrapping the fetch-based SSE stream from
// POST /api/v1/agents/chat/stream.
//
// Emits incremental token deltas (onToken) and rich cards (onCard)
// plus lifecycle events (onStart / onDone / onError). Supports
// cancellation by aborting the underlying fetch. Browser EventSource
// API doesn't support POST, so we implement SSE parsing over a
// readable stream.
import { useRef, useCallback } from 'react'
import { apiClient } from '../../services/api'

export interface SSEChatEvents {
  onStart?: (meta: { run_id: string; model: string; session_id: string }) => void
  onToken?: (delta: string) => void
  onStatus?: (msg: string) => void
  onCard?: (card: { kind: string; payload: Record<string, any> }) => void
  onDone?: (meta: { finish_reason: string; tokens?: { prompt: number; completion: number }; message_id?: string }) => void
  onError?: (message: string) => void
}

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(async (
    sessionId: string,
    userMessage: string,
    overrides: Record<string, any> | undefined,
    events: SSEChatEvents,
  ): Promise<void> => {
    // Cancel any in-flight stream before starting a new one.
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const baseURL = (apiClient.defaults.baseURL || '/api/v1').replace(/\/$/, '')
      const url = `${baseURL}/agents/chat/stream`
      // apiClient carries auth headers; we forward them manually since
      // we're using native fetch for the streaming body.
      const authHeaders: Record<string, string> = {}
      const headerSrc = apiClient.defaults.headers as any
      for (const bucket of ['common', 'post']) {
        const h = headerSrc?.[bucket] || {}
        for (const [k, v] of Object.entries(h)) {
          if (typeof v === 'string' && k.toLowerCase() !== 'content-type') authHeaders[k] = v
        }
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ session_id: sessionId, user_message: userMessage, overrides: overrides || null }),
        signal: ctrl.signal,
      })
      if (!resp.ok || !resp.body) {
        events.onError?.(`HTTP ${resp.status}`)
        return
      }

      // Parse SSE frames from the ReadableStream. Frames are
      // `data: {...json...}\n\n` — accumulate partial bytes across
      // reads, split on `\n\n`.
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let splitIdx: number
        while ((splitIdx = buffer.indexOf('\n\n')) !== -1) {
          const rawFrame = buffer.slice(0, splitIdx)
          buffer = buffer.slice(splitIdx + 2)
          const line = rawFrame.split('\n').find(l => l.startsWith('data:'))
          if (!line) continue
          const payloadText = line.slice(5).trim()
          if (!payloadText) continue
          try {
            const payload = JSON.parse(payloadText)
            switch (payload.event) {
              case 'start':  events.onStart?.({ run_id: payload.run_id, model: payload.model, session_id: payload.session_id }); break
              case 'token':  events.onToken?.(payload.delta || ''); break
              case 'status': events.onStatus?.(payload.message || ''); break
              case 'card':   events.onCard?.(payload.card); break
              case 'done':   events.onDone?.({ finish_reason: payload.finish_reason, tokens: payload.tokens, message_id: payload.message_id }); break
              case 'error':  events.onError?.(payload.message || 'Unknown error'); break
              default:       break
            }
          } catch {
            // ignore bad frames
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        events.onError?.(err?.message || 'Stream failed')
      }
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { send, cancel }
}

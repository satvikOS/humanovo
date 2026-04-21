import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  level: ToastLevel
  title?: string
  message: string
  duration_ms: number
  action?: { label: string; onClick: () => void }
}

interface ToastContextType {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id' | 'duration_ms'> & { duration_ms?: number }) => string
  dismiss: (id: string) => void
  clear: () => void
  info: (message: string, opts?: Partial<Toast>) => string
  success: (message: string, opts?: Partial<Toast>) => string
  warning: (message: string, opts?: Partial<Toast>) => string
  error: (message: string, opts?: Partial<Toast>) => string
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

const DEFAULT_DURATION: Record<ToastLevel, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 8000,
}

// Cap visible toasts — avoids the dev-mode "backend down, 18 API calls
// queued, 18 stacked toasts covering the whole page" failure mode.
const MAX_VISIBLE = 5
// Dedup identical (level + message) toasts within this window so a loop
// of 10 API retries doesn't repeat itself on-screen.
const DEDUP_WINDOW_MS = 3000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, number>())
  const recentKeys = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback<ToastContextType['push']>((t) => {
    const key = `${t.level}::${t.title ?? ''}::${t.message}`
    const now = Date.now()
    const lastSeen = recentKeys.current.get(key)
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
      return ''
    }
    recentKeys.current.set(key, now)
    // Age out the dedup map so it doesn't grow forever.
    if (recentKeys.current.size > 200) {
      const cutoff = now - DEDUP_WINDOW_MS * 10
      for (const [k, v] of recentKeys.current) {
        if (v < cutoff) recentKeys.current.delete(k)
      }
    }

    const id = `toast-${now}-${Math.random().toString(36).slice(2, 7)}`
    const duration_ms = t.duration_ms ?? DEFAULT_DURATION[t.level]
    const toast: Toast = { id, duration_ms, ...t }
    setToasts((prev) => {
      // When we exceed MAX_VISIBLE, drop the oldest entry so the newest
      // is always readable.
      const next = [...prev, toast]
      if (next.length > MAX_VISIBLE) {
        const dropped = next.shift()
        if (dropped) {
          const t2 = timers.current.get(dropped.id)
          if (t2) { window.clearTimeout(t2); timers.current.delete(dropped.id) }
        }
      }
      return next
    })
    if (duration_ms > 0) {
      const timer = window.setTimeout(() => dismiss(id), duration_ms)
      timers.current.set(id, timer)
    }
    return id
  }, [dismiss])

  const factory = useCallback(
    (level: ToastLevel) =>
      (message: string, opts?: Partial<Toast>) =>
        push({ level, message, ...opts }),
    [push],
  )

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current.clear()
    setToasts([])
  }, [])

  useEffect(() => {
    const stash = timers.current
    return () => {
      stash.forEach((t) => window.clearTimeout(t))
      stash.clear()
    }
  }, [])

  return (
    <ToastContext.Provider
      value={{
        toasts,
        push,
        dismiss,
        clear,
        info: factory('info'),
        success: factory('success'),
        warning: factory('warning'),
        error: factory('error'),
      }}
    >
      {children}
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

// Imperative handle — lets non-React code (like an axios interceptor) emit
// toasts without prop-drilling. Set once at app boot via <Toaster />.
let imperativeHandle: ToastContextType | null = null
// eslint-disable-next-line react-refresh/only-export-components
export function _setImperativeToast(handle: ToastContextType) {
  imperativeHandle = handle
}
// eslint-disable-next-line react-refresh/only-export-components
export function toast(level: ToastLevel, message: string, opts?: Partial<Toast>) {
  if (!imperativeHandle) {
    // Fallback: at least log so the error isn't silent.
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log'](`[toast:${level}]`, message)
    return ''
  }
  return imperativeHandle.push({ level, message, ...opts })
}

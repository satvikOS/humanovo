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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback<ToastContextType['push']>((t) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const duration_ms = t.duration_ms ?? DEFAULT_DURATION[t.level]
    const toast: Toast = { id, duration_ms, ...t }
    setToasts((prev) => [...prev, toast])
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

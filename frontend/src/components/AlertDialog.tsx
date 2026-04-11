/**
 * AlertDialog — Platform-wide replacement for native window.alert/confirm/prompt.
 * Provides a polished, themed overlay dialog consistent with the Humanovo design system.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { FiAlertTriangle, FiInfo, FiCheckCircle, FiAlertCircle } from 'react-icons/fi'

type DialogVariant = 'info' | 'warning' | 'error' | 'success' | 'confirm' | 'prompt'

interface DialogState {
  open: boolean
  variant: DialogVariant
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  inputDefault?: string
  resolve?: (value: boolean | string | null) => void
}

const ICONS: Record<DialogVariant, typeof FiInfo> = {
  info: FiInfo,
  warning: FiAlertTriangle,
  error: FiAlertCircle,
  success: FiCheckCircle,
  confirm: FiAlertTriangle,
  prompt: FiInfo,
}

const ICON_COLORS: Record<DialogVariant, string> = {
  info: 'var(--color-accent-blue)',
  warning: '#f59e0b',
  error: '#ef4444',
  success: '#22c55e',
  confirm: '#f59e0b',
  prompt: 'var(--color-accent-blue)',
}

const ICON_BG: Record<DialogVariant, string> = {
  info: 'rgba(59, 130, 246, 0.1)',
  warning: 'rgba(245, 158, 11, 0.1)',
  error: 'rgba(239, 68, 68, 0.1)',
  success: 'rgba(34, 197, 94, 0.1)',
  confirm: 'rgba(245, 158, 11, 0.1)',
  prompt: 'rgba(59, 130, 246, 0.1)',
}

const initial: DialogState = { open: false, variant: 'info', title: '', message: '' }

export function useAlertDialog() {
  const [state, setState] = useState<DialogState>(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  const showAlert = useCallback((message: string, title = 'Notice') => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, variant: 'info', title, message, resolve: () => { resolve(true) } })
    })
  }, [])

  const showError = useCallback((message: string, title = 'Error') => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, variant: 'error', title, message, resolve: () => { resolve(true) } })
    })
  }, [])

  const showConfirm = useCallback((message: string, title = 'Confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel') => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, variant: 'confirm', title, message, confirmLabel, cancelLabel, resolve: (v) => { resolve(!!v) } })
    })
  }, [])

  const showPrompt = useCallback((message: string, title = 'Input', defaultValue = '') => {
    return new Promise<string | null>((resolve) => {
      setState({ open: true, variant: 'prompt', title, message, inputDefault: defaultValue, resolve: (v) => { resolve(v as string | null) } })
    })
  }, [])

  const close = useCallback((value: boolean | string | null) => {
    state.resolve?.(value)
    setState(initial)
  }, [state])

  const DialogComponent = useCallback(() => {
    if (!state.open) return null
    const Icon = ICONS[state.variant]
    const isPrompt = state.variant === 'prompt'
    const hasCancel = state.variant === 'confirm' || isPrompt
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in"
        onClick={() => close(hasCancel ? (isPrompt ? null : false) : true)}
      >
        <div
          className="glass-card p-6 max-w-sm w-full mx-4 animate-in slide-in-from-bottom-4"
          onClick={e => e.stopPropagation()}
          style={{
            background: 'var(--color-surface-solid, var(--glass-bg))',
            border: '1px solid var(--glass-border)',
            borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 p-2.5 rounded-xl"
              style={{ background: ICON_BG[state.variant] }}
            >
              <Icon className="w-5 h-5" style={{ color: ICON_COLORS[state.variant] }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                {state.title}
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {state.message}
              </p>
              {isPrompt && (
                <input
                  ref={inputRef}
                  defaultValue={state.inputDefault}
                  autoFocus
                  className="w-full mt-3 px-3 py-2 text-xs rounded-lg outline-none"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--color-text)',
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') close(inputRef.current?.value ?? null)
                    if (e.key === 'Escape') close(null)
                  }}
                />
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-5">
            {hasCancel && (
              <button
                onClick={() => close(isPrompt ? null : false)}
                className="px-4 py-1.5 text-xs rounded-lg font-medium transition-colors hover:bg-white/5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {state.cancelLabel || 'Cancel'}
              </button>
            )}
            <button
              onClick={() => {
                if (isPrompt) close(inputRef.current?.value ?? null)
                else close(hasCancel ? true : true)
              }}
              autoFocus={!isPrompt}
              className="px-4 py-1.5 text-xs rounded-lg font-medium transition-colors"
              style={{
                background: state.variant === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                color: state.variant === 'error' ? '#ef4444' : 'var(--color-accent-blue)',
              }}
            >
              {state.confirmLabel || 'OK'}
            </button>
          </div>
        </div>
      </div>
    )
  }, [state, close])

  return { showAlert, showError, showConfirm, showPrompt, AlertDialog: DialogComponent }
}

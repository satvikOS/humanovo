import { useEffect } from 'react'
import { _setImperativeToast, useToast, type ToastLevel } from '../contexts/ToastContext'

const LEVEL_STYLE: Record<ToastLevel, { bg: string; border: string; icon: string; color: string }> = {
  info:    { bg: 'rgba(59, 130, 246, 0.12)',  border: 'rgba(59, 130, 246, 0.5)',  icon: 'i', color: '#60a5fa' },
  success: { bg: 'rgba(34, 197, 94, 0.12)',   border: 'rgba(34, 197, 94, 0.5)',   icon: '✓', color: '#4ade80' },
  warning: { bg: 'rgba(234, 179, 8, 0.12)',   border: 'rgba(234, 179, 8, 0.5)',   icon: '!', color: '#fbbf24' },
  error:   { bg: 'rgba(239, 68, 68, 0.12)',   border: 'rgba(239, 68, 68, 0.5)',   icon: '×', color: '#f87171' },
}

export function Toaster() {
  const toastCtx = useToast()

  // Register imperative handle so non-React code (axios interceptors,
  // standalone service modules) can emit toasts.
  useEffect(() => {
    _setImperativeToast(toastCtx)
  }, [toastCtx])

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(420px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      {toastCtx.toasts.map((t) => {
        const s = LEVEL_STYLE[t.level]
        return (
          <div
            key={t.id}
            role={t.level === 'error' ? 'alert' : 'status'}
            style={{
              pointerEvents: 'auto',
              background: 'var(--color-surface-raised, #1a1a1a)',
              border: `1px solid ${s.border}`,
              borderLeft: `3px solid ${s.color}`,
              borderRadius: 6,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              color: 'var(--color-text, #e5e5e5)',
              fontSize: 13,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
              backgroundImage: `linear-gradient(${s.bg}, ${s.bg})`,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: s.color,
                color: '#000',
                fontWeight: 700,
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                marginTop: 1,
              }}
            >
              {s.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {t.title && (
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.title}</div>
              )}
              <div style={{ wordBreak: 'break-word' }}>{t.message}</div>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick()
                    toastCtx.dismiss(t.id)
                  }}
                  style={{
                    marginTop: 6,
                    background: 'transparent',
                    border: `1px solid ${s.border}`,
                    color: s.color,
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => toastCtx.dismiss(t.id)}
              style={{
                flex: '0 0 auto',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted, #9ca3af)',
                cursor: 'pointer',
                padding: 0,
                width: 20,
                height: 20,
                fontSize: 14,
                lineHeight: 1,
                opacity: 0.7,
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

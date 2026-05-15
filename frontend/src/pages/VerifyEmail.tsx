/**
 * Email-verification landing page — the destination of the link sent
 * by POST /auth/send-verification. Reads ?token=… from the URL and
 * calls GET /auth/verify-email to consume it.
 *
 * UX: a 410 means the token already fired (or expired). Surface that
 * distinctly so the user knows whether to request a fresh one — a
 * generic "verification failed" toast would have them re-clicking
 * the dead link forever.
 */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FiAlertCircle, FiCheck, FiArrowLeft } from 'react-icons/fi'
import HumanovoGlyph from '../components/HumanovoGlyph'
import { verifyEmailToken } from '../services/auth'

type VerifyState = 'idle' | 'ok' | 'expired' | 'error' | 'missing'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [state, setState] = useState<VerifyState>(token.length < 8 ? 'missing' : 'idle')
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    if (state !== 'idle') return
    let cancelled = false
    ;(async () => {
      try {
        await verifyEmailToken(token)
        if (!cancelled) setState('ok')
      } catch (err: unknown) {
        if (cancelled) return
        const e = err as { response?: { status?: number; data?: { detail?: string } } }
        const status = e?.response?.status
        const msg = e?.response?.data?.detail
        if (status === 410) {
          setState('expired')
          setDetail(msg ?? 'This verification link has already been used or expired.')
        } else {
          setState('error')
          setDetail(msg ?? 'Verification failed. Try the link again or request a new one.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [token, state])

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <HumanovoGlyph className="w-7 h-7" />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            humanovo
          </span>
        </div>

        <div className="glass-card p-6" data-testid="verify-email-card">
          <h1 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
            Email verification
          </h1>

          {state === 'idle' && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Verifying your email…
            </p>
          )}

          {state === 'missing' && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              This page expects a verification token. Open the link from
              your email — or sign in and use Settings → Account → Resend
              verification to get a fresh one.
            </p>
          )}

          {state === 'ok' && (
            <div
              role="status"
              className="flex items-start gap-2 text-sm"
              data-testid="verify-email-ok"
              style={{ color: 'var(--color-text)' }}
            >
              <FiCheck className="w-4 h-4 mt-0.5 text-emerald-400" />
              <span>Email verified. You can close this tab or head to the dashboard.</span>
            </div>
          )}

          {(state === 'expired' || state === 'error') && (
            <div
              role="alert"
              className="flex items-start gap-2 text-sm"
              data-testid="verify-email-error"
              style={{ color: 'var(--color-error)' }}
            >
              <FiAlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{detail ?? 'Verification failed.'}</span>
            </div>
          )}

          <p className="text-xs mt-5 text-center" style={{ color: 'var(--color-text-muted)' }}>
            <Link
              to="/dashboard"
              className="underline hover:no-underline inline-flex items-center gap-1"
              style={{ color: 'var(--color-text)' }}
            >
              <FiArrowLeft className="w-3 h-3" /> Go to dashboard
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Reset-password page — consumes a token from ?token=… and POSTs
 * /auth/reset-password { token, new_password }.
 *
 * Single-use: a 410 response means the token has already been used or
 * expired. Surface the distinct cases so the user knows whether to
 * request a fresh link.
 */
import { useState, useMemo, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FiAlertCircle, FiCheck, FiArrowLeft } from 'react-icons/fi'
import HumanovoGlyph from '../components/HumanovoGlyph'
import { resetPassword } from '../services/auth'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const missingToken = useMemo(() => token.length < 8, [token])
  const mismatch = password.length > 0 && confirm.length > 0 && password !== confirm

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (missingToken) return
    if (password.length < 8) {
      setError('Pick a password at least 8 characters long.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await resetPassword(token, password)
      setOk(true)
      // Brief pause so the user sees the success state before we
      // bounce them back to /login.
      setTimeout(() => navigate('/login', { replace: true }), 1500)
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } } }
      const status = e?.response?.status
      const detail = e?.response?.data?.detail
      if (status === 410) {
        setError(detail || 'This reset link has already been used or expired. Request a new one.')
      } else if (status === 400) {
        setError(detail || 'Could not reset password. Double-check the link from your email.')
      } else if (!status) {
        setError('Cannot reach server. Check your connection.')
      } else {
        setError(detail || `Reset failed (${status}).`)
      }
    } finally {
      setSubmitting(false)
    }
  }

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

        <div className="glass-card p-6" data-testid="reset-password-card">
          <h1 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Set a new password
          </h1>

          {missingToken ? (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              This link is missing the reset token. Open the link from
              your email, or{' '}
              <Link to="/forgot-password" className="underline hover:no-underline">
                request a new one
              </Link>.
            </p>
          ) : ok ? (
            <div
              role="status"
              className="flex items-start gap-2 text-sm"
              data-testid="reset-password-ok"
              style={{ color: 'var(--color-text)' }}
            >
              <FiCheck className="w-4 h-4 mt-0.5 text-emerald-400" />
              <span>
                Password reset. Redirecting you to sign in…
              </span>
            </div>
          ) : (
            <>
              <p className="text-xs mb-5" style={{ color: 'var(--color-text-muted)' }}>
                Pick a password at least 8 characters long. You’ll be
                signed out of any other sessions.
              </p>
              <form onSubmit={onSubmit} noValidate>
                <label className="block mb-3">
                  <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    New password
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="input w-full text-sm"
                    disabled={submitting}
                    data-testid="reset-password-new"
                  />
                </label>
                <label className="block mb-3">
                  <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    Confirm new password
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Re-type to confirm"
                    className="input w-full text-sm"
                    disabled={submitting}
                    data-testid="reset-password-confirm"
                  />
                  {mismatch && (
                    <span className="block text-xs mt-1 text-red-400">
                      Passwords don’t match.
                    </span>
                  )}
                </label>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 mb-4 text-xs px-3 py-2 rounded"
                    style={{
                      background: 'var(--glass-bg)',
                      border: '1px solid var(--color-error)',
                      color: 'var(--color-error)',
                    }}
                  >
                    <FiAlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    submitting || password.length < 8 || password !== confirm
                  }
                  className="btn w-full text-sm justify-center"
                  data-testid="reset-password-submit"
                  style={{
                    background: 'var(--color-text)',
                    color: 'var(--color-bg)',
                    opacity:
                      submitting || password.length < 8 || password !== confirm
                        ? 0.5 : 1,
                  }}
                >
                  {submitting ? 'Saving…' : 'Reset password'}
                </button>
              </form>
            </>
          )}

          <p className="text-xs mt-5 text-center" style={{ color: 'var(--color-text-muted)' }}>
            <Link
              to="/login"
              className="underline hover:no-underline inline-flex items-center gap-1"
              style={{ color: 'var(--color-text)' }}
            >
              <FiArrowLeft className="w-3 h-3" /> Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

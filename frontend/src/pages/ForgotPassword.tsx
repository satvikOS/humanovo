/**
 * Forgot-password page — POST /auth/forgot-password.
 *
 * Always shows the same "if an account exists, we sent a link" copy
 * after submit, regardless of whether the email matched. The backend
 * is anti-enumeration so we mirror that on the UI side: revealing
 * "not found" here would defeat the purpose.
 */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FiAlertCircle, FiMail, FiArrowLeft } from 'react-icons/fi'
import HumanovoGlyph from '../components/HumanovoGlyph'
import { forgotPassword } from '../services/auth'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await forgotPassword(email.trim().toLowerCase())
      setSubmitted(true)
    } catch (err: unknown) {
      // Anti-enumeration: server returns 200 even on miss. A real
      // network error gets a clear message; we don't pretend it
      // succeeded.
      const e = err as { message?: string }
      setError(e?.message || 'Cannot reach server. Check your connection.')
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

        <div className="glass-card p-6" data-testid="forgot-password-card">
          <h1 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Reset your password
          </h1>
          <p className="text-xs mb-5" style={{ color: 'var(--color-text-muted)' }}>
            Enter the email on your humanovo account. We’ll send you a link
            (valid for 1 hour) to set a new password.
          </p>

          {submitted ? (
            <div
              role="status"
              className="text-sm space-y-3"
              data-testid="forgot-password-sent"
            >
              <p style={{ color: 'var(--color-text)' }}>
                If an account exists for that email, we’ve sent a reset
                link. Check your inbox — and your spam folder, since
                reset emails sometimes land there.
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                The link expires in 1 hour. If you don’t see anything in
                15 minutes, request another one below.
              </p>
              <button
                type="button"
                onClick={() => { setSubmitted(false); setEmail('') }}
                className="btn-secondary text-sm"
              >
                Send another link
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <label className="block mb-3">
                <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                  Email
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  className="input w-full text-sm"
                  disabled={submitting}
                  data-testid="forgot-password-email"
                />
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
                disabled={submitting || !email.trim()}
                className="btn w-full text-sm justify-center"
                data-testid="forgot-password-submit"
                style={{
                  background: 'var(--color-text)',
                  color: 'var(--color-bg)',
                  opacity: submitting || !email.trim() ? 0.5 : 1,
                }}
              >
                <FiMail className="w-3.5 h-3.5" />
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
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

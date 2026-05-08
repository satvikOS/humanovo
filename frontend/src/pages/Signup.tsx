/**
 * Signup page.
 *
 * Mirrors Login.tsx structure. On success: auto-login (handled by
 * AuthContext.register) → redirect to ?next= or /dashboard.
 *
 * Validation:
 *   - Email: HTML5 + non-empty trim
 *   - Password: minimum 8 characters, must contain at least one
 *     letter and one number (matches typical institutional research
 *     account hygiene without being onerous). Backend can layer
 *     additional checks later.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FiUserPlus, FiAlertCircle } from 'react-icons/fi'
import HumanovoGlyph from '../components/HumanovoGlyph'
import { useAuth } from '../contexts/useAuth'

function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.'
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.'
  return null
}

export default function Signup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { register } = useAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const next = searchParams.get('next') || '/dashboard'
  const pwError = password ? passwordIssue(password) : null

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    if (pwError) {
      setError(pwError)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await register({
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim() || undefined,
      })
      const target = /^\/[^/]/.test(next) ? next : '/dashboard'
      navigate(target, { replace: true })
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string }
      const status = e?.response?.status
      const detail = e?.response?.data?.detail
      if (status === 400) {
        setError(detail || 'Email already registered. Try signing in instead.')
      } else if (!status) {
        setError('Cannot reach server. Check your connection.')
      } else {
        setError(detail || `Sign up failed (${status}).`)
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
          <HumanovoGlyph size={36} className="text-[var(--color-text)]" />
          <span
            className="text-2xl italic"
            style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 700, letterSpacing: '0.04em', color: 'var(--color-text)' }}
          >
            humanovo
          </span>
        </div>

        <div
          className="rounded-lg p-6"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
        >
          <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Create your account
          </h1>
          <p className="text-xs mb-5" style={{ color: 'var(--color-text-muted)' }}>
            Free trial: 3 hypotheses + 1 paper synthesis. No card required.
          </p>

          <form onSubmit={onSubmit} noValidate>
            <label className="block mb-3">
              <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Full name <span style={{ opacity: 0.6 }}>(optional)</span>
              </span>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. Jane Researcher"
                className="input w-full text-sm"
                disabled={submitting}
                aria-label="Full name"
              />
            </label>

            <label className="block mb-3">
              <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Email
              </span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                className="input w-full text-sm"
                disabled={submitting}
                aria-label="Email"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Password
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="input w-full text-sm"
                disabled={submitting}
                aria-label="Password"
                aria-invalid={pwError !== null}
                aria-describedby={pwError ? 'pw-hint' : undefined}
              />
              {pwError && (
                <span
                  id="pw-hint"
                  className="block text-xxs mt-1"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {pwError}
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
              disabled={submitting || !email.trim() || !password || pwError !== null}
              className="btn w-full text-sm justify-center"
              style={{
                background: 'var(--color-text)',
                color: 'var(--color-bg)',
                opacity: submitting || !email.trim() || !password || pwError !== null ? 0.5 : 1,
              }}
            >
              <FiUserPlus className="w-3.5 h-3.5" />
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-xs mt-5 text-center" style={{ color: 'var(--color-text-muted)' }}>
            Already have an account?{' '}
            <Link
              to={`/login${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="underline hover:no-underline"
              style={{ color: 'var(--color-text)' }}
            >
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-xxs mt-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
          By creating an account you agree to humanovo's terms and privacy policy.
        </p>
      </div>
    </div>
  )
}

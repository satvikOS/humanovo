/**
 * Login page.
 *
 * On success: redirects to ?next=<path> if present, else /dashboard.
 * On failure: surfaces the backend's `detail` (typically "Incorrect
 * email or password") inline below the form.
 *
 * The API call uses the dedicated `authClient` in services/auth.ts so
 * that a 401 here doesn't trigger the global redirect-to-/login loop
 * that fires on the shared apiClient.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FiLogIn, FiAlertCircle } from 'react-icons/fi'
import HumanovoGlyph from '../components/HumanovoGlyph'
import { useAuth } from '../contexts/useAuth'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const next = searchParams.get('next') || '/dashboard'

  // Mock-auth visible only when the gate is on. Build sets
  // VITE_ENABLE_MOCK_AUTH=true for dev / E2E / Tauri-debug; release
  // builds omit it so the hint banner never ships to production users.
  const mockAuthEnabled = (
    (import.meta.env.VITE_ENABLE_MOCK_AUTH as string | undefined) === 'true'
  )

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setSubmitting(true)
    setError(null)
    try {
      // Mock credentials are case-sensitive numerics — don't lowercase
      // them or we'd break the literal-match path in services/auth.ts.
      const submitEmail = (
        mockAuthEnabled && email.trim() === '1234'
          ? '1234'
          : email.trim().toLowerCase()
      )
      await login({ email: submitEmail, password })
      // Redirect to ?next= if present and safe (relative path only).
      const target = /^\/[^/]/.test(next) ? next : '/dashboard'
      navigate(target, { replace: true })
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string }
      const status = e?.response?.status
      const detail = e?.response?.data?.detail
      if (status === 401) {
        setError('Incorrect email or password.')
      } else if (status === 403) {
        setError(detail || 'This account is disabled. Contact support.')
      } else if (!status) {
        setError('Cannot reach server. Check your connection.')
      } else {
        setError(detail || `Login failed (${status}).`)
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
        {/* Brand mark */}
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
          style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
          }}
        >
          <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            Sign in
          </h1>
          <p className="text-xs mb-5" style={{ color: 'var(--color-text-muted)' }}>
            Welcome back to your research workspace.
          </p>

          {mockAuthEnabled && (
            <div
              data-testid="mock-auth-banner"
              role="note"
              className="mb-4 rounded-md px-3 py-2 text-xxs flex items-center justify-between gap-3"
              style={{
                background: 'rgba(180, 110, 60, 0.10)',
                border: '1px solid rgba(180, 110, 60, 0.40)',
                color: 'var(--color-text)',
              }}
            >
              <span>
                <strong>Dev / E2E mode.</strong> Test login:{' '}
                <code style={{ fontFamily: 'monospace' }}>1234</code> /{' '}
                <code style={{ fontFamily: 'monospace' }}>1234</code>.
              </span>
              <button
                type="button"
                data-testid="mock-auth-fill"
                onClick={() => { setEmail('1234'); setPassword('1234') }}
                className="underline hover:no-underline whitespace-nowrap"
                style={{ color: 'var(--color-text)' }}
              >
                Fill
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <label className="block mb-3">
              <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Email
              </span>
              <input
                // Was type="email" — mock-auth path needs to accept
                // "1234" which fails HTML5 email validation. The
                // backend still validates the email format on the
                // login endpoint for non-mock paths.
                type={mockAuthEnabled ? 'text' : 'email'}
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mockAuthEnabled ? '1234 (or you@university.edu)' : 'you@university.edu'}
                className="input w-full text-sm"
                disabled={submitting}
                aria-label="Email"
                data-testid="login-email"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Password
              </span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input w-full text-sm"
                disabled={submitting}
                aria-label="Password"
                data-testid="login-password"
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
              disabled={submitting || !email.trim() || !password}
              className="btn w-full text-sm justify-center"
              data-testid="login-submit"
              style={{
                background: 'var(--color-text)',
                color: 'var(--color-bg)',
                opacity: submitting || !email.trim() || !password ? 0.5 : 1,
              }}
            >
              <FiLogIn className="w-3.5 h-3.5" />
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-xs mt-5 text-center" style={{ color: 'var(--color-text-muted)' }}>
            New here?{' '}
            <Link
              to={`/signup${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="underline hover:no-underline"
              style={{ color: 'var(--color-text)' }}
            >
              Create an account
            </Link>
          </p>
        </div>

        <p className="text-xxs mt-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
          By signing in you agree to humanovo's terms and privacy policy.
        </p>
      </div>
    </div>
  )
}

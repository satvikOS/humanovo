/**
 * RequireAuth — route guard.
 *
 * Wrap protected routes:
 *
 *     <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
 *
 * Behavior:
 *   - If AuthContext is still bootstrapping (`loading` true): render a
 *     minimal skeleton, NOT children, NOT redirect. Otherwise the user
 *     gets briefly bounced to /login during page refresh on a tab
 *     they're already authenticated on.
 *   - If unauthenticated: redirect to /login with `?next=` preserving
 *     the current path so the user lands back here after login.
 *   - If authenticated: render children.
 */

import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    // Plain background with a centered spinner-like dot. Avoids
    // pulling in a heavy skeleton component just for the boot moment.
    return (
      <div
        className="flex items-center justify-center w-full h-screen"
        style={{ background: 'var(--color-bg)' }}
        aria-busy="true"
        aria-label="Loading"
      >
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: 'var(--color-text-muted)' }}
        />
      </div>
    )
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <>{children}</>
}

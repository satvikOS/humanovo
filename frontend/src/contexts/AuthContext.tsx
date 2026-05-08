/**
 * AuthContext - current-user state + login/logout actions.
 *
 * Lifecycle:
 *   1. On mount: if a token exists in localStorage, call /auth/me to
 *      hydrate the current user. If /me returns 401, clear the token
 *      and treat the user as unauthenticated.
 *   2. login() POSTs to /auth/login, stores the token, then calls /me.
 *   3. logout() POSTs to /auth/logout (best-effort) and clears local
 *      state.
 *
 * Loading state: `loading` is true ONLY during the initial bootstrap
 * fetch on app mount. Subsequent login/logout actions don't toggle it
 * (they have their own per-action local state in the consuming page).
 *
 * The context object + value type live in `auth-context-internal.ts`
 * and the `useAuth` hook in `useAuth.ts`. This file exports only
 * `AuthProvider` so React Refresh's "components-only" rule is
 * satisfied (no fast-refresh warnings).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
  getMe,
  getToken,
  isTokenExpired,
  login as loginApi,
  logout as logoutApi,
  register as registerApi,
} from '../services/auth'
import { AuthContext, type AuthContextValue } from './auth-context-internal'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  // Initial bootstrap: if a non-expired token is present, fetch /me.
  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      const token = getToken()
      if (!token || isTokenExpired()) {
        if (!cancelled) {
          setUser(null)
          setLoading(false)
        }
        return
      }
      try {
        const me = await getMe()
        if (!cancelled) setUser(me)
      } catch {
        // /me failed - token invalid or expired server-side. Clear
        // local state; the response interceptor in services/api.ts
        // already cleared the token on the 401.
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (req: LoginRequest): Promise<AuthUser> => {
    await loginApi(req)
    const me = await getMe()
    setUser(me)
    return me
  }, [])

  const register = useCallback(async (req: RegisterRequest): Promise<AuthUser> => {
    // Backend /register returns the user but doesn't auto-login.
    const newUser = await registerApi(req)
    // Auto-login after successful registration so the user lands in
    // the app immediately rather than seeing the login page right
    // after submitting.
    await loginApi({ email: req.email, password: req.password })
    setUser(newUser)
    return newUser
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    await logoutApi()
    setUser(null)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const me = await getMe()
      setUser(me)
    } catch {
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    isAuthenticated: user !== null,
    login,
    register,
    logout,
    refresh,
  }), [user, loading, login, register, logout, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Auth service — token storage, login/signup/logout/refresh helpers.
 *
 * Token storage: localStorage for the v1 web preview. When the native
 * apps (Tauri / iOS) ship, swap the storage adapter to OS keychain via
 * Tauri's `keytar` plugin / iOS Keychain APIs. The interface here
 * (getToken / setToken / clearToken) stays stable across that swap.
 *
 * Token refresh: backend issues short-lived JWTs (default 60 min per
 * `ACCESS_TOKEN_EXPIRE_MINUTES`). When a 401 hits in the response
 * interceptor (services/api.ts), the user is redirected to /login.
 * No silent refresh path yet — a refresh-token endpoint is a Sprint-2
 * follow-up; for the closed beta the 60-min TTL + re-login UX is fine.
 */

import axios, { type AxiosInstance } from 'axios'

// ─── Types (mirror backend response shapes) ─────────────────────────

export interface AuthToken {
  access_token: string
  token_type: 'bearer'
  expires_in: number  // seconds
}

export interface AuthUser {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'researcher' | 'lab' | 'institution' | string
  is_active: boolean
  is_verified: boolean
  // First-run onboarding wizard gate. Backend defaults to TRUE for
  // legacy rows so they never see the wizard; FALSE for new signups
  // until the user clicks Skip or completes the last step.
  has_completed_onboarding: boolean
  created_at: string
  // Pricing tier (trial / researcher / lab / institution). Surfaced
  // so the TrialBanner + UpgradePanel can render the right state
  // without an extra /billing/status round-trip.
  tier?: 'trial' | 'researcher' | 'lab' | 'institution' | string
  // ISO timestamp when the trial expires. Null after conversion
  // or for users who never had a trial set. The TrialBanner
  // computes days-remaining client-side from this.
  trial_ends_at?: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  full_name?: string
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

// ─── Storage primitives ─────────────────────────────────────────────
// Single key for the JWT. The expiry timestamp lives alongside so the
// app can pre-emptively redirect to /login when the token is expired
// without round-tripping a 401 from the backend.

const TOKEN_KEY = 'humanovo.auth.token'
const EXPIRY_KEY = 'humanovo.auth.expires_at'  // epoch milliseconds

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: AuthToken): void {
  try {
    localStorage.setItem(TOKEN_KEY, token.access_token)
    const expiresAt = Date.now() + token.expires_in * 1000
    localStorage.setItem(EXPIRY_KEY, String(expiresAt))
  } catch {
    /* localStorage quota or disabled — login flow surfaces this */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EXPIRY_KEY)
  } catch {
    /* nothing to do */
  }
}

export function isTokenExpired(): boolean {
  try {
    const raw = localStorage.getItem(EXPIRY_KEY)
    if (!raw) return true
    const expiresAt = Number(raw)
    if (!Number.isFinite(expiresAt)) return true
    // 30-second buffer so we don't race the server's clock on close
    // expirations.
    return Date.now() >= expiresAt - 30_000
  } catch {
    return true
  }
}

// ─── HTTP layer ─────────────────────────────────────────────────────
// We use a dedicated axios instance for /auth endpoints rather than
// the shared apiClient, so that the response interceptor in
// services/api.ts (which redirects to /login on 401) doesn't fire on
// the login attempt itself.

const authBase = ((): string => {
  const env = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
  return env ? env.replace(/\/$/, '') + '/api/v1/auth' : '/api/v1/auth'
})()

const authClient: AxiosInstance = axios.create({
  baseURL: authBase,
  timeout: 15_000,
})

// Mock-auth bypass for headed E2E + dev environments. When a caller
// submits the literal credentials `1234 / 1234`, fabricate a token
// + user pair locally instead of hitting the backend. The mock token
// carries a `mock-` prefix so any backend that receives it (it
// shouldn't — getMe() returns the local mock user too) recognises it
// as fake and refuses to mint real records against it.
//
// Gated so production builds NEVER honour this path: the bypass only
// runs when import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true'. The
// Tauri app's debug builds and local Vite dev set this; release
// builds explicitly omit it via the build-native-apps workflow.
const MOCK_AUTH_ENABLED = (
  (import.meta.env.VITE_ENABLE_MOCK_AUTH as string | undefined) === 'true'
)
const MOCK_USERNAME = '1234'
const MOCK_PASSWORD = '1234'

function _mockToken(): AuthToken {
  return {
    access_token: 'mock-' + Math.random().toString(36).slice(2) + '.dev-only',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24,  // 24 hours
  }
}

function _mockUser(): AuthUser {
  return {
    id: 'mock-user-1234',
    email: '1234',
    full_name: 'Mock User (E2E)',
    role: 'admin',
    is_active: true,
    is_verified: true,
    has_completed_onboarding: true,
    created_at: new Date().toISOString(),
  }
}

function _isMockToken(): boolean {
  const t = getToken()
  return MOCK_AUTH_ENABLED && t !== null && t.startsWith('mock-')
}

export async function login(req: LoginRequest): Promise<AuthToken> {
  if (
    MOCK_AUTH_ENABLED
    && req.email.trim() === MOCK_USERNAME
    && req.password === MOCK_PASSWORD
  ) {
    const token = _mockToken()
    setToken(token)
    return token
  }
  const { data } = await authClient.post<AuthToken>('/login', req)
  setToken(data)
  return data
}

export async function register(req: RegisterRequest): Promise<AuthUser> {
  const { data } = await authClient.post<AuthUser>('/register', req)
  return data
}

export async function getMe(): Promise<AuthUser> {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  // Mock auth: short-circuit /me when the stored token is a mock —
  // no backend round-trip, returns the canned mock user. Same gate
  // as login(): only honoured when VITE_ENABLE_MOCK_AUTH=true.
  if (_isMockToken()) {
    return _mockUser()
  }
  const { data } = await authClient.get<AuthUser>('/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

// Profile patch — currently used by the onboarding wizard to set
// has_completed_onboarding=true on Skip / Finish, but accepts any
// subset of UserUpdateRequest fields the backend allows (full_name,
// email, has_completed_onboarding).
export async function patchMe(updates: {
  full_name?: string
  email?: string
  has_completed_onboarding?: boolean
}): Promise<AuthUser> {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  if (_isMockToken()) {
    // Apply updates locally to the canned mock user; no backend.
    const u = _mockUser()
    return { ...u, ...updates }
  }
  const { data } = await authClient.patch<AuthUser>('/me', updates, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

export async function logout(): Promise<void> {
  const token = getToken()
  // Best-effort server notification — JWTs aren't revocable server-side
  // without a blacklist (Sprint-2 work), so the canonical logout is
  // discarding the token client-side regardless of network outcome.
  // Mock tokens are already not sent to the backend; just clear local.
  if (token && !_isMockToken()) {
    try {
      await authClient.post('/logout', null, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5_000,
      })
    } catch {
      /* swallow — local clear is what matters */
    }
  }
  clearToken()
}

export async function changePassword(req: ChangePasswordRequest): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('Not authenticated')
  await authClient.post('/change-password', req, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

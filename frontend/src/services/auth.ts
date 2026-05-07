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
  created_at: string
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

export async function login(req: LoginRequest): Promise<AuthToken> {
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
  const { data } = await authClient.get<AuthUser>('/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

export async function logout(): Promise<void> {
  const token = getToken()
  // Best-effort server notification — JWTs aren't revocable server-side
  // without a blacklist (Sprint-2 work), so the canonical logout is
  // discarding the token client-side regardless of network outcome.
  if (token) {
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

/**
 * Auth context object + value type, split out of AuthContext.tsx so
 * the component file exports only its component (`AuthProvider`)
 * and the hook lives in `useAuth.ts`. This split silences React
 * Refresh's "exports both component and constants" warning, which
 * otherwise blocks fast-refresh during development.
 *
 * Don't import this directly from app code - use `useAuth()` from
 * `./useAuth.ts`. Only `AuthProvider` (in `AuthContext.tsx`) and
 * `useAuth` are allowed consumers.
 */
import { createContext } from 'react'
import type {
  AuthUser,
  LoginRequest,
  RegisterRequest,
} from '../services/auth'

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean // initial bootstrap only
  isAuthenticated: boolean
  login: (req: LoginRequest) => Promise<AuthUser>
  register: (req: RegisterRequest) => Promise<AuthUser>
  logout: () => Promise<void>
  refresh: () => Promise<void> // re-fetch /auth/me (e.g. after profile edit)
}

export const AuthContext = createContext<AuthContextValue | null>(null)

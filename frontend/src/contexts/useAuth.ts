/**
 * `useAuth()` hook - the canonical accessor for current-user state.
 *
 * Lives separately from AuthContext.tsx so the .tsx file exports
 * only its component (Fast Refresh requirement). Consumers import
 * exclusively from here:
 *
 *     import { useAuth } from '@/contexts/useAuth'
 */
import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context-internal'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth() must be used inside <AuthProvider>')
  }
  return ctx
}

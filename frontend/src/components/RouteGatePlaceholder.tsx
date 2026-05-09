/**
 * RouteGatePlaceholder — structural auth-gate slot for every route.
 *
 * Today: passthrough. Every click goes through, no redirect to /login.
 *
 * Why we still ship the wrapper now: PATH_TO_100_PERCENT.md Stage 5
 * flips this to enforce real auth (it'll route through `RequireAuth`
 * — currently defined in `RequireAuth.tsx` but unwired). Wrapping
 * every route in the placeholder TODAY means that flip is a one-line
 * change to this component, not 35 simultaneous edits across App.tsx.
 *
 * Operationally:
 *   - PageWrapper / LazyPageWrapper in App.tsx funnel every route
 *     element through this gate; you don't need to think about it
 *     when adding a new route.
 *   - The `data-route-gate="placeholder"` attribute lets e2e tests
 *     assert the gate is mounted without depending on its current
 *     permissive behaviour. When Stage 5 flips strict mode on, the
 *     attribute changes to "strict" and tests update accordingly.
 *
 * Future work (Stage 5 of PATH_TO_100_PERCENT.md):
 *   - Replace the body with a call to `useAuth()` + a redirect to
 *     /login when unauthenticated, exactly like `RequireAuth.tsx`
 *     does today (RequireAuth's body can be inlined here).
 *   - Add a per-route `requireRole` prop for admin-only surfaces.
 *   - Swap the `data-route-gate` attribute to "strict".
 */

import type { ReactNode } from 'react'

export default function RouteGatePlaceholder({ children }: { children: ReactNode }) {
  // Permissive by design — see header. Will tighten in Stage 5.
  return <div data-route-gate="placeholder" style={{ display: 'contents' }}>{children}</div>
}

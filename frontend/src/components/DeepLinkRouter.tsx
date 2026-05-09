/**
 * DeepLinkRouter — mounts at app root and routes `humanovo://` URLs.
 *
 * The Tauri shell registers `humanovo://` as an OS-level URI scheme
 * (see `src-tauri/tauri.conf.json` + the single-instance + deep-link
 * plugins in `src-tauri/src/lib.rs`). When something like Stripe
 * Checkout fires `humanovo://billing/success?session_id=cs_...`, the
 * OS hands the URL to the running humanovo app; this component is the
 * React-side receiver.
 *
 * Without this component, deep links land on the binary but the URL
 * parameters get lost — `frontend/src/lib/native.ts::onDeepLink` was
 * written but never subscribed.
 *
 * Routing model: parse the URL path, map to a known React Router
 * path, navigate. Unknown paths fall through to /dashboard so the
 * user always lands somewhere sensible. The query string is preserved
 * verbatim so Stripe's session_id etc. survive the hop.
 *
 * Web-mode no-op: `onDeepLink` returns a no-op when `isNativeApp()`
 * is false, so this component is safe to mount unconditionally.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { onDeepLink } from '../lib/native'

// path-prefix → router-path mapping. Add new entries here when wiring
// a new deep-link surface. Anything outside this map falls through
// to /dashboard.
const PATH_MAP: Record<string, string> = {
  'billing/success': '/billing',
  'billing/cancel': '/billing',
  'billing/portal': '/billing',
  'project': '/projects',         // humanovo://project/<id> → /projects/<id>
  'hypothesis': '/hypotheses',    // humanovo://hypothesis/<id> → /hypotheses/<id>
  'evidence': '/evidence',
  'discovery': '/agents',
  'notebook': '/notebook',
}


function resolveTarget(rawUrl: string): string | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  if (u.protocol !== 'humanovo:') return null

  // `humanovo://path/to/thing?query` → host is "path", pathname is
  // "/to/thing". We treat (host + pathname) as the routing key.
  const segments = [u.host, ...u.pathname.split('/')].filter(Boolean)
  if (segments.length === 0) return '/dashboard'

  // Try the most-specific prefix first (e.g. "billing/success") then
  // shorter prefixes (e.g. "billing"). Falls back to "/dashboard"
  // when nothing matches so we never land the user on a 404.
  for (let i = segments.length; i > 0; i--) {
    const key = segments.slice(0, i).join('/')
    const base = PATH_MAP[key]
    if (!base) continue
    const remaining = segments.slice(i).join('/')
    const path = remaining ? `${base}/${remaining}` : base
    return u.search ? `${path}${u.search}` : path
  }
  return '/dashboard'
}


export default function DeepLinkRouter() {
  const navigate = useNavigate()
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    onDeepLink((url) => {
      const target = resolveTarget(url)
      if (target) navigate(target, { replace: false })
    }).then((u) => {
      if (cancelled) {
        // Component unmounted before the listener registered — release
        // the subscription immediately.
        u()
      } else {
        unlisten = u
      }
    })
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [navigate])
  // Renderless — the component exists purely for the side-effecting
  // useEffect. Safe to mount once at the app root.
  return null
}


// `resolveTarget` is intentionally NOT exported — keeping the file
// to a single component export satisfies Vite fast-refresh's
// only-export-components rule. If a future unit-test pass needs it,
// move resolveTarget to a sibling .ts module and import from both
// here and the test.

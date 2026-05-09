/**
 * errorLog — bounded ring buffer of recent runtime errors.
 *
 * Captures the last N unhandled errors / promise rejections and makes
 * them queryable for the Settings → Desktop App "Copy diagnostics"
 * affordance. Without this, support tickets arrive without the actual
 * error text — users would need to open devtools, copy from console,
 * and paste in. Most never do.
 *
 * Why not Sentry: Sentry is the right answer at scale, but for the
 * private beta we don't want to add a 3rd-party SDK + DSN + retention
 * surface yet. A handful of in-memory entries that the user can paste
 * into a ticket is enough to close the gap.
 *
 * Bounded at 20 entries (most recent kept). Older entries fall off
 * the back so a noisy page doesn't push out yesterday's still-
 * relevant error.
 *
 * Persistence: localStorage. Errors persist across app restarts so a
 * user who files a ticket *the morning after* a crash still has the
 * original error text. The buffer is small (capped at MAX_ENTRIES)
 * so old entries fall off naturally. Settings → Desktop App ships a
 * "Clear diagnostics" button for users who want to reset stale state
 * before filing a fresh ticket.
 */

export interface ErrorLogEntry {
  ts: string // ISO timestamp
  source: 'error' | 'unhandledrejection' | 'manual'
  message: string
  // Path of the page that was active at capture time. Helpful when a
  // stack trace alone doesn't say which surface broke (e.g. a generic
  // network error from the api client).
  url: string
}

const STORAGE_KEY = 'humanovo.errorLog'
const MAX_ENTRIES = 20

function read(): ErrorLogEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(entries: ErrorLogEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // Storage quota or disabled — silently drop. The point of this
    // module is to *help* support, not become a bug source itself.
  }
}

/**
 * Record an error. Pruned to the last MAX_ENTRIES on write. Safe to
 * call from anywhere; failures are swallowed so the logger can't
 * break the app it's trying to instrument.
 */
export function logError(
  source: ErrorLogEntry['source'],
  message: string,
): void {
  const entry: ErrorLogEntry = {
    ts: new Date().toISOString(),
    source,
    message: message.slice(0, 1000), // cap individual messages so a
    // misbehaving stack trace doesn't blow the storage quota.
    url: typeof location !== 'undefined' ? location.pathname : 'unknown',
  }
  write([...read(), entry])
}

/** Snapshot of the recent errors, oldest → newest. */
export function recentErrors(): ErrorLogEntry[] {
  return read()
}

/**
 * Erase the persisted error log. Wired to the Settings "Clear
 * diagnostics" button so users can drop stale entries before filing
 * a fresh ticket.
 */
export function clearErrors(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage disabled / quota — degraded but not fatal */
  }
}

/**
 * Install the global handlers. Call once at app startup. Idempotent
 * via a module-level flag — re-mounting the AppShell shouldn't double-
 * register.
 */
let installed = false
export function installGlobalErrorHandlers(): void {
  if (installed) return
  if (typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    logError('error', e.message || String(e.error) || 'Unknown error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : JSON.stringify(reason)
    logError('unhandledrejection', msg)
  })
}

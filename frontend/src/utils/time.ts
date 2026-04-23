/**
 * Time formatting utilities used across the app.
 *
 * Single-source so we don't have three subtly-different "5m ago" formats.
 */

/** "Just now" / "5m ago" / "3h ago" / "2d ago" */
export function formatTimeAgo(ts: string | number | Date | null | undefined): string {
  if (!ts) return '—'
  const t = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts
  const ms = Date.now() - t.getTime()
  if (!isFinite(ms) || ms < 0) return 'Just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/** Apr 23, 2026 · 10:45 AM */
export function formatTimestamp(ts: string | number | Date | null | undefined): string {
  if (!ts) return '—'
  const t = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts
  if (!isFinite(t.getTime())) return '—'
  const date = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const time = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

/**
 * Subscribe to tab visibility + window focus. Fires `onActive` when the
 * tab becomes visible or the window gains focus. Returns a cleanup
 * function that unsubscribes.
 *
 * Use to throttle background polling — no need to hit the API every 5s
 * when the tab is in the background or the user has switched apps.
 */
export function onTabActive(onActive: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') onActive()
  }
  document.addEventListener('visibilitychange', handler)
  window.addEventListener('focus', onActive)
  return () => {
    document.removeEventListener('visibilitychange', handler)
    window.removeEventListener('focus', onActive)
  }
}

/** True when the tab is currently visible + focused. */
export function isTabActive(): boolean {
  return typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && (typeof document.hasFocus !== 'function' || document.hasFocus())
}

/**
 * Trial countdown banner — rendered above the main app shell when
 * the authenticated user is on the trial tier with a known
 * trial_ends_at. Click → /settings#billing.
 *
 * Visibility rules:
 *   • Show only when user.tier === 'trial' AND trial_ends_at exists.
 *   • If trial_ends_at has already passed, copy switches to "Your
 *     trial ended — upgrade to keep working" so the user has a
 *     clear path forward without us silently locking them out.
 *   • If the user has dismissed it this session (sessionStorage),
 *     stay dismissed until next reload — not localStorage, since
 *     the user needs the nudge after re-login.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FiAlertCircle, FiX } from 'react-icons/fi'
import { useAuth } from '../contexts/useAuth'

const DISMISS_KEY = 'humanovo-trial-banner-dismissed'

export function TrialBanner() {
  const { user, loading } = useAuth()
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  const daysRemaining = useMemo(() => {
    if (!user?.trial_ends_at) return null
    const ends = Date.parse(user.trial_ends_at)
    if (Number.isNaN(ends)) return null
    const ms = ends - Date.now()
    // Round up so the last day shows "1 day left" not "0".
    return Math.ceil(ms / 86_400_000)
  }, [user?.trial_ends_at])

  if (loading || !user) return null
  if (user.tier !== 'trial') return null
  if (daysRemaining === null) return null
  if (dismissed) return null

  const expired = daysRemaining <= 0
  const urgent = !expired && daysRemaining <= 3

  const headline = expired
    ? 'Your trial ended — upgrade to keep working.'
    : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in your trial.`

  const tone = expired
    ? 'bg-red-500/10 border-red-400/40 text-red-100'
    : urgent
      ? 'bg-amber-500/10 border-amber-400/40 text-amber-100'
      : 'bg-emerald-500/5 border-emerald-400/30 text-[var(--color-text)]'

  const handleDismiss = () => {
    setDismissed(true)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 border-b text-sm ${tone}`}
      role="status"
      data-testid="trial-banner"
    >
      <div className="flex items-center gap-2">
        <FiAlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>{headline}</span>
      </div>
      <div className="flex items-center gap-3">
        <Link
          to="/settings#billing"
          className="underline underline-offset-2 hover:no-underline"
          data-testid="trial-banner-upgrade"
        >
          {expired ? 'Upgrade now' : 'See plans'}
        </Link>
        {!expired && (
          <button
            type="button"
            aria-label="Dismiss for this session"
            onClick={handleDismiss}
            className="opacity-70 hover:opacity-100"
          >
            <FiX className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

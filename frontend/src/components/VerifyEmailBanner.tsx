/**
 * Verify-email banner — sits below the trial banner when the
 * authenticated user has is_verified === false. Single CTA:
 * "Resend verification email" → POST /auth/send-verification.
 *
 * Dismiss state lives in sessionStorage so a fresh login re-shows
 * the nudge. Permanent dismissal would let users accumulate weeks
 * of unverified accounts that we then can't reliably email.
 */
import { useState } from 'react'
import { FiMail, FiX } from 'react-icons/fi'
import { useAuth } from '../contexts/useAuth'
import { sendVerificationEmail } from '../services/auth'
import { toast } from '../contexts/ToastContext'

const DISMISS_KEY = 'humanovo-verify-banner-dismissed'

export function VerifyEmailBanner() {
  const { user, loading } = useAuth()
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' }
    catch { return false }
  })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (loading || !user) return null
  if (user.is_verified) return null
  if (dismissed) return null

  const handleResend = async () => {
    setSending(true)
    try {
      await sendVerificationEmail()
      setSent(true)
      toast('info', 'Verification email sent. Check your inbox.', { title: 'humanovo' })
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: { detail?: string } } }
      if (ax?.response?.status === 409) {
        // The user is actually already verified — they just have a
        // stale token. Dismiss the banner; AuthContext will pick up
        // the fresh state on next refresh.
        setDismissed(true)
        toast('info', 'Your email is already verified — refresh to clear this banner.', { title: 'humanovo' })
      } else {
        toast('error', ax?.response?.data?.detail ?? (e instanceof Error ? e.message : 'Could not send verification email'))
      }
    } finally {
      setSending(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 border-b text-sm bg-amber-500/5 border-amber-400/30 text-[var(--color-text)]"
      role="status"
      data-testid="verify-email-banner"
    >
      <div className="flex items-center gap-2">
        <FiMail className="w-4 h-4 flex-shrink-0" />
        <span>
          {sent
            ? 'Verification email sent — check your inbox (and spam).'
            : 'Your email isn’t verified yet. Some workflows need a verified address.'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {!sent && (
          <button
            type="button"
            onClick={handleResend}
            disabled={sending}
            className="underline underline-offset-2 hover:no-underline disabled:opacity-50"
            data-testid="verify-email-resend"
          >
            {sending ? 'Sending…' : 'Resend verification email'}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss for this session"
          onClick={handleDismiss}
          className="opacity-70 hover:opacity-100"
        >
          <FiX className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * Onboarding — first-run wizard.
 *
 * Shown exactly once per user, gated on `users.has_completed_onboarding`
 * being FALSE in the backend. Three steps:
 *
 *   1. Create your first project — navigates to /projects?new=1 so the
 *      Projects page opens the create modal automatically.
 *   2. Import a research corpus — navigates to /data-manager.
 *   3. Run your first discovery — navigates to /agents.
 *
 * Skip button (top-right) and the "Get started" CTA on the last step
 * both PATCH /me { has_completed_onboarding: true } and dismiss the
 * wizard. Once dismissed, the AuthContext refresh updates the cached
 * user and the trigger condition (user.has_completed_onboarding ===
 * false) flips, so the wizard never reopens this session.
 *
 * Failure mode: if the PATCH fails (network / 401), we still close the
 * wizard locally — the user shouldn't be stuck behind a modal because
 * of an infra blip. The flag will sync on the next /me refresh.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiX, FiFolder, FiUpload, FiZap, FiArrowRight, FiCheck } from 'react-icons/fi'
import { patchMe } from '../services/auth'
import { useAuth } from '../contexts/useAuth'

interface Step {
  id: 'project' | 'corpus' | 'discovery'
  title: string
  description: string
  icon: typeof FiFolder
  cta: string
  navTo: string
}

const STEPS: Step[] = [
  {
    id: 'project',
    title: 'Create your first project',
    description:
      'A project is a research context — a disease, a target, or a question. ' +
      'Hypotheses, evidence, simulations, and notebooks all roll up to a project.',
    icon: FiFolder,
    cta: 'Create a project',
    navTo: '/projects?new=1',
  },
  {
    id: 'corpus',
    title: 'Import a research corpus',
    description:
      "Upload PDFs, drop in a CSV of PMIDs, or let humanovo's discovery " +
      'engine pull from PubMed + ClinicalTrials.gov directly. The corpus ' +
      "is what every hypothesis grounds against.",
    icon: FiUpload,
    cta: 'Open Data Manager',
    navTo: '/data-manager',
  },
  {
    id: 'discovery',
    title: 'Run your first discovery',
    description:
      'Ask the 12-stage adversarial pipeline a research question. Each ' +
      'hypothesis is generated, attacked, revised, and grounded against ' +
      'the literature before it lands in your evidence library.',
    icon: FiZap,
    cta: 'Start a discovery',
    navTo: '/agents',
  },
]

export function Onboarding() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [stepIdx, setStepIdx] = useState(0)
  const [dismissing, setDismissing] = useState(false)
  // Local "closed" flag — the AuthContext refresh below also flips the
  // gating condition, but we close immediately for snappier UX rather
  // than waiting for the round-trip.
  const [closed, setClosed] = useState(false)

  const markComplete = useCallback(async (): Promise<void> => {
    setDismissing(true)
    try {
      await patchMe({ has_completed_onboarding: true })
      await refresh()
    } catch {
      // Network blip — still close locally so the user isn't blocked.
      // The flag will sync on the next /me round-trip.
    } finally {
      setClosed(true)
      setDismissing(false)
    }
  }, [refresh])

  const handleSkip = useCallback(async () => {
    await markComplete()
  }, [markComplete])

  const handleStepCTA = useCallback(async (target: string) => {
    // Mark complete first so the wizard doesn't re-fire on the next
    // route's mount; THEN navigate. Order matters — setting
    // has_completed_onboarding flips the trigger condition.
    await markComplete()
    navigate(target)
  }, [markComplete, navigate])

  if (closed) return null

  const step = STEPS[stepIdx]
  const Icon = step.icon
  const isLast = stepIdx === STEPS.length - 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative max-w-xl w-full mx-4 rounded-xl p-8 shadow-xl"
        style={{
          background: 'var(--color-surface-solid)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        {/* Close / Skip — top-right */}
        <button
          type="button"
          onClick={handleSkip}
          disabled={dismissing}
          aria-label="Skip onboarding"
          className="absolute top-3 right-3 p-1.5 rounded-md transition-opacity hover:bg-[var(--glass-bg)] disabled:opacity-40"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <FiX className="w-4 h-4" />
        </button>

        {/* Step pill row */}
        <div className="flex items-center gap-1.5 mb-5" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{
                background:
                  i < stepIdx
                    ? 'var(--color-text-secondary)'
                    : i === stepIdx
                    ? 'var(--color-text)'
                    : 'var(--color-border)',
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div className="flex items-start gap-4 mb-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--glass-bg)' }}
          >
            <Icon className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />
          </div>
          <div className="flex-1">
            <div className="text-xxs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              Step {stepIdx + 1} of {STEPS.length}
            </div>
            <h2 id="onboarding-title" className="text-lg font-semibold mt-0.5">
              {step.title}
            </h2>
          </div>
        </div>

        <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--color-text-secondary)' }}>
          {step.description}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleSkip}
            disabled={dismissing}
            className="text-xs underline-offset-2 hover:underline disabled:opacity-40"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Skip onboarding
          </button>

          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => setStepIdx(i => Math.max(0, i - 1))}
                disabled={dismissing}
                className="text-xs px-3 py-1.5 rounded-md hover:bg-[var(--glass-bg)] disabled:opacity-40"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Back
              </button>
            )}
            {!isLast && (
              <button
                type="button"
                onClick={() => setStepIdx(i => Math.min(STEPS.length - 1, i + 1))}
                disabled={dismissing}
                className="text-xs px-3 py-1.5 rounded-md hover:bg-[var(--glass-bg)] disabled:opacity-40"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Next
              </button>
            )}
            <button
              type="button"
              onClick={() => handleStepCTA(step.navTo)}
              disabled={dismissing}
              className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 disabled:opacity-40"
              style={{
                background: 'var(--color-text)',
                color: 'var(--color-bg)',
                fontWeight: 500,
              }}
            >
              {isLast ? <FiCheck className="w-3.5 h-3.5" /> : <FiArrowRight className="w-3.5 h-3.5" />}
              {step.cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

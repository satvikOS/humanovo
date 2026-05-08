/**
 * HypothesisTrace — per-claim citation chain UI.
 *
 * Renders one chip per CitationChainEntry returned by
 * GET /v1/hypotheses/{id}/trace. Each chip carries:
 *   - the verification status pill (verified / unsupported / retracted /
 *     unknown), colour-coded
 *   - the cited paper's title
 *   - DOI link-out (or PMID, or external URL, in that fallback order)
 *   - the relevance score
 *   - the snippet from the original passage
 *
 * The "Replay audit log" button opens AuditLogViewer with the hypothesis
 * id; together they implement the /provenance promise:
 *
 *   "every citation rendered by humanovo passes a roundtrip verification"
 *   "every event from the algorithm is written to a tamper-evident audit log"
 *
 * Both are read-only views; no mutation paths in this component.
 */
import { useEffect, useState } from 'react'
import {
  FiAlertTriangle, FiCheckCircle, FiExternalLink, FiHelpCircle,
  FiSlash, FiClock,
} from 'react-icons/fi'
import api, {
  type CitationChainEntry, type CitationVerificationStatus,
  type HypothesisTraceResponse,
} from '../services/api'

interface Props {
  hypothesisId: string
  onOpenAuditLog?: () => void
}

const STATUS_META: Record<CitationVerificationStatus, {
  label: string
  className: string
  Icon: typeof FiCheckCircle
}> = {
  verified: {
    label: 'Verified',
    className: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5',
    Icon: FiCheckCircle,
  },
  unsupported: {
    label: 'Unsupported',
    className: 'text-orange-300 border-orange-500/30 bg-orange-500/5',
    Icon: FiAlertTriangle,
  },
  retracted: {
    label: 'Retracted',
    className: 'text-red-300 border-red-500/30 bg-red-500/5',
    Icon: FiSlash,
  },
  unknown: {
    label: 'Unverified',
    className: 'text-[var(--color-text-muted)] border-[var(--color-border)] bg-white/5',
    Icon: FiHelpCircle,
  },
}

function statusFor(s: string): CitationVerificationStatus {
  return s === 'verified' || s === 'unsupported' || s === 'retracted'
    ? s
    : 'unknown'
}

function externalLinkFor(entry: CitationChainEntry): string | null {
  if (entry.doi) return `https://doi.org/${entry.doi}`
  if (entry.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${entry.pmid}/`
  if (entry.url) return entry.url
  return null
}

export default function HypothesisTrace({ hypothesisId, onOpenAuditLog }: Props) {
  const [trace, setTrace] = useState<HypothesisTraceResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getHypothesisTrace(hypothesisId)
      .then(t => { if (!cancelled) setTrace(t) })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Failed to load trace: ${msg}`)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [hypothesisId])

  if (loading) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-2 py-3">
        <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        Loading citation chain…
      </div>
    )
  }
  if (error) {
    return <p className="text-xs text-orange-300">{error}</p>
  }
  if (!trace) return null

  const verifiedCount = trace.citation_chain.filter(c => c.citation_verified).length

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--color-text-muted)]">
          {verifiedCount} of {trace.citation_chain.length} citations verified
          &middot; supporting {trace.supporting_count}
          &middot; contradicting {trace.contradiction_count}
        </div>
        {onOpenAuditLog && (
          <button
            onClick={onOpenAuditLog}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:text-white"
            title="Open the Merkle-anchored audit log for this hypothesis"
          >
            <FiClock className="w-3 h-3" />
            Replay audit log
          </button>
        )}
      </header>

      {trace.citation_chain.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] py-2">
          No citations attached to this hypothesis yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {trace.citation_chain.map(entry => {
            const status = statusFor(entry.verification_status)
            const meta = STATUS_META[status]
            const link = externalLinkFor(entry)
            const Icon = meta.Icon
            return (
              <li
                key={entry.evidence_id}
                className="border border-[var(--color-border)] rounded-md p-3 hover:border-[var(--color-border-strong)] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xxs uppercase tracking-wider ${meta.className}`}
                    aria-label={`Verification status: ${meta.label}`}
                  >
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">
                      {entry.title || (
                        <em className="text-[var(--color-text-muted)]">
                          (deleted citation)
                        </em>
                      )}
                    </p>
                    <p className="text-xxs text-[var(--color-text-muted)] mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{entry.evidence_type}</span>
                      <span>&middot;</span>
                      <span>relevance {(entry.relevance_score * 100).toFixed(0)}%</span>
                      {entry.publication_date && (
                        <>
                          <span>&middot;</span>
                          <span>{entry.publication_date.slice(0, 10)}</span>
                        </>
                      )}
                      {link && (
                        <>
                          <span>&middot;</span>
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                          >
                            {entry.doi ? entry.doi : entry.pmid ? `PMID ${entry.pmid}` : 'source'}
                            <FiExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </>
                      )}
                    </p>
                    {entry.snippet && (
                      <p className="text-xs text-[var(--color-text-secondary)] mt-2 italic">
                        &ldquo;{entry.snippet}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

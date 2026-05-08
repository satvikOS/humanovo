/**
 * AuditLogViewer — Merkle-anchored event log replay for one hypothesis.
 *
 * Pairs with HypothesisTrace.tsx. Backed by GET /v1/hypotheses/{id}/audit-log
 * which returns the per-record sequence, hash chain, and a chain_intact
 * boolean. The viewer renders:
 *   - a top-line integrity banner (green if intact, red if any chain
 *     issue surfaced)
 *   - a chronological list of audit events with sequence number,
 *     event_type, action, duration, cost, and the truncated record hash
 *   - the chain_issues list when intact == false
 *
 * Read-only; no edit / replay-execute paths. The full record hash and
 * previous_hash are revealed on hover so a graduate student in 2126
 * can verify the chain byte-for-byte against an external snapshot.
 */
import { useEffect, useState } from 'react'
import { FiAlertOctagon, FiCheckCircle, FiX } from 'react-icons/fi'
import api, { type AuditLogEntry, type AuditLogResponse } from '../services/api'

interface Props {
  hypothesisId: string
  onClose: () => void
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function formatCost(usd: number | null): string {
  if (usd === null || usd === 0) return '—'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function severityClass(sev: string): string {
  switch (sev) {
    case 'error':
    case 'critical':
      return 'text-red-300'
    case 'warning':
      return 'text-orange-300'
    case 'notice':
      return 'text-blue-300'
    default:
      return 'text-[var(--color-text-muted)]'
  }
}

export default function AuditLogViewer({ hypothesisId, onClose }: Props) {
  const [log, setLog] = useState<AuditLogResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getHypothesisAuditLog(hypothesisId, { limit: 1000 })
      .then(l => { if (!cancelled) setLog(l) })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Failed to load audit log: ${msg}`)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [hypothesisId])

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass-card w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col p-0">
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-base font-semibold text-white">Audit log</h2>
            <p className="text-xxs text-[var(--color-text-muted)]">
              Merkle-anchored event chain for hypothesis {hypothesisId.slice(0, 8)}…
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
          >
            <FiX className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Loading audit log…
            </p>
          )}
          {error && <p className="text-xs text-orange-300">{error}</p>}

          {log && (
            <>
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs mb-4 ${
                  log.chain_intact
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                    : 'border-red-500/30 bg-red-500/5 text-red-300'
                }`}
              >
                {log.chain_intact ? (
                  <>
                    <FiCheckCircle className="w-4 h-4" />
                    Hash chain intact across {log.total_records} record{log.total_records === 1 ? '' : 's'}.
                  </>
                ) : (
                  <>
                    <FiAlertOctagon className="w-4 h-4" />
                    Chain integrity check found {log.chain_issues.length} issue{log.chain_issues.length === 1 ? '' : 's'}.
                  </>
                )}
              </div>

              {log.entries.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  No audit-log entries recorded for this hypothesis yet.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--color-text-muted)] uppercase tracking-wider text-xxs border-b border-[var(--color-border)]">
                      <th className="text-left pb-2 pr-3">Seq</th>
                      <th className="text-left pb-2 pr-3">Time</th>
                      <th className="text-left pb-2 pr-3">Event</th>
                      <th className="text-left pb-2 pr-3">Action</th>
                      <th className="text-right pb-2 pr-3">Duration</th>
                      <th className="text-right pb-2 pr-3">Cost</th>
                      <th className="text-left pb-2">Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.entries.map((e: AuditLogEntry) => (
                      <tr
                        key={e.sequence}
                        className="border-b border-[var(--color-border)] last:border-b-0"
                      >
                        <td className="py-2 pr-3 tabular-nums text-[var(--color-text-muted)]">
                          {e.sequence}
                        </td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)] tabular-nums">
                          {new Date(e.timestamp).toLocaleString(undefined, {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                        </td>
                        <td className={`py-2 pr-3 ${severityClass(e.severity)}`}>
                          {e.event_type}
                        </td>
                        <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                          {e.action}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-text-muted)]">
                          {formatDuration(e.duration_ms)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-text-muted)]">
                          {formatCost(e.cost_usd)}
                        </td>
                        <td
                          className="py-2 font-mono text-xxs text-[var(--color-text-muted)]"
                          title={`record_hash=${e.record_hash}\nprevious_hash=${e.previous_hash || '<genesis>'}`}
                        >
                          {e.record_hash.slice(0, 10)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {!log.chain_intact && log.chain_issues.length > 0 && (
                <details className="mt-4 text-xs">
                  <summary className="cursor-pointer text-red-300">
                    Chain issues ({log.chain_issues.length})
                  </summary>
                  <pre className="mt-2 p-3 bg-black/40 rounded text-xxs text-[var(--color-text-secondary)] overflow-x-auto">
                    {JSON.stringify(log.chain_issues, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

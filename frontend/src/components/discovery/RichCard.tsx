// RichCard — renders an inline rich response object inside an
// assistant message. Supports hypothesis / evidence / entity / KG-
// subgraph / citation kinds. Clickable actions route through the
// parent's onAction callback (typically navigation or save-to-project).
import type { DiscoveryMessageCard } from '../../services/api'
import { FiZap, FiBookOpen, FiShare2, FiTag, FiExternalLink, FiSave } from 'react-icons/fi'

interface RichCardProps {
  card: DiscoveryMessageCard
  onAction?: (cardKind: string, payload: Record<string, unknown>) => void
}

// Defensive structural shape for the rich-card payload. The card schema
// is heterogeneous across kinds (hypothesis vs evidence vs citation),
// so we type each rendered field as optional and coerce with String() /
// Number() / Array.isArray() at the leaf.
interface RichCardPayload {
  title?: string
  statement?: string
  name?: string
  body?: string
  abstract?: string
  description?: string
  snippet?: string
  index?: number | string
  confidence?: number | null
  authors?: string | string[]
  journal?: string
  year?: number | string
  url?: string
}

function iconFor(kind: string) {
  switch (kind) {
    case 'hypothesis': return FiZap
    case 'evidence':   return FiBookOpen
    case 'entity':     return FiTag
    case 'kg_subgraph': return FiShare2
    case 'citation':   return FiBookOpen
    default:           return FiZap
  }
}

function labelFor(kind: string): string {
  switch (kind) {
    case 'hypothesis':  return 'Hypothesis'
    case 'evidence':    return 'Evidence'
    case 'entity':      return 'Entity'
    case 'kg_subgraph': return 'Knowledge subgraph'
    case 'citation':    return 'Citation'
    default:            return kind
  }
}

export default function RichCard({ card, onAction }: RichCardProps) {
  const Icon = iconFor(card.kind)
  const payload = (card.payload || {}) as RichCardPayload
  const title = payload.title || payload.statement || payload.name || 'Untitled'
  const body = payload.body || payload.abstract || payload.description || payload.snippet || ''

  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="flex-shrink-0 w-7 h-7 rounded-md border border-[var(--glass-border)] bg-[var(--color-surface-raised)] flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xxs uppercase tracking-wider text-[var(--color-text-muted)]">{labelFor(card.kind)}</span>
              {payload.index && <span className="text-xxs text-[var(--color-text-muted)]">#{payload.index}</span>}
              {typeof payload.confidence === 'number' && (
                <span className="text-xxs text-[var(--color-text-muted)]">· {Math.round(payload.confidence * 100)}% confidence</span>
              )}
            </div>
            <div className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'var(--color-text)' }}>
              {title}
            </div>
            {body && (
              <div className="text-xs mt-1 leading-relaxed line-clamp-3" style={{ color: 'var(--color-text-muted)' }}>
                {body}
              </div>
            )}
            {/* Evidence-specific attribution */}
            {card.kind === 'evidence' && (payload.authors || payload.journal) && (
              <div className="text-xxs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {Array.isArray(payload.authors) ? payload.authors.slice(0, 3).join(', ') : payload.authors}
                {payload.journal && ` — ${payload.journal}`}
                {payload.year && ` ${payload.year}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {card.kind === 'hypothesis' && onAction && (
            <button
              onClick={() => onAction('save-hypothesis', card.payload as Record<string, unknown>)}
              className="text-xxs px-2 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
              title="Save to active project"
              aria-label="Save hypothesis to active project"
            >
              <FiSave className="w-3 h-3" />
            </button>
          )}
          {payload.url && (
            <a
              href={payload.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xxs px-2 py-0.5 rounded border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
              title="Open source"
            >
              <FiExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

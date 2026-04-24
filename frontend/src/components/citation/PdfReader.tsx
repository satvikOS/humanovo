// PdfReader — inline PDF viewer with persisted highlights.
//
// Uses the browser's built-in PDF viewer via an <object> tag because
// a full pdfjs integration adds ~2MB to the bundle and this platform
// already uses the same technique in DocumentViewer.tsx.
//
// Highlights are stored as page-normalized rects in the backend
// (CitationHighlight). Since the browser's native PDF widget doesn't
// expose per-page selection coordinates, we:
//   1. Show the PDF in the main pane.
//   2. Show a companion "Highlights" side-panel that lists every
//      existing highlight with page + text + note, clickable to
//      jump to the page via the #page=N fragment.
//   3. Offer an "Add highlight" quick-form so users can manually
//      capture a note attached to a page — the pragmatic equivalent
//      of Mendeley's sticky-note tool.
//
// When we eventually upgrade to pdfjs, the highlights side-panel
// stays useful and we gain the ability to render rects atop the
// canvas without changing the persisted shape.
import { useState } from 'react'
import { FiPlus, FiTrash2, FiMessageSquare, FiExternalLink } from 'react-icons/fi'
import type { LibraryHighlight } from '../../services/api'

interface PdfReaderProps {
  pdfUrl: string | null
  highlights: LibraryHighlight[]
  onAddHighlight: (h: { page: number; text: string; note: string; color: string }) => void
  onDeleteHighlight: (id: string) => void
  onUpdateHighlight: (id: string, patch: { note?: string; color?: string }) => void
}

const COLORS = ['#C4956A', '#6A8FC4', '#8FC46A', '#C46A8F', '#A6A6A6']

export default function PdfReader({ pdfUrl, highlights, onAddHighlight, onDeleteHighlight, onUpdateHighlight }: PdfReaderProps) {
  const [page, setPage] = useState(1)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [color, setColor] = useState(COLORS[0])

  const submit = () => {
    if (!text.trim() && !note.trim()) return
    onAddHighlight({ page, text: text.trim(), note: note.trim(), color })
    setText('')
    setNote('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-h-0 border-r border-[var(--color-border)] bg-[var(--color-bg)]">
          {pdfUrl ? (
            <object
              data={pdfUrl}
              type="application/pdf"
              className="w-full h-full"
              aria-label="PDF preview"
            >
              <div className="p-6 text-sm text-[var(--color-text-muted)]">
                Your browser can't inline-render this PDF.{' '}
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
                  Open externally <FiExternalLink className="w-3 h-3" />
                </a>
              </div>
            </object>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)] px-6 text-center">
              This citation has no attached PDF. Drop one in the import panel or paste a PDF URL on the detail tab.
            </div>
          )}
        </div>

        <aside className="w-72 flex-shrink-0 flex flex-col min-h-0 bg-[var(--color-surface-solid)]">
          <div className="p-3 border-b border-[var(--color-border)]">
            <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mb-2">Add highlight</div>
            <label className="block text-xxs text-[var(--color-text-muted)] mb-1">Page</label>
            <input
              type="number"
              min={1}
              value={page}
              onChange={e => setPage(Math.max(1, parseInt(e.target.value || '1')))}
              className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] mb-2"
              aria-label="Page number"
            />
            <label className="block text-xxs text-[var(--color-text-muted)] mb-1">Text</label>
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Quoted passage"
              className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] mb-2"
            />
            <label className="block text-xxs text-[var(--color-text-muted)] mb-1">Note</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Your thought"
              className="w-full px-2 py-1 text-xs rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] mb-2 resize-none"
            />
            <div className="flex items-center gap-1 mb-2">
              <span className="text-xxs text-[var(--color-text-muted)] mr-1">Color</span>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-4 h-4 rounded-full border-2 ${color === c ? 'border-[var(--color-text)]' : 'border-transparent'}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <button
              onClick={submit}
              className="w-full flex items-center justify-center gap-1 py-1.5 text-xs rounded border border-[var(--glass-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            >
              <FiPlus className="w-3 h-3" /> Add
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] sticky top-0 bg-[var(--color-surface-solid)] pb-1">
              Highlights ({highlights.length})
            </div>
            {highlights.length === 0 && (
              <div className="text-xxs text-[var(--color-text-muted)] py-3">
                No highlights yet. Add one with the form above — this table lives on the backend so it follows you across devices.
              </div>
            )}
            {highlights.map(h => (
              <div key={h.id} className="rounded-md border border-[var(--glass-border)] p-2 bg-[var(--glass-bg)] text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: h.color }} aria-hidden="true" />
                    <span className="text-xxs font-medium text-[var(--color-text-muted)]">Page {h.page}</span>
                  </div>
                  <div className="flex gap-0.5">
                    {pdfUrl && (
                      <a
                        href={`${pdfUrl}#page=${h.page}`}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        title="Jump to page"
                        aria-label={`Jump to page ${h.page}`}
                      >
                        <FiExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => onDeleteHighlight(h.id)}
                      className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      title="Delete highlight"
                      aria-label="Delete highlight"
                    >
                      <FiTrash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {h.text && (
                  <blockquote className="border-l-2 pl-2 my-1 italic text-[var(--color-text-muted)]" style={{ borderColor: h.color }}>
                    {h.text}
                  </blockquote>
                )}
                {h.note ? (
                  <div className="flex items-start gap-1 mt-1">
                    <FiMessageSquare className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <textarea
                      defaultValue={h.note}
                      onBlur={e => { if (e.target.value !== h.note) onUpdateHighlight(h.id, { note: e.target.value }) }}
                      rows={2}
                      className="flex-1 bg-transparent text-xs resize-none focus:outline-none leading-relaxed"
                      style={{ color: 'var(--color-text)' }}
                      aria-label="Edit highlight note"
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

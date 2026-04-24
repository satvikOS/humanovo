// ImportDropZone — drag-and-drop area for PDFs and citation files.
//
// Accepted formats:
//   .pdf          → uploaded via /ingestion/documents/upload, creates
//                   a citation with pdf_url set
//   .bib/.bibtex  → parsed client-side OR sent to /citations/import
//   .ris/.nbib    → RIS / NBIB (NBIB is RIS-equivalent from NCBI)
//   .json         → CSL-JSON
//   .enw          → EndNote
//
// File type is inferred from extension; on conflict the user can
// override via the dropdown beneath the drop area.
import { useCallback, useRef, useState } from 'react'
import { FiUploadCloud, FiFileText, FiX } from 'react-icons/fi'

type Format = 'pdf' | 'bibtex' | 'ris' | 'csl' | 'endnote' | null

interface ImportDropZoneProps {
  onImportText: (format: 'bibtex' | 'ris' | 'csl' | 'endnote', text: string) => void | Promise<void>
  onImportPdf: (file: File) => void | Promise<void>
}

export default function ImportDropZone({ onImportText, onImportPdf }: ImportDropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<{ name: string; format: Format; text?: string; file?: File } | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const detectFormat = (name: string): Format => {
    const n = name.toLowerCase()
    if (n.endsWith('.pdf')) return 'pdf'
    if (n.endsWith('.bib') || n.endsWith('.bibtex')) return 'bibtex'
    if (n.endsWith('.ris') || n.endsWith('.nbib')) return 'ris'
    if (n.endsWith('.json') || n.endsWith('.csl')) return 'csl'
    if (n.endsWith('.enw')) return 'endnote'
    return null
  }

  const handleFile = useCallback(async (file: File) => {
    const fmt = detectFormat(file.name)
    if (fmt === 'pdf') {
      setPreview({ name: file.name, format: 'pdf', file })
      return
    }
    if (!fmt) {
      setPreview({ name: file.name, format: null })
      return
    }
    const text = await file.text()
    setPreview({ name: file.name, format: fmt, text })
  }, [])

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) await handleFile(file)
  }, [handleFile])

  const confirm = async () => {
    if (!preview) return
    setBusy(true)
    try {
      if (preview.format === 'pdf' && preview.file) await onImportPdf(preview.file)
      else if (preview.format && preview.format !== 'pdf' && preview.text) await onImportText(preview.format, preview.text)
    } finally {
      setBusy(false)
      setPreview(null)
    }
  }

  return (
    <div>
      <div
        onDragEnter={e => { e.preventDefault(); setDragging(true) }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed transition-colors cursor-pointer px-6 py-8 text-center ${
          dragging
            ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)]'
            : 'border-[var(--glass-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg)]'
        }`}
        role="button"
        tabIndex={0}
        aria-label="Drop PDFs or BibTeX/RIS/CSL files to import"
      >
        <FiUploadCloud className="w-6 h-6 mx-auto text-[var(--color-text-muted)] mb-2" aria-hidden="true" />
        <div className="text-sm font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>
          Drop a PDF or citation file to import
        </div>
        <div className="text-xxs text-[var(--color-text-muted)]">
          PDF · BibTeX (.bib) · RIS (.ris / .nbib) · CSL JSON (.json) · EndNote (.enw)
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.bib,.bibtex,.ris,.nbib,.json,.csl,.enw"
          onChange={async e => {
            const f = e.target.files?.[0]
            if (f) await handleFile(f)
            e.target.value = ''
          }}
          className="hidden"
          aria-label="Choose file to import"
        />
      </div>

      {preview && (
        <div className="mt-3 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <FiFileText className="w-4 h-4 text-[var(--color-text-muted)] mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{preview.name}</div>
              <div className="mt-1">
                <label className="text-xxs text-[var(--color-text-muted)] mr-2">Format:</label>
                <select
                  value={preview.format || ''}
                  onChange={e => setPreview(p => p ? { ...p, format: (e.target.value || null) as Format } : null)}
                  className="text-xxs px-1.5 py-0.5 rounded bg-[var(--color-surface-raised)] border border-[var(--glass-border)] text-[var(--color-text)]"
                  aria-label="Override detected format"
                >
                  <option value="">(auto-detect failed — pick one)</option>
                  <option value="pdf">PDF</option>
                  <option value="bibtex">BibTeX</option>
                  <option value="ris">RIS / NBIB</option>
                  <option value="csl">CSL JSON</option>
                  <option value="endnote">EndNote</option>
                </select>
              </div>
              {preview.text && preview.text.length > 0 && (
                <div className="mt-1.5 text-xxs max-h-24 overflow-auto font-mono text-[var(--color-text-muted)] leading-relaxed">
                  {preview.text.slice(0, 400)}{preview.text.length > 400 ? '…' : ''}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button
              onClick={confirm}
              disabled={!preview.format || busy}
              className="px-3 py-1 text-xs rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:bg-[var(--glass-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={busy}
              className="px-3 py-1 text-xs rounded border border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center justify-center gap-1"
              aria-label="Cancel import"
            >
              <FiX className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

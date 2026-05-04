import { useMemo, useState } from 'react'
import {
  FiDownload, FiPrinter, FiAlertCircle, FiCheckCircle, FiInfo,
  FiChevronRight, FiChevronDown,
} from 'react-icons/fi'
import clsx from 'clsx'
import DOMPurify from 'dompurify'

/**
 * StrictPaperViewer renders the output of
 *   POST /api/v1/documents/discovery/strict-paper
 * which returns a StructuredPaper JSON with:
 *   - sections      (prose per section key)
 *   - figures       (PNG base64 + SVG text + caption + section tag)
 *   - mermaid_diagrams
 *   - references    (verified via 3-round verifier)
 *   - tables
 *   - validation    (per-section pass/fail with failures[])
 *   - is_valid
 *
 * The user first previews the paper here (doc-viewer-first workflow)
 * and can then export to PDF via Print / Save-as-PDF. A QA panel
 * surfaces validation failures + pre-submission QA findings.
 */

export interface StructuredPaper {
  style: string
  title: string
  authors: string[]
  abstract: string
  sections: Record<string, string>
  figures: Array<{
    figure_type: string
    title: string
    caption?: string
    png_b64?: string
    svg?: string
    section?: string
    source?: string
  }>
  mermaid_diagrams: Array<{
    section?: string
    title?: string
    source: string
    png_b64?: string
    kind?: string
  }>
  tables: Array<{ section?: string; title?: string; rows?: any[] }>
  references: Array<{
    pmid?: string; doi?: string; title?: string; authors?: string;
    year?: string | number; journal?: string; verified?: boolean;
    verdict?: string; doi_status?: string; failure_reason?: string;
  }>
  toc: Array<{ number: string; key: string; heading: string; anchor?: string }>
  validation: Array<{
    key: string; word_count: number; passes: boolean; failures: string[];
  }>
  metadata: Record<string, any>
  is_valid: boolean
}

interface Props {
  paper: StructuredPaper
  qaFindings?: Array<{
    check: string; severity: string; section: string;
    message: string; location?: string; fix_hint?: string;
  }>
  onExportPdf?: () => void
}

function sectionsForToc(paper: StructuredPaper) {
  // Merge TOC ordering with actually-present sections
  const ordered: Array<{ key: string; heading: string; number?: string }> = []
  for (const t of paper.toc || []) {
    if (t.key && (paper.sections?.[t.key] || t.key === 'abstract')) {
      ordered.push({ key: t.key, heading: t.heading, number: t.number })
    }
  }
  // Fallback: any sections present but not in TOC
  const seen = new Set(ordered.map(o => o.key))
  for (const k of Object.keys(paper.sections || {})) {
    if (!seen.has(k)) {
      ordered.push({ key: k, heading: k.replace(/_/g, ' ') })
    }
  }
  return ordered
}

export default function StrictPaperViewer({ paper, qaFindings, onExportPdf }: Props) {
  const [expandedValidation, setExpandedValidation] = useState(false)
  const [expandedQA, setExpandedQA] = useState(false)
  const toc = useMemo(() => sectionsForToc(paper), [paper])
  const failuresCount = (paper.validation || []).filter(v => !v.passes).length
  const qaBlockers = (qaFindings || []).filter(f => f.severity === 'blocker').length
  const qaWarnings = (qaFindings || []).filter(f => f.severity === 'warning').length

  // Group figures / mermaid by section
  const figuresBySection = useMemo(() => {
    const m: Record<string, StructuredPaper['figures']> = {}
    for (const f of paper.figures || []) {
      const key = f.section || 'results_overview'
      ;(m[key] ||= []).push(f)
    }
    return m
  }, [paper.figures])

  const mermaidBySection = useMemo(() => {
    const m: Record<string, StructuredPaper['mermaid_diagrams']> = {}
    for (const d of paper.mermaid_diagrams || []) {
      const key = d.section || 'methods'
      ;(m[key] ||= []).push(d)
    }
    return m
  }, [paper.mermaid_diagrams])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(paper, null, 2)],
      { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `paper-${paper.title.slice(0, 40).replace(/\s+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 py-2 px-3 mb-4 bg-[var(--color-bg-elevated)]/95 backdrop-blur border-b border-[var(--color-border)]">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            {paper.style} · strict paper draft
          </div>
          <h1 className="text-sm font-semibold text-[var(--color-text)] truncate">
            {paper.title || 'Untitled paper'}
          </h1>
        </div>

        <div className="flex items-center gap-1 text-xs">
          {paper.is_valid
            ? <Pill ok>All sections valid</Pill>
            : <Pill warn>{failuresCount} section{failuresCount === 1 ? '' : 's'} need work</Pill>}
          {qaBlockers > 0 && <Pill bad>{qaBlockers} QA blockers</Pill>}
          {qaWarnings > 0 && <Pill warn>{qaWarnings} QA warnings</Pill>}
        </div>

        <button onClick={exportJson} title="Export as JSON"
                className="btn btn-secondary text-xs">
          <FiDownload className="w-3.5 h-3.5" /> JSON
        </button>
        {onExportPdf && (
          <button onClick={onExportPdf} title="Export as PDF"
                  className="btn btn-secondary text-xs">
            <FiPrinter className="w-3.5 h-3.5" /> PDF
          </button>
        )}
      </div>

      {/* Validation panel */}
      {(paper.validation || []).length > 0 && (
        <div className="glass-card mb-4">
          <button
            onClick={() => setExpandedValidation(v => !v)}
            className="w-full flex items-center gap-2 p-3 text-left text-xs"
          >
            {expandedValidation
              ? <FiChevronDown className="w-3 h-3" />
              : <FiChevronRight className="w-3 h-3" />}
            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-medium">Structural validation</span>
            <span className="text-[var(--color-text-muted)]">
              ({(paper.validation || []).length} sections · {failuresCount} failing)
            </span>
          </button>
          {expandedValidation && (
            <div className="px-3 pb-3 space-y-1 text-xs">
              {paper.validation.map(v => (
                <div key={v.key}
                     className={clsx('flex items-start gap-2',
                                     !v.passes && 'text-amber-400')}>
                  {v.passes
                    ? <FiCheckCircle className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />
                    : <FiAlertCircle className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />}
                  <div className="flex-1">
                    <span className="font-mono">{v.key}</span>
                    <span className="text-[var(--color-text-muted)] ml-2">
                      {v.word_count}w
                    </span>
                    {!v.passes && (
                      <ul className="mt-1 space-y-0.5">
                        {v.failures.map((f, i) =>
                          <li key={i} className="text-[var(--color-text-muted)] pl-2">
                            · {f}
                          </li>)}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* QA findings */}
      {qaFindings && qaFindings.length > 0 && (
        <div className="glass-card mb-4">
          <button
            onClick={() => setExpandedQA(v => !v)}
            className="w-full flex items-center gap-2 p-3 text-left text-xs"
          >
            {expandedQA
              ? <FiChevronDown className="w-3 h-3" />
              : <FiChevronRight className="w-3 h-3" />}
            <FiInfo className="w-3.5 h-3.5" />
            <span className="font-medium">Pre-submission QA</span>
            <span className="text-[var(--color-text-muted)]">
              ({qaBlockers}B / {qaWarnings}W / {qaFindings.length - qaBlockers - qaWarnings}i)
            </span>
          </button>
          {expandedQA && (
            <div className="px-3 pb-3 space-y-1 text-xs">
              {qaFindings.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={clsx('px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide flex-shrink-0 mt-0.5',
                    f.severity === 'blocker' && 'bg-red-500/30 text-red-200',
                    f.severity === 'warning' && 'bg-amber-500/30 text-amber-200',
                    f.severity === 'info' && 'bg-white/10 text-[var(--color-text-muted)]',
                  )}>
                    {f.severity}
                  </span>
                  <div className="flex-1">
                    <div className="font-mono text-[10px] text-[var(--color-text-muted)]">
                      {f.section} · {f.check}
                    </div>
                    <div>{f.message}</div>
                    {f.fix_hint && (
                      <div className="text-[var(--color-text-muted)] italic mt-0.5">
                        Fix: {f.fix_hint}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Paper body — journal-grade typography */}
      <article className="paper-body bg-white text-slate-900 rounded-md shadow-sm p-10 font-serif leading-relaxed">
        <header className="text-center mb-6 border-b border-slate-300 pb-4">
          <h1 className="text-2xl font-bold leading-tight mb-2">
            {paper.title || 'Untitled paper'}
          </h1>
          <div className="text-xs text-slate-500">
            {(paper.authors || ['Humanovo']).join(', ')}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">
            {paper.style} · draft
          </div>
        </header>

        {paper.abstract && (
          <section className="mb-6 bg-slate-50 border-l-4 border-slate-600 p-4">
            <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-700 mb-2">
              Abstract
            </h2>
            <p className="text-sm whitespace-pre-line">{paper.abstract}</p>
          </section>
        )}

        {/* TOC */}
        {toc.length > 3 && (
          <section className="mb-6 text-xs">
            <h2 className="uppercase tracking-wider font-semibold text-slate-700 mb-2">
              Contents
            </h2>
            <ol className="space-y-0.5 text-slate-700">
              {toc.filter(t => t.key !== 'abstract' && t.key !== 'title')
                  .map(t => (
                <li key={t.key} className="flex gap-2">
                  <span className="text-slate-400 tabular-nums w-8">
                    {t.number || ''}
                  </span>
                  <a href={`#sec-${t.key}`}
                     className="hover:underline text-slate-700">
                    {t.heading}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Sections */}
        {toc.filter(t => t.key !== 'abstract' && t.key !== 'title').map(t => (
          <section key={t.key} id={`sec-${t.key}`} className="mb-8">
            <h2 className="text-lg font-bold mb-2 border-b border-slate-200 pb-1">
              {t.number && <span className="text-slate-400 mr-2 font-normal tabular-nums">{t.number}</span>}
              {t.heading}
            </h2>
            <div className="text-[13.5px] whitespace-pre-line">
              {paper.sections[t.key] || <span className="text-slate-400 italic">
                (section body missing)
              </span>}
            </div>

            {/* Mermaid diagrams for this section */}
            {(mermaidBySection[t.key] || []).map((d, i) => (
              <figure key={`m-${i}`} className="my-4">
                {d.png_b64 ? (
                  <img src={`data:image/png;base64,${d.png_b64}`}
                       alt={d.title || 'Mermaid diagram'}
                       className="max-w-full mx-auto" />
                ) : (
                  <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-[10px] overflow-x-auto font-mono">
                    {d.source}
                  </pre>
                )}
                {d.title && (
                  <figcaption className="text-[10px] text-slate-500 text-center mt-1">
                    {d.title}
                  </figcaption>
                )}
              </figure>
            ))}

            {/* Figures for this section */}
            {(figuresBySection[t.key] || []).map((f, i) => (
              <figure key={`f-${i}`} className="my-4">
                {f.png_b64 ? (
                  <img src={`data:image/png;base64,${f.png_b64}`}
                       alt={f.title || 'Figure'}
                       className="max-w-full mx-auto" />
                ) : f.svg ? (
                  // SVG comes from the strict-paper backend pipeline.
                  // Even though we trust the source, we still sanitize
                  // before render so a compromised intermediate node
                  // (or a future change that lets user input flow into
                  // the SVG generator) can't ship script-bearing markup.
                  // SVG profile keeps <svg> + drawing primitives but
                  // strips <script>, on* handlers, javascript: URIs.
                  <div
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(f.svg, {
                        USE_PROFILES: { svg: true, svgFilters: true },
                      }),
                    }}
                    aria-label={f.title || 'Paper figure'}
                    role="img"
                    className="mx-auto max-w-full"
                  />
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 text-xs text-slate-500 italic text-center">
                    Figure placeholder: {f.figure_type}
                  </div>
                )}
                {f.title && (
                  <figcaption className="text-[10px] text-slate-500 text-center mt-1">
                    <strong>Figure.</strong> {f.title}
                    {f.caption && <span className="ml-1">— {f.caption}</span>}
                    {f.source === 'compute_engine' && (
                      <span className="ml-2 text-emerald-600">[compute engine]</span>
                    )}
                  </figcaption>
                )}
              </figure>
            ))}
          </section>
        ))}

        {/* References — journal-style numbered list */}
        {(paper.references || []).length > 0 && (
          <section className="mt-10 border-t border-slate-300 pt-4">
            <h2 className="text-lg font-bold mb-3">References</h2>
            <ol className="space-y-1.5 text-[11.5px] text-slate-700">
              {paper.references.map((r, i) => (
                <li key={i} className="flex gap-2 items-baseline">
                  <span className="tabular-nums text-slate-400 w-7 flex-shrink-0">
                    [{i + 1}]
                  </span>
                  <span>
                    {r.authors ? <span>{r.authors} </span> : null}
                    {r.year ? <span>({r.year}). </span> : null}
                    <em>{r.title || 'Untitled'}.</em>{' '}
                    {r.journal && <span>{r.journal}. </span>}
                    {r.doi && <a className="text-sky-700" href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer">
                      doi:{r.doi}
                    </a>}
                    {r.pmid && <span className="ml-2 text-slate-500">PMID: {r.pmid}</span>}
                    {r.verified === false && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[9px] rounded">
                        unverified{r.verdict ? ` · ${r.verdict}` : ''}
                      </span>
                    )}
                    {r.doi_status === 'no_doi_declared' && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[9px] rounded">
                        no DOI declared
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>

      {/* Metadata footer */}
      <div className="mt-4 text-[10px] text-[var(--color-text-muted)] flex gap-4 flex-wrap">
        {Object.entries(paper.metadata || {}).slice(0, 10).map(([k, v]) => (
          <span key={k}>
            <span className="opacity-60">{k}:</span>{' '}
            <span className="text-[var(--color-text)]">{String(v)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Pill({ children, ok, warn, bad }: any) {
  return (
    <span className={clsx(
      'px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium',
      ok && 'bg-emerald-500/25 text-emerald-200',
      warn && 'bg-amber-500/25 text-amber-200',
      bad && 'bg-red-500/25 text-red-200',
      !ok && !warn && !bad && 'bg-white/10 text-[var(--color-text)]',
    )}>{children}</span>
  )
}

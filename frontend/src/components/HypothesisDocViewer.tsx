import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  FiArrowLeft, FiDownload, FiFileText, FiZoomIn, FiZoomOut,
  FiMaximize2, FiMinimize2, FiPrinter,
} from 'react-icons/fi'
import clsx from 'clsx'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HypothesisDocData {
  id: string
  title: string
  description: string
  mechanism?: string
  confidence: number
  tags?: string[]
  disease?: string
  discovery_type?: string
  model_used?: string
  created_at?: string
}

interface HypothesisDocViewerProps {
  hypothesis: HypothesisDocData
  /** Breadcrumb segments: [{label, onClick?}] */
  breadcrumbs?: { label: string; onClick?: () => void }[]
  onClose: () => void
  onGenerateResearchPaper?: () => void
  onExportPdf?: () => void
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10

function confidenceTier(c: number) {
  if (c >= 0.8) return { label: 'Very High', color: '#166534', bg: '#dcfce7' }
  if (c >= 0.7) return { label: 'High', color: '#166534', bg: '#dcfce7' }
  if (c >= 0.5) return { label: 'Moderate', color: '#854d0e', bg: '#fef9c3' }
  return { label: 'Preliminary', color: '#9a3412', bg: '#fed7aa' }
}

function formatDate(dateStr?: string): string {
  if (dateStr) {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch { /* fall through */ }
  }
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Escape HTML entities */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Convert plain text with line breaks into paragraphs */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(para => `<p>${esc(para.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

/* ------------------------------------------------------------------ */
/*  Build the document HTML                                            */
/* ------------------------------------------------------------------ */

function buildDocumentHtml(h: HypothesisDocData): string {
  const date = formatDate(h.created_at)
  const tier = confidenceTier(h.confidence)
  const confPct = (h.confidence * 100).toFixed(1)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(h.title)}</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a2e;
    line-height: 1.65;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 50px 60px;
    margin: 0 auto;
    background: #fff;
    position: relative;
  }

  /* ---- Cover page ---- */
  .cover {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 297mm;
    text-align: center;
    padding: 80px 60px;
  }
  .cover .doc-type {
    font-size: 13px;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 32px;
    font-weight: 500;
  }
  .cover h1 {
    font-size: 26px;
    font-weight: 700;
    line-height: 1.35;
    color: #111827;
    max-width: 600px;
    margin-bottom: 24px;
  }
  .cover .divider {
    width: 80px;
    height: 3px;
    background: #2563eb;
    margin: 0 auto 32px;
    border-radius: 2px;
  }
  .cover .meta-group {
    margin-bottom: 20px;
  }
  .cover .meta-label {
    font-size: 12px;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .cover .meta-value {
    font-size: 16px;
    font-weight: 600;
    color: #111827;
  }
  .cover .meta-sub {
    font-size: 14px;
    color: #6b7280;
  }
  .cover .confidence-badge {
    display: inline-block;
    padding: 6px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 700;
    margin-top: 8px;
  }
  .cover .prepared-by {
    margin-top: 48px;
  }
  .cover .prepared-by .meta-value {
    font-size: 15px;
  }
  .cover .date {
    color: #9ca3af;
    font-size: 13px;
    margin-top: 8px;
  }
  .cover .classification {
    display: inline-block;
    margin-top: 40px;
    padding: 8px 24px;
    border: 2px solid #ef4444;
    border-radius: 4px;
    color: #ef4444;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  /* ---- Content pages ---- */
  .content-page {
    page-break-before: always;
  }
  .content-page h2 {
    font-size: 20px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 6px;
    padding-bottom: 8px;
    border-bottom: 2px solid #e5e7eb;
  }
  .content-page h2 .section-num {
    color: #2563eb;
    margin-right: 8px;
  }
  .content-page h3 {
    font-size: 16px;
    font-weight: 600;
    color: #374151;
    margin-top: 24px;
    margin-bottom: 8px;
  }
  .content-page p {
    font-size: 14px;
    color: #374151;
    text-align: justify;
    margin-bottom: 12px;
  }
  .content-page .section {
    margin-bottom: 36px;
  }

  /* Mechanism box */
  .mechanism-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4px solid #2563eb;
    border-radius: 6px;
    padding: 20px 24px;
    margin: 16px 0;
  }
  .mechanism-box p {
    font-size: 13.5px;
    color: #334155;
    line-height: 1.7;
  }

  /* Confidence meter */
  .confidence-meter {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0;
  }
  .confidence-bar-bg {
    flex: 1;
    height: 12px;
    background: #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
  }
  .confidence-bar-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.3s;
  }
  .confidence-label {
    font-size: 18px;
    font-weight: 700;
    min-width: 60px;
    text-align: right;
  }

  /* Tags */
  .tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .tag {
    display: inline-block;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  /* Table */
  .info-table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 13px;
  }
  .info-table th {
    text-align: left;
    padding: 10px 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    color: #6b7280;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  .info-table td {
    padding: 10px 16px;
    border: 1px solid #e2e8f0;
    color: #374151;
  }

  /* Footer */
  .page-footer {
    position: absolute;
    bottom: 30px;
    left: 60px;
    right: 60px;
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #9ca3af;
    border-top: 1px solid #e5e7eb;
    padding-top: 12px;
  }

  @media print {
    .page { box-shadow: none; }
  }
</style>
</head>
<body>

<!-- ==================== COVER PAGE ==================== -->
<div class="page cover">
  <div class="doc-type">Biomedical Hypothesis Report</div>
  <h1>${esc(h.title)}</h1>
  <div class="divider"></div>

  ${h.disease ? `
  <div class="meta-group">
    <div class="meta-value">${esc(h.disease)}</div>
    <div class="meta-sub">${h.discovery_type ? esc(h.discovery_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : 'Research'} Strategy</div>
  </div>` : ''}

  <div class="meta-group">
    <div class="confidence-badge" style="background:${tier.bg};color:${tier.color}">
      ${confPct}% Confidence &mdash; ${tier.label}
    </div>
  </div>

  <div class="date">${date}</div>

  <div class="prepared-by">
    <div class="meta-label">Prepared by</div>
    <div class="meta-value">Humanovo AI Discovery Platform</div>
    ${h.model_used ? `<div class="meta-sub">Pipeline model: ${esc(h.model_used)}</div>` : ''}
  </div>

  <div class="classification">Research Use Only</div>

  <div class="page-footer">
    <span>Humanovo &mdash; AI-Powered Biomedical Discovery</span>
    <span>Page 1</span>
  </div>
</div>

<!-- ==================== CONTENT PAGES ==================== -->
<div class="page content-page">

  <!-- Section 1: Executive Summary -->
  ${h.description ? `
  <div class="section">
    <h2><span class="section-num">1</span>Executive Summary</h2>
    ${textToHtml(h.description)}
  </div>` : ''}

  <!-- Section 2: Mechanism of Action -->
  ${h.mechanism ? `
  <div class="section">
    <h2><span class="section-num">${h.description ? '2' : '1'}</span>Mechanism of Action</h2>
    <div class="mechanism-box">
      ${textToHtml(h.mechanism)}
    </div>
  </div>` : ''}

  <!-- Section: Confidence Analysis -->
  <div class="section">
    <h2><span class="section-num">${(h.description ? 2 : 1) + (h.mechanism ? 1 : 0) + 1}</span>Confidence Analysis</h2>
    <p>This hypothesis has been assigned a confidence score of <strong>${confPct}%</strong>,
    placing it in the <strong>${tier.label.toLowerCase()}</strong> confidence tier.</p>

    <div class="confidence-meter">
      <div class="confidence-bar-bg">
        <div class="confidence-bar-fill" style="width:${confPct}%;background:${h.confidence >= 0.7 ? '#22c55e' : h.confidence >= 0.5 ? '#eab308' : '#f97316'}"></div>
      </div>
      <div class="confidence-label" style="color:${h.confidence >= 0.7 ? '#16a34a' : h.confidence >= 0.5 ? '#ca8a04' : '#ea580c'}">${confPct}%</div>
    </div>

    <p>${h.confidence >= 0.7
      ? 'This confidence level indicates strong supporting evidence from the discovery pipeline. The hypothesis has passed multiple validation stages including counter-argument analysis, mechanism verification, and evidence grounding.'
      : h.confidence >= 0.5
      ? 'This moderate confidence level suggests promising initial evidence but recommends further experimental validation and literature corroboration before advancing to preclinical stages.'
      : 'This preliminary confidence level indicates the hypothesis warrants further investigation. Additional evidence gathering and mechanism validation are recommended.'}</p>
  </div>

  <!-- Section: Metadata -->
  <div class="section">
    <h2><span class="section-num">${(h.description ? 2 : 1) + (h.mechanism ? 1 : 0) + 2}</span>Classification & Metadata</h2>
    <table class="info-table">
      <tbody>
        ${h.disease ? `<tr><th>Disease Focus</th><td>${esc(h.disease)}</td></tr>` : ''}
        ${h.discovery_type ? `<tr><th>Discovery Type</th><td>${esc(h.discovery_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</td></tr>` : ''}
        ${h.model_used ? `<tr><th>AI Model</th><td>${esc(h.model_used)}</td></tr>` : ''}
        <tr><th>Confidence Score</th><td>${confPct}% (${tier.label})</td></tr>
        <tr><th>Report Date</th><td>${date}</td></tr>
        <tr><th>Hypothesis ID</th><td style="font-family:monospace;font-size:12px">${esc(h.id)}</td></tr>
      </tbody>
    </table>

    ${h.tags && h.tags.length > 0 ? `
    <h3>Tags</h3>
    <div class="tags-container">
      ${h.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('\n      ')}
    </div>` : ''}
  </div>

  <div class="page-footer">
    <span>Humanovo &mdash; AI-Powered Biomedical Discovery</span>
    <span>Page 2</span>
  </div>
</div>

</body>
</html>`
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HypothesisDocViewer({
  hypothesis,
  breadcrumbs,
  onClose,
  onGenerateResearchPaper,
  onExportPdf,
}: HypothesisDocViewerProps) {
  const [zoom, setZoom] = useState(100)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const documentHtml = useMemo(() => buildDocumentHtml(hypothesis), [hypothesis])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false)
        else onClose()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); zoomIn() }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isFullscreen, onClose])

  const zoomIn = useCallback(() => setZoom(z => Math.min(z + ZOOM_STEP, ZOOM_MAX)), [])
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - ZOOM_STEP, ZOOM_MIN)), [])

  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(documentHtml)
      printWindow.document.close()
      printWindow.onload = () => {
        printWindow.print()
      }
    }
  }, [documentHtml])

  const handleExportPdf = useCallback(() => {
    if (onExportPdf) {
      onExportPdf()
    } else {
      // Fallback: print to PDF
      handlePrint()
    }
  }, [onExportPdf, handlePrint])

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex flex-col bg-secondary-900',
        isFullscreen ? 'fixed inset-0 z-50' : 'h-full'
      )}
    >
      {/* ---- Toolbar ---- */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary-800 border-b border-secondary-700 shrink-0">
        {/* Left: back + breadcrumbs */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white transition-colors shrink-0"
            title="Back"
          >
            <FiArrowLeft className="w-4 h-4" />
          </button>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="flex items-center gap-1.5 min-w-0">
                  {i > 0 && <span className="text-secondary-600">/</span>}
                  {b.onClick ? (
                    <button onClick={b.onClick} className="text-primary-400 hover:text-primary-300 truncate">
                      {b.label}
                    </button>
                  ) : (
                    <span className="text-secondary-400 truncate">{b.label}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          {!breadcrumbs && (
            <span className="text-sm text-white font-medium truncate">{hypothesis.title}</span>
          )}
        </div>

        {/* Center: zoom controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={zoomOut}
            disabled={zoom <= ZOOM_MIN}
            className="p-1 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white disabled:opacity-30 transition-colors"
            title="Zoom out"
          >
            <FiZoomOut className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-24 h-1 accent-primary-500 cursor-pointer"
          />
          <span className="text-xs text-secondary-300 w-10 text-center font-mono">{zoom}%</span>
          <button
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX}
            className="p-1 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white disabled:opacity-30 transition-colors"
            title="Zoom in"
          >
            <FiZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onGenerateResearchPaper && (
            <button
              onClick={onGenerateResearchPaper}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-xs font-medium transition-colors"
              title="Generate Research Paper"
            >
              <FiFileText className="w-3.5 h-3.5" />
              Generate Paper
            </button>
          )}
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 text-xs font-medium transition-colors"
            title="Export PDF"
          >
            <FiDownload className="w-3.5 h-3.5" />
            Export PDF
          </button>
          <button
            onClick={handlePrint}
            className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white transition-colors"
            title="Print"
          >
            <FiPrinter className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ---- Document area ---- */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ background: '#4b5563' }}
      >
        <div
          className="py-8 px-4 flex justify-center"
          style={{ minHeight: '100%' }}
        >
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              width: '210mm',
              transition: 'transform 0.15s ease',
            }}
          >
            {/* Shadow wrapper around the pages */}
            <div
              style={{
                boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              <iframe
                srcDoc={documentHtml}
                title="Hypothesis Document"
                sandbox="allow-same-origin"
                style={{
                  width: '210mm',
                  minHeight: '594mm', /* 2 A4 pages */
                  border: 'none',
                  display: 'block',
                  background: '#fff',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

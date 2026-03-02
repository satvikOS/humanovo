import { useState, useCallback, useRef, useEffect } from 'react'
import {
  FiX, FiDownload, FiMaximize2, FiMinimize2, FiFileText,
  FiRefreshCw, FiChevronLeft, FiChevronRight,
} from 'react-icons/fi'
import clsx from 'clsx'

interface DocumentViewerProps {
  /** PDF blob URL or null */
  pdfUrl: string | null
  /** Optional HTML content for inline viewing */
  htmlContent?: string | null
  /** Title shown in the viewer header */
  title?: string
  /** Called when user closes the viewer */
  onClose: () => void
  /** Original filename for download */
  filename?: string
  /** Whether the document is currently generating */
  isGenerating?: boolean
  /** Generation progress message */
  progressMessage?: string
  /** Callback to trigger research paper generation (shown in topbar) */
  onGenerateResearchPaper?: () => void
}

/**
 * DocumentViewer — full-screen document viewer for research papers.
 *
 * Supports two modes:
 *  1. PDF mode: renders a PDF via <object>/<embed> with blob URL
 *  2. HTML mode: renders HTML content in a sandboxed iframe
 *
 * Features:
 *  - Fullscreen toggle
 *  - Download button
 *  - Loading state with progress indicator
 *  - Responsive layout that fills available space
 */
export default function DocumentViewer({
  pdfUrl,
  htmlContent,
  title = 'Research Paper',
  onClose,
  filename = 'humanovo-paper.pdf',
  isGenerating = false,
  progressMessage,
  onGenerateResearchPaper,
}: DocumentViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, onClose])

  const handleDownload = useCallback(() => {
    if (pdfUrl) {
      const a = document.createElement('a')
      a.href = pdfUrl
      a.download = filename
      a.click()
    } else if (htmlContent) {
      const blob = new Blob([htmlContent], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename.replace('.pdf', '.html')
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [pdfUrl, htmlContent, filename])

  const hasContent = pdfUrl || htmlContent
  const isLoading = isGenerating && !hasContent

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex flex-col bg-secondary-900 border border-secondary-700 rounded-lg overflow-hidden',
        isFullscreen
          ? 'fixed inset-0 z-50 rounded-none border-none'
          : 'h-full'
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-secondary-800 border-b border-secondary-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FiFileText className="w-4 h-4 text-primary-400 shrink-0" />
          <span className="text-sm font-medium text-white truncate">{title}</span>
          {isGenerating && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 shrink-0">
              <FiRefreshCw className="w-3 h-3 animate-spin" />
              {progressMessage || 'Generating...'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onGenerateResearchPaper && (
            <button
              onClick={onGenerateResearchPaper}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 text-xs font-medium transition-colors"
              title="Generate Research Paper"
            >
              {isGenerating ? (
                <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FiFileText className="w-3.5 h-3.5" />
              )}
              {isGenerating ? 'Generating...' : hasContent ? 'Regenerate' : 'Generate Research Paper'}
            </button>
          )}
          {hasContent && (
            <button
              onClick={handleDownload}
              className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white transition-colors"
              title="Download"
            >
              <FiDownload className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary-700 text-secondary-400 hover:text-white transition-colors"
            title="Close"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative min-h-0">
        {isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="relative mb-6">
              <div className="w-16 h-16 border-4 border-secondary-700 border-t-primary-500 rounded-full animate-spin" />
              <FiFileText className="w-6 h-6 text-primary-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-white font-medium text-lg mb-1">Generating Research Paper</p>
            <p className="text-secondary-400 text-sm max-w-md text-center">
              {progressMessage || 'Running AI pipeline to generate your paper. This may take a moment...'}
            </p>
            <div className="mt-6 w-64">
              <div className="h-1.5 bg-secondary-700 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
          </div>
        ) : pdfUrl ? (
          <object
            data={pdfUrl}
            type="application/pdf"
            className="w-full h-full"
            title={title}
          >
            {/* Fallback for browsers that don't support object/embed for PDF */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <FiFileText className="w-12 h-12 text-secondary-600 mb-4" />
              <p className="text-white mb-2">PDF Preview Not Available</p>
              <p className="text-secondary-400 text-sm mb-4">Your browser doesn't support inline PDF viewing.</p>
              <button onClick={handleDownload} className="btn bg-primary-500 text-white hover:bg-primary-600">
                <FiDownload className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </object>
        ) : htmlContent ? (
          <iframe
            srcDoc={htmlContent}
            className="w-full h-full"
            title={title}
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <FiFileText className="w-12 h-12 text-secondary-600 mb-4" />
            <p className="text-secondary-400">No document to display</p>
          </div>
        )}
      </div>
    </div>
  )
}


// ============================================================================
// Inline Hypothesis Viewer — shows hypothesis details + paper side by side
// ============================================================================

interface HypothesisViewerProps {
  /** The hypothesis data */
  hypothesis: {
    id: string
    title: string
    description: string
    mechanism?: string
    confidence: number
    tags?: string[]
    disease?: string
    discovery_type?: string
    model_used?: string
  }
  /** PDF blob URL for the generated paper */
  pdfUrl?: string | null
  /** HTML content for the generated paper */
  htmlContent?: string | null
  /** Whether paper is currently generating */
  isGenerating?: boolean
  /** Callback to trigger paper generation */
  onGeneratePaper?: () => void
  /** Callback to close the viewer */
  onClose: () => void
}

/**
 * HypothesisViewer — split-view component showing hypothesis details
 * on the left and the generated research paper on the right.
 */
export function HypothesisViewer({
  hypothesis,
  pdfUrl,
  htmlContent,
  isGenerating,
  onGeneratePaper,
  onClose,
}: HypothesisViewerProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Left panel: Hypothesis details */}
      {!collapsed && (
        <div className="w-[400px] shrink-0 flex flex-col bg-secondary-900 border-r border-secondary-700 overflow-y-auto">
          <div className="p-5 space-y-5">
            {/* Header */}
            <div>
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-lg font-semibold text-white leading-tight pr-2">{hypothesis.title}</h2>
                <button onClick={onClose} className="p-1 rounded hover:bg-secondary-700 text-secondary-400 shrink-0">
                  <FiX className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={clsx(
                  'text-sm font-bold',
                  hypothesis.confidence >= 0.7 ? 'text-green-400' :
                  hypothesis.confidence >= 0.5 ? 'text-yellow-400' : 'text-orange-400'
                )}>
                  {(hypothesis.confidence * 100).toFixed(1)}% confidence
                </span>
                {hypothesis.disease && (
                  <span className="text-xs text-secondary-400 bg-secondary-800 px-2 py-0.5 rounded">
                    {hypothesis.disease}
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-xs text-secondary-500 uppercase tracking-wider mb-1">Description</h3>
              <p className="text-secondary-300 text-sm leading-relaxed">{hypothesis.description}</p>
            </div>

            {/* Mechanism */}
            {hypothesis.mechanism && (
              <div>
                <h3 className="text-xs text-secondary-500 uppercase tracking-wider mb-1">Mechanism of Action</h3>
                <p className="text-secondary-300 text-sm leading-relaxed">{hypothesis.mechanism}</p>
              </div>
            )}

            {/* Tags */}
            {hypothesis.tags && hypothesis.tags.length > 0 && (
              <div>
                <h3 className="text-xs text-secondary-500 uppercase tracking-wider mb-1">Tags</h3>
                <div className="flex flex-wrap gap-1">
                  {hypothesis.tags.map(tag => (
                    <span key={tag} className="badge badge-info text-xs">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Model info */}
            {hypothesis.model_used && (
              <div>
                <h3 className="text-xs text-secondary-500 uppercase tracking-wider mb-1">Model</h3>
                <p className="text-secondary-400 text-sm">{hypothesis.model_used}</p>
              </div>
            )}

            {/* Status indicator */}
            {isGenerating && (
              <div className="flex items-center gap-2 text-yellow-400 text-sm">
                <FiRefreshCw className="w-4 h-4 animate-spin" />
                Generating research paper...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-5 shrink-0 flex items-center justify-center bg-secondary-800 hover:bg-secondary-700 border-r border-secondary-700 transition-colors"
        title={collapsed ? 'Show hypothesis' : 'Hide hypothesis'}
      >
        {collapsed ? <FiChevronRight className="w-3 h-3 text-secondary-400" /> : <FiChevronLeft className="w-3 h-3 text-secondary-400" />}
      </button>

      {/* Right panel: Document viewer */}
      <div className="flex-1 min-w-0">
        <DocumentViewer
          pdfUrl={pdfUrl || null}
          htmlContent={htmlContent}
          title={`Research Paper: ${hypothesis.title}`}
          onClose={onClose}
          filename={`humanovo-${hypothesis.title.replace(/\s+/g, '-').toLowerCase().slice(0, 50)}.pdf`}
          isGenerating={isGenerating}
          progressMessage={isGenerating ? 'Running document pipeline...' : undefined}
          onGenerateResearchPaper={onGeneratePaper}
        />
      </div>
    </div>
  )
}

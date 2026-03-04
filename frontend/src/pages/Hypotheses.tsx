import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FiZap, FiCheck, FiAlertTriangle, FiClock, FiDownload, FiRefreshCw } from 'react-icons/fi'
import { api, Hypothesis } from '../services/api'
import clsx from 'clsx'

function HypothesisCard({ hypothesis }: { hypothesis: Hypothesis }) {
  const [exporting, setExporting] = useState(false)

  const statusConfig = {
    draft: { icon: FiClock, color: 'text-secondary-400', bg: 'bg-secondary-600/20' },
    generating: { icon: FiClock, color: 'text-yellow-400', bg: 'bg-yellow-600/20' },
    active: { icon: FiZap, color: 'text-blue-400', bg: 'bg-blue-600/20' },
    validated: { icon: FiCheck, color: 'text-green-400', bg: 'bg-green-600/20' },
    rejected: { icon: FiAlertTriangle, color: 'text-red-400', bg: 'bg-red-600/20' },
    archived: { icon: FiClock, color: 'text-secondary-400', bg: 'bg-secondary-600/20' },
  }

  const status = statusConfig[hypothesis.status] || statusConfig.draft
  const StatusIcon = status.icon

  const handleExportPdf = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setExporting(true)
    try {
      const blob = await api.generateHypothesisPdf(hypothesis.id, true)
      if (blob.size === 0) {
        alert('PDF generation returned empty result. Please try again.')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `humanovo-hypothesis-${hypothesis.id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('PDF export failed. Please try again or open the hypothesis detail page.')
    } finally {
      setExporting(false)
    }
  }, [hypothesis.id])

  return (
    <Link
      to={`/hypotheses/${hypothesis.id}`}
      className="card hover:border-primary-600/50 transition-colors"
    >
      <div className="flex items-start space-x-4">
        <div className={clsx('p-2 rounded-lg', status.bg)}>
          <StatusIcon className={clsx('w-5 h-5', status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium line-clamp-2">{hypothesis.statement}</p>
          {hypothesis.mechanism && (
            <p className="text-secondary-400 text-sm mt-1 line-clamp-1">
              {hypothesis.mechanism}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <span className={clsx('badge', {
            'badge-success': hypothesis.status === 'validated',
            'badge-warning': hypothesis.status === 'generating',
            'badge-error': hypothesis.status === 'rejected',
            'badge-info': hypothesis.status === 'active',
          })}>
            {hypothesis.status}
          </span>
          <span className="text-secondary-400 text-sm">
            {Math.round(hypothesis.confidence_score * 100)}% confidence
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
            title="Export as PDF"
          >
            {exporting ? (
              <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FiDownload className="w-3.5 h-3.5" />
            )}
            {exporting ? 'Exporting...' : 'PDF'}
          </button>
          <span className="text-secondary-500 text-xs">
            v{hypothesis.version}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center space-x-4 text-sm">
        <span className="text-green-400">
          {hypothesis.supporting_count} supporting
        </span>
        <span className="text-red-400">
          {hypothesis.contradiction_count} contradicting
        </span>
      </div>
    </Link>
  )
}

export default function Hypotheses() {
  const { data, isLoading } = useQuery({
    queryKey: ['hypotheses'],
    queryFn: () => api.getHypotheses({ page: 1, page_size: 50 }),
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Hypotheses</h1>
          <p className="text-secondary-400 mt-1">AI-generated biomedical hypotheses</p>
        </div>
        <button className="btn btn-primary flex items-center space-x-2">
          <FiZap className="w-4 h-4" />
          <span>Generate New</span>
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-secondary-800 h-32 rounded-lg" />
          ))}
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <div className="space-y-4">
          {data.items.map((hypothesis) => (
            <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <FiZap className="w-12 h-12 text-secondary-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No hypotheses yet</h3>
          <p className="text-secondary-400 mb-6">
            Generate your first AI-powered hypothesis
          </p>
          <button className="btn btn-primary">Generate Hypotheses</button>
        </div>
      )}
    </div>
  )
}

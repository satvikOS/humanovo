/**
 * HypothesisReview — Full hypothesis detail page per Jamison spec Section 14.4
 * Sections: Header, Pipeline Trace, Mechanism, Evidence, Translational Roadmap, Version History, Feedback
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

const API = '/api'

interface HypothesisDetail {
  id: string
  title: string
  summary: string
  mechanism: string
  confidence_score: number | null
  novelty_score: number | null
  feasibility_score: number | null
  impact_score: number | null
  required_methods: string[]
  key_citations: Citation[]
  fda_references: Record<string, unknown>[] | null
  clinical_trial_refs: Record<string, unknown>[] | null
  counter_arguments: string[]
  revisions: string[]
  translational_roadmap: TranslationalRoadmap | null
  pipeline_trace: Record<string, StageTrace>
  round_number: number
  hypothesis_index: number
}

interface Citation {
  index: number
  title: string
  authors: string[]
  journal: string
  year: number
  doi: string | null
  pmid: string | null
  verified: boolean
}

/** Parse a raw citation (string or partial object) into a structured Citation */
function parseCitation(raw: unknown, idx: number): Citation {
  if (typeof raw === 'string') {
    // Parse formats like "Sica et al., Clin Pharmacokinet 2005" or "Author, Journal (2020)"
    const yearMatch = (raw as string).match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? parseInt(yearMatch[0]) : 0
    // Try to split on common delimiters
    const parts = (raw as string).split(/[,;]\s*/)
    const authors = parts.length > 0 ? [parts[0].trim()] : ['Unknown']
    const journal = parts.length > 1 ? parts.slice(1).join(', ').replace(/\s*\(?\d{4}\)?\s*\.?$/, '').trim() : ''
    return {
      index: idx + 1,
      title: raw as string,
      authors,
      journal,
      year,
      doi: null,
      pmid: null,
      verified: false,
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    return {
      index: (obj.index as number) ?? idx + 1,
      title: (obj.title as string) || (obj.finding as string) || String(obj),
      authors: Array.isArray(obj.authors) ? obj.authors as string[] : typeof obj.authors === 'string' ? [obj.authors] : ['Unknown'],
      journal: (obj.journal as string) || (obj.source as string) || '',
      year: (obj.year as number) || 0,
      doi: (obj.doi as string) || null,
      pmid: (obj.pmid as string) || null,
      verified: (obj.verified as boolean) || false,
    }
  }
  return { index: idx + 1, title: String(raw), authors: ['Unknown'], journal: '', year: 0, doi: null, pmid: null, verified: false }
}

interface StageTrace {
  model: string
  duration_seconds: number
  tokens_in: number
  tokens_out: number
  grounding_ratio?: number
  output?: string
}

interface TranslationalRoadmap {
  T0?: { description: string; timeline: string; risks: string[] }
  T1?: { description: string; timeline: string; risks: string[] }
  T2?: { description: string; timeline: string; risks: string[] }
  T3?: { description: string; timeline: string; risks: string[] }
  T4?: { description: string; timeline: string; risks: string[] }
  T5?: { description: string; timeline: string; risks: string[] }
}

const FEEDBACK_DIMENSIONS = ['scientific_rigor', 'novelty', 'feasibility', 'clinical_relevance', 'evidence_quality', 'mechanism_clarity'] as const

export default function HypothesisReview() {
  const { projectId, hypothesisId } = useParams<{ projectId: string; hypothesisId: string }>()
  const [hyp, setHyp] = useState<HypothesisDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)

  // Feedback state
  const [overallQuality, setOverallQuality] = useState(3)
  const [dimensions, setDimensions] = useState<Record<string, number>>(
    Object.fromEntries(FEEDBACK_DIMENSIONS.map(d => [d, 3]))
  )
  const [freeText, setFreeText] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)

  useEffect(() => {
    if (!projectId || !hypothesisId) return
    setLoading(true)
    fetch(`${API}/v1/projects/${projectId}/hypotheses/${hypothesisId}`)
      .then(r => r.json())
      .then(data => { setHyp(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId, hypothesisId])

  const submitFeedback = async () => {
    if (!hypothesisId) return
    setSubmittingFeedback(true)
    try {
      await fetch(`${API}/v1/hypotheses/${hypothesisId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overall_quality: overallQuality,
          dimension_scores: dimensions,
          free_text: freeText || null,
        }),
      })
      setFeedbackSent(true)
    } finally {
      setSubmittingFeedback(false)
    }
  }

  const generatePaper = async () => {
    if (!hypothesisId) return
    try {
      const res = await fetch(`${API}/v1/hypotheses/${hypothesisId}/generate-paper`, { method: 'POST' })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `hypothesis-${hypothesisId}.docx`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch { /* silent */ }
  }

  if (loading) return <div className="p-8 animate-pulse" style={{ color: 'var(--color-text-muted)' }}>Loading hypothesis...</div>
  if (!hyp) return <div className="p-8" style={{ color: 'var(--color-text-muted)' }}>Hypothesis not found</div>

  const scoreColor = (s: number | null) => s == null ? '#6b7280' : s >= 0.8 ? '#22c55e' : s >= 0.5 ? '#eab308' : '#ef4444'
  const feasLabel = (s: number | null) => s == null ? 'Unknown' : s >= 0.8 ? 'Feasible' : s >= 0.3 ? 'Partially feasible' : 'Not feasible'

  const STAGES = ['SEED', 'EXPAND', 'EVIDENCE', 'COUNTER', 'REVISE', 'MECHANISM', 'VALIDATE', 'GROUND', 'SCORE', 'REFINE', 'TRANSLATE']

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Section 1: Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>{hyp.title}</h1>
        <div className="flex flex-wrap gap-3 mb-3">
          <ScorePill label="Confidence" score={hyp.confidence_score} />
          <ScorePill label="Novelty" score={hyp.novelty_score} />
          <ScorePill label="Feasibility" score={hyp.feasibility_score} />
          <ScorePill label="Impact" score={hyp.impact_score} />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: `${scoreColor(hyp.feasibility_score)}20`, color: scoreColor(hyp.feasibility_score) }}>
            {feasLabel(hyp.feasibility_score)}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Round {hyp.round_number}</span>
        </div>
        {hyp.required_methods?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {hyp.required_methods.map(m => (
              <span key={m} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>{m}</span>
            ))}
          </div>
        )}
        <p className="text-sm mt-3" style={{ color: 'var(--color-text-muted)' }}>{hyp.summary}</p>
      </div>

      {/* Section 2: Pipeline Trace Accordion */}
      <Section title="Pipeline Trace">
        <div className="space-y-1">
          {STAGES.map(stage => {
            const t = hyp.pipeline_trace?.[stage]
            if (!t) return (
              <div key={stage} className="px-3 py-2 text-xs rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                {stage} — no data
              </div>
            )
            return (
              <div key={stage}>
                <button onClick={() => setExpandedStage(expandedStage === stage ? null : stage)}
                  className="w-full text-left px-3 py-2 text-sm rounded flex items-center justify-between"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                  <span className="font-mono text-xs font-medium">{stage}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t.model} &middot; {t.duration_seconds?.toFixed(1)}s &middot; {t.tokens_in + t.tokens_out} tokens
                    {t.grounding_ratio != null ? ` · GR:${(t.grounding_ratio * 100).toFixed(0)}%` : ''}
                  </span>
                </button>
                {expandedStage === stage && t.output && (
                  <pre className="px-3 py-2 text-xs whitespace-pre-wrap overflow-auto max-h-60"
                    style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', borderLeft: '2px solid var(--color-accent-blue)' }}>
                    {t.output}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Section 3: Mechanism */}
      {hyp.mechanism && (
        <Section title="Mechanism">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{hyp.mechanism}</p>
        </Section>
      )}

      {/* Section 4: Evidence */}
      <Section title="Evidence">
        {hyp.key_citations?.length > 0 ? (
          <div className="space-y-2">
            {hyp.key_citations.map((raw, i) => {
              const c = parseCitation(raw, i)
              return (
                <div key={i} className="text-sm p-2 rounded" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono shrink-0 px-1.5 py-0.5 rounded" style={{ background: 'var(--color-accent-blue)', color: '#fff' }}>[{c.index}]</span>
                    <div>
                      <p className="font-medium" style={{ color: 'var(--color-text)' }}>{c.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {c.authors?.slice(0, 3).join(', ')}{c.authors?.length > 3 ? ' et al.' : ''}{c.journal ? ` \u00B7 ${c.journal}` : ''}{c.year ? ` (${c.year})` : ''}
                        {c.verified && <span className="ml-1 text-green-500">verified</span>}
                      </p>
                      {c.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}`} target="_blank" rel="noreferrer" className="text-xs" style={{ color: 'var(--color-accent-blue)' }}>PubMed</a>}
                      {c.doi && <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer" className="text-xs ml-2" style={{ color: 'var(--color-accent-blue)' }}>DOI</a>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No citations available</p>
        )}
      </Section>

      {/* Section 5: Translational Roadmap */}
      {hyp.translational_roadmap && (
        <Section title="Translational Roadmap">
          <div className="flex gap-1 overflow-x-auto pb-2">
            {(['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const).map(stage => {
              const data = hyp.translational_roadmap?.[stage]
              return (
                <div key={stage} className="min-w-[160px] flex-1 rounded-lg p-3"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <div className="text-xs font-mono font-bold mb-1" style={{ color: 'var(--color-accent-blue)' }}>{stage}</div>
                  {data ? (
                    <>
                      <p className="text-xs" style={{ color: 'var(--color-text)' }}>{data.description}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{data.timeline}</p>
                    </>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>-</p>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Section 6: Version History (Counter + Revise) */}
      {(hyp.counter_arguments?.length > 0 || hyp.revisions?.length > 0) && (
        <Section title="Version History">
          {hyp.counter_arguments?.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-muted)' }}>Counter-Arguments</h4>
              <ul className="space-y-1">
                {hyp.counter_arguments.map((c, i) => (
                  <li key={i} className="text-sm pl-3" style={{ color: '#ef4444', borderLeft: '2px solid #ef4444' }}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {hyp.revisions?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-muted)' }}>Revisions</h4>
              <ul className="space-y-1">
                {hyp.revisions.map((r, i) => (
                  <li key={i} className="text-sm pl-3" style={{ color: '#22c55e', borderLeft: '2px solid #22c55e' }}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Section 7: Paper Generation */}
      <Section title="Paper Generation">
        <button onClick={generatePaper} className="px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'var(--color-accent-blue)' }}>
          Generate Paper (.docx)
        </button>
      </Section>

      {/* Section 8: Feedback Form */}
      <Section title="Feedback">
        {feedbackSent ? (
          <p className="text-sm" style={{ color: '#22c55e' }}>Feedback submitted. Thank you!</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Overall Quality</label>
              <div className="flex gap-1 mt-1">
                {[1, 2, 3, 4, 5].map(v => (
                  <button key={v} onClick={() => setOverallQuality(v)}
                    className="w-8 h-8 rounded text-sm font-medium"
                    style={{ background: overallQuality >= v ? 'var(--color-accent-blue)' : 'var(--color-bg-secondary)', color: overallQuality >= v ? '#fff' : 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {FEEDBACK_DIMENSIONS.map(dim => (
              <div key={dim}>
                <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{dim.replace(/_/g, ' ')}</label>
                <input type="range" min={1} max={5} step={0.5} value={dimensions[dim]}
                  onChange={e => setDimensions(prev => ({ ...prev, [dim]: Number(e.target.value) }))}
                  className="w-full" />
              </div>
            ))}

            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Comments</label>
              <textarea value={freeText} onChange={e => setFreeText(e.target.value)} rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm mt-1"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </div>

            <button onClick={submitFeedback} disabled={submittingFeedback}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-accent-blue)', opacity: submittingFeedback ? 0.5 : 1 }}>
              {submittingFeedback ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </div>
  )
}

function ScorePill({ label, score }: { label: string; score: number | null }) {
  const valid = score != null && Number.isFinite(score)
  const color = !valid ? '#6b7280' : score >= 0.8 ? '#22c55e' : score >= 0.5 ? '#eab308' : '#ef4444'
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="font-mono font-medium px-1.5 py-0.5 rounded" style={{ background: `${color}20`, color }}>
        {valid ? `${(score * 100).toFixed(0)}%` : 'N/A'}
      </span>
    </div>
  )
}

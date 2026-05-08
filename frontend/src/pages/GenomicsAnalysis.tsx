import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiActivity, FiPlay, FiUpload,
} from 'react-icons/fi'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
  AreaChart, Area,
} from 'recharts'

import { logActivity } from '../utils/persistence'
import { apiClient } from '../services'

type TabId = 'pathway' | 'gsea' | 'variants' | 'biomarkers'
const BASE = '/genomics'

// The four `_compute*` analytics helpers used to live inline here.
// They were exported alongside the default component, which broke
// react-refresh (eslint rule `react-refresh/only-export-components`).
// They now live in `./genomics/compute` and are imported directly from
// there by anything that needs them — currently nothing in app code.
// The leading `_` is the long-standing convention for "exported for
// tests, not for the app surface area".

// Enum-guard so `?tab=bogus` quietly falls back to "pathway" instead
// of contaminating TabId-typed state.
const VALID_GENOMICS_TABS = new Set<TabId>(['pathway', 'gsea', 'variants', 'biomarkers'])

export default function GenomicsAnalysis() {
  // Deep-link `?tab=<pathway|gsea|variants|biomarkers>` so dashboards
  // can jump straight into an analysis. The param is consumed on
  // mount so the URL stays canonical.
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<TabId>(() => {
    const qt = (searchParams.get('tab') || '') as TabId
    return VALID_GENOMICS_TABS.has(qt) ? qt : 'pathway'
  })
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('tab')) {
      sp.delete('tab')
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
     
  }, [])
  const [loading, setLoading] = useState(false)
  // Result is heterogeneous across the 4 analysis types (pathway / GSEA /
  // variants / biomarker). Tightening to a discriminated union here
  // requires locking the backend API contract first — Sprint 2 work.
  // For now `any` keeps the render path readable; consumer-side coercion
  // in the JSX is already defensive (?? fallbacks, `?.toFixed()`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const [genes, setGenes] = useState('')
  const [database, setDatabase] = useState('kegg')

  const [rankedGenes, setRankedGenes] = useState('')

  const [variants, setVariants] = useState('')

  const [biomarkerData, setBiomarkerData] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length === 0) return
      const firstRow = lines[0].split(',')
      const isHeader = firstRow.some(v => isNaN(parseFloat(v.trim())))
      const dataLines = isHeader ? lines.slice(1) : lines
      if (tab === 'pathway') {
        // Single column of gene names
        const allGenes = dataLines.flatMap(l => l.split(',').map(v => v.trim())).filter(Boolean)
        setGenes(allGenes.join(', '))
      } else if (tab === 'gsea') {
        // gene,score per line
        setRankedGenes(dataLines.join('\n'))
      } else if (tab === 'variants') {
        // gene,position,ref,alt per line
        setVariants(dataLines.join('\n'))
      } else if (tab === 'biomarkers') {
        setBiomarkerData(dataLines.join('\n'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const delimiter = file.name.endsWith('.tsv') ? '\t' : ','
      const lines = text.trim().split('\n')

      if (tab === 'pathway') {
        // Expect a list of genes, one per line or comma-separated
        const allGenes = lines.flatMap(l => l.split(delimiter).map(g => g.trim())).filter(Boolean)
        setGenes(allGenes.join(', '))
      } else if (tab === 'gsea') {
        // Expect gene,score per line
        const ranked = lines.map(l => {
          const parts = l.split(delimiter).map(v => v.trim())
          if (parts.length >= 2 && !isNaN(parseFloat(parts[1]))) return `${parts[0]},${parts[1]}`
          return null
        }).filter(Boolean).join('\n')
        setRankedGenes(ranked)
      } else if (tab === 'variants') {
        // Expect gene,position,ref,alt per line
        const vars = lines.map(l => {
          const parts = l.split(delimiter).map(v => v.trim())
          if (parts.length >= 4) return parts.slice(0, 4).join(',')
          return null
        }).filter(Boolean).join('\n')
        setVariants(vars)
      } else if (tab === 'biomarkers') {
        // Expect gene,group1val1,group1val2,...;group2val1,group2val2,...
        // Or CSV with gene, then values for group1 and group2 separated by a blank column or header
        const parsed = lines.filter(l => l.trim()).map(l => l.trim())
        setBiomarkerData(parsed.join('\n'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const run = async () => {
    setLoading(true); setError(''); setResult(null)
    try {
      let endpoint = ''
      let body: Record<string, unknown> = {}
      if (tab === 'pathway') {
        endpoint = '/pathway-analysis'
        body = { genes: genes.split(',').map(g => g.trim()).filter(Boolean), database }
      } else if (tab === 'gsea') {
        endpoint = '/gsea'
        body = { ranked_genes: rankedGenes.split('\n').filter(l => l.trim()).map(l => { const parts = l.split(','); return { gene: (parts[0] || '').trim(), score: parseFloat(parts[1]) || 0 } }), gene_set: database }
      } else if (tab === 'variants') {
        endpoint = '/variant-annotation'
        body = { variants: variants.split('\n').filter(l => l.trim()).map(l => { const parts = l.split(',').map(s => s.trim()); return { gene: parts[0] || '', position: parseInt(parts[1]) || 0, ref: parts[2] || '', alt: parts[3] || '' } }) }
      } else {
        endpoint = '/biomarker-discovery'
        body = { expression_data: biomarkerData.split('\n').filter(l => l.trim()).map(l => { const [gene, rest] = l.split(',', 2).map(s => s.trim()); const groups = (rest || '').split(';'); return { gene, group1_values: groups[0]?.split(',').map(Number) || [], group2_values: groups[1]?.split(',').map(Number) || [] } }) }
      }
      // Call backend API for all genomics computations
      const { data } = await apiClient.post(`${BASE}${endpoint}`, body)
      setResult(data)
      logActivity({ type: 'discovery', action: 'started', title: `Ran genomics analysis: ${tab}` })
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Analysis failed') } finally { setLoading(false) }
  }

  const tabs = [
    { id: 'pathway' as TabId, label: 'Pathway Enrichment' },
    { id: 'gsea' as TabId, label: 'GSEA' },
    { id: 'variants' as TabId, label: 'Variant Annotation' },
    { id: 'biomarkers' as TabId, label: 'Biomarker Discovery' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-semibold tracking-tight">Genomics / Omics Analysis</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Pathway analysis, GSEA, variant annotation, and biomarker discovery</p>
        <div className="flex gap-1 mt-3">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setResult(null); setError('') }}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === t.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)]'}`}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input */}
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-medium">Input</h3>
            <div className="flex items-center gap-2 mb-2">
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="btn text-xs flex items-center gap-1.5 text-[var(--color-text-muted)]">
                <FiUpload className="w-3.5 h-3.5" /> Upload CSV/TSV
              </button>
              <span className="text-xxs text-[var(--color-text-muted)]">or enter data manually below</span>
            </div>
            {tab === 'pathway' && (
              <>
                <div><label className="text-xs text-[var(--color-text-muted)] mb-1 block">Gene List (comma-separated)</label>
                  <textarea value={genes} onChange={e => setGenes(e.target.value)} rows={3} placeholder="e.g., TP53, BRCA1, EGFR, KRAS, PIK3CA, AKT1" className="input w-full text-xs font-mono resize-none" /></div>
                <select value={database} onChange={e => setDatabase(e.target.value)} className="input text-xs"><option value="kegg">KEGG</option><option value="reactome">Reactome</option></select>
              </>
            )}
            {tab === 'gsea' && (
              <div><label className="text-xs text-[var(--color-text-muted)] mb-1 block">Ranked genes (gene,score per line)</label>
                <textarea value={rankedGenes} onChange={e => setRankedGenes(e.target.value)} rows={6} placeholder={"e.g.,\nTP53,2.5\nBRCA1,1.8\nEGFR,1.5\nKRAS,-0.5"} className="input w-full text-xs font-mono resize-none" /></div>
            )}
            {tab === 'variants' && (
              <div><label className="text-xs text-[var(--color-text-muted)] mb-1 block">Variants (gene,position,ref,alt per line)</label>
                <textarea value={variants} onChange={e => setVariants(e.target.value)} rows={5} placeholder={"e.g.,\nTP53,7577539,G,A\nBRCA1,41276045,C,T"} className="input w-full text-xs font-mono resize-none" /></div>
            )}
            {tab === 'biomarkers' && (
              <div><label className="text-xs text-[var(--color-text-muted)] mb-1 block">Expression data (gene,group1vals;group2vals per line)</label>
                <textarea value={biomarkerData} onChange={e => setBiomarkerData(e.target.value)} rows={6} placeholder={"e.g.,\nTP53,2.1,3.5,1.8;5.6,7.2,6.1\nBRCA1,1.5,2.0;1.7,2.1"} className="input w-full text-xs font-mono resize-none" /></div>
            )}
            <div className="flex gap-2">
              <button onClick={run} disabled={loading} className="btn text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><FiPlay className="w-3.5 h-3.5" /> {loading ? 'Running...' : 'Run Analysis'}</button>
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={handleCSVUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="btn text-xs flex items-center gap-1.5 text-[var(--color-text-muted)]"><FiUpload className="w-3.5 h-3.5" /> Upload CSV</button>
            </div>
          </div>

          {/* Results */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-medium mb-3">Results</h3>
            {error && <div className="text-xs text-[var(--color-error)] p-2 rounded bg-[var(--glass-bg)] mb-3">{error}</div>}
            {!result && !error && <div className="text-center py-12 text-[var(--color-text-muted)]"><FiActivity className="w-10 h-10 mx-auto mb-3 opacity-20" /><p className="text-xs">Run analysis to see results</p></div>}

            {result && tab === 'pathway' && (
              <div className="space-y-3">
                {(() => {
                  const pathways = result.results || result.pathways || []
                  const sigCount = result.significant_pathways ?? pathways.filter((p: { p_value: number }) => p.p_value < 0.05).length
                  const totalTested = result.pathways_tested ?? pathways.length
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{sigCount} significant pathways from {totalTested} tested</div>
                      {pathways.map((r: { pathway_id: string; pathway_name: string; p_value?: number; significant?: boolean; gene_count?: number; pathway_size?: number; overlap?: number; overlap_count?: number; matched_genes?: string[]; overlap_genes?: string[]; enrichment_score?: number; fold_enrichment?: number }) => (
                        <div key={r.pathway_id} className={`p-3 rounded-lg bg-[var(--glass-bg)] border ${(r.significant || (r.p_value ?? 1) < 0.05) ? 'border-[var(--color-border-strong)]' : 'border-[var(--glass-border)]'}`}>
                          <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.pathway_name}</span><span className="text-xxs font-mono">p={typeof r.p_value === 'number' ? r.p_value.toFixed(4) : r.p_value}</span></div>
                          <div className="text-xxs text-[var(--color-text-muted)] mt-1">
                            Overlap: {r.overlap_count || r.overlap || 0}/{r.pathway_size || r.gene_count || 0}
                            {r.fold_enrichment && ` | Fold: ${r.fold_enrichment}x`}
                            {r.enrichment_score && ` | Score: ${r.enrichment_score.toFixed(2)}`}
                          </div>
                          <div className="text-xxs text-[var(--color-text-muted)]">Genes: {(r.overlap_genes || r.matched_genes || []).join(', ')}</div>
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}

            {result && tab === 'gsea' && (
              <div className="space-y-3">
                {(() => {
                  const gseaResults = result.results || []
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{result.total_genes || result.n_genes || '?'} genes analyzed</div>
                      <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                        <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">ES</span> <span className="font-mono float-right">{result.enrichment_score?.toFixed(3) || '-'}</span></div>
                        <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">NES</span> <span className="font-mono float-right">{result.normalized_es?.toFixed(3) || '-'}</span></div>
                        <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">p-value</span> <span className="font-mono float-right">{result.p_value?.toFixed(4) || '-'}</span></div>
                        <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">FDR</span> <span className="font-mono float-right">{result.fdr?.toFixed(4) || '-'}</span></div>
                      </div>
                      {result.enrichment_plot && result.enrichment_plot.length > 0 && (
                        <div>
                          <p className="text-xs text-[var(--color-text-muted)] mb-2">Running Enrichment Score</p>
                          <ResponsiveContainer width="100%" height={180}>
                            <AreaChart data={result.enrichment_plot}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                              <XAxis dataKey="rank" name="Rank" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                                label={{ value: 'Gene Rank', position: 'insideBottom', offset: -5, style: { fontSize: 10, fill: 'var(--color-text-muted)' } }} />
                              <YAxis dataKey="running_es" name="Running ES" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                                label={{ value: 'ES', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--color-text-muted)' } }} />
                              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }}
                                formatter={(v) => [Number(v ?? 0).toFixed(4), 'ES']} />
                              <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeDasharray="4 4" />
                              <Area type="monotone" dataKey="running_es" stroke="#6BA594" fill="rgba(107,165,148,0.1)" strokeWidth={2} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {result.leading_edge_genes && (
                        <div className="text-xxs text-[var(--color-text-muted)]">Leading edge ({result.leading_edge_size} genes): {result.leading_edge_genes.join(', ')}</div>
                      )}
                      {gseaResults.map((r: { pathway_id?: string; gene_set?: string; pathway_name?: string; normalized_es?: number; hits?: number; leading_edge_size?: number; leading_edge_genes?: string[] }) => (
                        <div key={r.pathway_id || r.gene_set} className="p-3 rounded-lg bg-[var(--glass-bg)]">
                          <div className="text-xs font-medium">{r.pathway_name || r.gene_set}</div>
                          <div className="text-xxs text-[var(--color-text-muted)]">NES: {r.normalized_es} | Hits: {r.hits || r.leading_edge_size}</div>
                          <div className="text-xxs text-[var(--color-text-muted)]">Leading edge: {(r.leading_edge_genes || []).join(', ')}</div>
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}

            {result && tab === 'variants' && (
              <div className="space-y-2">
                {(() => {
                  const annotations = result.annotations || []
                  const nVariants = result.variants_annotated || result.n_variants || annotations.length
                  const highImpact = result.high_impact ?? result.summary?.high_impact ?? annotations.filter((a: { impact?: string }) => a.impact === 'HIGH').length
                  const pathogenic = result.pathogenic ?? result.summary?.pathogenic ?? annotations.filter((a: { clinical_significance?: string }) => a.clinical_significance === 'pathogenic').length
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{nVariants} annotated | {highImpact} high impact | {pathogenic} pathogenic</div>
                      {annotations.map((a: { gene?: string; position?: number; ref?: string; alt?: string; change?: string; impact?: string; consequence?: string; clinical_significance?: string; sift?: string; polyphen?: string; cadd_score?: number; gnomad_af?: number; allele_frequency?: number }, i: number) => (
                        <div key={i} className={`p-3 rounded-lg bg-[var(--glass-bg)] border ${a.impact === 'HIGH' ? 'border-red-500/30' : 'border-[var(--glass-border)]'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium font-mono">{a.change || `${a.gene}:${a.position} ${a.ref}>${a.alt}`}</span>
                            <span className={`text-xxs px-1.5 py-0.5 rounded ${a.impact === 'HIGH' ? 'bg-[var(--glass-bg)] text-[var(--color-text-muted)]' : a.impact === 'MODERATE' ? 'bg-[var(--glass-bg)] text-[var(--color-text-muted)]' : 'bg-[var(--glass-bg)]'}`}>{a.impact}</span>
                          </div>
                          <div className="text-xxs text-[var(--color-text-muted)] mt-1">{a.consequence} | {a.clinical_significance} | SIFT: {a.sift || '-'} | PolyPhen: {a.polyphen || '-'}</div>
                          {a.cadd_score !== undefined && <div className="text-xxs text-[var(--color-text-muted)]">CADD: {a.cadd_score?.toFixed(1)} | gnomAD AF: {a.gnomad_af?.toFixed(4) || a.allele_frequency || '-'}</div>}
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}

            {result && tab === 'biomarkers' && (
              <div className="space-y-3">
                {(() => {
                  const volcanoData = result.volcano_data || []
                  type VolcanoPoint = { gene?: string; significant?: boolean; x?: number; y?: number; log2_fold_change?: number; neg_log10_p?: number; p_value?: number }
                  const nSig = result.significant_biomarkers ?? result.n_significant ?? volcanoData.filter((d: VolcanoPoint) => d.significant).length
                  const nTotal = result.total_genes ?? result.n_genes ?? volcanoData.length
                  // Map data for scatter chart: x = log2FC, y = -log10(p)
                  const scatterData = volcanoData.map((d: VolcanoPoint) => ({
                    ...d,
                    x: d.x ?? d.log2_fold_change ?? 0,
                    y: d.y ?? d.neg_log10_p ?? (d.p_value ? -Math.log10(d.p_value) : 0),
                  }))
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{nSig} significant from {nTotal} genes</div>
                      {scatterData.length > 0 && (
                        <div>
                          <p className="text-xs text-[var(--color-text-muted)] mb-2">Volcano Plot — <span style={{ color: '#ef4444' }}>significant</span> vs <span style={{ color: 'var(--color-text)' }}>non-significant</span></p>
                          <ResponsiveContainer width="100%" height={280}>
                            <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                              <XAxis dataKey="x" name="log2FC" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                                label={{ value: 'log₂ Fold Change', position: 'insideBottom', offset: -5, style: { fontSize: 10, fill: 'var(--color-text-muted)' } }} />
                              <YAxis dataKey="y" name="-log10(p)" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }}
                                label={{ value: '-log₁₀(p-value)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--color-text-muted)' } }} />
                              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }}
                                formatter={(value, name) => [Number(value ?? 0).toFixed(3), String(name) === 'x' ? 'log₂FC' : '-log₁₀(p)']}
                                labelFormatter={(_, payload) => payload?.[0]?.payload?.gene || ''} />
                              {/* Significance thresholds */}
                              <ReferenceLine y={-Math.log10(0.05)} stroke="#C4956A" strokeDasharray="6 3" strokeWidth={1}
                                label={{ value: 'p=0.05', position: 'insideTopRight', style: { fontSize: 9, fill: '#C4956A' } }} />
                              <ReferenceLine x={-1} stroke="#666" strokeDasharray="4 4" strokeWidth={0.5} />
                              <ReferenceLine x={1} stroke="#666" strokeDasharray="4 4" strokeWidth={0.5} />
                              <Scatter data={scatterData} fill="var(--color-text)">
                                {scatterData.map((d: VolcanoPoint, i: number) => (
                                  <Cell key={i} fill={d.significant ? ((d.x ?? 0) > 0 ? '#B07E8B' : '#5B8DB8') : 'rgba(107,114,128,0.4)'} r={d.significant ? 5 : 3} />
                                ))}
                              </Scatter>
                            </ScatterChart>
                          </ResponsiveContainer>
                          <div className="flex items-center justify-center gap-4 text-xxs text-[var(--color-text-muted)] mt-1">
                            <span><span style={{ color: '#B07E8B' }}>●</span> Upregulated</span>
                            <span><span style={{ color: '#5B8DB8' }}>●</span> Downregulated</span>
                            <span><span style={{ color: 'rgba(107,114,128,0.4)' }}>●</span> Non-significant</span>
                            <span><span style={{ color: '#C4956A' }}>---</span> p=0.05 threshold</span>
                          </div>
                        </div>
                      )}
                      {/* Show top significant genes */}
                      {(result.top_upregulated || result.top_downregulated || result.results?.filter((r: { significant?: boolean }) => r.significant)) && (
                        <div className="space-y-2">
                          {(result.top_upregulated || []).map((r: { gene?: string; log2_fold_change?: number; p_value?: number }) => (
                            <div key={r.gene} className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-secondary)]">up</span></div>
                              <div className="text-xxs text-[var(--color-text-muted)]">log2FC: {r.log2_fold_change?.toFixed(3)} | p: {r.p_value?.toFixed(4)}</div>
                            </div>
                          ))}
                          {(result.top_downregulated || []).map((r: { gene?: string; log2_fold_change?: number; p_value?: number }) => (
                            <div key={r.gene} className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-secondary)]">down</span></div>
                              <div className="text-xxs text-[var(--color-text-muted)]">log2FC: {r.log2_fold_change?.toFixed(3)} | p: {r.p_value?.toFixed(4)}</div>
                            </div>
                          ))}
                          {(result.results?.filter((r: { significant?: boolean }) => r.significant) || []).map((r: { gene?: string; direction?: string; log2_fold_change?: number; p_value?: number }) => (
                            <div key={r.gene} className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className={`text-xxs px-1.5 py-0.5 rounded ${r.direction === 'up' ? 'bg-[var(--glass-bg)] text-[var(--color-text-secondary)]' : 'bg-[var(--glass-bg)] text-[var(--color-text-secondary)]'}`}>{r.direction === 'up' ? 'up' : 'down'}</span></div>
                              <div className="text-xxs text-[var(--color-text-muted)]">log2FC: {r.log2_fold_change} | p: {r.p_value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

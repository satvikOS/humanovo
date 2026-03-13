import { useState, useRef } from 'react'
import {
  FiActivity, FiPlay, FiUpload,
} from 'react-icons/fi'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

type TabId = 'pathway' | 'gsea' | 'variants' | 'biomarkers'
const API = '/api/v1/genomics'

export default function GenomicsAnalysis() {
  const [tab, setTab] = useState<TabId>('pathway')
  const [loading, setLoading] = useState(false)
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
      let endpoint = '', body: any = {}
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
      const res = await fetch(`${API}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Analysis failed')
      setResult(await res.json())
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
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
              <button onClick={run} disabled={loading} className="btn text-xs flex items-center gap-1.5" style={{ color: 'var(--color-accent-blue)' }}><FiPlay className="w-3.5 h-3.5" /> {loading ? 'Running...' : 'Run Analysis'}</button>
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
                <div className="text-xs text-[var(--color-text-muted)]">{result.significant_pathways} significant pathways from {result.pathways_tested} tested</div>
                {result.results?.map((r: any) => (
                  <div key={r.pathway_id} className={`p-3 rounded-lg ${r.significant ? 'bg-green-500/5 border border-green-500/20' : 'bg-[var(--glass-bg)]'}`}>
                    <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.pathway_name}</span><span className="text-xxs font-mono">p={r.p_value}</span></div>
                    <div className="text-xxs text-[var(--color-text-muted)] mt-1">Overlap: {r.overlap_count}/{r.pathway_size} | Fold: {r.fold_enrichment}x</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">Genes: {(r.overlap_genes || []).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}

            {result && tab === 'gsea' && (
              <div className="space-y-3">
                <div className="text-xs text-[var(--color-text-muted)]">{result.total_genes} genes, {result.gene_sets_tested} gene sets</div>
                {result.results?.map((r: any) => (
                  <div key={r.pathway_id} className="p-3 rounded-lg bg-[var(--glass-bg)]">
                    <div className="text-xs font-medium">{r.pathway_name}</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">NES: {r.normalized_es} | Hits: {r.hits}</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">Leading edge: {(r.leading_edge_genes || []).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}

            {result && tab === 'variants' && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--color-text-muted)]">{result.variants_annotated} annotated | {result.high_impact} high impact | {result.pathogenic} pathogenic</div>
                {result.annotations?.map((a: any, i: number) => (
                  <div key={i} className={`p-3 rounded-lg ${a.impact === 'HIGH' ? 'bg-red-500/5 border border-red-500/20' : a.impact === 'MODERATE' ? 'bg-yellow-500/5 border border-yellow-500/20' : 'bg-[var(--glass-bg)]'}`}>
                    <div className="flex items-center justify-between"><span className="text-xs font-medium font-mono">{a.change}</span><span className={`text-xxs px-1.5 py-0.5 rounded ${a.impact === 'HIGH' ? 'bg-red-500/10 text-red-400' : 'bg-[var(--glass-bg)]'}`}>{a.impact}</span></div>
                    <div className="text-xxs text-[var(--color-text-muted)] mt-1">{a.consequence} | {a.clinical_significance} | AF: {a.allele_frequency}</div>
                  </div>
                ))}
              </div>
            )}

            {result && tab === 'biomarkers' && (
              <div className="space-y-3">
                <div className="text-xs text-[var(--color-text-muted)]">{result.significant_biomarkers} significant from {result.total_genes} genes</div>
                {Array.isArray(result.volcano_data) && result.volcano_data.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">Volcano Plot</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="x" name="log2FC" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis dataKey="y" name="-log10(p)" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                        <Scatter data={result.volcano_data} fill="var(--color-accent-blue)">
                          {result.volcano_data.map((d: any, i: number) => <Cell key={i} fill={d.significant ? '#ef4444' : 'var(--color-accent-blue)'} />)}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {result.results?.filter((r: any) => r.significant).map((r: any) => (
                  <div key={r.gene} className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                    <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className={`text-xxs px-1.5 py-0.5 rounded ${r.direction === 'up' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{r.direction === 'up' ? '↑' : '↓'} {r.direction}</span></div>
                    <div className="text-xxs text-[var(--color-text-muted)]">log2FC: {r.log2_fold_change} | p: {r.p_value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

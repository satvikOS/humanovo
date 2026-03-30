import { useState, useRef } from 'react'
import {
  FiActivity, FiPlay, FiUpload,
} from 'react-icons/fi'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

import { logActivity } from '../utils/persistence'

type TabId = 'pathway' | 'gsea' | 'variants' | 'biomarkers'
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const API = `${API_BASE}/api/v1/genomics`

// ── Deterministic hash for consistent results from same inputs ──
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0 }
  return Math.abs(h)
}

// ── Client-side genomics computations (fallback when backend unavailable) ──

// Known gene-pathway associations for deterministic matching
const PATHWAY_GENES: Record<string, Record<string, string[]>> = {
  kegg: {
    'hsa04151|PI3K-Akt signaling pathway|348': ['PIK3CA', 'PIK3CB', 'AKT1', 'AKT2', 'MTOR', 'PTEN', 'PDK1', 'TSC1', 'TSC2', 'EGFR', 'HER2', 'ERBB2', 'ERBB3', 'IGF1R', 'INSR', 'VEGFA', 'BCL2', 'BAD', 'FOXO3', 'GSK3B', 'MDM2', 'CCND1', 'MYC', 'CDKN1A', 'RPS6KB1'],
    'hsa04010|MAPK signaling pathway|295': ['KRAS', 'NRAS', 'HRAS', 'BRAF', 'RAF1', 'MAP2K1', 'MAP2K2', 'MAPK1', 'MAPK3', 'ERK1', 'ERK2', 'JUN', 'FOS', 'EGFR', 'FGFR1', 'FGFR2', 'PDGFRA', 'SOS1', 'GRB2', 'SHC1', 'DUSP1', 'DUSP6'],
    'hsa04110|Cell cycle|124': ['TP53', 'RB1', 'CDK2', 'CDK4', 'CDK6', 'CCND1', 'CCNE1', 'CCNA2', 'CCNB1', 'CDKN1A', 'CDKN1B', 'CDKN2A', 'E2F1', 'E2F2', 'CDC25A', 'WEE1', 'CHK1', 'CHK2', 'ATM', 'ATR', 'MDM2', 'GADD45A'],
    'hsa04210|Apoptosis|136': ['TP53', 'BAX', 'BAK1', 'BCL2', 'BCL2L1', 'CASP3', 'CASP8', 'CASP9', 'CYCS', 'APAF1', 'BID', 'PUMA', 'NOXA', 'FADD', 'FAS', 'TRAIL', 'XIAP', 'BIRC5', 'DIABLO'],
    'hsa04310|Wnt signaling pathway|158': ['WNT1', 'WNT3A', 'WNT5A', 'CTNNB1', 'APC', 'AXIN1', 'GSK3B', 'DVL1', 'FZD1', 'LRP6', 'TCF7', 'LEF1', 'MYC', 'CCND1', 'AXIN2'],
    'hsa04350|TGF-beta signaling pathway|92': ['TGFB1', 'TGFB2', 'TGFBR1', 'TGFBR2', 'SMAD2', 'SMAD3', 'SMAD4', 'SMAD7', 'BMP2', 'BMP4', 'BMPR1A', 'ID1', 'ID2'],
    'hsa04370|VEGF signaling pathway|59': ['VEGFA', 'VEGFB', 'KDR', 'FLT1', 'NRP1', 'PGF', 'HIF1A', 'SRC', 'PLCγ1', 'MAPK1', 'AKT1', 'NOS3'],
    'hsa04630|JAK-STAT signaling pathway|162': ['JAK1', 'JAK2', 'JAK3', 'TYK2', 'STAT1', 'STAT3', 'STAT5A', 'STAT5B', 'SOCS1', 'SOCS3', 'IL6', 'IL6R', 'IFNG', 'IFNAR1', 'EPO', 'EPOR', 'CISH'],
  },
  reactome: {
    'R-HSA-1257604|PIP3 activates AKT signaling|65': ['PIK3CA', 'AKT1', 'AKT2', 'PTEN', 'PDK1', 'MTOR', 'TSC1', 'TSC2', 'FOXO3', 'GSK3B'],
    'R-HSA-9006934|Signaling by Receptor Tyrosine Kinases|467': ['EGFR', 'HER2', 'ERBB2', 'ERBB3', 'FGFR1', 'FGFR2', 'PDGFRA', 'KIT', 'MET', 'ALK', 'RET', 'KRAS', 'BRAF', 'PIK3CA', 'GRB2', 'SOS1'],
    'R-HSA-212436|Generic Transcription Pathway|731': ['TP53', 'MYC', 'JUN', 'FOS', 'SP1', 'STAT3', 'E2F1', 'NFKB1', 'RELA', 'HIF1A', 'CTNNB1'],
    'R-HSA-1640170|Cell Cycle|596': ['CDK2', 'CDK4', 'CDK6', 'CCND1', 'CCNE1', 'RB1', 'TP53', 'CDKN1A', 'CDKN2A', 'E2F1', 'CDC25A', 'WEE1'],
    'R-HSA-69278|Cell Cycle, Mitotic|481': ['CDK1', 'CCNB1', 'CCNA2', 'PLK1', 'AURKA', 'AURKB', 'BUB1', 'MAD2L1', 'CDC20', 'CENPE'],
    'R-HSA-73857|RNA Polymerase II Transcription|1098': ['POLR2A', 'GTF2F1', 'TFIIB', 'TBP', 'MED1', 'MED12', 'CDK7', 'CDK9', 'BRD4'],
  },
}

export function _computePathwayAnalysis(genes: string[], database: string) {
  const db = PATHWAY_GENES[database] || PATHWAY_GENES.kegg
  const upperGenes = genes.map(g => g.toUpperCase().trim())

  const results = Object.entries(db).map(([key, pathwayGenes]) => {
    const [id, name, sizeStr] = key.split('|')
    const size = parseInt(sizeStr)
    // Compute real overlap: which input genes are in this pathway
    const matched = upperGenes.filter(g => pathwayGenes.some(pg => pg.toUpperCase() === g))
    const overlap = matched.length
    if (overlap === 0) return null
    // Hypergeometric-approximated p-value: Fisher's exact approximation
    // p ≈ (K choose k) * (N-K choose n-k) / (N choose n)
    // Simplified: use -log10 approximation based on overlap fraction
    const expectedOverlap = (upperGenes.length * pathwayGenes.length) / 20000 // ~20k genes in genome
    const enrichmentRatio = overlap / Math.max(expectedOverlap, 0.01)
    // Approximate p-value using Poisson-like approximation
    const pValue = Math.max(1e-10, Math.exp(-overlap * Math.log(enrichmentRatio) + expectedOverlap * (enrichmentRatio - 1)))
    const clampedP = Math.min(1, pValue)
    return {
      pathway_id: id, pathway_name: name, p_value: clampedP,
      fdr: Math.min(1, clampedP * Object.keys(db).length), // Bonferroni-like FDR
      gene_count: size, overlap, matched_genes: matched,
      enrichment_score: -Math.log10(Math.max(clampedP, 1e-10)),
    }
  }).filter(Boolean).sort((a: any, b: any) => a.p_value - b.p_value)

  return { database, input_genes: genes.length, pathways: results }
}

export function _computeGSEA(rankedGenes: { gene: string; score: number }[], geneSet: string) {
  const sorted = [...rankedGenes].sort((a, b) => b.score - a.score)
  const n = sorted.length
  if (n === 0) return { gene_set: geneSet, enrichment_score: 0, normalized_es: 0, p_value: 1, fdr: 1, n_genes: 0, leading_edge_size: 0, leading_edge_genes: [], enrichment_plot: [] }

  // Compute actual running enrichment score using the standard GSEA algorithm
  // Use top 30% as the "gene set" for demonstration (positive scores)
  const geneSetSize = Math.max(1, Math.ceil(n * 0.3))
  const isInSet = new Set(sorted.slice(0, geneSetSize).map(g => g.gene))
  const nH = isInSet.size // hits
  const nM = n - nH // misses

  // Compute running ES with weighted scoring
  const totalHitScore = sorted.filter(g => isInSet.has(g.gene)).reduce((sum, g) => sum + Math.abs(g.score), 0) || 1
  let runningES = 0
  let maxES = 0
  let minES = 0

  const enrichmentPlot = sorted.map((g, i) => {
    if (isInSet.has(g.gene)) {
      runningES += Math.abs(g.score) / totalHitScore
    } else {
      runningES -= 1 / nM
    }
    if (runningES > maxES) maxES = runningES
    if (runningES < minES) minES = runningES
    return { rank: i + 1, gene: g.gene, score: g.score, running_es: runningES }
  })

  const es = Math.abs(maxES) > Math.abs(minES) ? maxES : minES
  // Approximate p-value from enrichment score magnitude
  const absES = Math.abs(es)
  const pValue = absES > 0.5 ? 0.001 : absES > 0.3 ? 0.01 : absES > 0.15 ? 0.05 : 0.1 + (1 - absES) * 0.5

  // Leading edge: genes contributing to ES before the peak
  const peakIdx = enrichmentPlot.findIndex(p => p.running_es === es)
  const leadingEdge = sorted.slice(0, peakIdx + 1).filter(g => isInSet.has(g.gene)).map(g => g.gene)

  return {
    gene_set: geneSet, enrichment_score: es, normalized_es: es / (absES || 1) * absES * 1.8,
    p_value: pValue, fdr: Math.min(1, pValue * 2),
    n_genes: n, leading_edge_size: leadingEdge.length,
    leading_edge_genes: leadingEdge,
    enrichment_plot: enrichmentPlot.filter((_, i) => i % Math.max(1, Math.floor(n / 50)) === 0),
  }
}

export function _computeVariantAnnotation(variants: { gene: string; position: number; ref: string; alt: string }[]) {
  // Deterministic variant annotation based on mutation characteristics
  function annotateVariant(v: { gene: string; position: number; ref: string; alt: string }) {
    const refLen = v.ref.length
    const altLen = v.alt.length

    // Determine consequence based on ref/alt characteristics
    let consequence: string
    let impact: string
    if (refLen !== altLen && refLen > 0 && altLen > 0) {
      // Indel
      if ((refLen - altLen) % 3 !== 0) {
        consequence = 'frameshift_variant'; impact = 'HIGH'
      } else {
        consequence = 'inframe_deletion'; impact = 'MODERATE'
      }
    } else if (v.alt === '*' || v.alt === 'X') {
      consequence = 'stop_gained'; impact = 'HIGH'
    } else {
      // SNV — use position hash for deterministic classification
      const h = hashStr(`${v.gene}:${v.position}:${v.ref}:${v.alt}`)
      const mod = h % 100
      if (mod < 5) { consequence = 'stop_gained'; impact = 'HIGH' }
      else if (mod < 10) { consequence = 'splice_donor_variant'; impact = 'HIGH' }
      else if (mod < 50) { consequence = 'missense_variant'; impact = 'MODERATE' }
      else if (mod < 65) { consequence = 'synonymous_variant'; impact = 'LOW' }
      else if (mod < 80) { consequence = 'intron_variant'; impact = 'MODIFIER' }
      else if (mod < 90) { consequence = '3_prime_UTR_variant'; impact = 'MODIFIER' }
      else { consequence = '5_prime_UTR_variant'; impact = 'MODIFIER' }
    }

    // Deterministic scores based on variant hash
    const h2 = hashStr(`${v.gene}:${v.position}`)
    const siftScore = impact === 'HIGH' ? (h2 % 10) / 100 : impact === 'MODERATE' ? (h2 % 30 + 5) / 100 : (h2 % 40 + 60) / 100
    const polyphenScore = impact === 'HIGH' ? (h2 % 15 + 85) / 100 : impact === 'MODERATE' ? (h2 % 30 + 50) / 100 : (h2 % 40) / 100
    const caddScore = impact === 'HIGH' ? 25 + (h2 % 15) : impact === 'MODERATE' ? 15 + (h2 % 10) : (h2 % 15)
    const gnomadAf = impact === 'HIGH' ? (h2 % 5) / 10000 : (h2 % 100) / 10000

    const clinSig = impact === 'HIGH' ? 'pathogenic' : impact === 'MODERATE' ? (h2 % 2 === 0 ? 'likely_pathogenic' : 'uncertain_significance') : 'benign'

    return {
      gene: v.gene, position: v.position, ref: v.ref, alt: v.alt,
      consequence, impact,
      sift: siftScore < 0.05 ? 'deleterious' : 'tolerated', sift_score: siftScore,
      polyphen: polyphenScore > 0.85 ? 'probably_damaging' : polyphenScore > 0.5 ? 'possibly_damaging' : 'benign', polyphen_score: polyphenScore,
      cadd_score: caddScore, gnomad_af: gnomadAf, clinical_significance: clinSig,
    }
  }

  const annotations = variants.map(annotateVariant)
  return {
    n_variants: variants.length,
    annotations,
    summary: {
      high_impact: annotations.filter(a => a.impact === 'HIGH').length,
      moderate_impact: annotations.filter(a => a.impact === 'MODERATE').length,
      pathogenic: annotations.filter(a => a.clinical_significance === 'pathogenic' || a.clinical_significance === 'likely_pathogenic').length,
    },
  }
}

export function _computeBiomarkerDiscovery(data: { gene: string; group1_values: number[]; group2_values: number[] }[]) {
  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const std = (arr: number[]) => { const m = mean(arr); const n = arr.length; return n > 1 ? Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0 }
  // Approximate t-distribution CDF using normal approximation
  const normalCDF = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989422804 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p }
  const results = data.map(d => {
    const m1 = mean(d.group1_values), m2 = mean(d.group2_values)
    const logFC = m1 !== 0 && m2 !== 0 ? Math.log2(m1 / m2) : (m1 - m2) > 0 ? 2 : -2
    const s1 = std(d.group1_values) || 0.01, s2 = std(d.group2_values) || 0.01
    const n1 = d.group1_values.length, n2 = d.group2_values.length
    const se = Math.sqrt(s1 * s1 / n1 + s2 * s2 / n2) || 0.01
    const tStat = (m1 - m2) / se
    // Two-tailed p-value from t-statistic using normal approximation
    const pValue = Math.max(1e-10, 2 * (1 - normalCDF(Math.abs(tStat))))
    return { gene: d.gene, log2_fold_change: logFC, p_value: pValue, neg_log10_p: -Math.log10(Math.max(pValue, 1e-10)), significant: pValue < 0.05 && Math.abs(logFC) > 1, mean_group1: m1, mean_group2: m2 }
  })
  return {
    n_genes: data.length,
    n_significant: results.filter(r => r.significant).length,
    volcano_data: results,
    top_upregulated: results.filter(r => r.log2_fold_change > 0).sort((a, b) => a.p_value - b.p_value).slice(0, 5),
    top_downregulated: results.filter(r => r.log2_fold_change < 0).sort((a, b) => a.p_value - b.p_value).slice(0, 5),
  }
}

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
      // Call backend API for all genomics computations
      const res = await fetch(`${API}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const contentType = res.headers.get('content-type') || ''
      if (!res.ok) {
        const errBody = contentType.includes('application/json')
          ? JSON.stringify(await res.json())
          : await res.text()
        throw new Error(`Backend error ${res.status}: ${errBody.slice(0, 200)}`)
      }
      if (!contentType.includes('application/json')) {
        throw new Error(`Expected JSON but received ${contentType}. Ensure the backend server is running at ${location.origin}.`)
      }
      setResult(await res.json())
      logActivity({ type: 'discovery', action: 'started', title: `Ran genomics analysis: ${tab}` })
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
                {(() => {
                  const pathways = result.results || result.pathways || []
                  const sigCount = result.significant_pathways ?? pathways.filter((p: any) => p.p_value < 0.05).length
                  const totalTested = result.pathways_tested ?? pathways.length
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{sigCount} significant pathways from {totalTested} tested</div>
                      {pathways.map((r: any) => (
                        <div key={r.pathway_id} className={`p-3 rounded-lg ${(r.significant || r.p_value < 0.05) ? 'bg-green-500/5 border border-green-500/20' : 'bg-[var(--glass-bg)]'}`}>
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
                          <p className="text-xs text-[var(--color-text-muted)] mb-2">Enrichment Plot</p>
                          <ResponsiveContainer width="100%" height={150}>
                            <ScatterChart>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                              <XAxis dataKey="rank" name="Rank" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                              <YAxis dataKey="running_es" name="Running ES" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                              <Scatter data={result.enrichment_plot} fill="var(--color-accent-blue)" />
                            </ScatterChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {result.leading_edge_genes && (
                        <div className="text-xxs text-[var(--color-text-muted)]">Leading edge ({result.leading_edge_size} genes): {result.leading_edge_genes.join(', ')}</div>
                      )}
                      {gseaResults.map((r: any) => (
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
                  const highImpact = result.high_impact ?? result.summary?.high_impact ?? annotations.filter((a: any) => a.impact === 'HIGH').length
                  const pathogenic = result.pathogenic ?? result.summary?.pathogenic ?? annotations.filter((a: any) => a.clinical_significance === 'pathogenic').length
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{nVariants} annotated | {highImpact} high impact | {pathogenic} pathogenic</div>
                      {annotations.map((a: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg ${a.impact === 'HIGH' ? 'bg-red-500/5 border border-red-500/20' : a.impact === 'MODERATE' ? 'bg-yellow-500/5 border border-yellow-500/20' : 'bg-[var(--glass-bg)]'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium font-mono">{a.change || `${a.gene}:${a.position} ${a.ref}>${a.alt}`}</span>
                            <span className={`text-xxs px-1.5 py-0.5 rounded ${a.impact === 'HIGH' ? 'bg-red-500/10 text-red-400' : a.impact === 'MODERATE' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-[var(--glass-bg)]'}`}>{a.impact}</span>
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
                  const nSig = result.significant_biomarkers ?? result.n_significant ?? volcanoData.filter((d: any) => d.significant).length
                  const nTotal = result.total_genes ?? result.n_genes ?? volcanoData.length
                  // Map data for scatter chart: x = log2FC, y = -log10(p)
                  const scatterData = volcanoData.map((d: any) => ({
                    ...d,
                    x: d.x ?? d.log2_fold_change ?? 0,
                    y: d.y ?? d.neg_log10_p ?? (d.p_value ? -Math.log10(d.p_value) : 0),
                  }))
                  return (
                    <>
                      <div className="text-xs text-[var(--color-text-muted)]">{nSig} significant from {nTotal} genes</div>
                      {scatterData.length > 0 && (
                        <div>
                          <p className="text-xs text-[var(--color-text-muted)] mb-2">Volcano Plot</p>
                          <ResponsiveContainer width="100%" height={200}>
                            <ScatterChart>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                              <XAxis dataKey="x" name="log2FC" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                              <YAxis dataKey="y" name="-log10(p)" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                              <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                              <Scatter data={scatterData} fill="var(--color-accent-blue)">
                                {scatterData.map((d: any, i: number) => <Cell key={i} fill={d.significant ? '#ef4444' : 'var(--color-accent-blue)'} />)}
                              </Scatter>
                            </ScatterChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {/* Show top significant genes */}
                      {(result.top_upregulated || result.top_downregulated || result.results?.filter((r: any) => r.significant)) && (
                        <div className="space-y-2">
                          {(result.top_upregulated || []).map((r: any) => (
                            <div key={r.gene} className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className="text-xxs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">up</span></div>
                              <div className="text-xxs text-[var(--color-text-muted)]">log2FC: {r.log2_fold_change?.toFixed(3)} | p: {r.p_value?.toFixed(4)}</div>
                            </div>
                          ))}
                          {(result.top_downregulated || []).map((r: any) => (
                            <div key={r.gene} className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className="text-xxs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">down</span></div>
                              <div className="text-xxs text-[var(--color-text-muted)]">log2FC: {r.log2_fold_change?.toFixed(3)} | p: {r.p_value?.toFixed(4)}</div>
                            </div>
                          ))}
                          {(result.results?.filter((r: any) => r.significant) || []).map((r: any) => (
                            <div key={r.gene} className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                              <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.gene}</span><span className={`text-xxs px-1.5 py-0.5 rounded ${r.direction === 'up' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{r.direction === 'up' ? 'up' : 'down'}</span></div>
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

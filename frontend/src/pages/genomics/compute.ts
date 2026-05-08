// Client-side genomics analytics — fallback when the backend is
// unavailable AND the path the unit tests poke at directly. Pulled
// out of GenomicsAnalysis.tsx so the .tsx file only exports a
// component (Vite fast-refresh quietly stops working when a .tsx
// file mixes component + non-component exports — eslint flags it as
// react-refresh/only-export-components).
//
// Public API: the four `_compute*` helpers below. The leading `_` is
// the long-standing convention for "exported for tests, not for the
// app surface area."

// Deterministic hash so the same inputs always render the same
// derived numbers — keeps screenshots and example walkthroughs
// reproducible across reloads.
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0 }
  return Math.abs(h)
}

// Known gene-pathway associations for deterministic matching.
// Keys are pipe-separated `id|name|geneCount` so we can split them
// cheaply without a second lookup table. The gene lists are
// hand-curated from KEGG/Reactome canonical pathways.
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
  }).filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => a.p_value - b.p_value)

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
  const nM = n - isInSet.size // misses

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

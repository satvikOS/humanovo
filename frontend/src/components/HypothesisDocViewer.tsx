import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  FiArrowLeft, FiDownload, FiFileText, FiZoomIn, FiZoomOut,
  FiMaximize2, FiMinimize2, FiPrinter,
} from 'react-icons/fi'
import clsx from 'clsx'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TranslationalPhaseDoc {
  phase: string
  phase_name: string
  formal_name: string
  description: string
  objectives?: string[]
  key_activities?: string[]
  milestones?: string[]
  deliverables?: string[]
  evidence_requirements?: string[]
  regulatory_considerations?: string[]
  regulatory_milestones?: string[]
  key_stakeholders?: string[]
  success_criteria?: string[]
  go_no_go_gates?: string[]
  phase_risks?: string[]
  mitigation_strategies?: string[]
  estimated_duration?: string
  resource_requirements?: string[]
  estimated_cost_range?: string
}

export interface TranslationalRoadmapDoc {
  current_phase: string
  phases: TranslationalPhaseDoc[]
  overall_feasibility_score: number
  estimated_total_timeline: string
  critical_path_summary: string
  key_decision_points?: string[]
  cross_phase_risks?: string[]
  regulatory_pathway_summary?: string
  commercialization_potential?: string
}

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
  translational_roadmap?: TranslationalRoadmapDoc
  // Extended pipeline signals — rendered in the short-communication layout
  dimension_scores?: Record<string, number | { score?: number; label?: string }>
  grounding_ratio?: number
  novelty_score?: number
  feasibility_score?: number
  target_entities?: string[]
  target_pathways?: string[]
  causal_chain?: Array<string | { event?: string; description?: string; level?: string; kind?: string; intervention?: unknown }>
  counter_arguments?: Array<{ argument?: string; severity?: string; rebuttal?: string }>
  evidence_summary?: Array<string | { finding?: string; pmid?: string; doi?: string; journal?: string }>
  key_citations?: Array<string | { pmid?: string; doi?: string; title?: string; authors?: string; year?: string | number }>
  risks?: string[]
  validation_steps?: string[]
  // Output of new Phase A additions
  evoe?: {
    evoe_usd?: number
    p_true?: number
    impact_if_true_usd?: number
    cost_to_test_usd?: number
    modality?: string
    verified_citation_ratio?: number
  }
  protocol?: {
    modality?: string
    sample_size_per_arm?: number
    duration_weeks_estimate?: number
    reagents_estimated_cost_usd?: number
    primary_endpoint?: { name?: string; metric?: string; effect_target?: number; timepoint?: string }
    go_no_go_criteria?: Array<{ criterion?: string; decision_if_met?: string; decision_if_not?: string }>
  }
  // Optional visual data URLs from the strict paper renderer
  figures?: Array<{ figure_type?: string; title?: string; caption?: string; png_b64?: string; svg?: string; section?: string }>
  mermaid_diagrams?: Array<{ title?: string; source?: string; png_b64?: string; section?: string }>
  citation_verdicts?: Array<{ stage: number; summary: Record<string, number>; n_citations: number }>
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
  if (c >= 0.8) return { label: 'Very High', color: '#1b4332', bg: '#d8f3dc' }
  if (c >= 0.7) return { label: 'High', color: '#1b4332', bg: '#d8f3dc' }
  if (c >= 0.5) return { label: 'Moderate', color: '#0077b6', bg: '#caf0f8' }
  return { label: 'Preliminary', color: '#7f1d1d', bg: '#fce4e4' }
}

function formatDocDate(dateStr?: string): string {
  if (dateStr) {
    try {
      const d = new Date(dateStr)
      if (!isNaN(d.getTime())) {
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${month}/${day}/${d.getFullYear()}`
      }
    } catch { /* fall through */ }
  }
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${month}/${day}/${d.getFullYear()}`
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
  /* =================================================================
   * SHORT-COMMUNICATION LAYOUT — matches Nature Communications /
   * Cell Reports / eLife short-communication style.
   *
   * Layout budget: 3–5 printed pages. Tight serif body, clear sans-
   * serif headers, single-column, inline figures, reference list
   * rendered in the journal-standard numbered-Vancouver style.
   * ================================================================= */

  const date = formatDocDate(h.created_at)
  const tier = confidenceTier(h.confidence)
  const confPct = (h.confidence * 100).toFixed(0)
  const disease = h.disease || '—'
  const dtype = (h.discovery_type || '').replace(/_/g, ' ') || 'Discovery'
  const tags = h.tags || []

  // Dimension-score extraction (accepts {score} or number)
  const dimVal = (k: string): number | undefined => {
    const v = h.dimension_scores?.[k]
    if (typeof v === 'number') return v
    if (v && typeof v === 'object' && typeof v.score === 'number') return v.score
    return undefined
  }
  const dims: Array<[string, number]> = [
    ['Plausibility',  dimVal('biological_plausibility') ?? 0],
    ['Evidence',      dimVal('evidence_strength')       ?? 0],
    ['Novelty',       dimVal('novelty')                 ?? h.novelty_score ?? 0],
    ['Feasibility',   dimVal('feasibility')             ?? h.feasibility_score ?? 0],
    ['Safety',        dimVal('safety')                  ?? 0],
    ['Clinical',      dimVal('clinical_relevance')      ?? 0],
    ['Reproducible',  dimVal('reproducibility')         ?? 0],
  ]
  const dimsFilled = dims.filter(([, v]) => v > 0)

  // Citations (numbered, ordered by first-appearance)
  const citations: Array<{ n: number; html: string }> = []
  const refMap = new Map<string, number>()
  type CitationObject = {
    doi?: string
    pmid?: string
    title?: string
    finding?: string
    authors?: string
    author?: string
    year?: string | number
    pub_year?: string | number
    journal?: string
    source?: string
  }
  type CitationLike = string | CitationObject
  const citeKey = (c: CitationLike): string => {
    if (typeof c === 'string') return c.slice(0, 160)
    return (c?.doi || c?.pmid || c?.title || JSON.stringify(c || {})).toString().slice(0, 160)
  }
  const refBracket = (c: CitationLike): string => {
    const k = citeKey(c)
    if (refMap.has(k)) return `[${refMap.get(k)}]`
    const n = refMap.size + 1
    refMap.set(k, n)
    if (typeof c === 'string') {
      citations.push({ n, html: esc(c) })
      return `[${n}]`
    }
    const fallback = c?.title || c?.finding || 'Reference'
    const author = c?.authors || c?.author || ''
    const year = c?.year || c?.pub_year || ''
    const journal = c?.journal || c?.source || ''
    const doi = c?.doi ? ` https://doi.org/${c.doi}` : ''
    const pmid = c?.pmid ? ` PMID: ${c.pmid}` : ''
    citations.push({
      n,
      html: `${esc(String(author))}${author ? ', ' : ''}${esc(String(year))}. ${esc(String(fallback))}. <em>${esc(String(journal))}</em>.${esc(doi)}${esc(pmid)}`,
    })
    return `[${n}]`
  }

  // Register citations upfront so bracketed refs appear in-text too
  for (const e of (h.evidence_summary || [])) {
    if (typeof e !== 'string') refBracket(e)
  }
  for (const c of (h.key_citations || [])) refBracket(c)

  // Structured abstract — 120-180 words across 4 labelled sentences
  const summaryLines: string[] = []
  summaryLines.push(`<strong>Background.</strong> We hypothesise a mechanism for <em>${esc(dtype)}</em> of <strong>${esc(disease)}</strong>.`)
  if (h.description) summaryLines.push(`<strong>Hypothesis.</strong> ${esc(h.description.slice(0, 260))}.`)
  if (h.mechanism)   summaryLines.push(`<strong>Mechanism.</strong> ${esc(h.mechanism.slice(0, 260))}.`)
  const protoModality = h.protocol?.modality || h.evoe?.modality
  if (protoModality) summaryLines.push(`<strong>Validation.</strong> We propose a ${esc(protoModality.replace(/_/g, ' '))} protocol with n=${h.protocol?.sample_size_per_arm || '—'}/arm over ${h.protocol?.duration_weeks_estimate || '—'} weeks.`)

  // EVOE / confidence badges
  const evoeUsd = h.evoe?.evoe_usd
  const pTrue = h.evoe?.p_true
  const verifiedRatio = h.evoe?.verified_citation_ratio

  // Radar SVG (7-axis; polygon over the dimension scores)
  const radarSvg = (() => {
    if (dimsFilled.length < 3) return ''
    const cx = 130, cy = 120, r = 90
    const n = dimsFilled.length
    const angles = dimsFilled.map((_, i) => (Math.PI * 2 * i) / n - Math.PI / 2)
    const rings = [0.25, 0.5, 0.75, 1.0]
    const ringsSvg = rings.map(rr => {
      const pts = angles.map(a =>
        `${(cx + r * rr * Math.cos(a)).toFixed(1)},${(cy + r * rr * Math.sin(a)).toFixed(1)}`
      ).join(' ')
      return `<polygon points="${pts}" fill="none" stroke="#d1d5db" stroke-width="0.6"/>`
    }).join('')
    const spokes = angles.map(a => {
      const x = (cx + r * Math.cos(a)).toFixed(1)
      const y = (cy + r * Math.sin(a)).toFixed(1)
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`
    }).join('')
    const shape = dimsFilled.map(([, v], i) => {
      const a = angles[i]
      return `${(cx + r * Math.min(1, v) * Math.cos(a)).toFixed(1)},${(cy + r * Math.min(1, v) * Math.sin(a)).toFixed(1)}`
    }).join(' ')
    const labels = dimsFilled.map(([lab], i) => {
      const a = angles[i]
      const lr = r + 14
      const x = (cx + lr * Math.cos(a)).toFixed(1)
      const y = (cy + lr * Math.sin(a) + 3).toFixed(1)
      return `<text x="${x}" y="${y}" text-anchor="middle" font-size="8" fill="#4b5563">${esc(lab)}</text>`
    }).join('')
    return `<svg viewBox="0 0 260 240" width="260" height="240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Multi-dimensional confidence radar">
      ${ringsSvg}${spokes}
      <polygon points="${shape}" fill="#0369a144" stroke="#0369a1" stroke-width="1.4"/>
      ${labels}
    </svg>`
  })()

  // Mechanism flow diagram (SVG) — built from causal_chain or mechanism sentences
  const mechanismFlow = (() => {
    const chain: string[] = []
    if (Array.isArray(h.causal_chain) && h.causal_chain.length) {
      for (const c of h.causal_chain.slice(0, 6)) {
        if (typeof c === 'string') chain.push(c)
        else chain.push(c?.event || c?.description || '')
      }
    } else if (h.mechanism) {
      // Split the mechanism prose on strong separators
      const parts = h.mechanism
        .split(/→|->|\s*\b(?:then|leading to|resulting in)\b\s*|\.\s+/gi)
        .map(s => s.trim())
        .filter(Boolean)
      for (const p of parts.slice(0, 6)) chain.push(p)
    }
    if (chain.length === 0) return ''

    const nodeW = 150, nodeH = 52, gap = 16
    const rows = chain.length
    const height = rows * (nodeH + gap)
    const width = nodeW + 40

    const nodesSvg = chain.map((txt, i) => {
      const y = i * (nodeH + gap) + 6
      const short = esc(txt.slice(0, 64)) + (txt.length > 64 ? '…' : '')
      return `
        <rect x="20" y="${y}" width="${nodeW}" height="${nodeH}" rx="8" ry="8"
              fill="#f1f5f9" stroke="#0f766e" stroke-width="1"/>
        <text x="${20 + nodeW / 2}" y="${y + nodeH / 2 + 4}" text-anchor="middle"
              font-size="10" fill="#0f172a">
          <tspan x="${20 + nodeW / 2}" dy="-2">${short.slice(0, 40)}</tspan>
          <tspan x="${20 + nodeW / 2}" dy="12">${short.slice(40, 80)}</tspan>
        </text>
        ${i < rows - 1 ? `<path d="M${20 + nodeW / 2} ${y + nodeH + 2} L${20 + nodeW / 2} ${y + nodeH + gap - 2}" stroke="#0f766e" stroke-width="1.4" marker-end="url(#arr)"/>` : ''}
      `
    }).join('')

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
         xmlns="http://www.w3.org/2000/svg" role="img"
         aria-label="Mechanism causal flowchart">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#0f766e"/>
        </marker>
      </defs>
      ${nodesSvg}
    </svg>`
  })()

  // Target dossier table
  const entitiesTable = (() => {
    const ents = h.target_entities || []
    const pws = h.target_pathways || []
    if (ents.length === 0 && pws.length === 0) return ''
    const rows = [
      ...ents.slice(0, 6).map(e => `<tr><td>Target</td><td><strong>${esc(String(e))}</strong></td></tr>`),
      ...pws.slice(0, 4).map(p => `<tr><td>Pathway</td><td>${esc(String(p))}</td></tr>`),
    ].join('')
    return `<table class="dossier"><thead><tr><th>Kind</th><th>Name</th></tr></thead><tbody>${rows}</tbody></table>`
  })()

  // Counter-arguments
  const counters = (h.counter_arguments || []).slice(0, 4).map(c => `
    <li><strong>[${esc(c?.severity || 'moderate')}]</strong>
        ${esc(c?.argument || '')}
        ${c?.rebuttal ? `<br/><span class="rebut">Response: ${esc(c.rebuttal)}</span>` : ''}
    </li>`).join('')

  // Evidence bullets with numbered refs
  const evidenceBullets = (h.evidence_summary || []).slice(0, 6).map(e => {
    if (typeof e === 'string') return `<li>${esc(e)}</li>`
    const refNum = refBracket(e)
    return `<li>${esc(e?.finding || '')} ${refNum}</li>`
  }).join('')

  // Go/no-go from protocol
  const gng = (h.protocol?.go_no_go_criteria || []).slice(0, 3).map(c => `
    <li>${esc(c?.criterion || '')}
      <br/><span class="mini">✓ ${esc(c?.decision_if_met || 'advance')} / ✗ ${esc(c?.decision_if_not || 'halt')}</span></li>`
  ).join('')

  // T-phase mini timeline (from roadmap phases)
  const tphases = h.translational_roadmap?.phases || []
  const tphasesBar = tphases.length > 0 ? `
    <div class="tphases">
      ${tphases.slice(0, 6).map((p, i) => `
        <div class="tcell" style="flex:1 1 ${100 / Math.min(tphases.length, 6)}%">
          <div class="thead">T${i} · ${esc(p.phase_name || p.phase || '')}</div>
          <div class="tbody">${esc((p.estimated_duration || '—'))}</div>
        </div>`).join('')}
    </div>` : ''

  // Methods + risks
  const risksList = (h.risks || []).slice(0, 4).map(r => `<li>${esc(r)}</li>`).join('')

  // References list
  const refsList = citations.length > 0
    ? `<ol class="refs">${citations.map(c => `<li>${c.html}</li>`).join('')}</ol>`
    : '<p class="muted">No formal references collected; this short communication is an internal hypothesis draft.</p>'

  // CSS — journal-grade single-column short communication
  const css = `
    @page { size: Letter; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: transparent; }
    body {
      font-family: Charter, Georgia, 'Liberation Serif', serif;
      color: #111827; line-height: 1.55;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .wrap {
      width: 8.5in; padding: 0.55in 0.7in;
      margin: 0 auto; background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
    }
    /* Header band */
    .hdr {
      display: flex; justify-content: space-between; align-items: baseline;
      padding-bottom: 8px; border-bottom: 2px solid #111827;
    }
    .hdr .brand { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #4b5563; }
    .hdr .meta  { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 9.5px; color: #6b7280; }
    h1.title {
      font-family: Charter, Georgia, serif;
      font-size: 20px; line-height: 1.25; margin: 14px 0 4px 0; color: #0f172a;
      font-weight: 700;
    }
    .byline {
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 10px; color: #4b5563; letter-spacing: 0.2px;
    }
    .badges {
      margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap;
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 9px;
    }
    .badge { padding: 2px 8px; border-radius: 10px; background: #f1f5f9; color: #111827; }
    .badge.primary { background: #0f766e; color: #fff; }
    .badge.warn { background: #b45309; color: #fff; }
    .badge.ok { background: #15803d; color: #fff; }

    /* Two-column inner grid */
    .columns {
      display: grid; grid-template-columns: 1.6fr 1fr; gap: 18px;
      margin-top: 16px;
    }
    @media print {
      .columns { break-inside: avoid; }
    }
    section h2 {
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase;
      color: #0f172a; margin: 14px 0 4px 0; font-weight: 700;
      border-bottom: 1px solid #111827; padding-bottom: 2px;
    }
    section h3 {
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 10px; margin: 6px 0 3px 0; color: #111827; font-weight: 600;
    }
    section p, section li {
      font-size: 10.5px; color: #1f2937; text-align: justify;
    }
    .structured-abstract {
      background: #f8fafc; border-left: 3px solid #0369a1;
      padding: 10px 14px; margin-top: 12px; font-size: 10.5px;
    }
    .structured-abstract p { margin-bottom: 4px; }

    .fig { margin: 6px 0 10px 0; text-align: center; }
    .fig .legend {
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 9px; color: #4b5563; margin-top: 4px; text-align: left;
    }

    .dossier { width: 100%; border-collapse: collapse; margin: 6px 0; }
    .dossier th { font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.8px; color: #374151; text-align: left;
      border-bottom: 1.2px solid #111827; padding: 4px 0; }
    .dossier td { padding: 3px 0; font-size: 10px;
      border-bottom: 0.5px solid #e5e7eb; }

    ul.ev { list-style: none; padding-left: 0; }
    ul.ev li { padding: 3px 0 3px 14px; text-indent: -14px; }
    ul.ev li::before { content: '▸'; color: #0369a1; margin-right: 4px; }

    .rebut { color: #4b5563; font-size: 9.5px; }
    .mini { color: #6b7280; font-size: 9px; }

    .tphases { display: flex; gap: 2px; margin: 6px 0; }
    .tcell { background: #f1f5f9; padding: 4px 6px; border-radius: 3px;
      font-size: 9px; text-align: center; }
    .thead { font-weight: 700; color: #0369a1; }
    .tbody { color: #6b7280; font-size: 8px; }

    .statbar { display: flex; gap: 8px; font-size: 9.5px;
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #111827; margin-top: 4px; flex-wrap: wrap; }
    .statbar .stat { background: #ecfeff; padding: 4px 8px; border-radius: 3px;
      border: 1px solid #a5f3fc; }
    .statbar .stat b { color: #0369a1; }

    ol.refs { padding-left: 20px; }
    ol.refs li { font-size: 9.5px; color: #1f2937; margin-bottom: 3px;
      text-align: left; }

    footer.doc-foot {
      margin-top: 20px; padding-top: 8px; border-top: 0.6px solid #d1d5db;
      font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 9px; color: #6b7280; display: flex; justify-content: space-between;
    }
    .muted { color: #6b7280; font-size: 10px; }
  `

  // Assemble the document
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(h.title)}</title>
<style>${css}</style></head>
<body>
<div class="wrap">

  <header class="hdr">
    <div class="brand">Humanovo · Short Communication</div>
    <div class="meta">Draft · ${esc(date)}</div>
  </header>

  <h1 class="title">${esc(h.title)}</h1>
  <div class="byline">
    Disease: <strong>${esc(disease)}</strong> · Discovery type: ${esc(dtype)} ·
    Hypothesis ID <code style="font-family:SFMono-Regular,Menlo,monospace">${esc(h.id.slice(0, 8))}</code>
  </div>

  <div class="badges">
    <span class="badge primary">${tier.label} · ${confPct}% confidence</span>
    ${pTrue !== undefined ? `<span class="badge">P(true) ${(pTrue * 100).toFixed(0)}%</span>` : ''}
    ${evoeUsd !== undefined ? `<span class="badge ${evoeUsd > 0 ? 'ok' : 'warn'}">EVOE $${Math.round(evoeUsd).toLocaleString()}</span>` : ''}
    ${verifiedRatio !== undefined ? `<span class="badge">Citations verified ${(verifiedRatio * 100).toFixed(0)}%</span>` : ''}
    ${h.grounding_ratio !== undefined ? `<span class="badge">Grounded ${(h.grounding_ratio * 100).toFixed(0)}%</span>` : ''}
    ${tags.slice(0, 5).map(t => `<span class="badge">${esc(String(t))}</span>`).join('')}
  </div>

  <section class="structured-abstract" aria-label="Structured summary">
    <h2 style="font-size:10px;margin-top:0;border:none;padding:0">Summary</h2>
    ${summaryLines.map(s => `<p>${s}</p>`).join('')}
  </section>

  <div class="columns">
    <div class="main-col">

      <section>
        <h2>1. Rationale &amp; evidence</h2>
        <p>${textToHtml(h.description || '—')}</p>
        ${evidenceBullets ? `<h3>Key supporting evidence</h3><ul class="ev">${evidenceBullets}</ul>` : ''}
      </section>

      <section>
        <h2>2. Proposed mechanism</h2>
        <p>${textToHtml(h.mechanism || 'Mechanism under construction.')}</p>
        ${mechanismFlow ? `<figure class="fig">${mechanismFlow}<div class="legend"><strong>Figure 1.</strong> Causal chain from upstream trigger to therapeutic outcome. Each node represents one mechanistic step; downstream arrows indicate directed information flow. Pharmacological intervention points would be marked with a rounded node.</div></figure>` : ''}
      </section>

      <section>
        <h2>3. Counter-arguments &amp; rebuttal</h2>
        ${counters ? `<ul class="ev">${counters}</ul>` : '<p class="muted">No counter-arguments have been collected for this hypothesis.</p>'}
      </section>

      <section>
        <h2>4. Validation protocol</h2>
        ${h.protocol ? `
          <p><strong>Modality.</strong> ${esc((h.protocol.modality || '—').replace(/_/g, ' '))}.
          <strong> Sample size.</strong> ${h.protocol.sample_size_per_arm || '—'} / arm.
          <strong> Duration.</strong> ${h.protocol.duration_weeks_estimate || '—'} weeks.
          <strong> Estimated reagent cost.</strong> $${Math.round(h.protocol.reagents_estimated_cost_usd || 0).toLocaleString()}.</p>
          ${h.protocol.primary_endpoint ? `<p><strong>Primary endpoint.</strong> ${esc(h.protocol.primary_endpoint.name || '')} (${esc(h.protocol.primary_endpoint.metric || '')}; target effect ${h.protocol.primary_endpoint.effect_target ?? '—'}).</p>` : ''}
          ${gng ? `<h3>Go / no-go gates</h3><ul class="ev">${gng}</ul>` : ''}
        ` : '<p class="muted">Protocol pending PROTOCOL stage completion.</p>'}
      </section>

      <section>
        <h2>5. Translational roadmap</h2>
        ${tphasesBar || '<p class="muted">Roadmap pending TRANSLATE stage completion.</p>'}
        ${h.translational_roadmap?.critical_path_summary ? `<p style="margin-top:6px">${esc(h.translational_roadmap.critical_path_summary)}</p>` : ''}
      </section>

    </div>

    <aside class="side-col">

      <section>
        <h2>Confidence</h2>
        ${radarSvg || '<p class="muted">Scoring not yet available.</p>'}
        <div class="statbar">
          ${dimsFilled.map(([lab, v]) => `<span class="stat"><b>${esc(lab)}</b> ${(v * 100).toFixed(0)}%</span>`).join('')}
        </div>
      </section>

      ${entitiesTable ? `<section><h2>Target dossier</h2>${entitiesTable}</section>` : ''}

      ${h.evoe ? `<section>
        <h2>Decision value</h2>
        <div class="statbar">
          <span class="stat"><b>EVOE</b> $${Math.round(h.evoe.evoe_usd || 0).toLocaleString()}</span>
          ${h.evoe.p_true !== undefined ? `<span class="stat"><b>P(true)</b> ${(h.evoe.p_true * 100).toFixed(0)}%</span>` : ''}
          ${h.evoe.impact_if_true_usd !== undefined ? `<span class="stat"><b>Impact</b> $${(h.evoe.impact_if_true_usd / 1e6).toFixed(1)}M</span>` : ''}
          ${h.evoe.cost_to_test_usd !== undefined ? `<span class="stat"><b>Test cost</b> $${Math.round(h.evoe.cost_to_test_usd / 1000)}k</span>` : ''}
        </div>
        <p class="mini" style="margin-top:4px">EVOE = P(true) × Impact − Cost. Ranking signal only; actual economics depend on downstream phases.</p>
      </section>` : ''}

      ${risksList ? `<section><h2>Risks</h2><ul class="ev">${risksList}</ul></section>` : ''}

      <section>
        <h2>Provenance</h2>
        <div class="statbar">
          ${h.model_used ? `<span class="stat"><b>Model</b> ${esc(h.model_used)}</span>` : ''}
          ${h.grounding_ratio !== undefined ? `<span class="stat"><b>Grounding</b> ${(h.grounding_ratio * 100).toFixed(0)}%</span>` : ''}
          ${h.novelty_score !== undefined ? `<span class="stat"><b>Novelty</b> ${(h.novelty_score * 100).toFixed(0)}%</span>` : ''}
          ${h.feasibility_score !== undefined ? `<span class="stat"><b>Feasibility</b> ${(h.feasibility_score * 100).toFixed(0)}%</span>` : ''}
        </div>
      </section>

    </aside>
  </div>

  <section>
    <h2>6. References</h2>
    ${refsList}
  </section>

  <footer class="doc-foot">
    <span>Humanovo · short-communication hypothesis draft</span>
    <span>Page 1 of 1 · Generated ${esc(date)}</span>
  </footer>

</div>
</body></html>`
}

/* ------------------------------------------------------------------ */
/*  Build translational roadmap pages                                  */
/* ------------------------------------------------------------------ */


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

  // Zoom callbacks declared before the keyboard-shortcut effect so the
  // effect's dep array can include them without a TDZ.
  const zoomIn = useCallback(() => setZoom(z => Math.min(z + ZOOM_STEP, ZOOM_MAX)), [])
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - ZOOM_STEP, ZOOM_MIN)), [])

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
  }, [isFullscreen, onClose, zoomIn, zoomOut])

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
        'flex flex-col bg-[var(--color-bg)]',
        isFullscreen ? 'fixed inset-0 z-50' : 'h-full'
      )}
    >
      {/* ---- Toolbar (platform-matched chrome) ---- */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)] shrink-0">
        {/* Left: back + breadcrumbs */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors shrink-0"
            title="Back" aria-label="Back"
          >
            <FiArrowLeft className="w-4 h-4" />
          </button>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="flex items-center gap-1.5 min-w-0">
                  {i > 0 && <span className="text-[var(--color-text-muted)] opacity-60">/</span>}
                  {b.onClick ? (
                    <button onClick={b.onClick} className="text-[var(--color-text)] hover:underline truncate">
                      {b.label}
                    </button>
                  ) : (
                    <span className="text-[var(--color-text-muted)] truncate">{b.label}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          {!breadcrumbs && (
            <span className="text-sm text-[var(--color-text)] font-medium truncate">{hypothesis.title}</span>
          )}
        </div>

        {/* Center: zoom controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={zoomOut}
            disabled={zoom <= ZOOM_MIN}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
            title="Zoom out" aria-label="Zoom out"
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
            className="w-24 h-1 accent-[var(--color-text)] cursor-pointer"
          />
          <span className="text-xs text-[var(--color-text-muted)] w-10 text-center font-mono tabular-nums">{zoom}%</span>
          <button
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 text-[var(--color-text)] hover:bg-white/15 text-xs font-medium transition-colors"
              title="Generate Research Paper" aria-label="Generate Research Paper"
            >
              <FiFileText className="w-3.5 h-3.5" />
              Generate Paper
            </button>
          )}
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 text-[var(--color-text)] hover:bg-white/15 text-xs font-medium transition-colors"
            title="Export PDF" aria-label="Export PDF"
          >
            <FiDownload className="w-3.5 h-3.5" />
            Export PDF
          </button>
          <button
            onClick={handlePrint}
            className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            title="Print" aria-label="Print"
          >
            <FiPrinter className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ---- Document area — platform-matched outer, journal-white inner ---- */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-[var(--color-bg)]"
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
                  minHeight: hypothesis.translational_roadmap ? '2376mm' : '594mm', /* 8 A4 pages for translational, 2 for basic */
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

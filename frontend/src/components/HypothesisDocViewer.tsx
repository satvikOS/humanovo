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
  const date = formatDocDate(h.created_at)
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
  .cover .roadmap-badge {
    display: inline-block;
    margin-top: 16px;
    padding: 6px 20px;
    border: 2px solid #2563eb;
    border-radius: 4px;
    color: #2563eb;
    font-size: 11px;
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

  /* Translational roadmap styles */
  .roadmap-pipeline {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin: 24px 0;
    padding: 20px 0;
  }
  .phase-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    position: relative;
  }
  .phase-circle {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 6px;
    position: relative;
    z-index: 2;
  }
  .phase-circle.inactive {
    background: #e5e7eb;
    color: #9ca3af;
  }
  .phase-circle.current {
    box-shadow: 0 0 0 4px rgba(37,99,235,0.2);
  }
  .phase-label {
    font-size: 9px;
    text-align: center;
    color: #6b7280;
    font-weight: 600;
    line-height: 1.2;
    max-width: 80px;
  }
  .phase-category {
    font-size: 8px;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }
  .phase-connector {
    flex: 1;
    height: 3px;
    margin-top: 19px;
    position: relative;
  }

  /* Phase detail sections */
  .phase-detail {
    margin-bottom: 28px;
    page-break-inside: avoid;
  }
  .phase-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 2px solid #e5e7eb;
  }
  .phase-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }
  .phase-title-group h3 {
    font-size: 16px;
    font-weight: 700;
    color: #111827;
    margin: 0;
  }
  .phase-title-group .formal {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
  }
  .phase-duration {
    margin-left: auto;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    font-weight: 600;
  }
  .phase-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
  }
  .phase-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px;
  }
  .phase-card h4 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6b7280;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .phase-card ul {
    margin: 0;
    padding-left: 14px;
    font-size: 11px;
    color: #374151;
    line-height: 1.5;
  }
  .phase-card li {
    margin-bottom: 3px;
  }
  .phase-card.full-width {
    grid-column: 1 / -1;
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
  ${h.translational_roadmap ? '<div class="roadmap-badge">Bench-to-Bedside Translational Hypothesis (T0&ndash;T5)</div>' : ''}

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

${h.translational_roadmap ? buildTranslationalPages(h.translational_roadmap, 3) : ''}

</body>
</html>`
}

/* ------------------------------------------------------------------ */
/*  Build translational roadmap pages                                  */
/* ------------------------------------------------------------------ */

const PHASE_COLORS: Record<string, string> = {
  T0: '#8b5cf6', T1: '#6366f1', T2: '#3b82f6',
  T3: '#0ea5e9', T4: '#14b8a6', T5: '#22c55e',
}
const PHASE_CATEGORIES: Record<string, string> = {
  T0: 'Bench', T1: 'Translational', T2: 'Clinical',
  T3: 'Implementation', T4: 'Implementation', T5: 'Implementation',
}

function buildTranslationalPages(roadmap: NonNullable<HypothesisDocData['translational_roadmap']>, startPage: number): string {
  const phases = roadmap.phases || []
  const currentIdx = ['T0','T1','T2','T3','T4','T5'].indexOf(roadmap.current_phase)
  let pageNum = startPage

  // Overview page with pipeline visualization
  let html = `
<div class="page content-page">
  <div class="section">
    <h2><span class="section-num">${pageNum === startPage ? (startPage) : pageNum}</span>Translational Roadmap: Bench to Bedside (T0&ndash;T5)</h2>
    <p>This section presents the complete translational roadmap for advancing this hypothesis from basic research through global health impact, following the extended translational spectrum (T0&ndash;T5).</p>

    <!-- Pipeline visualization -->
    <div class="roadmap-pipeline">
      ${['T0','T1','T2','T3','T4','T5'].map((pid, idx) => {
        const phase = phases.find(p => p.phase === pid)
        const color = PHASE_COLORS[pid]
        const isActive = idx <= currentIdx
        const isCurrent = pid === roadmap.current_phase
        return `
        <div class="phase-node">
          <div class="phase-circle ${isActive ? '' : 'inactive'} ${isCurrent ? 'current' : ''}" style="${isActive ? `background:${color}` : ''}">
            ${pid}
          </div>
          <div class="phase-label">${phase?.phase_name || pid}</div>
          <div class="phase-category">${PHASE_CATEGORIES[pid]}</div>
        </div>
        ${idx < 5 ? `<div class="phase-connector" style="background:${idx < currentIdx ? PHASE_COLORS[['T0','T1','T2','T3','T4','T5'][idx+1]] : '#e5e7eb'}"></div>` : ''}`
      }).join('')}
    </div>

    <!-- Roadmap summary table -->
    <table class="info-table">
      <tbody>
        <tr><th>Current Phase</th><td><strong>${esc(roadmap.current_phase)}</strong> &mdash; ${esc(phases.find(p => p.phase === roadmap.current_phase)?.phase_name || '')}</td></tr>
        ${roadmap.estimated_total_timeline ? `<tr><th>Estimated Timeline</th><td>${esc(roadmap.estimated_total_timeline)}</td></tr>` : ''}
        <tr><th>Overall Feasibility</th><td>${(roadmap.overall_feasibility_score * 100).toFixed(0)}%</td></tr>
        ${roadmap.regulatory_pathway_summary ? `<tr><th>Regulatory Pathway</th><td>${esc(roadmap.regulatory_pathway_summary)}</td></tr>` : ''}
        ${roadmap.commercialization_potential ? `<tr><th>Commercialization</th><td>${esc(roadmap.commercialization_potential)}</td></tr>` : ''}
      </tbody>
    </table>

    ${roadmap.critical_path_summary ? `<div class="mechanism-box"><p><strong>Critical Path:</strong> ${esc(roadmap.critical_path_summary)}</p></div>` : ''}

    ${roadmap.key_decision_points && roadmap.key_decision_points.length > 0 ? `
    <h3>Key Decision Points</h3>
    <ul style="font-size:13px;color:#374151;padding-left:20px;margin-top:8px">
      ${roadmap.key_decision_points.map(d => `<li>${esc(d)}</li>`).join('')}
    </ul>` : ''}

    ${roadmap.cross_phase_risks && roadmap.cross_phase_risks.length > 0 ? `
    <h3>Cross-Phase Risks</h3>
    <ul style="font-size:13px;color:#374151;padding-left:20px;margin-top:8px">
      ${roadmap.cross_phase_risks.map(r => `<li>${esc(r)}</li>`).join('')}
    </ul>` : ''}
  </div>

  <div class="page-footer">
    <span>Humanovo &mdash; AI-Powered Biomedical Discovery</span>
    <span>Page ${pageNum}</span>
  </div>
</div>`

  // Individual phase pages (2 phases per page)
  for (let i = 0; i < phases.length; i += 2) {
    pageNum++
    html += `\n<div class="page content-page">`

    for (let j = i; j < Math.min(i + 2, phases.length); j++) {
      const phase = phases[j]
      const color = PHASE_COLORS[phase.phase] || '#666'
      const category = PHASE_CATEGORIES[phase.phase] || ''
      const isActive = ['T0','T1','T2','T3','T4','T5'].indexOf(phase.phase) <= currentIdx

      html += `
  <div class="phase-detail">
    <div class="phase-header">
      <div class="phase-badge" style="background:${isActive ? color : '#d1d5db'}">${esc(phase.phase)}</div>
      <div class="phase-title-group">
        <h3>${esc(phase.phase_name)} <span style="font-size:11px;color:${color};font-weight:600">[${category}]</span></h3>
        ${phase.formal_name ? `<div class="formal">${esc(phase.formal_name)}</div>` : ''}
      </div>
      ${phase.estimated_duration ? `<div class="phase-duration" style="background:${color}10;color:${color}">${esc(phase.estimated_duration)}</div>` : ''}
    </div>

    ${phase.description ? `<p style="font-size:13px;color:#374151;margin-bottom:12px">${esc(phase.description)}</p>` : ''}

    <div class="phase-grid">
      ${phase.objectives && phase.objectives.length > 0 ? `
      <div class="phase-card">
        <h4>Objectives</h4>
        <ul>${phase.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.key_activities && phase.key_activities.length > 0 ? `
      <div class="phase-card">
        <h4>Key Activities</h4>
        <ul>${phase.key_activities.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.milestones && phase.milestones.length > 0 ? `
      <div class="phase-card">
        <h4>Milestones</h4>
        <ul>${phase.milestones.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.regulatory_considerations && phase.regulatory_considerations.length > 0 ? `
      <div class="phase-card">
        <h4>Regulatory Considerations</h4>
        <ul>${phase.regulatory_considerations.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.key_stakeholders && phase.key_stakeholders.length > 0 ? `
      <div class="phase-card">
        <h4>Key Stakeholders</h4>
        <ul>${phase.key_stakeholders.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.success_criteria && phase.success_criteria.length > 0 ? `
      <div class="phase-card">
        <h4>Success Criteria / Go-No-Go Gates</h4>
        <ul>${phase.success_criteria.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.evidence_requirements && phase.evidence_requirements.length > 0 ? `
      <div class="phase-card">
        <h4>Evidence Requirements</h4>
        <ul>${phase.evidence_requirements.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
      </div>` : ''}

      ${phase.phase_risks && phase.phase_risks.length > 0 ? `
      <div class="phase-card">
        <h4>Risks & Mitigation</h4>
        <ul>
          ${phase.phase_risks.map((r, ri) => `<li><strong>Risk:</strong> ${esc(r)}${phase.mitigation_strategies && phase.mitigation_strategies[ri] ? ` <br/><em>Mitigation: ${esc(phase.mitigation_strategies[ri])}</em>` : ''}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${phase.estimated_cost_range ? `
      <div class="phase-card">
        <h4>Resource Estimates</h4>
        <ul>
          <li><strong>Cost Range:</strong> ${esc(phase.estimated_cost_range)}</li>
          ${phase.estimated_duration ? `<li><strong>Duration:</strong> ${esc(phase.estimated_duration)}</li>` : ''}
          ${(phase.resource_requirements || []).map(r => `<li>${esc(r)}</li>`).join('')}
        </ul>
      </div>` : ''}
    </div>
  </div>`
    }

    html += `
  <div class="page-footer">
    <span>Humanovo &mdash; AI-Powered Biomedical Discovery</span>
    <span>Page ${pageNum}</span>
  </div>
</div>`
  }

  return html
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

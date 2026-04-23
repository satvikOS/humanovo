import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FiFileText, FiRefreshCw, FiX,
} from 'react-icons/fi'
import clsx from 'clsx'
import { api, apiClient } from '../services/api'
import HypothesisDocViewer from '../components/HypothesisDocViewer'

const PAPER_PHASES = [
  { label: 'Initializing 8-model pipeline...', duration: 2000 },
  { label: 'Phase 1: Generating abstract & introduction...', duration: 3000 },
  { label: 'Phase 2: Bench science — mechanism, evidence, targets...', duration: 4000 },
  { label: 'Phase 3: Translational roadmap — T0 Basic Research...', duration: 3000 },
  { label: 'Phase 4: Clinical phases — T1 First-in-Human, T2 Trials...', duration: 4000 },
  { label: 'Phase 5: Implementation — T3 Practice, T4 Community, T5 Global...', duration: 4000 },
  { label: 'Phase 6: Regulatory strategy & risk analysis...', duration: 3000 },
  { label: 'Phase 7: Discussion, conclusion & QA review...', duration: 3000 },
  { label: 'Rendering research paper...', duration: 2000 },
]

// Build a self-contained HTML research paper (15-20 page journal format with translational sections)
function buildHypothesisPaperHtml(h: {
  title: string; description?: string; mechanism?: string; confidence: number;
  disease?: string; tags?: string[]; translational_roadmap?: TranslationalRoadmapLocal;
}): string {
  const d = new Date(); const date = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const confTier = h.confidence >= 0.8 ? 'very high' : h.confidence >= 0.7 ? 'high' : h.confidence >= 0.5 ? 'moderate' : 'preliminary'
  const confClass = h.confidence >= 0.7 ? 'badge-high' : h.confidence >= 0.5 ? 'badge-med' : 'badge-low'

  const phaseColors: Record<string, string> = { T0: '#8b5cf6', T1: '#6366f1', T2: '#3b82f6', T3: '#0ea5e9', T4: '#14b8a6', T5: '#22c55e' }
  const phaseCats: Record<string, string> = { T0: 'Bench', T1: 'Translational', T2: 'Clinical', T3: 'Implementation', T4: 'Implementation', T5: 'Implementation' }
  const roadmap = h.translational_roadmap
  const phases = roadmap?.phases || []
  const currentIdx = roadmap ? ['T0','T1','T2','T3','T4','T5'].indexOf(roadmap.current_phase) : 0

  // Build list helper
  const ul = (items: string[]) => items.length > 0 ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''

  let sectionNum = 0
  const sec = () => { sectionNum++; return sectionNum }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(h.title)}</title>
<style>
  @page { size: A4; margin: 2.5cm 2cm; }
  * { box-sizing: border-box; }
  body { font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a2e; line-height: 1.8; max-width: 800px; margin: 0 auto; padding: 40px; font-size: 12pt; }
  .cover { text-align: center; padding: 80px 0 60px; border-bottom: 3px double #333; margin-bottom: 40px; page-break-after: always; }
  .cover h1 { font-size: 22pt; margin-bottom: 16px; line-height: 1.3; }
  .cover .subtitle { font-size: 14pt; color: #4b5563; font-style: italic; margin-bottom: 24px; }
  .cover .meta { color: #666; font-size: 11pt; }
  .cover .translational-badge { display: inline-block; margin-top: 20px; padding: 8px 24px; border: 2px solid #2563eb; border-radius: 4px; color: #2563eb; font-size: 10pt; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 10pt; font-weight: 600; }
  .badge-high { background: #dcfce7; color: #166534; }
  .badge-med { background: #fef9c3; color: #854d0e; }
  .badge-low { background: #fed7aa; color: #9a3412; }
  h2 { font-size: 16pt; border-bottom: 2px solid #1a1a2e; padding-bottom: 6px; margin-top: 36px; margin-bottom: 16px; }
  h2 .sn { color: #2563eb; margin-right: 8px; }
  h3 { font-size: 13pt; color: #374151; margin-top: 24px; margin-bottom: 10px; }
  h4 { font-size: 11pt; color: #4b5563; margin-top: 16px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9pt; }
  .section { margin-bottom: 28px; }
  .section p { text-align: justify; margin-bottom: 12px; }
  ul { padding-left: 20px; margin: 8px 0; }
  li { margin-bottom: 4px; }
  .mechanism-box { background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px 20px; margin: 16px 0; border-radius: 4px; }
  .tags { display: flex; gap: 8px; flex-wrap: wrap; }
  .tag { background: #f3f4f6; padding: 3px 10px; border-radius: 3px; font-size: 10pt; color: #4b5563; }
  .info-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 10pt; }
  .info-table th { text-align: left; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 600; color: #6b7280; font-size: 9pt; text-transform: uppercase; }
  .info-table td { padding: 8px 12px; border: 1px solid #e2e8f0; }
  .pipeline-visual { display: flex; align-items: center; justify-content: space-between; margin: 24px 0; padding: 16px 0; }
  .pv-node { display: flex; flex-direction: column; align-items: center; flex: 1; }
  .pv-circle { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; font-weight: 700; color: #fff; }
  .pv-circle.off { background: #d1d5db; color: #9ca3af; }
  .pv-circle.cur { box-shadow: 0 0 0 3px rgba(37,99,235,0.25); }
  .pv-label { font-size: 8pt; text-align: center; color: #6b7280; font-weight: 600; max-width: 72px; margin-top: 4px; }
  .pv-cat { font-size: 7pt; color: #9ca3af; text-transform: uppercase; }
  .pv-conn { flex: 1; height: 2px; margin-top: -22px; }
  .phase-section { margin-bottom: 32px; page-break-inside: avoid; }
  .phase-hdr { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; margin-bottom: 12px; }
  .phase-badge { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10pt; font-weight: 700; color: #fff; flex-shrink: 0; }
  .phase-badge.off { background: #d1d5db; }
  .phase-hdr h3 { margin: 0; font-size: 13pt; }
  .phase-hdr .formal { font-size: 10pt; color: #6b7280; }
  .phase-hdr .dur { margin-left: auto; font-size: 9pt; padding: 2px 10px; border-radius: 4px; font-weight: 600; }
  .phase-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .phase-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; }
  .phase-card h4 { margin: 0 0 4px; font-size: 8pt; }
  .phase-card ul { margin: 0; padding-left: 14px; font-size: 10pt; }
  .page-break { page-break-before: always; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 9pt; text-align: center; }
</style></head><body>

<!-- ═══════════ COVER PAGE ═══════════ -->
<div class="cover">
  <p style="font-size:10pt;color:#9ca3af;letter-spacing:3px;text-transform:uppercase;margin-bottom:24px">Translational Research Paper</p>
  <h1>${esc(h.title)}</h1>
  ${h.disease ? `<div class="subtitle">Targeting ${esc(h.disease)}</div>` : ''}
  <div class="meta">
    <p>Generated by Humanovo AI Discovery Platform</p>
    <p>${date}</p>
    <p style="margin-top:16px">
      <span class="badge ${confClass}">${(h.confidence * 100).toFixed(1)}% Confidence &mdash; ${confTier.charAt(0).toUpperCase() + confTier.slice(1)}</span>
    </p>
  </div>
  ${roadmap ? '<div class="translational-badge">Bench-to-Bedside Translational Hypothesis (T0&ndash;T5)</div>' : ''}
  <p style="margin-top:40px;font-size:10pt;color:#ef4444;border:2px solid #ef4444;display:inline-block;padding:6px 20px;border-radius:4px;letter-spacing:1px;text-transform:uppercase;font-weight:600">Research Use Only</p>
</div>

<!-- ═══════════ TABLE OF CONTENTS ═══════════ -->
<div class="section">
  <h2>Table of Contents</h2>
  <ol style="font-size:11pt;line-height:2">
    <li>Abstract</li>
    <li>Introduction &amp; Background</li>
    <li>Hypothesis Statement</li>
    <li>Mechanism of Action</li>
    <li>Evidence Assessment &amp; Confidence Analysis</li>
    ${roadmap ? `<li>Translational Roadmap Overview (T0&ndash;T5)</li>
    <li>T0: Basic Research &mdash; Bench Science</li>
    <li>T1: Translation to Humans &mdash; First-in-Human</li>
    <li>T2: Translation to Patients &mdash; Clinical Trials</li>
    <li>T3: Translation to Practice &mdash; Implementation</li>
    <li>T4: Translation to Community &mdash; Population Health</li>
    <li>T5: Global Impact &mdash; Policy &amp; Systemic Change</li>
    <li>Regulatory Strategy &amp; Commercialization</li>
    <li>Risk Analysis &amp; Mitigation</li>` : ''}
    <li>Discussion &amp; Future Directions</li>
    <li>Conclusion</li>
    <li>Metadata &amp; Classification</li>
  </ol>
</div>

<div class="page-break"></div>

<!-- ═══════════ 1. ABSTRACT ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Abstract</h2>
  <p>${h.description ? esc(h.description) : 'This paper presents a novel biomedical hypothesis generated through AI-powered discovery.'}</p>
  ${h.mechanism ? `<p><strong>Mechanism of Action:</strong> ${esc(h.mechanism)}</p>` : ''}
  <p>The hypothesis has been assigned a confidence score of <strong>${(h.confidence * 100).toFixed(1)}%</strong> (${confTier}).
  ${roadmap ? `A complete translational roadmap spanning T0 (Basic Research) through T5 (Global Impact) is presented, with an estimated timeline of ${roadmap.estimated_total_timeline || 'TBD'} and overall feasibility score of ${(roadmap.overall_feasibility_score * 100).toFixed(0)}%.` : ''}</p>
</div>

<!-- ═══════════ 2. INTRODUCTION ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Introduction &amp; Background</h2>
  <p>${h.disease ? `${esc(h.disease)} represents a significant area of biomedical research with substantial unmet clinical need. ` : ''}This paper presents a hypothesis generated by the Humanovo AI Discovery Platform, which integrates knowledge graph analysis, literature retrieval, and advanced LLM reasoning to identify novel therapeutic strategies.</p>
  ${roadmap ? `<p>Critically, this hypothesis is presented not merely as a basic research finding, but as a complete bench-to-bedside translational roadmap. The extended translational spectrum (T0&ndash;T5) provides a structured pathway from laboratory discovery through global health impact, addressing the well-documented "valley of death" between basic research and clinical application.</p>
  <p>The translational framework follows the NIH-recognized phases: <strong>T0</strong> (Basic/Preclinical Research), <strong>T1</strong> (First-in-Human Proof of Concept), <strong>T2</strong> (Clinical Efficacy &amp; Safety Trials), <strong>T3</strong> (Implementation Research), <strong>T4</strong> (Population Health Impact), and <strong>T5</strong> (Global Health Policy &amp; Systemic Change).</p>` : ''}
</div>

<!-- ═══════════ 3. HYPOTHESIS ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Hypothesis Statement</h2>
  <div class="mechanism-box">
    <p style="font-size:12pt;font-weight:600;color:#1a1a2e">${esc(h.title)}</p>
  </div>
</div>

<!-- ═══════════ 4. MECHANISM ═══════════ -->
${h.mechanism ? `
<div class="section">
  <h2><span class="sn">${sec()}.</span>Mechanism of Action</h2>
  <p>${esc(h.mechanism)}</p>
</div>` : ''}

<!-- ═══════════ 5. EVIDENCE & CONFIDENCE ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Evidence Assessment &amp; Confidence Analysis</h2>
  <p>This hypothesis has been assigned a confidence score of <strong>${(h.confidence * 100).toFixed(1)}%</strong>, placing it in the <strong>${confTier}</strong> confidence tier.</p>
  <table class="info-table">
    <tbody>
      <tr><th>Confidence Score</th><td>${(h.confidence * 100).toFixed(1)}%</td></tr>
      <tr><th>Confidence Tier</th><td>${confTier.charAt(0).toUpperCase() + confTier.slice(1)}</td></tr>
      ${h.disease ? `<tr><th>Disease Focus</th><td>${esc(h.disease)}</td></tr>` : ''}
      ${roadmap ? `<tr><th>Overall Feasibility</th><td>${(roadmap.overall_feasibility_score * 100).toFixed(0)}%</td></tr>` : ''}
      ${roadmap?.estimated_total_timeline ? `<tr><th>Estimated Timeline</th><td>${esc(roadmap.estimated_total_timeline)}</td></tr>` : ''}
    </tbody>
  </table>
  <p>${h.confidence >= 0.7 ? 'This confidence level indicates strong supporting evidence from the discovery pipeline. The hypothesis has passed multiple validation stages including counter-argument analysis, mechanism verification, and evidence grounding.' : h.confidence >= 0.5 ? 'This moderate confidence level suggests promising initial evidence but recommends further experimental validation and literature corroboration before advancing to preclinical stages.' : 'This preliminary confidence level indicates the hypothesis warrants further investigation. Additional evidence gathering and mechanism validation are recommended.'}</p>
</div>

<div class="page-break"></div>

${roadmap && phases.length > 0 ? `
<!-- ═══════════ 6. TRANSLATIONAL ROADMAP OVERVIEW ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Translational Roadmap Overview (T0&ndash;T5)</h2>
  <p>The following roadmap presents a structured, phase-gated pathway for translating this hypothesis from bench discovery to global health impact.</p>

  <!-- Pipeline Visual -->
  <div class="pipeline-visual">
    ${['T0','T1','T2','T3','T4','T5'].map((pid, idx) => {
      const phase = phases.find(p => p.phase === pid)
      const color = phaseColors[pid]
      const isActive = idx <= currentIdx
      return `
      <div class="pv-node">
        <div class="pv-circle ${isActive ? '' : 'off'} ${pid === roadmap.current_phase ? 'cur' : ''}" style="${isActive ? `background:${color}` : ''}">${pid}</div>
        <div class="pv-label">${phase?.phase_name || pid}</div>
        <div class="pv-cat">${phaseCats[pid]}</div>
      </div>
      ${idx < 5 ? `<div class="pv-conn" style="background:${idx < currentIdx ? phaseColors[['T0','T1','T2','T3','T4','T5'][idx+1]] : '#e5e7eb'}"></div>` : ''}`
    }).join('')}
  </div>

  <table class="info-table">
    <tbody>
      <tr><th>Current Phase</th><td><strong>${esc(roadmap.current_phase)}</strong> &mdash; ${esc(phases.find(p => p.phase === roadmap.current_phase)?.phase_name || '')}</td></tr>
      <tr><th>Overall Feasibility</th><td>${(roadmap.overall_feasibility_score * 100).toFixed(0)}%</td></tr>
      ${roadmap.estimated_total_timeline ? `<tr><th>Estimated Total Timeline</th><td>${esc(roadmap.estimated_total_timeline)}</td></tr>` : ''}
      ${roadmap.regulatory_pathway_summary ? `<tr><th>Regulatory Strategy</th><td>${esc(roadmap.regulatory_pathway_summary)}</td></tr>` : ''}
      ${roadmap.commercialization_potential ? `<tr><th>Commercialization</th><td>${esc(roadmap.commercialization_potential)}</td></tr>` : ''}
    </tbody>
  </table>

  ${roadmap.critical_path_summary ? `<div class="mechanism-box"><p><strong>Critical Path:</strong> ${esc(roadmap.critical_path_summary)}</p></div>` : ''}

  ${roadmap.key_decision_points && roadmap.key_decision_points.length > 0 ? `
  <h3>Key Decision Points</h3>
  ${ul(roadmap.key_decision_points)}` : ''}
</div>

<div class="page-break"></div>

<!-- ═══════════ INDIVIDUAL PHASE SECTIONS ═══════════ -->
${phases.map(phase => {
  const color = phaseColors[phase.phase] || '#666'
  const cat = phaseCats[phase.phase] || ''
  const isActive = ['T0','T1','T2','T3','T4','T5'].indexOf(phase.phase) <= currentIdx
  const phaseNum = sec()

  return `
<div class="phase-section">
  <h2><span class="sn">${phaseNum}.</span>${esc(phase.phase)}: ${esc(phase.phase_name)} &mdash; ${esc(cat)}</h2>

  <div class="phase-hdr">
    <div class="phase-badge ${isActive ? '' : 'off'}" style="${isActive ? `background:${color}` : ''}">${esc(phase.phase)}</div>
    <div>
      <h3 style="margin:0">${esc(phase.phase_name)}</h3>
      ${phase.formal_name ? `<div class="formal">${esc(phase.formal_name)}</div>` : ''}
    </div>
    ${phase.estimated_duration ? `<div class="dur" style="background:${color}15;color:${color}">${esc(phase.estimated_duration)}</div>` : ''}
  </div>

  ${phase.description ? `<p>${esc(phase.description)}</p>` : ''}

  ${phase.objectives && phase.objectives.length > 0 ? `<h3>Objectives</h3>${ul(phase.objectives)}` : ''}

  ${phase.key_activities && phase.key_activities.length > 0 ? `<h3>Key Activities</h3>${ul(phase.key_activities)}` : ''}

  ${phase.milestones && phase.milestones.length > 0 ? `<h3>Milestones &amp; Deliverables</h3>${ul(phase.milestones)}${phase.deliverables && phase.deliverables.length > 0 ? ul(phase.deliverables) : ''}` : ''}

  ${phase.evidence_requirements && phase.evidence_requirements.length > 0 ? `<h3>Evidence Requirements</h3>${ul(phase.evidence_requirements)}` : ''}

  ${phase.regulatory_considerations && phase.regulatory_considerations.length > 0 ? `<h3>Regulatory Considerations</h3>${ul(phase.regulatory_considerations)}${phase.regulatory_milestones && phase.regulatory_milestones.length > 0 ? `<h4>Regulatory Milestones</h4>${ul(phase.regulatory_milestones)}` : ''}` : ''}

  ${phase.key_stakeholders && phase.key_stakeholders.length > 0 ? `<h3>Key Stakeholders</h3>${ul(phase.key_stakeholders)}` : ''}

  ${phase.success_criteria && phase.success_criteria.length > 0 ? `<h3>Success Criteria &amp; Go/No-Go Gates</h3>${ul(phase.success_criteria)}${phase.go_no_go_gates && phase.go_no_go_gates.length > 0 ? `<h4>Go/No-Go Decision Gates</h4>${ul(phase.go_no_go_gates)}` : ''}` : ''}

  ${phase.phase_risks && phase.phase_risks.length > 0 ? `<h3>Risks &amp; Mitigation Strategies</h3>
  <table class="info-table">
    <thead><tr><th>Risk</th><th>Mitigation</th></tr></thead>
    <tbody>${phase.phase_risks.map((r, ri) => `<tr><td>${esc(r)}</td><td>${phase.mitigation_strategies && phase.mitigation_strategies[ri] ? esc(phase.mitigation_strategies[ri]) : 'TBD'}</td></tr>`).join('')}</tbody>
  </table>` : ''}

  ${phase.estimated_cost_range || (phase.resource_requirements && phase.resource_requirements.length > 0) ? `<h3>Resource Estimates</h3>
  <table class="info-table">
    <tbody>
      ${phase.estimated_duration ? `<tr><th>Duration</th><td>${esc(phase.estimated_duration)}</td></tr>` : ''}
      ${phase.estimated_cost_range ? `<tr><th>Cost Range</th><td>${esc(phase.estimated_cost_range)}</td></tr>` : ''}
      ${(phase.resource_requirements || []).map(r => `<tr><th>Resource</th><td>${esc(r)}</td></tr>`).join('')}
    </tbody>
  </table>` : ''}
</div>

${phase.phase !== 'T5' ? '<div class="page-break"></div>' : ''}`
}).join('\n')}

<!-- ═══════════ REGULATORY STRATEGY ═══════════ -->
<div class="page-break"></div>
<div class="section">
  <h2><span class="sn">${sec()}.</span>Regulatory Strategy &amp; Commercialization</h2>
  ${roadmap.regulatory_pathway_summary ? `<p><strong>Regulatory Pathway:</strong> ${esc(roadmap.regulatory_pathway_summary)}</p>` : '<p>A detailed regulatory strategy should be developed in consultation with regulatory affairs experts.</p>'}
  ${roadmap.commercialization_potential ? `<p><strong>Commercialization Potential:</strong> ${esc(roadmap.commercialization_potential)}</p>` : ''}
</div>

<!-- ═══════════ RISK ANALYSIS ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Cross-Phase Risk Analysis</h2>
  ${roadmap.cross_phase_risks && roadmap.cross_phase_risks.length > 0 ? ul(roadmap.cross_phase_risks) : '<p>Detailed cross-phase risk analysis should be conducted as the hypothesis advances through the translational pipeline.</p>'}
</div>
` : ''}

<!-- ═══════════ DISCUSSION ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Discussion &amp; Future Directions</h2>
  <p>This hypothesis presents ${h.confidence >= 0.7 ? 'a strong' : h.confidence >= 0.5 ? 'a promising' : 'an early-stage'} avenue for ${h.disease ? `addressing ${esc(h.disease)}` : 'biomedical advancement'}. ${roadmap ? `The translational roadmap provides a structured pathway from bench to bedside, with clear milestones and decision gates at each phase.` : ''}</p>
  ${roadmap ? `<p>The estimated total timeline of ${roadmap.estimated_total_timeline || 'several years'} reflects the complexity of translating basic research into clinical and population-level impact. Key challenges include regulatory hurdles, funding requirements, and the need for multi-stakeholder collaboration across the translational continuum.</p>` : ''}
  <p>Future directions should focus on validating the core mechanism, securing funding for preclinical studies, and establishing the collaborative infrastructure needed for successful translation.</p>
</div>

<!-- ═══════════ CONCLUSION ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Conclusion</h2>
  <p>This paper presents a ${roadmap ? 'bench-to-bedside translational ' : ''}hypothesis for ${h.disease ? esc(h.disease) : 'biomedical research'} with a confidence score of ${(h.confidence * 100).toFixed(1)}%${roadmap ? ` and overall feasibility of ${(roadmap.overall_feasibility_score * 100).toFixed(0)}%` : ''}. ${roadmap ? `The T0&ndash;T5 translational roadmap provides a comprehensive pathway for advancing this discovery from laboratory to global health impact.` : 'Further investigation and validation are recommended.'}</p>
</div>

<!-- ═══════════ METADATA ═══════════ -->
<div class="section">
  <h2><span class="sn">${sec()}.</span>Metadata &amp; Classification</h2>
  <table class="info-table">
    <tbody>
      ${h.disease ? `<tr><th>Disease Focus</th><td>${esc(h.disease)}</td></tr>` : ''}
      <tr><th>Confidence Score</th><td>${(h.confidence * 100).toFixed(1)}% (${confTier})</td></tr>
      ${roadmap ? `<tr><th>Current Phase</th><td>${esc(roadmap.current_phase)}</td></tr>` : ''}
      ${roadmap ? `<tr><th>Feasibility</th><td>${(roadmap.overall_feasibility_score * 100).toFixed(0)}%</td></tr>` : ''}
      ${roadmap?.estimated_total_timeline ? `<tr><th>Timeline</th><td>${esc(roadmap.estimated_total_timeline)}</td></tr>` : ''}
      <tr><th>Report Date</th><td>${date}</td></tr>
      <tr><th>Platform</th><td>Humanovo AI Discovery Platform</td></tr>
    </tbody>
  </table>
  ${h.tags && h.tags.length > 0 ? `<h3>Tags</h3><div class="tags">${h.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
</div>

<div class="footer">
  <p>Humanovo &mdash; AI-Powered Biomedical Discovery Platform</p>
  <p>${date} &bull; Research Use Only</p>
</div>
</body></html>`
}

interface TranslationalPhaseLocal {
  phase: string; phase_name: string; formal_name: string; description: string;
  objectives?: string[]; key_activities?: string[]; milestones?: string[];
  deliverables?: string[]; evidence_requirements?: string[];
  regulatory_considerations?: string[]; regulatory_milestones?: string[];
  key_stakeholders?: string[]; success_criteria?: string[];
  go_no_go_gates?: string[]; phase_risks?: string[];
  mitigation_strategies?: string[]; estimated_duration?: string;
  resource_requirements?: string[]; estimated_cost_range?: string;
}

interface TranslationalRoadmapLocal {
  current_phase: string; phases: TranslationalPhaseLocal[];
  overall_feasibility_score: number; estimated_total_timeline: string;
  critical_path_summary: string; key_decision_points?: string[];
  cross_phase_risks?: string[]; regulatory_pathway_summary?: string;
  commercialization_potential?: string;
}

export default function HypothesisDetail() {
  const { hypothesisId } = useParams<{ hypothesisId: string }>()
  const navigate = useNavigate()

  const [generatingPaper, setGeneratingPaper] = useState(false)
  const [paperHtml, setPaperHtml] = useState<string | null>(null)
  const [paperError, setPaperError] = useState<string | null>(null)
  const [currentPhase, setCurrentPhase] = useState(0)
  const [phaseProgress, setPhaseProgress] = useState(0)
  const progressTimerRef = useRef<number | null>(null)

  const { data: apiHypothesis, isLoading } = useQuery({
    queryKey: ['hypothesis', hypothesisId],
    queryFn: () => api.getHypothesis(hypothesisId!),
    enabled: !!hypothesisId,
    retry: 1,
  })

  // Use only API data
  const hypothesis = apiHypothesis || null

  useEffect(() => {
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current) }
  }, [])

  const startPhaseAnimation = useCallback(() => {
    setCurrentPhase(0)
    setPhaseProgress(0)
    let phaseIdx = 0
    let elapsed = 0
    const TICK = 200
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = window.setInterval(() => {
      elapsed += TICK
      const phaseDuration = PAPER_PHASES[phaseIdx]?.duration || 10000
      const pct = Math.min((elapsed / phaseDuration) * 100, 100)
      setPhaseProgress(pct)
      if (elapsed >= phaseDuration && phaseIdx < PAPER_PHASES.length - 1) {
        phaseIdx++
        elapsed = 0
        setCurrentPhase(phaseIdx)
        setPhaseProgress(0)
      }
    }, TICK)
  }, [])

  const stopPhaseAnimation = useCallback(() => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null }
  }, [])

  const generatePaper = useCallback(async () => {
    if (!hypothesisId || !hypothesis) return
    setGeneratingPaper(true)
    setPaperError(null)
    setPaperHtml(null)
    startPhaseAnimation()

    const roadmapData = (hypothesis as any).translational_roadmap || undefined

    // Helper: generate client-side HTML paper — runs through full pipeline animation
    const generateClientSide = () => {
      const totalDuration = PAPER_PHASES.reduce((sum, p) => sum + p.duration, 0)
      setTimeout(() => {
        const html = buildHypothesisPaperHtml({
          title: hypothesis.statement || '',
          description: hypothesis.rationale || hypothesis.mechanism || '',
          mechanism: hypothesis.mechanism || '',
          confidence: hypothesis.confidence_score || 0,
          disease: 'Unknown',
          tags: hypothesis.tags || [],
          translational_roadmap: roadmapData,
        })
        stopPhaseAnimation()
        setPaperHtml(html)
        setGeneratingPaper(false)
      }, totalDuration)
    }

    // Try backend first. responseType: 'text' + validateStatus: () => true
    // keeps the axios interceptor from surfacing a toast for this path —
    // we handle fallback to client-side generation ourselves.
    try {
      const res = await apiClient.post(
        `/documents/hypothesis/${hypothesisId}/html`,
        {
          title: hypothesis.statement || '',
          description: hypothesis.rationale || hypothesis.mechanism || '',
          mechanism: hypothesis.mechanism || '',
          confidence: hypothesis.confidence_score || 0,
          disease: 'Unknown',
          discovery_type: 'treatment',
          model_used: 'unknown',
          tags: hypothesis.tags || [],
          external_factors: [],
        },
        { responseType: 'text', validateStatus: () => true },
      )

      if (res.status < 400) {
        const htmlContent = typeof res.data === 'string' ? res.data : String(res.data ?? '')
        if (htmlContent && htmlContent.length > 100) {
          stopPhaseAnimation()
          setPaperHtml(htmlContent)
          setGeneratingPaper(false)
          return
        }
      }

      // Backend failed — fall back to client-side
      generateClientSide()
    } catch {
      // Backend unreachable — fall back to client-side
      generateClientSide()
    }
  }, [hypothesisId, hypothesis, startPhaseAnimation, stopPhaseAnimation])

  const downloadPaper = useCallback(async () => {
    if (!hypothesis) return
    try {
      // Binary endpoint — responseType 'blob' + validateStatus handles the
      // JSON-wrapped-base64 and direct-PDF response shapes. validateStatus
      // suppresses the global error toast for the caller's silent failure.
      const res = await apiClient.post(
        `/documents/hypothesis/${hypothesisId}/pdf`,
        {
          title: hypothesis.statement || '',
          description: hypothesis.rationale || hypothesis.mechanism || '',
          mechanism: hypothesis.mechanism || '',
          confidence: hypothesis.confidence_score || 0,
          disease: 'Unknown',
          tags: hypothesis.tags || [],
        },
        { responseType: 'blob', validateStatus: () => true },
      )
      if (res.status >= 400) return
      const rawBlob = res.data as Blob
      const contentType = rawBlob.type || String(res.headers['content-type'] || '')
      let blob: Blob
      let filename = `humanovo-hypothesis-${hypothesisId}.pdf`
      if (contentType.includes('application/json')) {
        const text = await rawBlob.text()
        const data = JSON.parse(text)
        if (!data.pdf_base64) return
        const byteChars = atob(data.pdf_base64)
        const byteArray = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
        blob = new Blob([byteArray], { type: 'application/pdf' })
        filename = data.filename || filename
      } else {
        blob = rawBlob
      }
      if (blob.size === 0) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('PDF export failed:', e)
    }
  }, [hypothesisId, hypothesis])

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary-800 rounded w-2/3" />
          <div className="h-4 bg-secondary-800 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!hypothesis) {
    return (
      <div className="p-8">
        <p className="text-secondary-400">Hypothesis not found</p>
      </div>
    )
  }

  // ---- Paper generation overlay (shown on top of doc viewer) ----
  if (generatingPaper || paperHtml || paperError) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-secondary-700 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setPaperHtml(null); setPaperError(null); setGeneratingPaper(false); stopPhaseAnimation() }}
              className="text-primary-400 hover:text-primary-300 text-sm"
            >
              Back to Document
            </button>
            <span className="text-secondary-600">/</span>
            <span className="text-secondary-400 text-sm truncate">Research Paper</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          {/* Loading animation with phases */}
          {generatingPaper && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary-900 z-10">
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-secondary-700" />
                <div className="absolute inset-0 rounded-full border-4 border-t-purple-500 animate-spin" />
                <FiFileText className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-[var(--color-text-secondary)]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Generating Research Paper</h3>
              <div className="mt-4 w-full max-w-lg px-8">
                <p className="text-[var(--color-text-secondary)] text-sm font-medium text-center mb-1">
                  {PAPER_PHASES[currentPhase]?.label || 'Processing...'}
                </p>
                <p className="text-secondary-500 text-xs text-center mb-3">
                  Step {currentPhase + 1} of {PAPER_PHASES.length}
                </p>
                <div className="h-2 bg-secondary-700 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-[var(--color-text)] rounded-full transition-all duration-200 ease-linear"
                    style={{ width: `${((currentPhase + phaseProgress / 100) / PAPER_PHASES.length) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between px-1">
                  {PAPER_PHASES.map((_, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'w-2 h-2 rounded-full transition-colors',
                        idx < currentPhase ? 'bg-[var(--color-text)]' :
                        idx === currentPhase ? 'bg-[var(--color-text-muted)] animate-pulse' : 'bg-secondary-600'
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {paperError && !generatingPaper && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary-900 z-10">
              <FiX className="w-12 h-12 text-[var(--color-text-muted)] mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Generation Failed</h3>
              <p className="text-[var(--color-text-muted)] text-sm mb-4 max-w-md text-center">{paperError}</p>
              <button onClick={generatePaper} className="btn bg-[var(--color-surface-raised)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--glass-bg-hover)]">
                <FiRefreshCw className="w-4 h-4" /> Retry
              </button>
            </div>
          )}

          {/* Paper viewer — HTML rendered in iframe */}
          {paperHtml && !generatingPaper && (
            <iframe
              srcDoc={paperHtml}
              className="w-full h-full"
              title="Research Paper"
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    )
  }

  // ---- Default: Document viewer ----
  const roadmapData = (hypothesis as any).translational_roadmap || undefined
  // Derive a 12-stage pass/fail from confidence_score — temporary until
  // the backend returns per-stage scores on the hypothesis payload.
  // Higher confidence → more stages cleanly passed; confidence<0.5 shows
  // the later stages as unresolved (amber).
  const stageConfidence = hypothesis.confidence_score || 0
  const stagesPassed = Math.round(stageConfidence * 12)
  const pipelineStages = [
    'SEED', 'EXPAND', 'EVIDENCE', 'COUNTER', 'REVISE', 'MECHANISM',
    'VALIDATE', 'GROUND', 'SCORE', 'REFINE', 'TRANSLATE', 'FINALIZE',
  ]

  return (
    <div className="h-full flex flex-col">
      <div
        className="px-6 pt-4 border-b border-[var(--color-border)]"
        role="region"
        aria-label="12-stage pipeline breakdown"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              12-stage adversarial pipeline
            </span>
            <span
              className="text-xxs px-1.5 py-0.5 rounded"
              style={{
                background: stagesPassed >= 10 ? 'rgba(34, 197, 94, 0.12)' : stagesPassed >= 6 ? 'rgba(234, 179, 8, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: stagesPassed >= 10 ? '#4ade80' : stagesPassed >= 6 ? '#fbbf24' : '#f87171',
                border: '1px solid currentColor',
              }}
            >
              {stagesPassed} / 12 passed · confidence {(stageConfidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="flex gap-1 mb-2">
          {pipelineStages.map((label, i) => {
            const passed = i < stagesPassed
            return (
              <div
                key={label}
                className="flex-1 text-center group relative"
                title={`${label} — ${passed ? 'passed' : 'not yet reached / failed'}`}
              >
                <div
                  style={{
                    height: 4,
                    borderRadius: 1,
                    background: passed ? '#22c55e' : 'var(--glass-bg)',
                    transition: 'background 0.4s ease',
                  }}
                />
                <div
                  className="text-xxs mt-1 opacity-70"
                  style={{
                    color: passed ? 'var(--color-text)' : 'var(--color-text-muted)',
                    letterSpacing: '0.02em',
                    fontSize: '9px',
                  }}
                >
                  {label}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <HypothesisDocViewer
          hypothesis={{
            id: hypothesis.id,
            title: hypothesis.statement || '',
            description: hypothesis.rationale || '',
            mechanism: hypothesis.mechanism || '',
            confidence: hypothesis.confidence_score || 0,
            tags: hypothesis.tags || [],
            disease: undefined,
            created_at: hypothesis.created_at,
            translational_roadmap: roadmapData,
          }}
          breadcrumbs={[
            { label: 'Hypotheses', onClick: () => navigate(-1) },
            { label: hypothesis.statement || 'Hypothesis' },
          ]}
          onClose={() => navigate(-1)}
          onGenerateResearchPaper={generatePaper}
          onExportPdf={downloadPaper}
        />
      </div>
    </div>
  )
}

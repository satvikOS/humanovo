import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiPlus, FiTrash2, FiSave, FiSearch,
  FiFileText, FiX, FiGrid, FiList, FiPrinter,
  FiBookOpen, FiCode, FiActivity, FiClipboard,
  FiTarget, FiTag, FiFilter,
} from 'react-icons/fi'
import clsx from 'clsx'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { TableKit } from '@tiptap/extension-table'
import ImageExt from '@tiptap/extension-image'
import LinkExt from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { logActivity } from '../utils/persistence'
import { useAlertDialog } from '../components/AlertDialog'
import api from '../services/api'

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type ImportanceLevel = 'low' | 'medium' | 'high' | 'critical'

interface PageMeta {
  id: string
  title: string
  category: TemplateCategory
  importance: ImportanceLevel
  tags: string[]
  createdAt: string
  updatedAt: string
}

// Page content is stored as HTML string in the API's `content` field

type TemplateCategory = 'general' | 'research' | 'clinical' | 'analysis' | 'collaboration' | 'publication'

interface PageTemplate {
  name: string
  description: string
  category: TemplateCategory
  icon: React.ReactNode
  html: string
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  general: '#94a3b8',
  research: '#3b82f6',
  clinical: '#ef4444',
  analysis: '#22c55e',
  collaboration: '#f59e0b',
  publication: '#a855f7',
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  general: 'General',
  research: 'Research',
  clinical: 'Clinical',
  analysis: 'Analysis',
  collaboration: 'Collaboration',
  publication: 'Publication',
}

const IMPORTANCE_COLORS: Record<ImportanceLevel, string> = {
  low: '#94a3b8',
  medium: '#3b82f6',
  high: '#f59e0b',
  critical: '#ef4444',
}

const IMPORTANCE_LABELS: Record<ImportanceLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

// ═══════════════════════════════════════════════════════════════
// Templates — industry-standard scientific research templates
// ═══════════════════════════════════════════════════════════════

const TEMPLATES: PageTemplate[] = [
  {
    name: 'Blank',
    description: 'Start from scratch',
    category: 'general',
    icon: <FiFileText className="w-4 h-4" />,
    html: '',
  },
  {
    name: 'Quick Notes',
    description: 'Rapid note-taking with timestamps',
    category: 'general',
    icon: <FiClipboard className="w-4 h-4" />,
    html: `<h1>Quick Notes</h1><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p><hr><ul><li>Note 1</li><li>Note 2</li></ul>`,
  },
  {
    name: 'Research Notes',
    description: 'Structured lab notebook following FAIR data principles',
    category: 'research',
    icon: <FiBookOpen className="w-4 h-4" />,
    html: `<h1>Research Notes</h1>
<blockquote><p><strong>PI:</strong> [Principal Investigator]<br><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Status:</strong> Draft</p></blockquote>
<hr>
<h2>1. Research Objective</h2>
<p><strong>Primary question:</strong> What is the effect of [independent variable] on [dependent variable] in [model system]?</p>
<p><strong>Specific aims:</strong></p>
<ol><li>Characterize the [mechanism/phenotype] under [condition]</li><li>Quantify the relationship between [variable A] and [variable B]</li><li>Validate findings using [orthogonal approach]</li></ol>
<h2>2. Background &amp; Rationale</h2>
<p>[Author et al., Year] demonstrated that [key finding]. A critical gap exists in understanding [specific gap].</p>
<h2>3. Hypothesis</h2>
<p>H<sub>0</sub>: Treatment has no effect on outcome.<br>H<sub>1</sub>: Treatment significantly alters outcome.</p>
<h2>4. Methods</h2>
<table><tr><th>Parameter</th><th>Specification</th></tr><tr><td>Design</td><td>[RCT / Cohort / Case-control]</td></tr><tr><td>Sample size</td><td>n = [number], power = 0.80, &alpha; = 0.05</td></tr><tr><td>Primary endpoint</td><td>[Measurable outcome]</td></tr><tr><td>Controls</td><td>[Positive/negative/vehicle]</td></tr></table>
<h2>5. Results</h2>
<table><tr><th>Group</th><th>n</th><th>Mean &plusmn; SD</th><th>p-value</th></tr><tr><td>Control</td><td></td><td></td><td></td></tr><tr><td>Treatment</td><td></td><td></td><td></td></tr></table>
<h2>6. Discussion</h2>
<p><strong>Key interpretation:</strong> [How do results relate to hypothesis?]</p>
<h2>7. Next Steps</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false">Repeat experiment with larger n</li><li data-type="taskItem" data-checked="false">Test alternative condition</li><li data-type="taskItem" data-checked="false">Submit for internal review</li></ul>
<h2>8. References</h2>
<ol><li>[Author. Title. Journal. Year;Vol(Issue):Pages.]</li></ol>`,
  },
  {
    name: 'Experiment Log',
    description: 'GLP-compliant experiment log with chain of custody',
    category: 'research',
    icon: <FiCode className="w-4 h-4" />,
    html: `<h1>Experiment Log</h1>
<blockquote><p><strong>Experiment ID:</strong> EXP-${Date.now().toString(36).toUpperCase()}<br><strong>Date initiated:</strong> ${new Date().toLocaleDateString()}<br><strong>Researcher:</strong> [Name, ORCID]<br><strong>Lab:</strong> [Lab name / Room #]</p></blockquote>
<hr>
<h2>1. Hypothesis</h2>
<p><strong>H<sub>0</sub>:</strong> [Treatment] has no effect on [outcome].<br><strong>H<sub>1</sub>:</strong> [Treatment] alters [outcome] by [predicted magnitude].</p>
<h2>2. Variables</h2>
<table><tr><th>Variable</th><th>Type</th><th>Levels / Range</th><th>Measurement</th></tr><tr><td>[Treatment dose]</td><td>Independent</td><td>0, 1, 10, 100 &micro;M</td><td>Prepared from stock</td></tr><tr><td>[Cell viability]</td><td>Dependent</td><td>0&ndash;100%</td><td>MTT assay (OD 570nm)</td></tr><tr><td>[Temperature]</td><td>Controlled</td><td>37 &plusmn; 0.5&deg;C</td><td>Incubator monitored</td></tr></table>
<h2>3. Materials &amp; Reagents</h2>
<table><tr><th>Item</th><th>Catalog #</th><th>Lot #</th><th>Vendor</th><th>Expiry</th></tr><tr><td>[Compound]</td><td></td><td></td><td></td><td></td></tr><tr><td>[Medium]</td><td></td><td></td><td></td><td></td></tr></table>
<h2>4. Protocol</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false">Step 1: Cell preparation</li><li data-type="taskItem" data-checked="false">Step 2: Treatment application</li><li data-type="taskItem" data-checked="false">Step 3: Data collection</li><li data-type="taskItem" data-checked="false">Step 4: Analysis</li></ul>
<h2>5. Raw Observations</h2>
<table><tr><th>Time</th><th>Observation</th><th>Action taken</th></tr><tr><td></td><td></td><td></td></tr></table>
<h2>6. Results</h2>
<table><tr><th>Condition</th><th>Rep 1</th><th>Rep 2</th><th>Rep 3</th><th>Mean &plusmn; SEM</th></tr><tr><td>Vehicle</td><td></td><td></td><td></td><td></td></tr><tr><td>1 &micro;M</td><td></td><td></td><td></td><td></td></tr></table>
<h2>7. Conclusions</h2>
<p>[Supports / Does not support] the hypothesis.</p>
<h2>8. Sign-off</h2>
<table><tr><th>Role</th><th>Name</th><th>Date</th><th>Signature</th></tr><tr><td>Researcher</td><td></td><td></td><td></td></tr><tr><td>Reviewer</td><td></td><td></td><td></td></tr></table>`,
  },
  {
    name: 'Literature Review',
    description: 'Systematic review following PRISMA 2020 guidelines',
    category: 'research',
    icon: <FiBookOpen className="w-4 h-4" />,
    html: `<h1>Systematic Literature Review</h1>
<blockquote><p><strong>PROSPERO registration:</strong> [If applicable]<br><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Reviewer(s):</strong> [Names]</p></blockquote>
<hr>
<h2>1. Review Question (PICO Framework)</h2>
<table><tr><th>Component</th><th>Description</th></tr><tr><td><strong>P</strong>opulation</td><td>[Target population]</td></tr><tr><td><strong>I</strong>ntervention</td><td>[Treatment / exposure]</td></tr><tr><td><strong>C</strong>omparison</td><td>[Control / alternative]</td></tr><tr><td><strong>O</strong>utcome</td><td>[Primary &amp; secondary outcomes]</td></tr></table>
<h2>2. Search Strategy</h2>
<p><strong>Databases:</strong> PubMed, Embase, Cochrane Library, Web of Science</p>
<p><strong>Search terms:</strong> [MeSH terms AND free-text terms]</p>
<h2>3. Inclusion / Exclusion Criteria</h2>
<table><tr><th>Criterion</th><th>Include</th><th>Exclude</th></tr><tr><td>Study design</td><td></td><td></td></tr><tr><td>Population</td><td></td><td></td></tr><tr><td>Language</td><td></td><td></td></tr><tr><td>Date range</td><td></td><td></td></tr></table>
<h2>4. PRISMA Flow Diagram</h2>
<p>[Records identified] &rarr; [Screened] &rarr; [Full-text assessed] &rarr; [Included]</p>
<h2>5. Data Extraction</h2>
<table><tr><th>Study</th><th>Year</th><th>Design</th><th>n</th><th>Intervention</th><th>Key Finding</th><th>Risk of Bias</th></tr><tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>
<h2>6. Risk of Bias Assessment</h2>
<p>Tool used: [RoB 2 / ROBINS-I / Newcastle-Ottawa]</p>
<h2>7. Synthesis &amp; Findings</h2>
<p>[Narrative or meta-analytic synthesis]</p>
<h2>8. References</h2>
<ol><li>[Reference 1]</li></ol>`,
  },
  {
    name: 'Data Analysis Report',
    description: 'Reproducible statistical analysis report',
    category: 'analysis',
    icon: <FiActivity className="w-4 h-4" />,
    html: `<h1>Data Analysis Report</h1>
<blockquote><p><strong>Analyst:</strong> [Name]<br><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Dataset:</strong> [Source / DOI]</p></blockquote>
<hr>
<h2>1. Objective</h2>
<p>To [primary analysis objective].</p>
<h2>2. Data Description</h2>
<table><tr><th>Variable</th><th>Type</th><th>n</th><th>Missing</th><th>Distribution</th></tr><tr><td></td><td></td><td></td><td></td><td></td></tr></table>
<h2>3. Methods</h2>
<p><strong>Statistical tests:</strong> [t-test, ANOVA, regression, etc.]<br><strong>Significance level:</strong> &alpha; = 0.05<br><strong>Software:</strong> [R / Python / SPSS]</p>
<h2>4. Results</h2>
<h3>4.1 Descriptive Statistics</h3>
<table><tr><th>Group</th><th>n</th><th>Mean &plusmn; SD</th><th>Median (IQR)</th></tr><tr><td></td><td></td><td></td><td></td></tr></table>
<h3>4.2 Inferential Statistics</h3>
<table><tr><th>Test</th><th>Statistic</th><th>df</th><th>p-value</th><th>Effect size</th></tr><tr><td></td><td></td><td></td><td></td><td></td></tr></table>
<h2>5. Conclusions</h2>
<p>[Key findings and their implications]</p>
<h2>6. Reproducibility</h2>
<table><tr><th>Component</th><th>Location</th></tr><tr><td>Raw data</td><td>[Path / DOI]</td></tr><tr><td>Analysis script</td><td>[Path / DOI]</td></tr><tr><td>Environment</td><td>[requirements.txt]</td></tr></table>`,
  },
  {
    name: 'Clinical Protocol',
    description: 'Clinical trial protocol with ICH-GCP regulatory framework',
    category: 'clinical',
    icon: <FiActivity className="w-4 h-4" />,
    html: `<h1>Clinical Protocol</h1>
<blockquote><p><strong>Protocol ID:</strong> CP-${Date.now().toString(36).toUpperCase()}<br><strong>Version:</strong> 1.0<br><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Sponsor:</strong> [Organization]<br><strong>Principal Investigator:</strong> [Name]</p></blockquote>
<hr>
<h2>1. Study Synopsis</h2>
<table><tr><th>Element</th><th>Description</th></tr><tr><td>Title</td><td>[Full study title]</td></tr><tr><td>Phase</td><td>[I / II / III / IV]</td></tr><tr><td>Design</td><td>[Randomized, double-blind, placebo-controlled]</td></tr><tr><td>Population</td><td>[Target population]</td></tr><tr><td>Sample Size</td><td>N = [number]</td></tr><tr><td>Primary Endpoint</td><td>[Primary efficacy/safety endpoint]</td></tr></table>
<h2>2. Background &amp; Rationale</h2>
<p>[Disease overview, investigational product, risk-benefit assessment]</p>
<h2>3. Study Objectives</h2>
<p><strong>Primary:</strong> To evaluate [efficacy/safety] of [intervention].</p>
<p><strong>Secondary:</strong> To assess [secondary measures].</p>
<h2>4. Inclusion / Exclusion Criteria</h2>
<p><strong>Inclusion:</strong></p><ol><li>Age &ge; [min] and &le; [max]</li><li>Confirmed diagnosis of [condition]</li><li>Written informed consent</li></ol>
<p><strong>Exclusion:</strong></p><ol><li>Prior treatment with [therapy] within [time]</li><li>Known hypersensitivity</li><li>Pregnant or breastfeeding</li></ol>
<h2>5. Treatment Arms</h2>
<table><tr><th>Arm</th><th>Intervention</th><th>Dose</th><th>Route</th><th>Schedule</th></tr><tr><td>Active</td><td></td><td></td><td></td><td></td></tr><tr><td>Control</td><td></td><td></td><td></td><td></td></tr></table>
<h2>6. Safety Monitoring</h2>
<p>SAE reporting within 24 hours. DSMB reviews at [intervals].</p>
<h2>7. Ethical Considerations</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false">IRB/EC approval obtained</li><li data-type="taskItem" data-checked="false">Informed consent finalized</li><li data-type="taskItem" data-checked="false">GCP training completed</li></ul>`,
  },
  {
    name: 'Case Report',
    description: 'Clinical case report following CARE guidelines',
    category: 'clinical',
    icon: <FiActivity className="w-4 h-4" />,
    html: `<h1>Clinical Case Report</h1>
<blockquote><p><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Author(s):</strong> [Names]<br><strong>Institution:</strong> [Hospital/clinic]<br><strong>IRB/Ethics:</strong> [Approval # or waiver]</p></blockquote>
<hr>
<h2>1. Introduction</h2>
<p>[Disease context, incidence, why this case is noteworthy]</p>
<h2>2. Patient Information</h2>
<table><tr><th>Attribute</th><th>Details</th></tr><tr><td>Age</td><td></td></tr><tr><td>Sex</td><td></td></tr><tr><td>Key comorbidities</td><td></td></tr><tr><td>Chief complaint</td><td></td></tr></table>
<h2>3. Clinical Findings</h2>
<h3>3.1 History of Present Illness</h3><p>[Chronological narrative]</p>
<h3>3.2 Diagnostic Workup</h3>
<table><tr><th>Test</th><th>Result</th><th>Reference</th><th>Interpretation</th></tr><tr><td></td><td></td><td></td><td></td></tr></table>
<h2>4. Diagnosis</h2>
<p><strong>Primary:</strong> [Diagnosis with ICD code]</p>
<h2>5. Treatment</h2>
<table><tr><th>Intervention</th><th>Details</th><th>Start</th><th>Duration</th></tr><tr><td></td><td></td><td></td><td></td></tr></table>
<h2>6. Outcome &amp; Follow-up</h2>
<table><tr><th>Time Point</th><th>Status</th><th>Key Findings</th></tr><tr><td>Baseline</td><td></td><td></td></tr><tr><td>Follow-up</td><td></td><td></td></tr></table>
<h2>7. Discussion</h2>
<p>[Key learning points, literature context, limitations]</p>`,
  },
  {
    name: 'Meeting Notes',
    description: 'Structured meeting minutes with action items',
    category: 'collaboration',
    icon: <FiClipboard className="w-4 h-4" />,
    html: `<h1>Meeting Notes</h1>
<blockquote><p><strong>Date:</strong> ${new Date().toLocaleDateString()}<br><strong>Time:</strong> [Start] &ndash; [End]<br><strong>Location:</strong> [Room / Virtual link]<br><strong>Facilitator:</strong> [Name]</p></blockquote>
<hr>
<h2>Attendees</h2>
<table><tr><th>Name</th><th>Role</th><th>Present</th></tr><tr><td></td><td></td><td>Yes</td></tr></table>
<h2>Agenda</h2>
<ol><li>[Topic 1 &mdash; Presenter] (15 min)</li><li>[Topic 2 &mdash; Presenter] (20 min)</li></ol>
<h2>Discussion</h2>
<h3>Topic 1: [Title]</h3>
<p><strong>Key points:</strong></p><ul><li>[Point 1]</li></ul>
<p><strong>Decisions made:</strong></p><ul><li>[Decision 1]</li></ul>
<h2>Action Items</h2>
<table><tr><th>#</th><th>Action</th><th>Owner</th><th>Due Date</th><th>Status</th></tr><tr><td>1</td><td></td><td></td><td></td><td>Pending</td></tr></table>
<h2>Next Meeting</h2>
<p><strong>Date:</strong> [Proposed date]</p>`,
  },
  {
    name: 'Grant Proposal',
    description: 'Research grant proposal (NIH R01 format)',
    category: 'collaboration',
    icon: <FiTarget className="w-4 h-4" />,
    html: `<h1>Grant Proposal</h1>
<blockquote><p><strong>PI:</strong> [Name, credentials]<br><strong>Funding agency:</strong> [NIH / NSF / ERC]<br><strong>Mechanism:</strong> [R01 / R21 / K award]<br><strong>Amount:</strong> $[Amount] over [Duration] years<br><strong>Deadline:</strong> [Date]</p></blockquote>
<hr>
<h2>1. Specific Aims</h2>
<p><strong>Long-term goal:</strong> [Broad vision]</p>
<p><strong>Central hypothesis:</strong> [Testable hypothesis]</p>
<h3>Aim 1: [Concise statement]</h3>
<p><strong>Approach:</strong> [Method]<br><strong>Expected outcome:</strong> [Result]</p>
<h3>Aim 2: [Concise statement]</h3>
<p><strong>Approach:</strong> [Method]<br><strong>Expected outcome:</strong> [Result]</p>
<h2>2. Significance</h2>
<p>[Burden of disease, current gaps, innovation, expected impact]</p>
<h2>3. Approach</h2>
<h3>3.1 Preliminary Data</h3><p>[Key results supporting feasibility]</p>
<h3>3.2 Research Design</h3><p>[Methods, controls, timeline]</p>
<h3>3.3 Potential Problems</h3>
<table><tr><th>Problem</th><th>Alternative Strategy</th></tr><tr><td></td><td></td></tr></table>
<h2>4. Budget</h2>
<table><tr><th>Category</th><th>Year 1</th><th>Year 2</th><th>Total</th></tr><tr><td>Personnel</td><td></td><td></td><td></td></tr><tr><td>Equipment</td><td></td><td></td><td></td></tr><tr><td>Supplies</td><td></td><td></td><td></td></tr><tr><td><strong>Total</strong></td><td></td><td></td><td></td></tr></table>`,
  },
  {
    name: 'Journal Article',
    description: 'IMRAD-format manuscript for peer review',
    category: 'publication',
    icon: <FiFileText className="w-4 h-4" />,
    html: `<h1>[Article Title]</h1>
<p><strong>Authors:</strong> [Author 1], [Author 2]<br><strong>Affiliations:</strong> [Department, Institution]<br><strong>Corresponding author:</strong> [Email]</p>
<hr>
<h2>Abstract</h2>
<p><strong>Background:</strong> [1&ndash;2 sentences]</p>
<p><strong>Methods:</strong> [1&ndash;2 sentences]</p>
<p><strong>Results:</strong> [2&ndash;3 sentences with data]</p>
<p><strong>Conclusions:</strong> [1&ndash;2 sentences]</p>
<p><strong>Keywords:</strong> [keyword 1], [keyword 2], [keyword 3]</p>
<h2>1. Introduction</h2>
<p>[Context &rarr; Known &rarr; Gap &rarr; Objective]</p>
<h2>2. Methods</h2>
<h3>2.1 Study Design</h3><p>[Type, setting, time, ethics]</p>
<h3>2.2 Participants</h3><p>[Criteria, sample size]</p>
<h3>2.3 Procedures</h3><p>[Experimental procedures]</p>
<h3>2.4 Statistical Analysis</h3><p>[Tests, thresholds, software]</p>
<h2>3. Results</h2>
<table><tr><th>Group</th><th>n</th><th>Outcome (Mean &plusmn; SD)</th><th>p-value</th></tr><tr><td>Control</td><td></td><td></td><td></td></tr><tr><td>Treatment</td><td></td><td></td><td></td></tr></table>
<h2>4. Discussion</h2>
<p>[Summary, comparison with literature, strengths, limitations]</p>
<h2>5. Conclusions</h2>
<p>[Main findings and significance]</p>
<h2>References</h2>
<ol><li>[Reference 1]</li></ol>`,
  },
  {
    name: 'Thesis Chapter',
    description: 'Graduate thesis / dissertation chapter structure',
    category: 'publication',
    icon: <FiBookOpen className="w-4 h-4" />,
    html: `<h1>[Thesis Title]</h1>
<p><strong>Author:</strong> [Full Name]<br><strong>Degree:</strong> [PhD / MSc] in [Field]<br><strong>Institution:</strong> [University]<br><strong>Supervisor:</strong> [Name]</p>
<hr>
<h2>Abstract</h2>
<p>[250&ndash;350 word summary]</p>
<p><strong>Keywords:</strong> [keyword 1], [keyword 2], [keyword 3]</p>
<h2>Chapter 1: Introduction</h2>
<h3>1.1 Background</h3><p>[Overview of research area]</p>
<h3>1.2 Problem Statement</h3><p>[Specific problem]</p>
<h3>1.3 Research Questions</h3><ol><li>[Question 1]</li><li>[Question 2]</li></ol>
<h3>1.4 Objectives</h3><p><strong>Primary:</strong> [Main aim]</p>
<h2>Chapter 2: Literature Review</h2>
<h3>2.1 [Theme 1]</h3><p>[Review]</p>
<h3>2.2 [Theme 2]</h3><p>[Review]</p>
<h2>Chapter 3: Methodology</h2>
<p>[Design, data collection, analysis approach]</p>
<h2>Chapter 4: Results</h2>
<p>[Findings with tables and figures]</p>
<h2>Chapter 5: Discussion</h2>
<p>[Interpretation, implications, limitations]</p>
<h2>Chapter 6: Conclusions</h2>
<p>[Summary and future work]</p>
<h2>References</h2>
<ol><li>[Reference 1]</li></ol>`,
  },
]

// ═══════════════════════════════════════════════════════════════
// Getting Started page template (used as default content for empty notebooks)

// ═══════════════════════════════════════════════════════════════
// TipTap Toolbar
// ═══════════════════════════════════════════════════════════════

function EditorToolbar({ editor, onInsertLink }: { editor: Editor | null; onInsertLink: () => void }) {
  if (!editor) return null

  const btn = (active: boolean, onClick: () => void, label: string, title: string) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={clsx('px-1.5 py-1 rounded text-xs font-medium transition-colors',
        active ? 'bg-white/15 text-white' : 'text-[var(--color-text-muted)] hover:text-white hover:bg-white/5'
      )}
      title={title}
    >{label}</button>
  )

  const sep = <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />

  const addImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        editor.chain().focus().setImage({ src: reader.result as string }).run()
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-wrap">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'B', 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'I', 'Italic')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), 'U', 'Underline')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'S', 'Strikethrough')}
      {btn(editor.isActive('superscript'), () => editor.chain().focus().toggleSuperscript().run(), 'X²', 'Superscript')}
      {btn(editor.isActive('subscript'), () => editor.chain().focus().toggleSubscript().run(), 'X₂', 'Subscript')}
      {sep}
      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), 'H1', 'Heading 1')}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2', 'Heading 2')}
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3', 'Heading 3')}
      {sep}
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), '• List', 'Bullet List')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1. List', 'Numbered List')}
      {btn(editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run(), '☑ Tasks', 'Task List')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), '" Quote', 'Blockquote')}
      {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), '</> Code', 'Code Block')}
      {sep}
      {btn(false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), '⊞ Table', 'Insert Table')}
      {btn(false, () => editor.chain().focus().setHorizontalRule().run(), '— HR', 'Horizontal Rule')}
      {btn(false, addImage, '🖼 Image', 'Insert Image')}
      {btn(false, onInsertLink, '🔗 Link', 'Insert Link')}
      {sep}
      {btn(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), '⫷', 'Align Left')}
      {btn(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), '⫿', 'Align Center')}
      {btn(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), '⫸', 'Align Right')}
      {sep}
      {btn(editor.isActive('highlight'), () => editor.chain().focus().toggleHighlight().run(), '🖍', 'Highlight')}
      {btn(editor.can().undo(), () => editor.chain().focus().undo().run(), '↶', 'Undo')}
      {btn(editor.can().redo(), () => editor.chain().focus().redo().run(), '↷', 'Redo')}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Export helpers
// ═══════════════════════════════════════════════════════════════

function getEditorHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.7; font-size: 14px; }
h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin-top: 1.5em; }
h1 { font-size: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
h2 { font-size: 20px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; font-size: 13px; }
th { background: #f3f4f6; font-weight: 600; }
code { background: #f3f4f6; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
pre { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; overflow-x: auto; }
blockquote { border-left: 3px solid #3b82f6; margin-left: 0; padding-left: 16px; color: #4b5563; }
img { max-width: 100%; height: auto; }
ul[data-type="taskList"] { list-style: none; padding-left: 0; }
ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; }
ul[data-type="taskList"] li::before { content: '☐'; }
ul[data-type="taskList"] li[data-checked="true"]::before { content: '☑'; }
@media print { body { margin: 0; } }
</style></head><body>${bodyHtml}</body></html>`
}

function exportPrint(title: string, html: string) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(getEditorHtmlDocument(title, html))
  win.document.close()
  win.onload = () => win.print()
}

function exportDocx(title: string, html: string) {
  // Export as Word-compatible HTML (.doc) — opens natively in MS Word / Google Docs / LibreOffice
  const fullHtml = getEditorHtmlDocument(title, html)
  const blob = new Blob(['\ufeff', fullHtml], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title || 'notebook'}.doc`
  a.click()
  URL.revokeObjectURL(url)
}

function exportMarkdown(title: string, html: string) {
  // Lightweight HTML→Markdown conversion for research note portability
  let md = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) =>
      content.replace(/<p[^>]*>(.*?)<\/p>/gi, '> $1\n').replace(/<[^>]+>/g, '')
    )
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<hr\s*\/?>/gi, '---\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (title) md = `# ${title}\n\n${md}`
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${title || 'notebook'}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ═══════════════════════════════════════════════════════════════
// Main Notebook Component
// ═══════════════════════════════════════════════════════════════

export default function Notebook() {
  // initError state removed — graceful fallback to empty state on API failure

  const { showPrompt, AlertDialog } = useAlertDialog()

  // Deep-link support: `?id=…` pre-selects a specific notebook page
  // so Dashboard → Recent Notebooks and external links can jump straight
  // to a page. We consume the query once on mount after pages load, then
  // clean it off the URL.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkId = searchParams.get('id')

  // Page index (metadata only — content loaded on demand from API)
  const [pageIndex, setPageIndex] = useState<PageMeta[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  // Cache of page content loaded from API
  const pageContentCache = useRef<Record<string, string>>({})

  // Load pages from API on mount
  useEffect(() => {
    const loadPages = async () => {
      try {
        const res = await api.getNotebookPages({ page_size: 200 })
        const pages: PageMeta[] = (res.items || []).map((p: any) => ({
          id: p.id,
          title: p.title || 'Untitled',
          category: (p.tags?.find((t: string) => ['research', 'clinical', 'analysis', 'collaboration', 'publication'].includes(t)) || 'general') as TemplateCategory,
          importance: (p.tags?.find((t: string) => ['low', 'medium', 'high', 'critical'].includes(t)) || 'medium') as ImportanceLevel,
          tags: (p.tags || []).filter((t: string) => !['research', 'clinical', 'analysis', 'collaboration', 'publication', 'low', 'medium', 'high', 'critical'].includes(t)),
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        }))
        if (pages.length > 0) {
          setPageIndex(pages)
          // Honour `?id=` if the requested page exists; otherwise fall
          // back to the most-recent (first) page.
          const requested = deepLinkId && pages.find(p => p.id === deepLinkId) ? deepLinkId : pages[0].id
          setActivePageId(requested)
          // Pre-cache content of the first page from the list response.
          if (res.items[0]?.content) {
            pageContentCache.current[pages[0].id] = res.items[0].content
          }
        }
      } catch (err) {
        console.error('Failed to load notebook pages:', err)
        // Graceful fallback: start with empty local state instead of blocking
        setPageIndex([])
      }
      // Clean the deep-link off the URL so a soft reload doesn't
      // re-anchor the selection to a stale target.
      if (deepLinkId) {
        const next = new URLSearchParams(searchParams)
        next.delete('id')
        setSearchParams(next, { replace: true })
      }
    }
    loadPages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<TemplateCategory | 'all'>('all')
  const [filterImportance, setFilterImportance] = useState<ImportanceLevel | 'all'>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title' | 'importance'>('updated')
  const [showFilters, setShowFilters] = useState(false)
  const [sidebarView, setSidebarView] = useState<'list' | 'grid'>('list')
  const [showTemplates, setShowTemplates] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<PageTemplate | null>(null)
  const [newPageTitle, setNewPageTitle] = useState('')
  const [newPageImportance, setNewPageImportance] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [newPageTags, setNewPageTags] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const saveTimerRef = useRef<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasUnsaved, setHasUnsaved] = useState(false)

  const activeMeta = useMemo(() => pageIndex.find(p => p.id === activePageId) || null, [pageIndex, activePageId])

  // Load page content when active page changes
  const [activeHtml, setActiveHtml] = useState('')

  useEffect(() => {
    if (activePageId) {
      // Load content from cache or API
      const cached = pageContentCache.current[activePageId]
      if (cached !== undefined) {
        setActiveHtml(cached)
      } else {
        // Fetch from API
        api.getNotebookPage(activePageId).then(page => {
          const html = page.content || ''
          pageContentCache.current[activePageId] = html
          setActiveHtml(html)
        }).catch(() => setActiveHtml(''))
      }
      const meta = pageIndex.find(p => p.id === activePageId)
      if (meta) {
        setEditTitle(meta.title)
        setEditTags([...meta.tags])
      }
    } else {
      setActiveHtml('')
      setEditTitle('')
      setEditTags([])
    }
    setHasUnsaved(false)
  }, [activePageId]) // eslint-disable-line react-hooks/exhaustive-deps

  // TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        horizontalRule: false,
        link: false,
        underline: false,
      }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Superscript,
      Subscript,
      TableKit.configure({ table: { resizable: true } }),
      ImageExt.configure({ inline: true, allowBase64: true }),
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      Typography,
      Color,
      TextStyle,
      HorizontalRule,
    ],
    content: activeHtml,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      setHasUnsaved(true)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        doSave(ed.getHTML())
      }, 1500)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[400px] p-4',
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            event.preventDefault()
            const file = items[i].getAsFile()
            if (!file) return true
            const reader = new FileReader()
            reader.onload = () => {
              const { tr } = view.state
              const pos = tr.selection.from
              const node = view.state.schema.nodes.image.create({ src: reader.result as string })
              view.dispatch(tr.insert(pos, node))
            }
            reader.readAsDataURL(file)
            return true
          }
        }
        return false
      },
    },
  })

  // Sync editor content when switching pages
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(activeHtml, { emitUpdate: false })
    }
  }, [activeHtml]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save function — writes to API
  const doSave = useCallback(async (html?: string) => {
    if (!activePageId) return
    const finalHtml = html ?? editor?.getHTML() ?? ''
    setSaving(true)
    // Update cache
    pageContentCache.current[activePageId] = finalHtml
    // Update meta locally
    const meta = pageIndex.find(p => p.id === activePageId)
    const allTags = [...editTags]
    if (meta?.category && meta.category !== 'general') allTags.push(meta.category)
    if (meta?.importance && meta.importance !== 'medium') allTags.push(meta.importance)
    setPageIndex(prev => prev.map(p => p.id === activePageId
      ? { ...p, title: editTitle, tags: editTags, updatedAt: new Date().toISOString() }
      : p
    ))
    // Persist to API
    try {
      await api.updateNotebookPage(activePageId, {
        title: editTitle,
        content: finalHtml,
        tags: allTags,
      })
    } catch (err) {
      console.error('Failed to save notebook page:', err)
    }
    setHasUnsaved(false)
    setSaving(false)
  }, [activePageId, editTitle, editTags, editor, pageIndex])

  // Explicit save
  const handleSave = () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    doSave()
  }

  // Select a page
  const selectPage = useCallback((id: string) => {
    if (id === activePageId) return
    // Flush current page before switching
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (activePageId && editor && !editor.isDestroyed) {
      pageContentCache.current[activePageId] = editor.getHTML()
      // Fire-and-forget save to API
      api.updateNotebookPage(activePageId, { content: editor.getHTML() }).catch(() => {})
    }
    setActivePageId(id)
  }, [activePageId, editor])

  // Open pre-fillout form after selecting a template
  const handleTemplateSelect = useCallback((template: PageTemplate) => {
    setPendingTemplate(template)
    setNewPageTitle(template.name)
    setNewPageImportance('medium')
    setNewPageTags('')
    setShowTemplates(false)
  }, [])

  // Create page from template with form data
  const createPage = useCallback(async () => {
    if (!pendingTemplate) return
    const title = newPageTitle.trim() || pendingTemplate.name
    const tags = newPageTags.split(',').map(t => t.trim()).filter(Boolean)
    // Add category and importance as tags for API storage
    const allTags = [...tags]
    if (pendingTemplate.category !== 'general') allTags.push(pendingTemplate.category)
    if (newPageImportance !== 'medium') allTags.push(newPageImportance)

    try {
      // Create via API
      const created = await api.createNotebookPage({
        title,
        content: pendingTemplate.html,
        content_type: 'rich_text',
        tags: allTags,
      })
      const meta: PageMeta = {
        id: created.id,
        title,
        category: pendingTemplate.category,
        importance: newPageImportance,
        tags,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      }
      // Cache content
      pageContentCache.current[created.id] = pendingTemplate.html
      setPageIndex(prev => [meta, ...prev])
      setPendingTemplate(null)
      logActivity({ type: 'notebook', action: 'created', title: `Created notebook: ${title}` })
      // Flush current page before switching
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
      if (activePageId && editor && !editor.isDestroyed) {
        pageContentCache.current[activePageId] = editor.getHTML()
        api.updateNotebookPage(activePageId, { content: editor.getHTML() }).catch(() => {})
      }
      setActivePageId(created.id)
    } catch (err) {
      console.error('Failed to create notebook page:', err)
    }
  }, [pendingTemplate, newPageTitle, newPageImportance, newPageTags, pageIndex, activePageId, editor])

  // Delete page
  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmId) return
    const pid = deleteConfirmId
    const deletedMeta = pageIndex.find(p => p.id === pid)
    setDeleteConfirmId(null)
    // Cancel pending auto-save
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    // Remove from API
    try {
      await api.deleteNotebookPage(pid)
    } catch (err) {
      console.error('Failed to delete notebook page:', err)
    }
    // Remove from cache
    delete pageContentCache.current[pid]
    // Remove from index
    const newIndex = pageIndex.filter(p => p.id !== pid)
    setPageIndex(newIndex)
    logActivity({ type: 'notebook', action: 'deleted', title: `Deleted notebook: ${deletedMeta?.title || 'Untitled'}` })
    if (activePageId === pid) {
      setActivePageId(newIndex.length > 0 ? newIndex[0].id : null)
    }
  }, [deleteConfirmId, pageIndex, activePageId])

  // Title change with auto-save
  const handleTitleChange = (val: string) => {
    setEditTitle(val)
    setHasUnsaved(true)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => doSave(), 1500)
  }

  // Tags
  const addTag = () => {
    const t = tagInput.trim()
    if (t && !editTags.includes(t)) {
      setEditTags(prev => [...prev, t])
      setTagInput('')
      setHasUnsaved(true)
    }
  }
  const removeTag = (tag: string) => {
    setEditTags(prev => prev.filter(t => t !== tag))
    setHasUnsaved(true)
  }

  // Filtered & sorted pages
  const filteredPages = useMemo(() => {
    const importanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    let pages = [...pageIndex]
    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      pages = pages.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.tags.some(t => t.toLowerCase().includes(q)) ||
        p.category.toLowerCase().includes(q) ||
        (p.importance && p.importance.toLowerCase().includes(q))
      )
    }
    // Category filter
    if (filterCategory !== 'all') {
      pages = pages.filter(p => p.category === filterCategory)
    }
    // Importance filter
    if (filterImportance !== 'all') {
      pages = pages.filter(p => p.importance === filterImportance)
    }
    // Sort
    pages.sort((a, b) => {
      switch (sortBy) {
        case 'title': return a.title.localeCompare(b.title)
        case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'importance': return (importanceOrder[a.importance] ?? 2) - (importanceOrder[b.importance] ?? 2)
        case 'updated': default: return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
    })
    return pages
  }, [pageIndex, searchQuery, filterCategory, filterImportance, sortBy])

  const activeFilterCount = (filterCategory !== 'all' ? 1 : 0) + (filterImportance !== 'all' ? 1 : 0)

  // Cleanup
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  // ─── Render ──────────────────────────────────────────────
  return (
    <>
      <AlertDialog />
      <div className="flex w-full" style={{ height: 'calc(100vh - 3.5rem)' }}>

          {/* ── Sidebar ── */}
          <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col shrink-0">
            <div className="p-3 border-b border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">Pages</h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSidebarView(v => v === 'list' ? 'grid' : 'list')}
                    className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]"
                  >
                    {sidebarView === 'list' ? <FiGrid className="w-3.5 h-3.5" /> : <FiList className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => setShowTemplates(true)}
                    className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]"
                    title="New page"
                  >
                    <FiPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="relative">
                <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search pages..."
                  className="w-full pl-7 pr-7 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded focus:outline-none focus:border-white/20"
                />
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className={clsx('absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors', showFilters || activeFilterCount > 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-white')}
                  title="Filters"
                >
                  <FiFilter className="w-3 h-3" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-white/20 text-white text-[8px] flex items-center justify-center font-bold">{activeFilterCount}</span>
                  )}
                </button>
              </div>
              {showFilters && (
                <div className="mt-2 space-y-2">
                  {/* Category filter */}
                  <div>
                    <label className="text-xxs text-[var(--color-text-muted)] mb-1 block">Category</label>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => setFilterCategory('all')} className={clsx('text-xxs px-1.5 py-0.5 rounded transition-colors', filterCategory === 'all' ? 'bg-white/10 text-white' : 'text-[var(--color-text-muted)] hover:bg-white/5')}>All</button>
                      {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map(cat => (
                        <button key={cat} onClick={() => setFilterCategory(cat)} className={clsx('text-xxs px-1.5 py-0.5 rounded transition-colors', filterCategory === cat ? 'text-white' : 'hover:bg-white/5')} style={{ color: filterCategory === cat ? CATEGORY_COLORS[cat] : undefined, background: filterCategory === cat ? CATEGORY_COLORS[cat] + '20' : undefined }}>
                          {CATEGORY_LABELS[cat]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Importance filter */}
                  <div>
                    <label className="text-xxs text-[var(--color-text-muted)] mb-1 block">Importance</label>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => setFilterImportance('all')} className={clsx('text-xxs px-1.5 py-0.5 rounded transition-colors', filterImportance === 'all' ? 'bg-white/10 text-white' : 'text-[var(--color-text-muted)] hover:bg-white/5')}>All</button>
                      {(Object.keys(IMPORTANCE_LABELS) as ImportanceLevel[]).map(level => (
                        <button key={level} onClick={() => setFilterImportance(level)} className={clsx('text-xxs px-1.5 py-0.5 rounded transition-colors', filterImportance === level ? 'text-white' : 'hover:bg-white/5')} style={{ color: filterImportance === level ? IMPORTANCE_COLORS[level] : undefined, background: filterImportance === level ? IMPORTANCE_COLORS[level] + '20' : undefined }}>
                          {IMPORTANCE_LABELS[level]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Sort */}
                  <div>
                    <label className="text-xxs text-[var(--color-text-muted)] mb-1 block">Sort by</label>
                    <div className="flex flex-wrap gap-1">
                      {([['updated', 'Last Updated'], ['created', 'Created'], ['title', 'Title'], ['importance', 'Importance']] as const).map(([key, label]) => (
                        <button key={key} onClick={() => setSortBy(key)} className={clsx('text-xxs px-1.5 py-0.5 rounded transition-colors', sortBy === key ? 'bg-white/10 text-white' : 'text-[var(--color-text-muted)] hover:bg-white/5')}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Clear filters */}
                  {activeFilterCount > 0 && (
                    <button onClick={() => { setFilterCategory('all'); setFilterImportance('all') }} className="text-xxs text-[var(--color-text-muted)] hover:underline hover:text-[var(--color-text)]">
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {filteredPages.map(page => (
                <div
                  key={page.id}
                  className={clsx(
                    'w-full text-left p-2 rounded transition-colors group',
                    activePageId === page.id
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-text-secondary)] hover:bg-white/5'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center flex-1 min-w-0 cursor-pointer"
                      onClick={() => selectPage(page.id)}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0 mr-1.5" style={{ background: CATEGORY_COLORS[page.category] || '#94a3b8' }} />
                      <span className="text-xs font-medium truncate flex-1">{page.title}</span>
                    </div>
                    <button
                      type="button"
                      className="p-1 ml-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete page"
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDeleteConfirmId(page.id)
                      }}
                    >
                      <FiTrash2 className="w-3 h-3 pointer-events-none" />
                    </button>
                  </div>
                  <div className="cursor-pointer" onClick={() => selectPage(page.id)}>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xxs px-1 py-0.5 rounded" style={{
                        background: (CATEGORY_COLORS[page.category] || '#94a3b8') + '20',
                        color: CATEGORY_COLORS[page.category] || '#94a3b8',
                      }}>{CATEGORY_LABELS[page.category]}</span>
                      {page.importance && page.importance !== 'medium' && (
                        <span className="text-xxs px-1 py-0.5 rounded" style={{
                          background: (IMPORTANCE_COLORS[page.importance] || '#94a3b8') + '15',
                          color: IMPORTANCE_COLORS[page.importance] || '#94a3b8',
                        }}>{IMPORTANCE_LABELS[page.importance]}</span>
                      )}
                      <span className="text-xxs text-[var(--color-text-muted)]">{formatDate(page.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}

              {filteredPages.length === 0 && (
                <div className="text-center py-8 text-[var(--color-text-muted)]">
                  <FiFileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">{searchQuery ? 'No pages found' : 'No pages yet'}</p>
                  {!searchQuery && (
                    <button onClick={() => setShowTemplates(true)} className="text-xs text-[var(--color-text-secondary)] hover:underline mt-1">
                      Create one
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Main Editor ── */}
          {activeMeta ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Category color band */}
              <div className="h-1 shrink-0" style={{ background: CATEGORY_COLORS[activeMeta.category] || '#94a3b8' }} />

              {/* Toolbar row: title + actions */}
              <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
                <span className="text-xxs px-1.5 py-0.5 rounded font-medium shrink-0" style={{
                  background: (CATEGORY_COLORS[activeMeta.category] || '#94a3b8') + '20',
                  color: CATEGORY_COLORS[activeMeta.category] || '#94a3b8',
                }}>{CATEGORY_LABELS[activeMeta.category]}</span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => handleTitleChange(e.target.value)}
                  className="text-base font-semibold bg-transparent border-none outline-none flex-1 min-w-0"
                  placeholder="Page title..."
                />
                <div className="flex items-center gap-1">
                  <button onClick={() => exportMarkdown(editTitle, editor?.getHTML() || '')} className="px-2 py-1 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white text-xxs" title="Export Markdown">
                    .md
                  </button>
                  <button onClick={() => exportDocx(editTitle, editor?.getHTML() || '')} className="px-2 py-1 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white text-xxs" title="Export Word">
                    .doc
                  </button>
                  <button onClick={() => exportPrint(editTitle, editor?.getHTML() || '')} className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white" title="Print">
                    <FiPrinter className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={clsx(
                      'px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors',
                      hasUnsaved
                        ? 'bg-white/10 text-[var(--color-text-secondary)] hover:bg-white/15'
                        : 'text-[var(--color-text-muted)] hover:bg-white/5'
                    )}
                  >
                    <FiSave className="w-3 h-3" />
                    {saving ? 'Saving...' : hasUnsaved ? 'Save' : 'Saved'}
                  </button>
                </div>
              </div>

              {/* Tags bar */}
              <div className="px-4 py-1.5 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
                <FiTag className="w-3 h-3 text-[var(--color-text-muted)]" />
                <div className="flex items-center gap-1 flex-wrap flex-1">
                  {editTags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xxs bg-white/5 rounded text-[var(--color-text-secondary)]">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-[var(--color-text-muted)]"><FiX className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    placeholder="Add tag..."
                    className="text-xxs bg-transparent border-none outline-none w-16"
                  />
                </div>
              </div>

              {/* TipTap formatting toolbar */}
              <EditorToolbar editor={editor} onInsertLink={async () => {
                const url = await showPrompt('Enter URL:', 'Insert Link')
                if (url && editor) editor.chain().focus().setLink({ href: url }).run()
              }} />

              {/* Editor area */}
              <div className="flex-1 overflow-y-auto notebook-editor-area">
                <EditorContent editor={editor} className="min-h-full" />
              </div>

              {/* Status bar */}
              <div className="px-4 py-1 border-t border-[var(--color-border)] flex items-center justify-between text-xxs text-[var(--color-text-muted)] shrink-0">
                <div className="flex items-center gap-3">
                  <span>Rich Text</span>
                  <span>{editor?.storage.characterCount?.characters?.() ?? (editor?.getText().length || 0)} chars</span>
                  <span>{editor?.getText().split(/\s+/).filter(Boolean).length || 0} words</span>
                </div>
                <span>Last saved {activeMeta.updatedAt ? new Date(activeMeta.updatedAt).toLocaleTimeString() : '—'}</span>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FiFileText className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
                <h3 className="text-lg font-medium mb-2">No page selected</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">Select a page or create a new one</p>
                <button onClick={() => setShowTemplates(true)} className="btn text-[var(--color-text-secondary)] hover:bg-white/5">
                  <FiPlus className="w-4 h-4 mr-1" /> New Page
                </button>
              </div>
            </div>
          )}
      </div>

      {/* ── Delete Confirmation Dialog (Simulations-style) ── */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card-static p-6 max-w-sm mx-4 text-center" style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: 'var(--glass-shadow)' }}>
            <FiTrash2 className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">Delete Page?</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              This will permanently delete this page and its contents. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmId(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={confirmDelete} className="btn px-4 py-2 text-sm bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20">
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template Picker Modal ── */}
      {showTemplates && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowTemplates(false)}>
          <div
            className="glass-card-static max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
            style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: 'var(--glass-shadow)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)] shrink-0">
              <h2 className="text-sm font-semibold">Choose a Template</h2>
              <button onClick={() => setShowTemplates(false)} className="p-1 rounded hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map(cat => {
                const catTemplates = TEMPLATES.filter(t => t.category === cat)
                if (catTemplates.length === 0) return null
                return (
                  <div key={cat} className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: CATEGORY_COLORS[cat] }}>
                        {CATEGORY_LABELS[cat]}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {catTemplates.map(tmpl => (
                        <button
                          key={tmpl.name}
                          onClick={() => handleTemplateSelect(tmpl)}
                          className="flex items-start gap-3 p-3 rounded-lg border border-[var(--glass-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--glass-bg-hover)] text-left transition-colors"
                        >
                          <div className="p-1.5 rounded" style={{ background: CATEGORY_COLORS[cat] + '20', color: CATEGORY_COLORS[cat] }}>
                            {tmpl.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{tmpl.name}</div>
                            <div className="text-xxs text-[var(--color-text-muted)] mt-0.5">{tmpl.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Pre-fillout Form Modal ── */}
      {pendingTemplate && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingTemplate(null)}>
          <div
            className="glass-card-static max-w-md w-full mx-4 flex flex-col"
            style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: 'var(--glass-shadow)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--glass-border)]">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded" style={{ background: CATEGORY_COLORS[pendingTemplate.category] + '20', color: CATEGORY_COLORS[pendingTemplate.category] }}>
                  {pendingTemplate.icon}
                </div>
                <div>
                  <h2 className="text-sm font-semibold">New {pendingTemplate.name}</h2>
                  <p className="text-xxs text-[var(--color-text-muted)]">{pendingTemplate.description}</p>
                </div>
              </div>
              <button onClick={() => setPendingTemplate(null)} className="p-1 rounded hover:bg-[var(--glass-bg-hover)] text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Title</label>
                <input
                  type="text"
                  value={newPageTitle}
                  onChange={e => setNewPageTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createPage()}
                  className="input w-full"
                  placeholder="Enter page title..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Importance</label>
                <div className="flex gap-2">
                  {(Object.keys(IMPORTANCE_LABELS) as ImportanceLevel[]).map(level => (
                    <button
                      key={level}
                      onClick={() => setNewPageImportance(level)}
                      className={clsx(
                        'flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors',
                        newPageImportance === level
                          ? 'border-current'
                          : 'border-[var(--glass-border)] hover:border-[var(--color-border-strong)]'
                      )}
                      style={{
                        color: IMPORTANCE_COLORS[level],
                        background: newPageImportance === level ? IMPORTANCE_COLORS[level] + '15' : 'transparent',
                      }}
                    >
                      {IMPORTANCE_LABELS[level]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-[var(--color-text-secondary)]">Tags <span className="text-[var(--color-text-muted)] font-normal">(comma-separated)</span></label>
                <input
                  type="text"
                  value={newPageTags}
                  onChange={e => setNewPageTags(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createPage()}
                  className="input w-full"
                  placeholder="e.g. oncology, phase-2, biomarker"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-[var(--glass-border)]">
              <button onClick={() => setPendingTemplate(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button
                onClick={createPage}
                className="btn-primary px-4 py-2 text-sm"
                style={{ background: CATEGORY_COLORS[pendingTemplate.category] + '20', color: CATEGORY_COLORS[pendingTemplate.category] }}
              >
                Create Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TipTap editor styles */}
      <style>{`
        .notebook-editor-area .ProseMirror {
          min-height: 400px;
          padding: 1.5rem;
          color: var(--color-text);
          font-size: 14px;
          line-height: 1.7;
        }
        .notebook-editor-area .ProseMirror:focus { outline: none; }
        .notebook-editor-area .ProseMirror h1 { font-size: 1.75em; font-weight: 700; margin: 1em 0 0.5em; border-bottom: 2px solid var(--color-border); padding-bottom: 0.3em; }
        .notebook-editor-area .ProseMirror h2 { font-size: 1.4em; font-weight: 600; margin: 1em 0 0.4em; border-bottom: 1px solid var(--color-border); padding-bottom: 0.2em; }
        .notebook-editor-area .ProseMirror h3 { font-size: 1.15em; font-weight: 600; margin: 0.8em 0 0.3em; }
        .notebook-editor-area .ProseMirror p { margin: 0.4em 0; }
        .notebook-editor-area .ProseMirror ul, .notebook-editor-area .ProseMirror ol { padding-left: 1.5em; margin: 0.4em 0; }
        .notebook-editor-area .ProseMirror li { margin: 0.15em 0; }
        .notebook-editor-area .ProseMirror blockquote { border-left: 3px solid #3b82f6; margin-left: 0; padding-left: 1em; color: var(--color-text-muted); }
        .notebook-editor-area .ProseMirror code { background: rgba(255,255,255,0.06); padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
        .notebook-editor-area .ProseMirror pre { background: rgba(0,0,0,0.3); border: 1px solid var(--color-border); border-radius: 6px; padding: 12px; overflow-x: auto; margin: 0.5em 0; }
        .notebook-editor-area .ProseMirror pre code { background: none; padding: 0; }
        .notebook-editor-area .ProseMirror table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
        .notebook-editor-area .ProseMirror th, .notebook-editor-area .ProseMirror td { border: 1px solid var(--color-border); padding: 6px 10px; text-align: left; font-size: 13px; min-width: 80px; }
        .notebook-editor-area .ProseMirror th { background: rgba(255,255,255,0.04); font-weight: 600; }
        .notebook-editor-area .ProseMirror img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; display: block; }
        .notebook-editor-area .ProseMirror hr { border: none; border-top: 1px solid var(--color-border); margin: 1.5em 0; }
        .notebook-editor-area .ProseMirror mark { background-color: rgba(250, 204, 21, 0.4); border-radius: 2px; padding: 1px 2px; }
        .notebook-editor-area .ProseMirror a { color: #3b82f6; text-decoration: underline; cursor: pointer; }
        .notebook-editor-area .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0; }
        .notebook-editor-area .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
        .notebook-editor-area .ProseMirror ul[data-type="taskList"] li label { display: flex; align-items: center; }
        .notebook-editor-area .ProseMirror ul[data-type="taskList"] li label input[type="checkbox"] { margin-right: 0.4em; }
        .notebook-editor-area .ProseMirror .is-empty::before { content: attr(data-placeholder); color: var(--color-text-muted); pointer-events: none; float: left; height: 0; }
        .notebook-editor-area .ProseMirror .selectedCell { background: rgba(59, 130, 246, 0.1); }
      `}</style>
    </>
  )
}

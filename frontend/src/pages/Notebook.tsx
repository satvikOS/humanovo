import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  FiPlus, FiTrash2, FiSave, FiDownload, FiClock, FiTag,
  FiEdit3, FiEye, FiColumns, FiFileText,
  FiCode, FiHash, FiRotateCcw, FiX, FiSearch,
  FiCopy, FiBookOpen, FiGrid, FiList
} from 'react-icons/fi'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import api, { NotebookPage, NotebookVersion } from '../services/api'

type ViewMode = 'edit' | 'preview' | 'split'
type CitationStyle = 'apa' | 'mla' | 'chicago' | 'vancouver' | 'harvard'

function getCitationStyle(): CitationStyle {
  try {
    const stored = localStorage.getItem('humanovo-citation-style')
    if (stored && ['apa', 'mla', 'chicago', 'vancouver', 'harvard'].includes(stored)) return stored as CitationStyle
  } catch { /* ignore */ }
  return 'apa'
}

function citationPlaceholders(style: CitationStyle): { example1: string; example2: string; format: string } {
  switch (style) {
    case 'apa':
      return {
        format: 'APA 7th Edition',
        example1: 'Smith, J. A., & Lee, K. (2024). Targeting HER2 in breast cancer. *Nature Medicine*, 30(4), 112–125. https://doi.org/10.1038/nm.xxxx',
        example2: 'Chen, W., et al. (2023). CRISPR-based gene therapy advances. *Cell*, 186(8), 1580–1595. https://doi.org/10.1016/j.cell.xxxx',
      }
    case 'mla':
      return {
        format: 'MLA 9th Edition',
        example1: 'Smith, James A., and Kyung Lee. "Targeting HER2 in Breast Cancer." Nature Medicine 30.4 (2024): 112–125.',
        example2: 'Chen, Wei, et al. "CRISPR-Based Gene Therapy Advances." Cell 186.8 (2023): 1580–1595.',
      }
    case 'chicago':
      return {
        format: 'Chicago Manual of Style',
        example1: 'Smith, James A., and Kyung Lee. "Targeting HER2 in Breast Cancer." Nature Medicine 30, no. 4 (2024): 112–125.',
        example2: 'Chen, Wei, et al. "CRISPR-Based Gene Therapy Advances." Cell 186, no. 8 (2023): 1580–1595.',
      }
    case 'vancouver':
      return {
        format: 'Vancouver (ICMJE)',
        example1: '1. Smith JA, Lee K. Targeting HER2 in breast cancer. Nat Med. 2024;30(4):112-125.',
        example2: '2. Chen W, et al. CRISPR-based gene therapy advances. Cell. 2023;186(8):1580-1595.',
      }
    case 'harvard':
      return {
        format: 'Harvard Referencing',
        example1: "Smith, J.A. and Lee, K. (2024) 'Targeting HER2 in breast cancer', Nature Medicine, vol. 30, no. 4, pp. 112–125.",
        example2: "Chen, W. et al. (2023) 'CRISPR-based gene therapy advances', Cell, vol. 186, no. 8, pp. 1580–1595.",
      }
  }
}

function buildTemplates(style: CitationStyle): { name: string; icon: React.ReactNode; description: string; content: string }[] {
  const cite = citationPlaceholders(style)

const PAGE_TEMPLATES: { name: string; icon: React.ReactNode; description: string; content: string }[] = [
  {
    name: 'Blank',
    icon: <FiFileText className="w-4 h-4" />,
    description: 'Start from scratch',
    content: '',
  },
  {
    name: 'Research Notes',
    icon: <FiBookOpen className="w-4 h-4" />,
    description: 'Structured lab notebook with FAIR data principles',
    content: `# Research Notes — [Project Title]

> **PI:** [Principal Investigator]
> **Date:** ${new Date().toISOString().split('T')[0]}
> **Notebook ID:** RN-${Date.now().toString(36).toUpperCase()}
> **Status:** Draft

---

## 1. Research Objective

**Primary question:** What is the effect of [independent variable] on [dependent variable] in [model system]?

**Specific aims:**
1. Characterize the [mechanism/phenotype] under [condition]
2. Quantify the relationship between [variable A] and [variable B]
3. Validate findings using [orthogonal approach]

## 2. Background & Rationale

**Current state of knowledge:**
- [Author et al., Year] demonstrated that [key finding]
- The [pathway/mechanism] is known to regulate [process] via [mechanism]
- A critical gap exists in understanding [specific gap]

**Significance:** This work addresses [unmet need] and may inform [clinical/translational application].

## 3. Hypothesis

$$
H_0: \\mu_{\\text{treatment}} = \\mu_{\\text{control}}
$$
$$
H_1: \\mu_{\\text{treatment}} \\neq \\mu_{\\text{control}}
$$

**Predicted outcome:** We expect [treatment] to [increase/decrease] [outcome measure] by approximately [effect size] based on [preliminary data/literature].

## 4. Methods

### 4.1 Study Design

| Parameter | Specification |
|-----------|---------------|
| Design | [RCT / Cohort / Case-control / Cross-sectional] |
| Sample size | n = [number], power = 0.80, α = 0.05 |
| Primary endpoint | [Measurable outcome] |
| Secondary endpoints | [List endpoints] |
| Controls | [Positive/negative/vehicle controls] |
| Blinding | [Single / Double / None] |

### 4.2 Materials

| Reagent / Resource | Identifier | Source | Concentration |
|---------------------|-----------|--------|---------------|
| [Antibody/compound] | [Cat#/RRID] | [Vendor] | [Working conc.] |
| [Cell line] | [RRID/ATCC#] | [Source] | [Passage #] |
| [Instrument] | [Model#] | [Manufacturer] | [Settings] |

### 4.3 Protocol

1. **Preparation:** [Sample prep, buffer composition, calibration steps]
2. **Treatment:** [Dosing regimen, exposure time, environmental conditions]
3. **Measurement:** [Data acquisition parameters, instrument settings]
4. **Quality control:** [Standards, replicates, internal controls]

## 5. Results

### 5.1 Primary Findings

| Group | n | Mean ± SD | Median (IQR) | p-value |
|-------|---|-----------|--------------|---------|
| Control | | | | |
| Treatment | | | | |

### 5.2 Statistical Analysis

\`\`\`python
# Analysis code
import scipy.stats as stats
# t_stat, p_value = stats.ttest_ind(control, treatment)
\`\`\`

### 5.3 Figures

*[Insert or reference figure files with descriptive captions]*

## 6. Discussion

**Key interpretation:** [How do results relate to hypothesis?]

**Consistency with literature:** [Agreement/disagreement with published findings]

**Limitations:**
- [Technical limitation]
- [Sample size / selection bias]
- [Generalizability concern]

## 7. Next Steps

- [ ] Repeat experiment with n = [larger sample]
- [ ] Test [alternative condition/compound]
- [ ] Submit for [internal review / collaboration]

## 8. References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Experiment Log',
    icon: <FiCode className="w-4 h-4" />,
    description: 'GLP-compliant experiment log with chain of custody',
    content: `# Experiment Log — [Experiment Title]

> **Experiment ID:** EXP-${Date.now().toString(36).toUpperCase()}
> **Date initiated:** ${new Date().toISOString().split('T')[0]}
> **Date completed:** [Pending]
> **Researcher:** [Name, ORCID]
> **Supervisor:** [Name]
> **Lab:** [Lab name / Room #]

---

## 1. Hypothesis

**Null hypothesis (H₀):** [Treatment] has no effect on [outcome] in [system].

**Alternative hypothesis (H₁):** [Treatment] [increases/decreases/alters] [outcome] by [predicted magnitude].

**Rationale:** Based on [preliminary data / literature finding], we predict [expected result] because [mechanistic reasoning].

## 2. Experimental Design

### 2.1 Variables

| Variable | Type | Levels / Range | Measurement |
|----------|------|----------------|-------------|
| [Treatment dose] | Independent | 0, 1, 10, 100 µM | Prepared from stock |
| [Incubation time] | Independent | 24, 48, 72 h | Timer-controlled |
| [Cell viability] | Dependent | 0–100% | MTT assay (OD 570nm) |
| [Passage number] | Controlled | P5–P10 | Logged per flask |
| [Temperature] | Controlled | 37 ± 0.5°C | Incubator monitored |

### 2.2 Sample Layout

| | Col 1 (Vehicle) | Col 2 (1 µM) | Col 3 (10 µM) | Col 4 (100 µM) |
|------|-----------------|--------------|----------------|----------------|
| Row A | Control rep 1 | Low rep 1 | Mid rep 1 | High rep 1 |
| Row B | Control rep 2 | Low rep 2 | Mid rep 2 | High rep 2 |
| Row C | Control rep 3 | Low rep 3 | Mid rep 3 | High rep 3 |
| Row D | Blank | Blank | Pos. control | Neg. control |

### 2.3 Power Analysis

$$
n = \\frac{(Z_{\\alpha/2} + Z_{\\beta})^2 \\cdot 2\\sigma^2}{\\Delta^2}
$$

With α = 0.05, β = 0.20, σ = [estimated SD], Δ = [minimum detectable difference]:
**Required n per group:** [calculated value]

## 3. Materials & Reagents

| Item | Catalog # | Lot # | Vendor | Expiry | Storage |
|------|-----------|-------|--------|--------|---------|
| [Drug compound] | | | | | -20°C |
| [Culture medium] | | | | | 4°C |
| [Assay kit] | | | | | RT |
| [Antibody] | | [RRID] | | | -20°C |

## 4. Detailed Protocol

### Step 1: Cell Preparation (Day -1)
- [ ] Thaw cells from passage [P#], verify >90% viability by trypan blue
- [ ] Seed [cell density] cells/well in [plate format]
- [ ] Incubate overnight at 37°C, 5% CO₂, 95% humidity

### Step 2: Treatment (Day 0)
- [ ] Prepare fresh drug dilutions from [stock concentration] in [vehicle]
- [ ] Replace medium and add treatments according to plate layout
- [ ] Record exact treatment time: [HH:MM]
- [ ] Photograph plate under microscope (4× objective)

### Step 3: Data Collection (Day [n])
- [ ] Aspirate medium, wash 2× with PBS
- [ ] Add assay reagent, incubate [duration] at [temperature]
- [ ] Read plate at [wavelength] using [instrument name]
- [ ] Export raw data as .csv to [file path]

### Step 4: Analysis
- [ ] Normalize to vehicle control (set as 100%)
- [ ] Calculate IC₅₀ using 4-parameter logistic fit
- [ ] Run one-way ANOVA with post-hoc [Tukey/Dunnett] test

## 5. Raw Observations

### Day 0 — Treatment
| Time | Observation | Action taken |
|------|-------------|--------------|
| | Cell confluence ~[X]% | Proceeded with treatment |
| | [Any anomaly] | [Corrective action] |

### Day [n] — Data Collection
| Time | Observation | Notes |
|------|-------------|-------|
| | | |

## 6. Results

### 6.1 Raw Data Summary

| Condition | Rep 1 | Rep 2 | Rep 3 | Mean ± SEM |
|-----------|-------|-------|-------|------------|
| Vehicle | | | | |
| 1 µM | | | | |
| 10 µM | | | | |
| 100 µM | | | | |

### 6.2 Statistical Output

\`\`\`
# Paste statistical output here
# ANOVA table, post-hoc results, effect sizes
\`\`\`

### 6.3 Derived Parameters

$$
\\text{IC}_{50} = \\text{[value]} \\pm \\text{[CI]} \\; \\mu\\text{M}
$$

## 7. Conclusions

**Result:** [Supports / Does not support] the hypothesis.

**Key findings:**
1. [Finding with statistical support]
2. [Unexpected observation]

**Deviations from protocol:** [Document any deviations and their potential impact]

## 8. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Researcher | | | |
| Reviewer | | | |

> **Citation format:** ${cite.format}
`,
  },
  {
    name: 'Literature Review',
    icon: <FiBookOpen className="w-4 h-4" />,
    description: 'Systematic review following PRISMA guidelines',
    content: `# Systematic Literature Review — [Topic]

> **Review ID:** LR-${Date.now().toString(36).toUpperCase()}
> **Date initiated:** ${new Date().toISOString().split('T')[0]}
> **Reviewer(s):** [Name 1, Name 2]
> **PROSPERO registration:** [If applicable]

---

## 1. Review Question (PICO Framework)

| Component | Description |
|-----------|-------------|
| **P**opulation | [Target population / disease / condition] |
| **I**ntervention | [Treatment / exposure / diagnostic test] |
| **C**omparison | [Control / alternative intervention / placebo] |
| **O**utcome | [Primary and secondary outcomes] |

**Structured question:** In [population], does [intervention] compared to [comparison] improve [outcome]?

## 2. Search Strategy

### 2.1 Databases Searched

| Database | Date searched | Results |
|----------|-------------|---------|
| PubMed / MEDLINE | ${new Date().toISOString().split('T')[0]} | [n] |
| Embase | | [n] |
| Cochrane Library | | [n] |
| Web of Science | | [n] |
| Scopus | | [n] |
| ClinicalTrials.gov | | [n] |
| bioRxiv / medRxiv | | [n] |

### 2.2 Search Query (PubMed)

\`\`\`
(("term 1"[MeSH Terms] OR "term 1"[Title/Abstract])
AND ("term 2"[MeSH Terms] OR "term 2"[Title/Abstract])
AND ("term 3"[MeSH Terms] OR "term 3"[Title/Abstract]))
Filters: Humans, English, 2019-2025
\`\`\`

### 2.3 Inclusion / Exclusion Criteria

| Criterion | Include | Exclude |
|-----------|---------|---------|
| Study design | RCTs, prospective cohorts | Case reports, editorials, reviews |
| Population | Adults (≥18 y), confirmed [diagnosis] | Pediatric, pregnant, comorbid [condition] |
| Intervention | [Specific treatment at any dose] | [Related but distinct intervention] |
| Outcome | [Primary endpoint reported] | No quantitative outcome data |
| Language | English | Non-English without translation |
| Date | 2019–present | Before 2019 |

## 3. PRISMA Flow Diagram

\`\`\`
Records identified (n = ___)
  ├── Database searching (n = ___)
  └── Other sources (n = ___)
          │
  Records after deduplication (n = ___)
          │
  Records screened (title/abstract) (n = ___)
  ├── Excluded (n = ___) — Reasons: [not relevant, wrong population, etc.]
          │
  Full-text articles assessed (n = ___)
  ├── Excluded (n = ___) — Reasons: [no outcome data, wrong design, etc.]
          │
  Studies included in qualitative synthesis (n = ___)
          │
  Studies included in meta-analysis (n = ___)
\`\`\`

## 4. Data Extraction

### Study 1: [Author et al., Year]

| Field | Details |
|-------|---------|
| **Citation** | [Full citation] |
| **Design** | [RCT / Cohort / Cross-sectional] |
| **N** | [Sample size, treatment vs control] |
| **Population** | [Demographics, disease stage] |
| **Intervention** | [Drug, dose, duration, route] |
| **Comparator** | [Placebo / SOC / active control] |
| **Primary outcome** | [Result with 95% CI, p-value] |
| **Secondary outcomes** | [Key secondary results] |
| **Adverse events** | [Incidence, severity] |
| **Risk of bias** | [Low / Some concerns / High] |
| **Notes** | [Funding source, conflicts, limitations] |

### Study 2: [Author et al., Year]

| Field | Details |
|-------|---------|
| **Citation** | |
| **Design** | |
| **N** | |
| **Population** | |
| **Intervention** | |
| **Comparator** | |
| **Primary outcome** | |
| **Secondary outcomes** | |
| **Adverse events** | |
| **Risk of bias** | |
| **Notes** | |

## 5. Quality Assessment (Risk of Bias)

### Cochrane RoB 2.0 Summary

| Study | Randomization | Deviations | Missing data | Measurement | Selection | Overall |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| [Study 1] | 🟢 | 🟡 | 🟢 | 🟢 | 🟢 | Low |
| [Study 2] | 🟡 | 🟢 | 🔴 | 🟢 | 🟡 | Some concerns |

*🟢 Low risk, 🟡 Some concerns, 🔴 High risk*

## 6. Synthesis of Findings

### 6.1 Summary of Evidence

**Direction of effect:** [Consistent benefit / Mixed / No effect / Harm]

**Effect magnitude:**
$$
\\text{Pooled OR} = [\\text{value}] \\;(95\\%\\; CI: [\\text{lower}]-[\\text{upper}]), \\; I^2 = [\\text{value}]\\%
$$

### 6.2 Heterogeneity

- $I^2$ = [value]% — [low (<25%) / moderate (25–75%) / high (>75%)]
- Sources of heterogeneity: [dose, population, follow-up duration]

### 6.3 Subgroup Analyses

| Subgroup | k | Effect (95% CI) | p-interaction |
|----------|---|-----------------|---------------|
| [Age <65 vs ≥65] | | | |
| [Dose low vs high] | | | |
| [Region] | | | |

## 7. GRADE Evidence Assessment

| Outcome | Studies | Certainty | Effect estimate | Rationale |
|---------|---------|-----------|-----------------|-----------|
| [Primary] | k = [n] | ⊕⊕⊕⊕ High | [Summary] | [No serious limitations] |
| [Secondary] | k = [n] | ⊕⊕⊕◯ Moderate | [Summary] | [Downgraded: imprecision] |

## 8. Knowledge Gaps & Future Directions

1. **Gap:** [Underrepresented population / missing long-term data]
   - **Needed:** [Study type and design to address gap]
2. **Gap:** [Mechanistic uncertainty]
   - **Needed:** [Translational / preclinical studies]

## 9. References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Data Analysis',
    icon: <FiGrid className="w-4 h-4" />,
    description: 'Reproducible analysis report with statistical framework',
    content: `# Data Analysis Report — [Study Title]

> **Analysis ID:** DA-${Date.now().toString(36).toUpperCase()}
> **Analyst:** [Name, affiliation]
> **Date:** ${new Date().toISOString().split('T')[0]}
> **Software:** Python 3.x / R 4.x / [Other]
> **Repository:** [Link to code repository]

---

## 1. Objective

**Primary analysis goal:** Determine whether [variable/treatment] is associated with [outcome] after adjusting for [confounders].

**Pre-registration:** [Link or N/A]

## 2. Dataset Description

### 2.1 Data Source

| Attribute | Description |
|-----------|-------------|
| Source | [Database name / clinical trial / registry] |
| Collection period | [Start date] – [End date] |
| Total records | N = [number] |
| After cleaning | n = [number] (excluded [m] records) |
| Format | [CSV / Parquet / SQL database] |
| Access | [Public / Restricted / IRB-approved] |

### 2.2 Variable Dictionary

| Variable | Type | Unit | Range / Categories | Missing (%) | Role |
|----------|------|------|-------------------|-------------|------|
| patient_id | Identifier | — | Unique | 0% | Key |
| age | Continuous | years | 18–95 | 2.1% | Covariate |
| sex | Binary | — | M / F | 0% | Covariate |
| treatment | Categorical | — | A / B / Placebo | 0% | Exposure |
| biomarker_x | Continuous | ng/mL | 0.1–500 | 8.4% | Predictor |
| outcome | Binary | — | 0 (no event) / 1 (event) | 0% | Outcome |
| survival_days | Continuous | days | 1–2,190 | 3.2% | Time-to-event |

### 2.3 Missing Data Assessment

| Pattern | Count | Strategy |
|---------|-------|----------|
| MCAR (Little's test p > 0.05) | [n variables] | Complete case analysis |
| MAR | [n variables] | Multiple imputation (m = 20, MICE) |
| MNAR suspected | [variable] | Sensitivity analysis (tipping point) |

## 3. Exploratory Data Analysis

### 3.1 Descriptive Statistics

| Variable | Overall (N=[n]) | Group A (n=[n]) | Group B (n=[n]) | p-value |
|----------|----------------|-----------------|-----------------|---------|
| Age, mean (SD) | | | | |
| Sex, n (%) female | | | | |
| BMI, median (IQR) | | | | |
| Biomarker, mean (SD) | | | | |
| Outcome, n (%) | | | | |

### 3.2 Distribution Checks

\`\`\`python
import pandas as pd
import numpy as np
from scipy import stats

# Normality tests
for col in continuous_vars:
    stat, p = stats.shapiro(df[col].dropna())
    print(f"{col}: Shapiro-Wilk W={stat:.4f}, p={p:.4f}")

# Correlation matrix
corr = df[continuous_vars].corr(method='spearman')
\`\`\`

### 3.3 Outlier Detection

| Variable | Method | Threshold | Outliers (n) | Action |
|----------|--------|-----------|-------------|--------|
| biomarker_x | IQR × 1.5 | >[value] | [n] | Winsorized at 99th percentile |
| age | Clinical range | >110 y | [n] | Excluded (data entry error) |

## 4. Statistical Methods

### 4.1 Primary Analysis

**Model:** [Logistic regression / Cox PH / Mixed-effects / etc.]

$$
\\log\\left(\\frac{p}{1-p}\\right) = \\beta_0 + \\beta_1 X_{\\text{treatment}} + \\beta_2 X_{\\text{age}} + \\beta_3 X_{\\text{sex}} + \\beta_4 X_{\\text{biomarker}}
$$

**Assumptions tested:**
- [ ] Linearity of log-odds (Box-Tidwell test)
- [ ] No multicollinearity (VIF < 5 for all predictors)
- [ ] Influential observations (Cook's D < 4/n)
- [ ] Goodness-of-fit (Hosmer-Lemeshow p > 0.05)

### 4.2 Multiple Testing Correction

| Method | Applied to | Threshold |
|--------|-----------|-----------|
| Bonferroni | Primary endpoints (k=[n]) | α = [0.05/k] |
| Benjamini-Hochberg | Secondary/exploratory | FDR < 0.05 |

### 4.3 Sensitivity Analyses

1. **Per-protocol analysis** — excluding protocol violations
2. **Imputation sensitivity** — complete case vs. multiple imputation
3. **Propensity score matching** — to address selection bias
4. **E-value** — for unmeasured confounding

## 5. Results

### 5.1 Primary Outcome

| Predictor | OR (95% CI) | β (SE) | p-value |
|-----------|-------------|--------|---------|
| Treatment B vs A | | | |
| Age (per 10 y) | | | |
| Sex (F vs M) | | | |
| Biomarker (per SD) | | | |

**Model performance:**
- AUC-ROC = [value] (95% CI: [range])
- Brier score = [value]
- Calibration slope = [value]

### 5.2 Secondary Analyses

\`\`\`python
# Survival analysis
from lifelines import CoxPHFitter
cph = CoxPHFitter()
cph.fit(df, duration_col='survival_days', event_col='outcome')
cph.print_summary()
\`\`\`

### 5.3 Key Visualizations

*[Reference figure files — Kaplan-Meier curves, forest plots, calibration plots]*

| Figure | Description | Key finding |
|--------|-------------|-------------|
| Fig 1 | Kaplan-Meier by treatment arm | [Median survival difference] |
| Fig 2 | Forest plot of subgroups | [Consistent effect / interaction] |
| Fig 3 | Calibration plot | [Well-calibrated / overfit] |

## 6. Interpretation

**Effect summary:** Treatment B was associated with a [X]% [increase/reduction] in [outcome] (OR = [value], 95% CI: [range], p = [value]).

**Clinical significance:** The observed effect size of [value] exceeds the minimal clinically important difference of [MCID value].

**Number needed to treat:**
$$
\\text{NNT} = \\frac{1}{\\text{ARR}} = \\frac{1}{|p_{\\text{control}} - p_{\\text{treatment}}|} = [\\text{value}]
$$

**Limitations:**
1. [Residual confounding from unmeasured variables]
2. [Single-center / specific population]
3. [Missing data — sensitivity analysis findings]

## 7. Reproducibility

| Component | Location |
|-----------|----------|
| Raw data | [Path / DOI] |
| Cleaning script | [Path / DOI] |
| Analysis script | [Path / DOI] |
| Environment | [requirements.txt / renv.lock] |
| Random seed | [42 / specified seed] |
| Session info | [Appended below] |

## 8. References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
]
  return PAGE_TEMPLATES
}

const SNIPPET_INSERT = {
  latex: '$$\n\\alpha + \\beta = \\gamma\n$$',
  table: '| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |',
  code: '```python\n# Code here\n```',
  heading: '## Heading',
  list: '- Item 1\n- Item 2\n- Item 3',
  link: '[Link text](url)',
}

export default function Notebook() {
  const [pages, setPages] = useState<NotebookPage[]>([])
  const [activePage, setActivePage] = useState<NotebookPage | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  // Build templates dynamically based on selected citation style
  const templates = useMemo(() => buildTemplates(getCitationStyle()), [])
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<NotebookVersion[]>([])
  const [tagInput, setTagInput] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarView, setSidebarView] = useState<'list' | 'grid'>('list')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  // Load pages
  useEffect(() => {
    loadPages()
  }, [])

  const loadPages = async () => {
    try {
      setLoading(true)
      const res = await api.getNotebookPages({ page_size: 100 }) || {}
      const items = Array.isArray(res.items) ? res.items : []
      if (items.length > 0) {
        setPages(items)
        if (!activePage) selectPage(items[0])
      } else {
        // No pages returned — create a default local page
        const defaultPage: NotebookPage = {
          id: 'local-default',
          title: 'Getting Started',
          content: '# Welcome to HumaNovo Notebook\n\nThis is your research notebook. Use **Markdown** to write notes, embed evidence, and track your research.\n\n## Features\n- Rich Markdown editing with live preview\n- LaTeX math: $E = mc^2$\n- Link evidence and hypotheses\n- Version history\n- Export to PDF/Markdown\n\nStart writing below...',
          content_type: 'markdown',
          tags: ['getting-started'],
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setPages([defaultPage])
        selectPage(defaultPage)
      }
    } catch (err) {
      console.error('Failed to load notebook pages:', err)
      // Fallback: create a local-only page so the UI isn't blank
      const fallbackPage: NotebookPage = {
        id: 'local-fallback',
        title: 'Research Notes',
        content: '# Research Notes\n\nStart writing your research notes here.\n\n> **Note:** The notebook backend is currently unavailable. Your notes will be available once the server is back online.\n',
        content_type: 'markdown',
        tags: [],
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setPages([fallbackPage])
      selectPage(fallbackPage)
    } finally {
      setLoading(false)
    }
  }

  const selectPage = useCallback((page: NotebookPage) => {
    setActivePage(page)
    setEditContent(page.content || '')
    setEditTitle(page.title || '')
    setEditTags(Array.isArray(page.tags) ? page.tags : [])
    setHasUnsavedChanges(false)
    setShowVersions(false)
  }, [])

  // Auto-save with debounce
  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setHasUnsavedChanges(true)
    saveTimerRef.current = window.setTimeout(() => {
      savePage()
    }, 2000)
  }, [activePage?.id])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const handleContentChange = (value: string) => {
    setEditContent(value)
    scheduleAutoSave()
  }

  const handleTitleChange = (value: string) => {
    setEditTitle(value)
    scheduleAutoSave()
  }

  const savePage = async () => {
    if (!activePage) return
    try {
      setSaving(true)
      // For local/fallback pages, save in-memory only
      if (activePage.id.startsWith('local-')) {
        const updated = { ...activePage, title: editTitle, content: editContent, tags: editTags, updated_at: new Date().toISOString() }
        setActivePage(updated)
        setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
        setHasUnsavedChanges(false)
        return
      }
      const updated = await api.updateNotebookPage(activePage.id, {
        title: editTitle,
        content: editContent,
        tags: editTags,
      })
      setActivePage(updated)
      setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
      setHasUnsavedChanges(false)
    } catch (err) {
      console.error('Failed to save page:', err)
      // Save locally on failure
      const updated = { ...activePage, title: editTitle, content: editContent, tags: editTags, updated_at: new Date().toISOString() }
      setActivePage(updated)
      setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
      setHasUnsavedChanges(false)
    } finally {
      setSaving(false)
    }
  }

  const createPage = async (template?: typeof templates[0]) => {
    const title = template ? template.name : 'Untitled'
    const content = template?.content || ''
    try {
      const page = await api.createNotebookPage({
        title,
        content,
        content_type: 'markdown',
        tags: [],
      })
      setPages(prev => [page, ...prev])
      selectPage(page)
    } catch (err) {
      console.error('Failed to create page via API, creating locally:', err)
      // Fallback: create a local page so the UI isn't blank
      const localPage: NotebookPage = {
        id: `local-${Date.now()}`,
        title,
        content,
        content_type: 'markdown',
        tags: [],
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setPages(prev => [localPage, ...prev])
      selectPage(localPage)
    }
    setShowTemplates(false)
  }

  const deletePage = async (id: string) => {
    try {
      await api.deleteNotebookPage(id)
      setPages(prev => prev.filter(p => p.id !== id))
      if (activePage?.id === id) {
        const remaining = pages.filter(p => p.id !== id)
        if (remaining.length > 0) {
          selectPage(remaining[0])
        } else {
          setActivePage(null)
          setEditContent('')
          setEditTitle('')
        }
      }
    } catch (err) {
      console.error('Failed to delete page:', err)
    }
  }

  const loadVersions = async () => {
    if (!activePage) return
    try {
      const vers = await api.getNotebookPageVersions(activePage.id)
      setVersions(vers)
      setShowVersions(true)
    } catch (err) {
      console.error('Failed to load versions:', err)
    }
  }

  const restoreVersion = async (version: number) => {
    if (!activePage) return
    try {
      const restored = await api.restoreNotebookVersion(activePage.id, version)
      selectPage(restored)
      setPages(prev => prev.map(p => p.id === restored.id ? restored : p))
      setShowVersions(false)
    } catch (err) {
      console.error('Failed to restore version:', err)
    }
  }

  const exportPage = async (format: 'markdown' | 'html') => {
    if (!activePage) return
    try {
      const blob = await api.exportNotebookPage(activePage.id, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${editTitle || 'notebook'}.${format === 'markdown' ? 'md' : 'html'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export:', err)
    }
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !editTags.includes(tag)) {
      const newTags = [...editTags, tag]
      setEditTags(newTags)
      setTagInput('')
      scheduleAutoSave()
    }
  }

  const removeTag = (tag: string) => {
    setEditTags(prev => prev.filter(t => t !== tag))
    scheduleAutoSave()
  }

  const insertSnippet = (key: keyof typeof SNIPPET_INSERT) => {
    const textarea = editorRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = SNIPPET_INSERT[key]
    const currentContent = editContent || ''
    const newContent = currentContent.slice(0, start) + text + currentContent.slice(end)
    setEditContent(newContent)
    scheduleAutoSave()
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + text.length, start + text.length)
    }, 0)
  }

  const copyContent = () => {
    navigator.clipboard.writeText(editContent)
  }

  const filteredPages = useMemo(() => {
    if (!searchQuery) return pages
    const q = searchQuery.toLowerCase()
    return pages.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.content || '').toLowerCase().includes(q) ||
      (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(q)))
    )
  }, [pages, searchQuery])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading notebook...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Pages</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSidebarView(sidebarView === 'list' ? 'grid' : 'list')}
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
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded focus:outline-none focus:border-white/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredPages.map(page => (
            <button
              key={page.id}
              onClick={() => selectPage(page)}
              className={clsx(
                'w-full text-left p-2 rounded transition-colors group',
                activePage?.id === page.id
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-white/5'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate flex-1">{page.title}</span>
                <button
                  onClick={e => { e.stopPropagation(); deletePage(page.id) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-red-400"
                >
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xxs text-[var(--color-text-muted)]">
                  v{page.version}
                </span>
                <span className="text-xxs text-[var(--color-text-muted)]">
                  {new Date(page.updated_at).toLocaleDateString()}
                </span>
              </div>
              {Array.isArray(page.tags) && page.tags.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(page.tags ?? []).slice(0, 3).map(tag => (
                    <span key={tag} className="text-xxs px-1 py-0.5 rounded bg-white/5 text-[var(--color-text-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}

          {filteredPages.length === 0 && (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              <FiFileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">
                {searchQuery ? 'No pages found' : 'No pages yet'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setShowTemplates(true)}
                  className="text-xs text-accent-blue hover:underline mt-1"
                >
                  Create one
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      {activePage ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
            {/* Title */}
            <input
              type="text"
              value={editTitle}
              onChange={e => handleTitleChange(e.target.value)}
              className="text-base font-semibold bg-transparent border-none outline-none flex-1 min-w-0"
              placeholder="Page title..."
            />

            {/* View mode toggle */}
            <div className="flex items-center bg-[var(--color-surface)] rounded border border-[var(--color-border)]">
              {[
                { mode: 'edit' as ViewMode, icon: <FiEdit3 className="w-3 h-3" />, label: 'Edit' },
                { mode: 'split' as ViewMode, icon: <FiColumns className="w-3 h-3" />, label: 'Split' },
                { mode: 'preview' as ViewMode, icon: <FiEye className="w-3 h-3" />, label: 'Preview' },
              ].map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={clsx(
                    'px-2 py-1 text-xs flex items-center gap-1 transition-colors',
                    viewMode === mode
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-text-muted)] hover:text-white'
                  )}
                  title={label}
                >
                  {icon}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => insertSnippet('latex')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Insert LaTeX"
              >
                <FiHash className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => insertSnippet('table')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Insert Table"
              >
                <FiGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => insertSnippet('code')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Insert Code Block"
              >
                <FiCode className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={copyContent}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Copy content"
              >
                <FiCopy className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

              <button
                onClick={loadVersions}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Version history"
              >
                <FiClock className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => exportPage('markdown')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Export Markdown"
              >
                <FiDownload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={savePage}
                disabled={saving}
                className={clsx(
                  'px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors',
                  hasUnsavedChanges
                    ? 'bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30'
                    : 'text-[var(--color-text-muted)] hover:bg-white/5'
                )}
              >
                <FiSave className="w-3 h-3" />
                {saving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
              </button>
            </div>
          </div>

          {/* Tags bar */}
          <div className="px-4 py-1.5 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
            <FiTag className="w-3 h-3 text-[var(--color-text-muted)]" />
            <div className="flex items-center gap-1 flex-wrap flex-1">
              {editTags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xxs bg-white/5 rounded text-[var(--color-text-secondary)]"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400">
                    <FiX className="w-2.5 h-2.5" />
                  </button>
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

          {/* Editor / Preview area */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Editor pane */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div className={clsx('flex-1 flex flex-col min-w-0', viewMode === 'split' && 'border-r border-[var(--color-border)]')}>
                <textarea
                  ref={editorRef}
                  value={editContent}
                  onChange={e => handleContentChange(e.target.value)}
                  className="flex-1 w-full p-4 bg-transparent text-sm font-mono resize-none outline-none leading-relaxed"
                  placeholder="Start writing in Markdown...

Supports:
- **Bold**, *italic*, ~~strikethrough~~
- LaTeX: $E = mc^2$ or $$\int_0^\infty$$
- Tables, code blocks, lists
- Links, images, and more"
                  spellCheck={false}
                />
              </div>
            )}

            {/* Preview pane */}
            {(viewMode === 'preview' || viewMode === 'split') && (
              <div className="flex-1 overflow-y-auto min-w-0">
                <div className="p-6 max-w-3xl mx-auto prose prose-invert prose-sm
                  prose-headings:text-white prose-headings:font-semibold
                  prose-p:text-[var(--color-text-secondary)]
                  prose-a:text-accent-blue prose-a:no-underline hover:prose-a:underline
                  prose-code:text-accent-green prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                  prose-pre:bg-[#0a0a0a] prose-pre:border prose-pre:border-[var(--color-border)] prose-pre:rounded-lg
                  prose-th:text-white prose-th:border-[var(--color-border)] prose-th:px-3 prose-th:py-1.5
                  prose-td:border-[var(--color-border)] prose-td:px-3 prose-td:py-1.5
                  prose-table:border-collapse
                  prose-blockquote:border-l-accent-blue prose-blockquote:text-[var(--color-text-muted)]
                  prose-strong:text-white prose-em:text-[var(--color-text-secondary)]
                  prose-hr:border-[var(--color-border)]
                  prose-li:text-[var(--color-text-secondary)]
                  prose-img:rounded-lg
                ">
                  {editContent ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {editContent}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-[var(--color-text-muted)] italic">Nothing to preview</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="px-4 py-1 border-t border-[var(--color-border)] flex items-center justify-between text-xxs text-[var(--color-text-muted)] shrink-0">
            <div className="flex items-center gap-3">
              <span>Markdown</span>
              <span>{(editContent || '').length} chars</span>
              <span>{(editContent || '').split('\n').length} lines</span>
              <span>{(editContent || '').split(/\s+/).filter(Boolean).length} words</span>
            </div>
            <div className="flex items-center gap-3">
              <span>v{activePage.version ?? 1}</span>
              <span>Last saved {activePage.updated_at ? new Date(activePage.updated_at).toLocaleTimeString() : '—'}</span>
            </div>
          </div>
        </div>
      ) : (
        /* No page selected */
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <FiFileText className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium mb-2">No page selected</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Select a page from the sidebar or create a new one
            </p>
            <button
              onClick={() => setShowTemplates(true)}
              className="btn text-accent-blue hover:bg-accent-blue/10"
            >
              <FiPlus className="w-4 h-4 mr-1" />
              New Page
            </button>
          </div>
        </div>
      )}

      {/* Template picker modal */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowTemplates(false)}>
          <div className="glass-card w-full max-w-md mx-4 p-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
              <h2 className="text-sm font-semibold">New Page</h2>
              <button onClick={() => setShowTemplates(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2">
              {templates.map(template => (
                <button
                  key={template.name}
                  onClick={() => createPage(template)}
                  className="w-full text-left p-3 rounded hover:bg-white/5 transition-colors flex items-center gap-3"
                >
                  <div className="p-2 rounded bg-white/5 text-[var(--color-text-muted)]">
                    {template.icon}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{template.name}</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">
                      {template.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Version history panel */}
      {showVersions && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowVersions(false)}>
          <div className="glass-card w-full max-w-lg mx-4 p-0 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] shrink-0">
              <h2 className="text-sm font-semibold">Version History</h2>
              <button onClick={() => setShowVersions(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {versions.length > 0 ? (
                versions.map(ver => (
                  <div
                    key={ver.version}
                    className="p-3 rounded hover:bg-white/5 flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        v{ver.version} — {ver.title}
                      </div>
                      <div className="text-xxs text-[var(--color-text-muted)]">
                        {new Date(ver.created_at).toLocaleString()}
                      </div>
                      <div className="text-xxs text-[var(--color-text-muted)] mt-0.5 line-clamp-1">
                        {(ver.content || '').slice(0, 100)}...
                      </div>
                    </div>
                    <button
                      onClick={() => restoreVersion(ver.version)}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-accent-blue hover:bg-accent-blue/10 rounded transition-all"
                    >
                      <FiRotateCcw className="w-3 h-3 inline mr-1" />
                      Restore
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-[var(--color-text-muted)]">
                  <FiClock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No version history yet</p>
                  <p className="text-xxs mt-1">Versions are created on each save</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

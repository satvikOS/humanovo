import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  FiPlus, FiTrash2, FiSave, FiDownload, FiClock, FiTag,
  FiEdit3, FiEye, FiColumns, FiFileText,
  FiCode, FiHash, FiRotateCcw, FiX, FiSearch,
  FiCopy, FiBookOpen, FiGrid, FiList,
  FiPrinter, FiClipboard, FiTarget, FiActivity,
  FiBold, FiItalic, FiImage, FiLink
} from 'react-icons/fi'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { marked } from 'marked'
import TurndownService from 'turndown'
import api, { NotebookPage, NotebookVersion } from '../services/api'
import { persistGet, persistSet, formatDate, formatDateTime } from '../utils/persistence'

// Configure turndown for HTML-to-markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
})
// Keep images with base64 data URIs
turndownService.addRule('base64images', {
  filter: (node: any) => node.nodeName === 'IMG' && node.getAttribute('src')?.startsWith('data:'),
  replacement: (_content: string, node: any) => `![${node.getAttribute('alt') || 'Image'}](${node.getAttribute('src')})`,
})

// Configure marked for markdown-to-HTML
marked.setOptions({ gfm: true, breaks: true })

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

type TemplateCategory = 'general' | 'research' | 'clinical' | 'analysis' | 'collaboration' | 'publication'

const TEMPLATE_CATEGORY_COLORS: Record<TemplateCategory, string> = {
  general: '#94a3b8',
  research: '#3b82f6',
  clinical: '#ef4444',
  analysis: '#22c55e',
  collaboration: '#f59e0b',
  publication: '#a855f7',
}

const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  general: 'General',
  research: 'Research',
  clinical: 'Clinical',
  analysis: 'Analysis',
  collaboration: 'Collaboration',
  publication: 'Publication',
}

function buildTemplates(style: CitationStyle): { name: string; icon: React.ReactNode; description: string; content: string; category: TemplateCategory }[] {
  const cite = citationPlaceholders(style)

const PAGE_TEMPLATES: { name: string; icon: React.ReactNode; description: string; content: string; category: TemplateCategory }[] = [
  {
    name: 'Blank',
    icon: <FiFileText className="w-4 h-4" />,
    description: 'Start from scratch',
    content: '',
    category: 'general',
  },
  {
    name: 'Research Notes',
    icon: <FiBookOpen className="w-4 h-4" />,
    description: 'Structured lab notebook with FAIR data principles',
    category: 'research' as TemplateCategory,
    content: `# Research Notes — [Project Title]

> **PI:** [Principal Investigator]
> **Date:** ${formatDate(new Date())}
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
    category: 'research' as TemplateCategory,
    content: `# Experiment Log — [Experiment Title]

> **Experiment ID:** EXP-${Date.now().toString(36).toUpperCase()}
> **Date initiated:** ${formatDate(new Date())}
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
    category: 'research' as TemplateCategory,
    content: `# Systematic Literature Review — [Topic]

> **Review ID:** LR-${Date.now().toString(36).toUpperCase()}
> **Date initiated:** ${formatDate(new Date())}
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
| PubMed / MEDLINE | ${formatDate(new Date())} | [n] |
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
    category: 'analysis' as TemplateCategory,
    content: `# Data Analysis Report — [Study Title]

> **Analysis ID:** DA-${Date.now().toString(36).toUpperCase()}
> **Analyst:** [Name, affiliation]
> **Date:** ${formatDate(new Date())}
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
  {
    name: 'Clinical Protocol',
    icon: <FiActivity className="w-4 h-4" />,
    description: 'Clinical trial protocol with regulatory framework',
    category: 'clinical' as TemplateCategory,
    content: `# Clinical Protocol — [Study Title]

> **Protocol ID:** CP-${Date.now().toString(36).toUpperCase()}
> **Version:** 1.0
> **Date:** ${formatDate(new Date())}
> **Sponsor:** [Organization]
> **Principal Investigator:** [Name, credentials]

---

## 1. Study Synopsis

| Element | Description |
|---------|-------------|
| Title | [Full study title] |
| Phase | [Phase I / II / III / IV] |
| Design | [Randomized, double-blind, placebo-controlled] |
| Population | [Target population, key inclusion criteria] |
| Sample Size | N = [number] ([power calculation basis]) |
| Duration | [Enrollment period] + [Follow-up period] |
| Primary Endpoint | [Primary efficacy/safety endpoint] |
| Secondary Endpoints | [List key secondary endpoints] |

## 2. Background & Rationale

**Disease overview:** [Brief description of condition, prevalence, unmet need]

**Investigational product:** [Drug/device name, mechanism of action, preclinical/clinical data summary]

**Risk-benefit assessment:** [Justify the study based on available evidence]

## 3. Study Objectives

### Primary Objective
- To evaluate [efficacy/safety] of [intervention] compared to [comparator] in [population]

### Secondary Objectives
- To assess [secondary efficacy measure]
- To characterize [pharmacokinetic/pharmacodynamic profile]
- To evaluate [patient-reported outcomes]

## 4. Study Population

### 4.1 Inclusion Criteria
1. Age ≥ [min] and ≤ [max] years
2. Confirmed diagnosis of [condition] by [diagnostic criteria]
3. [Disease severity/stage requirement]
4. Adequate organ function: [specify lab values]
5. Written informed consent

### 4.2 Exclusion Criteria
1. Prior treatment with [specified therapy] within [time period]
2. Known hypersensitivity to [study drug or excipients]
3. Active [comorbid condition]
4. Pregnant or breastfeeding
5. Participation in another clinical trial within [time period]

## 5. Study Design & Treatment

### 5.1 Treatment Arms

| Arm | Intervention | Dose | Route | Schedule |
|-----|-------------|------|-------|----------|
| A (Active) | [Drug name] | [Dose] | [PO/IV/SC] | [Frequency, duration] |
| B (Control) | [Placebo/SOC] | [Dose] | [PO/IV/SC] | [Frequency, duration] |

### 5.2 Randomization & Blinding
- **Randomization ratio:** [1:1 / 2:1]
- **Stratification factors:** [List factors]
- **Blinding:** [Double-blind / Open-label]
- **Unblinding procedures:** [Emergency unblinding criteria]

## 6. Study Assessments

### 6.1 Schedule of Assessments

| Assessment | Screening | Baseline | Week 4 | Week 8 | Week 12 | End of Study |
|-----------|:---------:|:--------:|:------:|:------:|:-------:|:------------:|
| Informed consent | X | | | | | |
| Medical history | X | | | | | |
| Physical exam | X | X | | X | | X |
| Vital signs | X | X | X | X | X | X |
| Lab tests | X | X | X | X | X | X |
| Primary endpoint | | X | | X | | X |
| Adverse events | | X | X | X | X | X |

## 7. Safety Monitoring

### 7.1 Adverse Event Reporting
- **AE collection period:** From first dose to [time period] after last dose
- **SAE reporting:** Within 24 hours to sponsor and IRB/EC
- **DSMB reviews:** [Frequency and trigger criteria]

### 7.2 Stopping Rules
1. [Toxicity threshold for individual subject withdrawal]
2. [Futility criteria for study termination]
3. [Safety signal threshold]

## 8. Statistical Considerations

### 8.1 Sample Size Calculation
Based on [effect size], with α = 0.05 (two-sided), power = 80%:
$$
n = \\frac{(Z_{\\alpha/2} + Z_{\\beta})^2 (\\sigma_1^2 + \\sigma_2^2)}{\\Delta^2} = [\\text{calculated value per arm}]
$$

### 8.2 Analysis Populations
- **ITT:** All randomized subjects
- **mITT:** All randomized subjects who received ≥1 dose
- **Per-protocol:** mITT excluding major protocol violations
- **Safety:** All subjects who received ≥1 dose

## 9. Ethical Considerations

- [ ] IRB/EC approval obtained
- [ ] Informed consent form finalized
- [ ] Data monitoring committee established
- [ ] Insurance/indemnity in place
- [ ] GCP training completed for all site staff

## 10. References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Meeting Notes',
    icon: <FiClipboard className="w-4 h-4" />,
    description: 'Structured meeting minutes with action items',
    category: 'collaboration' as TemplateCategory,
    content: `# Meeting Notes — [Meeting Title]

> **Date:** ${formatDate(new Date())}
> **Time:** [Start time] — [End time]
> **Location:** [Room / Virtual link]
> **Facilitator:** [Name]
> **Note-taker:** [Name]

---

## Attendees

| Name | Role | Present |
|------|------|:-------:|
| [Name 1] | [PI / Lead] | Yes |
| [Name 2] | [Researcher] | Yes |
| [Name 3] | [Collaborator] | No |

## Agenda

1. [Topic 1 — Presenter name] (15 min)
2. [Topic 2 — Presenter name] (20 min)
3. [Topic 3 — Presenter name] (10 min)
4. Open discussion (15 min)

---

## Discussion Summary

### Topic 1: [Title]

**Key points:**
- [Point 1]
- [Point 2]

**Decisions made:**
- [Decision 1]

### Topic 2: [Title]

**Key points:**
- [Point 1]

**Questions raised:**
- [Question — who will follow up]

### Topic 3: [Title]

**Key points:**
- [Point 1]

---

## Action Items

| # | Action | Owner | Due Date | Status |
|---|--------|-------|----------|--------|
| 1 | [Action description] | [Name] | [Date] | Pending |
| 2 | [Action description] | [Name] | [Date] | Pending |
| 3 | [Action description] | [Name] | [Date] | Pending |

## Follow-up Items

- [ ] Schedule next meeting for [date]
- [ ] Distribute meeting notes to attendees
- [ ] [Additional follow-up]

## Next Meeting

**Date:** [Proposed date]
**Agenda preview:**
1. Review action items from this meeting
2. [Upcoming topic]
`,
  },
  {
    name: 'Grant Proposal',
    icon: <FiTarget className="w-4 h-4" />,
    description: 'Research grant proposal outline with budget framework',
    category: 'collaboration' as TemplateCategory,
    content: `# Grant Proposal — [Project Title]

> **PI:** [Name, credentials, institution]
> **Co-investigators:** [Names]
> **Funding agency:** [NIH / NSF / ERC / Other]
> **Mechanism:** [R01 / R21 / R03 / K award / Other]
> **Requested amount:** $[Amount] over [Duration] years
> **Submission deadline:** [Date]

---

## 1. Specific Aims

**Long-term goal:** [Broad research vision]

**Overall objective:** [What this specific project will accomplish]

**Central hypothesis:** [Testable hypothesis based on preliminary data]

**Rationale:** [Why this work is important and timely]

### Aim 1: [Concise aim statement]
**Hypothesis:** [Specific testable hypothesis]
**Approach:** [Brief method description]
**Expected outcome:** [Anticipated results]

### Aim 2: [Concise aim statement]
**Hypothesis:** [Specific testable hypothesis]
**Approach:** [Brief method description]
**Expected outcome:** [Anticipated results]

### Aim 3: [Concise aim statement]
**Hypothesis:** [Specific testable hypothesis]
**Approach:** [Brief method description]
**Expected outcome:** [Anticipated results]

**Impact:** [How completion of aims will advance the field]

## 2. Significance

**Burden of disease:** [Epidemiology, unmet need, societal impact]

**Current gaps:** [What is unknown or inadequately addressed]

**Innovation:** [How this project differs from existing approaches]

**Expected impact:** [How this work will change clinical practice/scientific understanding]

## 3. Innovation

- **Conceptual innovation:** [Novel hypothesis or theoretical framework]
- **Technical innovation:** [New methods, tools, or approaches]
- **Applied innovation:** [New applications or translational potential]

## 4. Approach

### 4.1 Preliminary Data

[Summarize key preliminary results that support feasibility]

### 4.2 Research Design

**Aim 1 detailed approach:**
- [Methods, models, analysis plan]
- [Controls and validation strategy]
- [Timeline: months 1-12]

**Aim 2 detailed approach:**
- [Methods, models, analysis plan]
- [Controls and validation strategy]
- [Timeline: months 6-24]

**Aim 3 detailed approach:**
- [Methods, models, analysis plan]
- [Controls and validation strategy]
- [Timeline: months 18-36]

### 4.3 Potential Problems & Alternative Strategies

| Potential Problem | Alternative Strategy |
|-------------------|---------------------|
| [Problem 1] | [Contingency plan] |
| [Problem 2] | [Contingency plan] |
| [Problem 3] | [Contingency plan] |

### 4.4 Timeline

| Activity | Y1 Q1 | Y1 Q2 | Y1 Q3 | Y1 Q4 | Y2 Q1 | Y2 Q2 | Y2 Q3 | Y2 Q4 |
|----------|:------:|:------:|:------:|:------:|:------:|:------:|:------:|:------:|
| Aim 1 | X | X | X | X | | | | |
| Aim 2 | | | X | X | X | X | | |
| Aim 3 | | | | | | X | X | X |
| Manuscripts | | | | X | | | | X |

## 5. Budget Overview

| Category | Year 1 | Year 2 | Total |
|----------|--------|--------|-------|
| Personnel | | | |
| Equipment | | | |
| Supplies | | | |
| Travel | | | |
| Other | | | |
| **Total direct** | | | |
| F&A ([rate]%) | | | |
| **Total** | | | |

## 6. References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Case Report',
    icon: <FiActivity className="w-4 h-4" />,
    description: 'Clinical case report following CARE guidelines',
    category: 'clinical' as TemplateCategory,
    content: `# Clinical Case Report — [Brief Title]

> **Report ID:** CR-${Date.now().toString(36).toUpperCase()}
> **Date:** ${formatDate(new Date())}
> **Author(s):** [Names, affiliations]
> **Institution:** [Hospital/clinic name]
> **IRB/Ethics:** [Approval number or waiver]

---

## 1. Introduction

**Background:** [Disease/condition context, incidence, why this case is noteworthy]

**Rationale for reporting:** [Novel presentation / Rare condition / Unexpected outcome / Diagnostic challenge]

## 2. Patient Information

| Attribute | Details |
|-----------|---------|
| Age | [Years] |
| Sex | [M/F/Other] |
| Ethnicity | [If relevant] |
| Occupation | [If relevant] |
| Key comorbidities | [List] |
| Relevant family history | [Details] |
| Relevant social history | [Details] |

**Chief complaint:** [Primary symptom in patient's words]

## 3. Clinical Findings

### 3.1 History of Present Illness
[Chronological narrative of symptom onset, duration, character, associated symptoms, aggravating/relieving factors]

### 3.2 Physical Examination
| System | Findings |
|--------|----------|
| General | [Appearance, vitals] |
| [Relevant system 1] | [Findings] |
| [Relevant system 2] | [Findings] |

### 3.3 Diagnostic Workup

| Test | Result | Reference Range | Interpretation |
|------|--------|-----------------|----------------|
| [Lab test 1] | [Value] | [Range] | [Normal/Abnormal] |
| [Lab test 2] | [Value] | [Range] | [Normal/Abnormal] |
| [Imaging 1] | [Findings] | — | [Interpretation] |

## 4. Diagnostic Assessment

**Primary diagnosis:** [Diagnosis with ICD code if applicable]

**Differential diagnosis considered:**
1. [Diagnosis 1] — [Why ruled in/out]
2. [Diagnosis 2] — [Why ruled in/out]
3. [Diagnosis 3] — [Why ruled in/out]

**Diagnostic reasoning:** [How the final diagnosis was reached]

## 5. Treatment & Interventions

| Intervention | Details | Start Date | Duration |
|-------------|---------|------------|----------|
| [Medication 1] | [Dose, route, frequency] | [Date] | [Duration] |
| [Procedure] | [Description] | [Date] | — |
| [Supportive care] | [Details] | [Date] | [Duration] |

## 6. Outcome & Follow-up

### Timeline
| Time Point | Status | Key Findings |
|-----------|--------|-------------|
| Baseline | [Condition] | [Key metrics] |
| [Week/Month X] | [Improved/Stable/Worsened] | [Key metrics] |
| [Final follow-up] | [Outcome] | [Key metrics] |

**Patient perspective:** [Patient's reported experience, if available]

## 7. Discussion

**Key learning points:**
1. [Teaching point 1]
2. [Teaching point 2]
3. [Teaching point 3]

**Literature context:** [How this case compares to published literature]

**Limitations:** [Limitations of single case reports, missing data]

## 8. References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Journal Article',
    icon: <FiFileText className="w-4 h-4" />,
    description: 'IMRAD-format journal article manuscript',
    category: 'publication' as TemplateCategory,
    content: `# [Article Title]

> **Authors:** [Author 1], [Author 2], [Author 3]
> **Affiliations:** [Department, Institution, City, Country]
> **Corresponding author:** [Email]

---

## Abstract

**Background:** [1-2 sentences on context and knowledge gap]

**Methods:** [1-2 sentences on study design and approach]

**Results:** [2-3 sentences on key findings with quantitative data]

**Conclusions:** [1-2 sentences on implications]

**Keywords:** [keyword 1], [keyword 2], [keyword 3], [keyword 4], [keyword 5]

---

## 1. Introduction

[Paragraph 1: Broad context — what is the field and why does it matter?]

[Paragraph 2: What is currently known — key findings from prior work]

[Paragraph 3: What is the gap — what remains unknown or unresolved?]

[Paragraph 4: Study objective — what does this paper aim to address?]

## 2. Methods

### 2.1 Study Design
[Study type, setting, time period, ethical approvals]

### 2.2 Participants / Samples
[Selection criteria, sample size, demographics]

### 2.3 Procedures
[Experimental or clinical procedures, instruments used]

### 2.4 Statistical Analysis
[Tests used, significance thresholds, software]

## 3. Results

### 3.1 [Primary Outcome]

| Group | n | Outcome (Mean ± SD) | p-value |
|-------|---|---------------------|---------|
| Control | | | |
| Treatment | | | |

### 3.2 [Secondary Outcomes]
[Additional findings]

## 4. Discussion

[Summary of key findings, comparison with literature, strengths, limitations, implications]

## 5. Conclusions

[Concise summary of main findings and their significance]

## Acknowledgments

[Funding sources, contributors]

## Conflict of Interest

The authors declare no conflicts of interest.

## References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Thesis / Dissertation',
    icon: <FiBookOpen className="w-4 h-4" />,
    description: 'Graduate thesis or dissertation chapter structure',
    category: 'publication' as TemplateCategory,
    content: `# [Thesis Title]

> **Author:** [Full Name]
> **Degree:** [PhD / MSc / MD] in [Field]
> **Institution:** [University Name]
> **Supervisor:** [Name, Title]
> **Date:** ${formatDate(new Date())}

---

## Abstract

[250-350 word summary covering background, objectives, methods, results, and conclusions]

**Keywords:** [keyword 1], [keyword 2], [keyword 3], [keyword 4], [keyword 5]

---

## Chapter 1: Introduction

### 1.1 Background
[Broad overview of the research area]

### 1.2 Problem Statement
[Specific problem this thesis addresses]

### 1.3 Research Questions
1. [Research question 1]
2. [Research question 2]
3. [Research question 3]

### 1.4 Objectives
**Primary objective:** [Main aim]

**Secondary objectives:**
- [Objective 1]
- [Objective 2]

### 1.5 Thesis Structure
[Brief overview of each chapter]

---

## Chapter 2: Literature Review

### 2.1 [Major Theme 1]
[Review of relevant literature]

### 2.2 [Major Theme 2]
[Review of relevant literature]

### 2.3 Summary and Research Gap
[Synthesis and identification of the gap this thesis fills]

---

## Chapter 3: Methodology

### 3.1 Research Design
[Overall approach and justification]

### 3.2 Data Collection
[Sources, instruments, sampling strategy]

### 3.3 Data Analysis
[Analytical methods, software, statistical tests]

### 3.4 Ethical Considerations
[IRB approval, informed consent, data handling]

---

## Chapter 4: Results

### 4.1 [Result Set 1]
[Findings with tables and figures]

### 4.2 [Result Set 2]
[Findings with tables and figures]

---

## Chapter 5: Discussion

### 5.1 Summary of Findings
### 5.2 Comparison with Literature
### 5.3 Implications
### 5.4 Limitations
### 5.5 Future Research

---

## Chapter 6: Conclusions

[Final synthesis of the thesis contribution]

---

## References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}

## Appendices

### Appendix A: [Title]
[Supplementary material]
`,
  },
  {
    name: 'Book Chapter',
    icon: <FiHash className="w-4 h-4" />,
    description: 'Contributed book chapter with section structure',
    category: 'publication' as TemplateCategory,
    content: `# [Chapter Title]

> **Authors:** [Author 1], [Author 2]
> **Book:** [Book Title]
> **Editors:** [Editor 1], [Editor 2]
> **Publisher:** [Publisher Name]

---

## 1. Introduction

[Opening paragraph establishing the chapter's topic within the broader book context]

## 2. [Main Section Title]

### 2.1 [Subsection]
[Content with appropriate depth for a book chapter audience]

### 2.2 [Subsection]
[Content]

## 3. [Main Section Title]

### 3.1 [Subsection]
[Content]

### 3.2 [Subsection]
[Content]

## 4. [Main Section Title]

[Content]

## 5. Current Challenges and Future Directions

[Discussion of open questions and emerging trends]

## 6. Summary

**Key takeaways:**
- [Point 1]
- [Point 2]
- [Point 3]

## Glossary

| Term | Definition |
|------|-----------|
| [Term 1] | [Definition] |
| [Term 2] | [Definition] |

## References (${cite.format})

1. ${cite.example1}
2. ${cite.example2}
`,
  },
  {
    name: 'Review Article',
    icon: <FiList className="w-4 h-4" />,
    description: 'Narrative or systematic review article',
    category: 'publication' as TemplateCategory,
    content: `# [Review Title]: A [Systematic / Narrative] Review

> **Authors:** [Author 1], [Author 2]
> **Target journal:** [Journal Name]
> **Date:** ${formatDate(new Date())}

---

## Abstract

**Purpose:** [What does this review aim to summarize?]

**Methods:** [Search strategy, databases, criteria]

**Findings:** [Key themes and conclusions]

**Implications:** [What the evidence means for practice]

**Keywords:** [keyword 1], [keyword 2], [keyword 3], [keyword 4]

---

## 1. Introduction

[Context, rationale, and scope of the review]

## 2. Search Methodology

| Parameter | Details |
|-----------|---------|
| Databases | [PubMed, Embase, Scopus, etc.] |
| Date range | [Start] – [End] |
| Search terms | [Terms] |
| Articles identified | [Number] |
| Articles included | [Number] |

## 3. [Thematic Section 1]

### 3.1 [Subtopic]
[Synthesis of evidence]

### 3.2 [Subtopic]
[Synthesis of evidence]

## 4. [Thematic Section 2]

### 4.1 [Subtopic]
[Synthesis of evidence]

## 5. [Thematic Section 3]

[Synthesis of evidence]

## 6. Discussion

### 6.1 Summary of Evidence
### 6.2 Gaps in the Literature
### 6.3 Implications for Practice

## 7. Conclusions

[Concise synthesis]

## References (${cite.format})

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
  const [pages, setPagesRaw] = useState<NotebookPage[]>(() => persistGet<NotebookPage[]>('notebook-pages', []))
  const [activePage, setActivePage] = useState<NotebookPage | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [loading, setLoading] = useState(true)

  // Persist pages to localStorage whenever they change
  const setPages = useCallback((updater: NotebookPage[] | ((prev: NotebookPage[]) => NotebookPage[])) => {
    setPagesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      persistSet('notebook-pages', next)
      return next
    })
  }, [])
  const [saving, setSaving] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  // Build templates dynamically based on selected citation style
  // Re-read citation style from localStorage each time the template modal opens
  const templates = useMemo(() => buildTemplates(getCitationStyle()), [showTemplates])
  const [showVersions, setShowVersions] = useState(false)
  // deleteConfirmId state removed — delete modal is now built via direct DOM manipulation
  const [versions, setVersions] = useState<NotebookVersion[]>([])
  const [tagInput, setTagInput] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarView, setSidebarView] = useState<'list' | 'grid'>('list')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const richEditorRef = useRef<HTMLDivElement>(null)
  const isUpdatingRef = useRef(false)

  // Auto-save with debounce
  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setHasUnsavedChanges(true)
    saveTimerRef.current = window.setTimeout(() => {
      savePage()
    }, 2000)
  }, [activePage?.id])

  // Convert markdown to HTML for rendering
  const contentToHtml = useCallback((md: string): string => {
    if (!md) return ''
    try {
      return marked.parse(md) as string
    } catch {
      return `<p>${md}</p>`
    }
  }, [])

  // Track whether the rich editor is being initialized (to prevent input handlers from wiping content)
  const editorInitializingRef = useRef(false)

  // Sync rich editor HTML changes back to markdown (does NOT re-render the editor)
  const handleRichEditorInput = useCallback(() => {
    if (isUpdatingRef.current || editorInitializingRef.current) return
    const el = richEditorRef.current
    if (!el) return
    // Don't sync if editor is empty and we have content (editor just mounted)
    if (!el.innerHTML.trim() && editContent.trim()) return
    try {
      isUpdatingRef.current = true
      const html = el.innerHTML
      const md = turndownService.turndown(html)
      setEditContent(md)
      setHasUnsavedChanges(true)
      scheduleAutoSave()
    } finally {
      isUpdatingRef.current = false
    }
  }, [scheduleAutoSave, editContent])

  // Handle paste in rich editor: intercept images and render them inline
  const handleRichPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const file = items[i].getAsFile()
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result as string
          document.execCommand('insertImage', false, base64)
          // Sync back to markdown after a small delay
          setTimeout(() => handleRichEditorInput(), 50)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }, [handleRichEditorInput])

  // Set rich editor content imperatively only when content changes externally
  // (template selection, version restore, page switch, view mode switch) - never during typing
  const lastExternalContent = useRef('')
  useEffect(() => {
    if (isUpdatingRef.current) return
    const el = richEditorRef.current
    if (!el) return
    // Update when content changed from outside OR when editor just remounted (empty innerHTML)
    const editorIsEmpty = !el.innerHTML.trim()
    if (lastExternalContent.current !== editContent || editorIsEmpty) {
      try {
        editorInitializingRef.current = true
        const currentMd = editorIsEmpty ? '' : turndownService.turndown(el.innerHTML)
        if (currentMd !== editContent) {
          el.innerHTML = contentToHtml(editContent)
        }
      } catch {
        el.innerHTML = contentToHtml(editContent)
      } finally {
        editorInitializingRef.current = false
      }
      lastExternalContent.current = editContent
    }
  }, [editContent, contentToHtml, viewMode])

  // Load pages
  useEffect(() => {
    loadPages()
  }, [])

  const loadPages = async () => {
    try {
      setLoading(true)
      const cachedPages = persistGet<NotebookPage[]>('notebook-pages', [])
      let apiItems: NotebookPage[] = []
      try {
        const res = await api.getNotebookPages({ page_size: 100 }) || {}
        apiItems = Array.isArray(res.items) ? res.items : []
      } catch {
        // API unavailable — use cached pages
      }

      // Merge API pages with locally-created pages
      const apiIds = new Set(apiItems.map(p => p.id))
      const localOnly = cachedPages.filter(p => !apiIds.has(p.id))
      const merged = [...apiItems, ...localOnly]
      merged.sort((a, b) => (new Date(b.updated_at || b.created_at || 0).getTime()) - (new Date(a.updated_at || a.created_at || 0).getTime()))

      if (merged.length > 0) {
        setPages(merged)
        if (!activePage) selectPage(merged[0])
      } else {
        // Only show Getting Started for truly fresh users (never used notebook before)
        const hasUsedNotebook = persistGet<boolean>('notebook-onboarded', false)
        if (!hasUsedNotebook) {
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
          persistSet('notebook-onboarded', true)
          setPages([defaultPage])
          selectPage(defaultPage)
        } else {
          // User has used notebook before but deleted all pages — show empty state
          setPages([])
        }
      }
    } catch (err) {
      console.error('Failed to load notebook pages:', err)
      // Use cached pages if available, otherwise create fallback
      const cachedPages = persistGet<NotebookPage[]>('notebook-pages', [])
      if (cachedPages.length > 0) {
        setPages(cachedPages)
        if (!activePage) selectPage(cachedPages[0])
      } else {
        const hasUsedNotebook = persistGet<boolean>('notebook-onboarded', false)
        if (!hasUsedNotebook) {
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
        } else {
          setPages([])
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const selectPage = useCallback((page: NotebookPage) => {
    setActivePage(page)
    const content = page.content || ''
    setEditContent(content)
    setEditTitle(page.title || '')
    setEditTags(Array.isArray(page.tags) ? page.tags : [])
    setHasUnsavedChanges(false)
    setShowVersions(false)
    // Force editor content refresh on page switch
    lastExternalContent.current = ''
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

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

  // Pre-fillout form state for new page creation
  const [pendingTemplate, setPendingTemplate] = useState<typeof templates[0] | null>(null)
  const [newPageTitle, setNewPageTitle] = useState('')
  const [newPageTags, setNewPageTags] = useState('')

  const selectTemplate = (template: typeof templates[0]) => {
    setPendingTemplate(template)
    setNewPageTitle(template.name)
    setNewPageTags('')
  }

  const cancelCreate = () => {
    setPendingTemplate(null)
    setNewPageTitle('')
    setNewPageTags('')
  }

  const createPage = useCallback(() => {
    const template = pendingTemplate
    const title = newPageTitle.trim() || (template ? template.name : 'Untitled')
    const content = template?.content || ''
    const categoryTag = template?.category ? `category:${template.category}` : 'category:general'
    const extraTags = newPageTags.split(',').map(t => t.trim()).filter(Boolean)
    const tags = [categoryTag, ...extraTags]

    // Close modal immediately
    setPendingTemplate(null)
    setNewPageTitle('')
    setNewPageTags('')
    setShowTemplates(false)

    // Create the page (local first, then try API)
    const localPage: NotebookPage = {
      id: `local-${Date.now()}`,
      title,
      content,
      content_type: 'markdown',
      tags,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setPages(prev => [localPage, ...prev])
    selectPage(localPage)

    // Try API in background — if it succeeds, swap the local page for the API one
    api.createNotebookPage({ title, content, content_type: 'markdown', tags }).then(apiPage => {
      const pageWithContent = { ...apiPage, content: apiPage.content || content, tags: apiPage.tags?.length ? apiPage.tags : tags }
      setPages(prev => prev.map(p => p.id === localPage.id ? pageWithContent : p))
    }).catch(() => { /* keep local page */ })
  }, [pendingTemplate, newPageTitle, newPageTags, selectPage, setPages])

  // Helper to extract template category from page tags
  const getPageCategory = (page: NotebookPage | null): TemplateCategory => {
    const catTag = (page?.tags || []).find(t => t.startsWith('category:'))
    return (catTag?.replace('category:', '') as TemplateCategory) || 'general'
  }

  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const activePageRef = useRef(activePage)
  activePageRef.current = activePage

  const handleDeletePage = useCallback((pageId: string) => {
    // Build modal via DOM — styled to match Simulations delete dialog (2nd image reference)
    const overlay = document.createElement('div')
    overlay.id = 'delete-confirm-overlay'
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      zIndex: '999999', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    })

    const card = document.createElement('div')
    Object.assign(card.style, {
      background: 'var(--color-surface-solid, #1a1a2e)', padding: '24px', borderRadius: '16px',
      maxWidth: '400px', width: '90%', textAlign: 'center', color: 'var(--color-text, #e2e8f0)',
      border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
      boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
    })

    card.innerHTML = `
      <div style="margin-bottom:12px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
      <h3 style="font-size:18px;font-weight:600;margin:0 0 8px 0;">Delete Page?</h3>
      <p style="font-size:14px;color:var(--color-text-muted, #94a3b8);margin:0 0 20px 0;">
        This will permanently delete this page and its contents. This action cannot be undone.
      </p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="delete-cancel-btn" style="padding:8px 16px;font-size:14px;border-radius:8px;border:none;background:transparent;color:var(--color-text-muted, #94a3b8);cursor:pointer;font-weight:500;">
          Cancel
        </button>
        <button id="delete-confirm-btn" style="padding:8px 16px;font-size:14px;border-radius:8px;border:none;background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;font-weight:500;">
          Delete Permanently
        </button>
      </div>
    `

    overlay.appendChild(card)
    document.body.appendChild(overlay)

    const close = () => { if (overlay.parentNode) overlay.remove() }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close()
    })
    card.addEventListener('click', (e) => { e.stopPropagation() })
    card.querySelector('#delete-cancel-btn')!.addEventListener('click', close)
    card.querySelector('#delete-confirm-btn')!.addEventListener('click', () => {
      close()

      try {
        // Cancel any pending auto-save
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        // API delete
        if (!pageId.startsWith('local-')) {
          api.deleteNotebookPage(pageId).catch(() => {})
        }
        persistSet('notebook-onboarded', true)

        // Remove from pages — use flushSync to force synchronous React update
        const currentPages = pagesRef.current
        const remaining = currentPages.filter(p => p.id !== pageId)
        persistSet('notebook-pages', remaining)

        flushSync(() => {
          setPagesRaw(remaining)
        })

        // Switch active page if we deleted the active one
        const currentActive = activePageRef.current
        if (currentActive?.id === pageId) {
          flushSync(() => {
            if (remaining.length > 0) {
              const next = remaining[0]
              setActivePage(next)
              setEditContent(next.content || '')
              setEditTitle(next.title || '')
              setEditTags(Array.isArray(next.tags) ? next.tags : [])
              setHasUnsavedChanges(false)
            } else {
              setActivePage(null)
              setEditContent('')
              setEditTitle('')
              setEditTags([])
            }
          })
        }
      } catch (err) {
        console.error('[DELETE] Error during page deletion:', err)
        alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
      }
    })
  }, []) // No dependencies — uses refs for latest state

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

  const printPage = useCallback(() => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    // Generate HTML from markdown directly to ensure images are included
    let htmlContent: string
    try {
      htmlContent = marked.parse(editContent) as string
    } catch {
      htmlContent = `<pre>${editContent}</pre>`
    }
    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>${editTitle || 'Notebook Page'}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.7; font-size: 14px; }
  h1, h2, h3, h4 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin-top: 1.5em; }
  h1 { font-size: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
  h2 { font-size: 20px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; font-size: 13px; }
  th { background: #f3f4f6; font-weight: 600; }
  code { background: #f3f4f6; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
  pre { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #3b82f6; margin-left: 0; padding-left: 16px; color: #4b5563; }
  img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; display: block; }
  @media print { body { margin: 0; } }
</style></head><body>${htmlContent}</body></html>`)
    printWindow.document.close()
    printWindow.onload = () => { printWindow.print() }
  }, [editContent, editTitle])

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
    <>
    <div className="relative w-full" style={{ height: 'calc(100vh - 3rem)' }}>
      <div className="absolute inset-0 flex" style={{ overflow: 'clip' }}>
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
            <div
              key={page.id}
              role="button"
              tabIndex={0}
              onClick={() => selectPage(page)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') selectPage(page) }}
              className={clsx(
                'w-full text-left p-2 rounded transition-colors group cursor-pointer',
                activePage?.id === page.id
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-white/5'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="w-1.5 h-1.5 rounded-full shrink-0 mr-1.5" style={{ background: TEMPLATE_CATEGORY_COLORS[getPageCategory(page)] || '#94a3b8' }} />
                <span className="text-xs font-medium truncate flex-1">{page.title}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleDeletePage(page.id) }}
                  onMouseDown={e => e.stopPropagation()}
                  className="p-1 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 cursor-pointer shrink-0"
                  title="Delete page"
                  style={{ pointerEvents: 'auto', position: 'relative', zIndex: 20 }}
                >
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xxs text-[var(--color-text-muted)]">
                  v{page.version}
                </span>
                <span className="text-xxs text-[var(--color-text-muted)]">
                  {formatDate(page.updated_at)}
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
            </div>
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
          {/* Category color band */}
          <div className="h-1 shrink-0" style={{ background: TEMPLATE_CATEGORY_COLORS[getPageCategory(activePage)] || '#94a3b8' }} />
          {/* Toolbar */}
          <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
            {/* Category badge */}
            <span
              className="text-xxs px-1.5 py-0.5 rounded font-medium shrink-0"
              style={{
                background: (TEMPLATE_CATEGORY_COLORS[getPageCategory(activePage)] || '#94a3b8') + '20',
                color: TEMPLATE_CATEGORY_COLORS[getPageCategory(activePage)] || '#94a3b8',
              }}
            >
              {TEMPLATE_CATEGORY_LABELS[getPageCategory(activePage)] || 'General'}
            </span>
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
                onClick={printPage}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Print page"
              >
                <FiPrinter className="w-3.5 h-3.5" />
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
            {/* Left pane: WYSIWYG rich text editor OR raw markdown */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div className={clsx('flex-1 flex flex-col min-w-0', viewMode === 'split' && 'border-r border-[var(--color-border)]')}>
                {/* Mini formatting toolbar */}
                <div className="flex items-center gap-0.5 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
                  <button onClick={() => { document.execCommand('bold') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white" title="Bold"><FiBold className="w-3 h-3" /></button>
                  <button onClick={() => { document.execCommand('italic') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white" title="Italic"><FiItalic className="w-3 h-3" /></button>
                  <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />
                  <button onClick={() => { document.execCommand('formatBlock', false, 'h1') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white text-xxs font-bold" title="Heading 1">H1</button>
                  <button onClick={() => { document.execCommand('formatBlock', false, 'h2') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white text-xxs font-bold" title="Heading 2">H2</button>
                  <button onClick={() => { document.execCommand('formatBlock', false, 'h3') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white text-xxs font-bold" title="Heading 3">H3</button>
                  <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />
                  <button onClick={() => { document.execCommand('insertUnorderedList') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white text-xxs" title="Bullet List">List</button>
                  <button onClick={() => { document.execCommand('insertOrderedList') }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white text-xxs" title="Numbered List">1.</button>
                  <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />
                  <button onClick={() => {
                    const url = prompt('Enter link URL:')
                    if (url) document.execCommand('createLink', false, url)
                  }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white" title="Insert Link"><FiLink className="w-3 h-3" /></button>
                  <button onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/*'
                    input.onchange = (e: any) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => { document.execCommand('insertImage', false, reader.result as string) }
                      reader.readAsDataURL(file)
                    }
                    input.click()
                  }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white" title="Insert Image"><FiImage className="w-3 h-3" /></button>
                  <div className="w-px h-3.5 bg-[var(--color-border)] mx-1" />
                  <button onClick={() => setViewMode(viewMode === 'edit' ? 'split' : 'edit')} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-white" title="Toggle raw markdown">
                    <FiCode className="w-3 h-3" />
                  </button>
                  <span className="text-xxs text-[var(--color-text-muted)] ml-auto">Rich Editor</span>
                </div>
                {/* WYSIWYG contenteditable editor - no dangerouslySetInnerHTML to avoid re-render/cursor reset */}
                <div
                  ref={richEditorRef as any}
                  contentEditable
                  suppressContentEditableWarning
                  className="flex-1 w-full p-4 overflow-y-auto text-sm leading-relaxed outline-none rich-editor-pane"
                  style={{ minHeight: 0, wordBreak: 'break-word' }}
                  onInput={handleRichEditorInput}
                  onPaste={handleRichPaste}
                  onBlur={handleRichEditorInput}
                />
              </div>
            )}

            {/* Right pane: rendered document view (read-only styled) */}
            {(viewMode === 'preview' || viewMode === 'split') && (
              <div className="flex-1 overflow-y-auto min-w-0">
                <div className="notebook-preview-pane p-6 max-w-3xl mx-auto prose prose-invert prose-sm
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
                      urlTransform={(url) => url}
                      components={{
                        img: ({ src, alt }) => (
                          <img
                            src={src || ''}
                            alt={alt || 'Image'}
                            style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px', margin: '8px 0', display: 'block' }}
                          />
                        ),
                      }}
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

      </div>

    </div>

    {/* Template picker modal — portaled to document.body */}
    {showTemplates && createPortal(
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60" onClick={() => { setShowTemplates(false); cancelCreate() }}>
        <div className="max-w-lg w-full mx-4 max-h-[80vh] flex flex-col rounded-xl border border-white/10" style={{ background: '#1a1a2e', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', color: '#e2e8f0' }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
            <h2 className="text-sm font-semibold">
              {pendingTemplate ? 'Configure New Page' : 'Choose a Template'}
            </h2>
            <button onClick={() => { setShowTemplates(false); cancelCreate() }} className="p-1 rounded hover:bg-white/10 cursor-pointer" style={{ background: 'transparent', border: 'none', color: '#94a3b8' }}>
              <FiX className="w-4 h-4" />
            </button>
          </div>

          {pendingTemplate ? (
            /* Step 2: Pre-fillout form */
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="p-1.5 rounded shrink-0" style={{ background: (TEMPLATE_CATEGORY_COLORS[pendingTemplate.category] || '#94a3b8') + '33', color: TEMPLATE_CATEGORY_COLORS[pendingTemplate.category] || '#94a3b8' }}>
                  {pendingTemplate.icon}
                </div>
                <div>
                  <div className="text-xs font-medium">{pendingTemplate.name}</div>
                  <div className="text-xxs" style={{ color: '#94a3b8' }}>{pendingTemplate.description}</div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#e2e8f0' }}>Page Title</label>
                <input
                  type="text"
                  value={newPageTitle}
                  onChange={e => setNewPageTitle(e.target.value)}
                  placeholder="Enter page title..."
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') createPage() }}
                  className="w-full px-3 py-2 text-sm rounded-md border border-white/20 outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#e2e8f0' }}>Tags <span style={{ color: '#94a3b8', fontWeight: 400 }}>(comma-separated, optional)</span></label>
                <input
                  type="text"
                  value={newPageTags}
                  onChange={e => setNewPageTags(e.target.value)}
                  placeholder="e.g. research, draft, BRCA1"
                  onKeyDown={e => { if (e.key === 'Enter') createPage() }}
                  className="w-full px-3 py-2 text-sm rounded-md border border-white/20 outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', boxSizing: 'border-box' }}
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={cancelCreate} className="px-4 py-2 text-sm cursor-pointer rounded-lg" style={{ background: 'transparent', border: 'none', color: '#94a3b8' }}>
                  Back
                </button>
                <button onClick={createPage} className="px-4 py-2 text-sm cursor-pointer rounded-lg font-medium" style={{ background: 'rgba(99,102,241,0.2)', border: 'none', color: '#818cf8' }}>
                  Create Page
                </button>
              </div>
            </div>
          ) : (
            /* Step 1: Template selection */
            <div className="p-3 overflow-y-auto">
              {Object.entries(
                templates.reduce<Record<string, typeof templates>>((acc, t) => {
                  const cat = t.category || 'general'
                  if (!acc[cat]) acc[cat] = []
                  acc[cat].push(t)
                  return acc
                }, {})
              ).map(([cat, tmpls]) => (
                <div key={cat} className="mb-3">
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: TEMPLATE_CATEGORY_COLORS[cat as TemplateCategory] || '#94a3b8' }} />
                    <span className="text-xxs font-medium uppercase tracking-wider" style={{ color: '#94a3b8' }}>
                      {TEMPLATE_CATEGORY_LABELS[cat as TemplateCategory] || cat}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {tmpls.map(template => (
                      <button
                        key={template.name}
                        onClick={() => selectTemplate(template)}
                        className="text-left p-3 rounded-lg border border-white/10 hover:bg-white/5 flex items-start gap-2.5 transition-colors cursor-pointer"
                        style={{ background: 'transparent', color: '#e2e8f0' }}
                      >
                        <div className="p-1.5 rounded" style={{ background: (TEMPLATE_CATEGORY_COLORS[template.category] || '#94a3b8') + '33', color: TEMPLATE_CATEGORY_COLORS[template.category] || '#94a3b8' }}>
                          {template.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium">{template.name}</div>
                          <div className="text-xxs mt-0.5" style={{ color: '#94a3b8' }}>
                            {template.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>,
      document.body
    )}

    {/* Version history panel — portaled to document.body */}
    {showVersions && createPortal(
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60" onClick={() => setShowVersions(false)}>
        <div className="max-w-lg w-full mx-4 max-h-[70vh] flex flex-col rounded-xl border border-white/10" style={{ background: '#1a1a2e', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', color: '#e2e8f0' }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
            <h2 className="text-sm font-semibold">Version History</h2>
            <button onClick={() => setShowVersions(false)} className="p-1 rounded hover:bg-white/10 cursor-pointer" style={{ background: 'transparent', border: 'none', color: '#94a3b8' }}>
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
                    <div className="text-xxs" style={{ color: '#94a3b8' }}>
                      {formatDateTime(ver.created_at)}
                    </div>
                    <div className="text-xxs mt-0.5 line-clamp-1" style={{ color: '#94a3b8' }}>
                      {(ver.content || '').slice(0, 100)}...
                    </div>
                  </div>
                  <button
                    onClick={() => restoreVersion(ver.version)}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-accent-blue hover:bg-accent-blue/10 rounded transition-all cursor-pointer"
                    style={{ background: 'transparent', border: 'none' }}
                  >
                    <FiRotateCcw className="w-3 h-3 inline mr-1" />
                    Restore
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-8" style={{ color: '#94a3b8' }}>
                <FiClock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No version history yet</p>
                <p className="text-xxs mt-1">Versions are created on each save</p>
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
  </>
  )
}

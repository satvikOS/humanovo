# humanovo — Definitive Implementation Specification v2

**Sources:**
- Customer discovery: Jamison Seabury, URMC Neuroimaging Lab (MRI + EEG)
- Technical architecture session (March 2026)
- Prior technical audit findings

**Rule:** If anything in this document contradicts the prior v1 spec, THIS document wins.

---

# TABLE OF CONTENTS

1. [Prerequisites — Backend Wiring & Model Swap](#1-prerequisites)
2. [Feature 1 — Lab Capability Filter](#2-lab-capability-filter)
3. [Feature 2 — Backward/Synthesis Pipeline](#3-backward-synthesis-pipeline)
4. [Feature 3 — Output Format & Verbosity Control](#4-output-format-verbosity)
5. [Feature 4 — Visual Summary Layer](#5-visual-summary-layer)
6. [Discovery Pipeline Upgrade (11-Stage)](#6-discovery-pipeline-upgrade)
7. [3-Layer Grounding System](#7-grounding-system)
8. [Auto-Citation System](#8-auto-citation-system)
9. [Constitutional Security & Bias Mitigation](#9-constitutional-security)
10. [Data Sources (Phase 1 — 21 Core)](#10-data-sources)
11. [Database Schema & Migrations](#11-database-schema)
12. [API Endpoints (Complete)](#12-api-endpoints)
13. [WebSocket Protocol](#13-websocket)
14. [Frontend Pages (Complete)](#14-frontend-pages)
15. [Imaging Ingestion Service](#15-imaging-ingestion)
16. [Methods Taxonomy](#16-methods-taxonomy)
17. [Architecture Decisions](#17-architecture-decisions)
18. [Testing Requirements](#18-testing)
19. [Data Sources — Phases 2-4 (39 Additional)](#19-data-sources-extended)
20. [pgvector Management UI (Developer)](#20-pgvector-ui)
21. [Billing & Usage Dashboard](#21-billing-dashboard)
22. [Implementation Priority Order](#22-priority-order)

---

# 1. PREREQUISITES — BACKEND WIRING & MODEL SWAP <a name="1-prerequisites"></a>

**Why this is first:** The Workbench page currently runs on hardcoded mock data. Nothing else works until this is fixed. Every discovery mode selector must call the real LangGraph pipeline.

## 1.1 — Remove All Chinese Models

Delete all references to these models from the codebase:
- DeepSeek-R1
- Mistral-Large-3
- Kimi-K2

Search the entire codebase for these strings and remove them from: model config files, fallback chains, environment variables, docker-compose, any hardcoded model IDs.

## 1.2 — New Model Assignments

Every pipeline stage has exactly ONE primary model. Fallback chains are specified per stage.

```
PROVIDER CONFIGURATION:
  anthropic_bedrock:
    models: [claude-opus-4-6, claude-sonnet-4-6]
    region: us-east-1 (or whatever is configured)
    auth: AWS IAM role
  azure_openai:
    models: [gpt-4.1, o3-mini]
    endpoint: https://<resource>.openai.azure.com/
    api_version: 2024-12-01-preview
    auth: API key from env AZURE_OPENAI_API_KEY
  azure_ai_foundry:
    models: [grok-4-1-fast]
    auth: API key from env AZURE_AI_FOUNDRY_API_KEY
  cohere:
    models: [command-a, embed-v3]
    auth: API key from env COHERE_API_KEY (or via Azure OpenAI)
  openai:
    models: [text-embedding-3-large]
    auth: API key from env OPENAI_API_KEY

STAGE → MODEL MAPPING (Discovery Pipeline):
  SEED:        Claude Opus 4.6 (Bedrock)
  EXPAND:      Claude Sonnet 4.6 (Bedrock)
  EVIDENCE:    GPT-4.1 (Azure OpenAI)
  COUNTER:     GPT-4.1 (Azure OpenAI)
  REVISE:      o3-mini (Azure OpenAI)
  MECHANISM:   Claude Opus 4.6 (Bedrock)
  VALIDATE:    Claude Sonnet 4.6 (Bedrock)
  GROUND:      Claude Opus 4.6 (Bedrock)
  SCORE:       GPT-4.1 (Azure OpenAI)
  REFINE:      Claude Opus 4.6 (Bedrock)
  TRANSLATE:   Claude Sonnet 4.6 (Bedrock)
  FINALIZE:    Claude Sonnet 4.6 (Bedrock)

STAGE → MODEL MAPPING (Backward/Synthesis Pipeline):
  DECOMPOSE:   Claude Opus 4.6 (Bedrock)
  RETRIEVE:    Cohere Command A
  SYNTHESIZE:  Claude Opus 4.6 (Bedrock)
  GAP_ANALYZE: GPT-4.1 (Azure OpenAI)
  FORMAT:      Claude Sonnet 4.6 (Bedrock)

CHAT:          Claude Sonnet 4.6 (Bedrock), NO fallbacks

EMBEDDINGS (cloud-only, no local models):
  Primary:     Cohere Embed v3 (1024 dimensions)
  Secondary:   text-embedding-3-large (1536 dimensions, OpenAI)
  Usage:       Dual-embedding for anti-hallucination cross-check

FALLBACK CHAIN (per stage, ordered):
  Opus stages:    Claude Opus 4.6 → GPT-4.1 → Claude Sonnet 4.6
  Sonnet stages:  Claude Sonnet 4.6 → GPT-4.1 → Grok-4-1-fast
  GPT stages:     GPT-4.1 → Claude Opus 4.6 → Claude Sonnet 4.6
  o3-mini stages: o3-mini → GPT-4.1 → Claude Sonnet 4.6
```

## 1.3 — Wire Existing Discovery Modes

Replace every mock data return in the Workbench page with real API calls:

```
Discovery mode "treatment_discovery"     → POST /projects/{project_id}/discover  body: { discovery_type: "treatment_discovery", ... }
Discovery mode "prevention_strategies"   → POST /projects/{project_id}/discover  body: { discovery_type: "prevention_strategies", ... }
Discovery mode "biomarker_identification"→ POST /projects/{project_id}/discover  body: { discovery_type: "biomarker_identification", ... }
Discovery mode "drug_repurposing"        → POST /projects/{project_id}/discover  body: { discovery_type: "drug_repurposing", ... }
Discovery mode "combination_therapy"     → POST /projects/{project_id}/discover  body: { discovery_type: "combination_therapy", ... }
```

Each call returns a `run_id` + WebSocket URL. The frontend connects to the WebSocket to receive live pipeline updates.

---

# 2. FEATURE 1 — LAB CAPABILITY FILTER <a name="2-lab-capability-filter"></a>

**Jamison's pain point:** "One of our biggest constraints is the tools and equipment we have access to. Would there be a way to filter by the methods or tools that we can use?"

## 2.1 — Data Model

Lab profile is stored as a JSONB column on the `projects` table — NOT a separate table. One lab profile per project.

```sql
-- Already defined in the projects table (see Section 11)
-- Column: lab_profile JSONB
-- Structure:
{
  "equipment": ["3T Siemens Prisma MRI", "64-channel EEG system", "TMS device"],
  "modalities": ["MRI", "fMRI", "DTI", "EEG", "ERP"],
  "techniques": ["resting-state connectivity", "event-related potentials", "diffusion tensor imaging"],
  "excluded_methods": ["PET", "invasive electrophysiology", "optogenetics"],
  "filter_mode": "permissive"  // "strict" | "permissive"
}
```

**Why JSONB on projects, not a separate table:** A lab profile is scoped to a project, not to a user. A researcher may collaborate with different labs on different projects. Storing it as JSONB avoids an extra table + join while still being queryable.

## 2.2 — API

```
PATCH /projects/{id}/lab-profile
  Request body: The full lab_profile JSON object above
  Response: 200 with updated project object
  Validation:
    - equipment: array of strings, each max 200 chars
    - modalities: array of strings, each must match a value from the methods taxonomy (Section 16)
    - techniques: array of strings, each max 200 chars
    - excluded_methods: array of strings, each must match a value from the methods taxonomy
    - filter_mode: enum "strict" | "permissive"
```

## 2.3 — Pipeline Integration

Lab profile filtering is applied at TWO points in the discovery pipeline:

**Point 1 — SEED stage (hypothesis generation):**
Inject into the SEED stage system prompt:
```
LABORATORY CONSTRAINTS:
The researcher's lab has access to the following modalities: {modalities_list}
The researcher's lab has access to the following equipment: {equipment_list}
The researcher's lab uses the following techniques: {techniques_list}
The researcher CANNOT use: {excluded_methods_list}

When generating hypotheses, PRIORITIZE hypotheses that can be tested using the modalities and techniques listed above.
You MAY generate hypotheses requiring other methods, but you MUST tag each hypothesis with:
  "required_methods": ["list", "of", "methods", "needed"]
so downstream filtering can flag feasibility.
```

**Point 2 — SCORE stage (ranking):**
Inject into the SCORE stage system prompt:
```
FEASIBILITY SCORING:
The researcher's lab has: {modalities_list}
For each hypothesis, compute a feasibility_score (0.0 to 1.0):
  1.0 = All required methods are available in the lab
  0.5 = Some methods available, others could be obtained via collaboration
  0.0 = Core method is unavailable and no reasonable workaround exists

Include feasibility_score in the scoring output alongside confidence_score.
Filter mode is: {filter_mode}
  - If "strict": Exclude any hypothesis with feasibility_score < 0.5 from final results
  - If "permissive": Keep all hypotheses, but sort feasibility_score < 0.5 to the bottom and flag them with "⚠️ Requires: [missing_method] — not in your lab profile"
```

**Point 3 — Backward/Synthesis pipeline (SYNTHESIZE stage):**
Inject into the SYNTHESIZE stage system prompt:
```
METHOD COMPATIBILITY:
The researcher's lab has: {modalities_list}
When summarizing evidence, annotate each study with the method used.
In the gap analysis, prioritize gaps that the researcher's lab is equipped to fill using {modalities_list}.
```

## 2.4 — UI: Lab Profile Editor

Location: ProjectWorkspace → Settings tab

```
Component: LabProfileEditor
  - Section "Equipment":
      Multi-input text field with tag chips (freeform text, no taxonomy constraint)
      Placeholder: "e.g., 3T Siemens Prisma MRI, 64-channel EEG"
  - Section "Modalities":
      Multi-select dropdown populated from methods taxonomy (Section 16)
      Grouped by category (Neuroimaging, Molecular Biology, etc.)
      Search/filter within dropdown
  - Section "Techniques":
      Multi-input text field with tag chips (freeform text)
      Placeholder: "e.g., resting-state connectivity, event-related potentials"
  - Section "Excluded Methods":
      Multi-select dropdown from same taxonomy
      These are methods the lab explicitly CANNOT do
  - Section "Filter Mode":
      Radio buttons: "Permissive (flag but keep)" vs "Strict (remove)"
      Default: Permissive
  - Save button → PATCH /projects/{id}/lab-profile
```

## 2.5 — UI: Feasibility Indicators on Hypothesis Cards

On HypothesisReview page and in the DiscoveryRunner results grid:

```
Each hypothesis card displays:
  - Feasibility badge:
      ✅ "Feasible" (green) if feasibility_score >= 0.8
      ⚠️ "Partially feasible" (yellow) if 0.3 <= feasibility_score < 0.8
         Tooltip: "Requires: PET imaging — not in your lab profile"
      ❌ "Not feasible" (red) if feasibility_score < 0.3
         Tooltip: "Core method X is not available in your lab"
  - "Required methods" tag list showing what methods this hypothesis needs
  - Methods in the user's lab profile are styled green; methods NOT in profile are styled red
```

---

# 3. FEATURE 2 — BACKWARD/SYNTHESIS PIPELINE <a name="3-backward-synthesis-pipeline"></a>

**Jamison's pain point:** "Often times, we already have a hypothesis and the tricky part is summarizing past work and explaining the gap in knowledge in a grant application or a paper."

This is a SEPARATE pipeline from the 11-stage discovery pipeline. It has 5 stages.

## 3.1 — Pipeline Stages

```
STAGE 1: DECOMPOSE (Claude Opus 4.6 via Bedrock)
  Input:
    - hypothesis: string (user's free-text hypothesis)
    - field_scope: string | null (optional narrowing)
    - time_range: { start_year: int, end_year: int } | null
  Output:
    - sub_claims: list[string]  (the hypothesis broken into 3-7 testable sub-claims)
    - key_entities: list[{ name: string, type: "gene"|"protein"|"drug"|"disease"|"pathway"|"method" }]
    - search_queries: list[string]  (5-15 PubMed/Semantic Scholar queries, one per sub-claim + cross-cutting)
  System prompt must include:
    "Break the hypothesis into independently verifiable sub-claims. For each sub-claim, generate at least one search query optimized for PubMed (using MeSH terms where appropriate) and one for Semantic Scholar (using natural language). Extract all named entities with their types."

STAGE 2: RETRIEVE (Cohere Command A)
  Input: search_queries from DECOMPOSE
  Behavior:
    - Query ALL configured data sources concurrently (see Section 10 for the 21 Phase 1 sources)
    - RAG retrieval from pgvector cache (cosine similarity >= 0.7 threshold)
    - For each sub-claim, retrieve top 20 papers (deduplicated across sources)
    - If time_range is set, filter papers by publication year
    - Return full metadata: title, authors, journal, year, DOI, PMID, abstract
  Output:
    - retrieved_papers: list[Paper]  (deduplicated, max ~100 total across all sub-claims)
    - retrieval_stats: { sources_queried: int, total_hits: int, deduplicated_to: int }

STAGE 3: SYNTHESIZE (Claude Opus 4.6 via Bedrock)
  Input:
    - hypothesis (original)
    - sub_claims from DECOMPOSE
    - retrieved_papers from RETRIEVE
    - lab_profile (from project, if set)
  Output:
    - supporting_evidence: list[CitedFinding]
    - contradicting_evidence: list[CitedFinding]
    - inconclusive_evidence: list[CitedFinding]
    - literature_summary: string (narrative with inline [1][2][3] citations)
    - method_frequency: list[{ method: string, count: int, most_recent_year: int }]
  System prompt must include:
    "Classify each retrieved paper as supporting, contradicting, or inconclusive relative to the hypothesis. Write a literature summary in academic prose with inline numbered citations [1][2][3]. For each cited claim, the citation number must map to a specific paper in the retrieved_papers list. DO NOT cite papers that were not retrieved. DO NOT invent citations. If a claim cannot be attributed to a retrieved paper, prefix it with '[Unverified]'."
  Lab profile injection:
    "The researcher's lab has: {modalities}. When discussing methods, note which studies used methods available to this lab."

STAGE 4: GAP_ANALYZE (GPT-4.1 via Azure OpenAI)
  Input:
    - hypothesis (original)
    - sub_claims from DECOMPOSE
    - supporting_evidence, contradicting_evidence, inconclusive_evidence from SYNTHESIZE
    - method_frequency from SYNTHESIZE
    - lab_profile (from project, if set)
  Output:
    - gaps: list[GapItem] where GapItem is:
        {
          description: string,         // What has NOT been studied
          evidence_status: "no_evidence" | "weak_evidence" | "conflicting_evidence",
          suggested_experiments: list[string],  // Concrete next experiments
          priority: "high" | "medium" | "low",
          impact: string,              // Why this gap matters
          feasibility_note: string | null  // If lab profile active: "Your lab can address this with EEG" or "Would require PET — not in your profile"
        }
    - overall_field_maturity: "nascent" | "growing" | "mature" | "saturated"
    - key_open_questions: list[string]  (3-5 top unanswered questions in the field)
  System prompt must include:
    "Identify specific knowledge gaps — not vague 'more research needed' statements. Each gap must be concrete enough that a researcher could design an experiment to address it. Rank gaps by priority (high = no existing evidence + high impact; low = some evidence exists + incremental impact). If a lab profile is provided, flag which gaps the researcher's lab is best positioned to address."

STAGE 5: FORMAT (Claude Sonnet 4.6 via Bedrock)
  Input:
    - All outputs from stages 1-4
    - output_format: enum (see Section 4)
    - grant_type: enum | null (see below)
  Output:
    - formatted_output: string (the final document in the requested format)
    - citations: list[Citation] (full reference list)
    - visualization_data: object (structured data for frontend charts — see Section 5)
  Grant-aware formatting options:
    - "nih_r01":       12-page Research Strategy → sections: Significance, Innovation, Approach
    - "nih_r21":       6-page Research Strategy → sections: Significance, Innovation, Approach (exploratory framing)
    - "nsf":           15-page Project Description
    - "dod":           Statement of Work, Technical Approach, Military Relevance
    - "private_foundation": Executive Summary, Background, Proposed Research, Budget Justification
  System prompt per grant type must include the specific section headings, page limits, and stylistic conventions for that grant agency. For example:
    NIH R01: "Write in the style of an NIH R01 Research Strategy. Use section headers: A. Significance, B. Innovation, C. Approach. Under Significance, establish the importance of the problem, explain the gaps in knowledge, and state how the proposed research will advance the field. Under Innovation, describe what is novel about the approach. Under Approach, describe preliminary data, experimental design, methods, timelines, and potential pitfalls with alternative strategies. Use inline citations in [Author, Year] format."
```

## 3.2 — Data Types

```python
# These are the Pydantic models for the synthesis pipeline I/O

class CitedFinding(BaseModel):
    summary: str                     # 1-2 sentence description
    citation_indices: list[int]      # Maps to positions in the citations list
    relevance_score: float           # 0.0 to 1.0
    method_used: str | None          # e.g., "EEG", "fMRI"
    in_lab_profile: bool | None      # True if method_used is in the project's lab profile

class GapItem(BaseModel):
    description: str
    evidence_status: Literal["no_evidence", "weak_evidence", "conflicting_evidence"]
    suggested_experiments: list[str]
    priority: Literal["high", "medium", "low"]
    impact: str
    feasibility_note: str | None

class Citation(BaseModel):
    index: int                       # The [1], [2], etc. number
    title: str
    authors: list[str]
    journal: str
    year: int
    doi: str | None
    pmid: str | None
    verified: bool                   # True if DOI or PMID was verified via API

class SynthesisResult(BaseModel):
    hypothesis: str
    sub_claims: list[str]
    supporting_evidence: list[CitedFinding]
    contradicting_evidence: list[CitedFinding]
    inconclusive_evidence: list[CitedFinding]
    gaps: list[GapItem]
    overall_field_maturity: Literal["nascent", "growing", "mature", "saturated"]
    key_open_questions: list[str]
    formatted_output: str
    citations: list[Citation]
    visualization_data: dict         # See Section 5
    retrieval_stats: dict
    pipeline_trace: dict             # Model used, duration, token count per stage
```

## 3.3 — API Endpoint

```
POST /projects/{project_id}/synthesize
  Request body:
    {
      "hypothesis": "EEG-based biomarkers can predict treatment response in Rett syndrome clinical trials",
      "field_scope": "Rett syndrome EEG biomarkers",         // optional
      "time_range": { "start_year": 2015, "end_year": 2026 }, // optional, default: last 10 years
      "output_format": "narrative",                           // see Section 4
      "grant_type": "nih_r01",                                // optional, only used when output_format is "grant_sections"
      "citation_style": "numbered"                            // "numbered" | "apa" | "vancouver"
    }
  Response: 202 Accepted
    {
      "run_id": "uuid",
      "websocket_url": "ws://host/ws/synthesis/{run_id}",
      "status": "running"
    }
  The frontend connects to the WebSocket to receive stage-by-stage updates.
  Final result is also stored in the database and retrievable via GET.

GET /projects/{project_id}/synthesis-runs
  Response: list of past synthesis runs with status, hypothesis, created_at

GET /projects/{project_id}/synthesis-runs/{run_id}
  Response: full SynthesisResult object (see 3.2)
```

---

# 4. FEATURE 3 — OUTPUT FORMAT & VERBOSITY CONTROL <a name="4-output-format-verbosity"></a>

**Jamison's pain point:** "It would be really interesting to see if this tool could be tailored to provide more concise summaries. Researchers may opt to just refer to a review paper. Where the AI could fill in is providing a more concise and direct summary."

## 4.1 — Output Formats

The `output_format` parameter is accepted by BOTH the discovery pipeline (POST /projects/{id}/discover) and the synthesis pipeline (POST /projects/{id}/synthesize).

```
output_format: enum
  "narrative"        — Prose paragraphs with inline citations. Default.
  "structured_table" — Tabular format: rows = findings, columns = [Finding, Evidence, Confidence, Method, Source]
  "knowledge_gap_map"— Focused on gaps: what is known vs. unknown, organized by sub-topic
  "grant_sections"   — Grant-formatted output. Requires grant_type parameter.
  "comprehensive"    — All of the above combined into a single long-form document
```

## 4.2 — Verbosity Levels

Verbosity is ORTHOGONAL to output_format. It controls length/depth, not structure.

```
verbosity: enum
  "brief"
    - Max ~300 words for narrative sections
    - Top 5 citations only
    - Bullet points, no background context
    - Visual: 1 summary chart
    - Use case: Quick scan, Slack sharing, lab meeting prep

  "standard"
    - Max ~1000 words for narrative sections
    - Top 15 citations
    - Short paragraphs with key findings
    - Visual: Summary chart + method frequency table
    - Use case: Default for most researchers

  "comprehensive"
    - Max ~3000 words for narrative sections
    - All relevant citations (20-50)
    - Full analysis with methodology discussion
    - Visual: Full dashboard (all charts from Section 5)
    - Use case: Grant writing, manuscript preparation
```

## 4.3 — Implementation

Verbosity is enforced in the FORMAT stage (synthesis pipeline) or the TRANSLATE/FINALIZE stage (discovery pipeline).

Add to the FORMAT/TRANSLATE system prompt:
```
OUTPUT CONSTRAINTS:
  Verbosity level: {verbosity}

  If verbosity is "brief":
    - Maximum 300 words for the main narrative section
    - Include ONLY the 5 most important findings as single-sentence bullet points
    - NO background context, NO methodology discussion
    - Citation list: top 5 only, ranked by relevance
    - End with a single "Key Takeaway" sentence

  If verbosity is "standard":
    - Maximum 1000 words for the main narrative section
    - 3-5 short paragraphs covering: key findings, most significant gap, actionable next steps
    - Citation list: top 15, ranked by relevance
    - Include brief methodology notes only where they affect interpretation

  If verbosity is "comprehensive":
    - Maximum 3000 words
    - Full academic narrative with sections: Background, Methods Review, Key Findings, Gaps, Implications
    - All relevant citations (no limit)
    - Include methodology discussion, statistical approaches, sample sizes
```

## 4.4 — Verbosity Re-run Optimization

When the user changes verbosity AFTER a pipeline has completed:
- Do NOT re-run stages 1-4 (DECOMPOSE, RETRIEVE, SYNTHESIZE, GAP_ANALYZE).
- Re-run ONLY the FORMAT stage with the new verbosity setting.
- Cache the intermediate results from stages 1-4 so re-formatting is fast (~5-10 seconds instead of ~60-120 seconds).

Implementation: Store the stage 1-4 outputs in the `pipeline_trace` JSONB column on the synthesis run. The FORMAT stage reads from this cache.

## 4.5 — Export Options

```
POST /projects/{project_id}/synthesis-runs/{run_id}/export
  Request body:
    {
      "format": "docx" | "pdf" | "latex" | "markdown" | "clipboard"
    }
  Response:
    - "docx": Returns a .docx file with formatted headings, inline citations, and a reference list at the end
    - "pdf": Returns a .pdf rendered from the docx
    - "latex": Returns a .tex file with \cite{} commands and a .bib file
    - "markdown": Returns a .md file
    - "clipboard": Returns plain text optimized for pasting into Slack/email
```

---

# 5. FEATURE 4 — VISUAL SUMMARY LAYER <a name="5-visual-summary-layer"></a>

**Jamison's pain point:** "Your idea about the visuals would be very helpful... allowing researchers to review a lot of information in the field much faster."

## 5.1 — Required Visualizations

Every pipeline output (discovery AND synthesis) must include a `visualization_data` object in its response. The frontend renders these using Recharts (already a dependency in the frontend).

### Chart 1: Evidence Landscape (all modes)

```json
{
  "evidence_landscape": {
    "points": [
      {
        "title": "EEG biomarkers in Rett syndrome: a systematic review",
        "year": 2023,
        "relevance_score": 0.92,
        "citation_count": 45,
        "stance": "supporting",
        "doi": "10.1234/example",
        "method": "EEG"
      }
    ]
  }
}
```
Frontend: Recharts ScatterChart. X = year, Y = relevance_score, bubble size = citation_count, color = stance (green/red/gray). Hover shows title + DOI link.

### Chart 2: Method Frequency Table (all modes)

```json
{
  "method_frequency": {
    "rows": [
      { "method": "EEG", "count": 12, "most_recent_year": 2025, "in_lab_profile": true },
      { "method": "fMRI", "count": 8, "most_recent_year": 2024, "in_lab_profile": true },
      { "method": "PET", "count": 3, "most_recent_year": 2022, "in_lab_profile": false }
    ]
  }
}
```
Frontend: Table component (or Recharts BarChart). Methods in user's lab profile have green background. Methods not in profile have gray background.

### Chart 3: Gap Heatmap (synthesis pipeline only)

```json
{
  "gap_heatmap": {
    "populations": ["Rett syndrome", "Angelman syndrome", "Fragile X", "Healthy controls"],
    "methods": ["EEG", "fMRI", "PET", "Behavioral"],
    "matrix": [
      [8, 3, 1, 12],
      [2, 1, 0, 5],
      [4, 2, 1, 8],
      [15, 10, 5, 20]
    ],
    "lab_profile_methods": ["EEG", "fMRI"]
  }
}
```
Frontend: Recharts heatmap (or custom grid). Cell color: green (5+), yellow (1-4), red (0). Columns matching `lab_profile_methods` get a blue border highlight.

### Chart 4: Hypothesis Confidence Meter (discovery pipeline only)

```json
{
  "confidence_meters": [
    {
      "hypothesis_index": 0,
      "title": "EEG-based early detection of Rett syndrome",
      "confidence_score": 0.78,
      "supporting_count": 8,
      "contradicting_count": 2,
      "feasibility_score": 0.95
    }
  ]
}
```
Frontend: Horizontal bar per hypothesis. Left half = contradicting (red), right half = supporting (green), marker at confidence_score position. Feasibility badge next to it.

### Chart 5: Cost Breakdown (discovery pipeline, on DiscoveryRunner page)

```json
{
  "cost_breakdown": {
    "stages": [
      { "stage": "SEED", "model": "claude-opus-4-6", "cost_cents": 12, "tokens_in": 2000, "tokens_out": 1500, "duration_seconds": 4.2 },
      { "stage": "EXPAND", "model": "claude-sonnet-4-6", "cost_cents": 3, "tokens_in": 3000, "tokens_out": 2000, "duration_seconds": 2.1 }
    ],
    "total_cost_cents": 87,
    "total_duration_seconds": 45.3
  }
}
```
Frontend: Recharts stacked BarChart (cost per stage) + PieChart (cost by model) + line showing elapsed time.

## 5.2 — Backend Responsibility

The FORMAT stage (synthesis) or FINALIZE stage (discovery) MUST output the `visualization_data` object as structured JSON alongside the narrative text. Add to the system prompt:

```
VISUALIZATION DATA:
In addition to the narrative output, you MUST return a JSON object called "visualization_data" containing structured data for the following charts:
  - evidence_landscape: Array of papers with year, relevance_score, citation_count, stance, title, doi, method
  - method_frequency: Array of methods with count and most_recent_year
  - gap_heatmap (synthesis only): Matrix of populations × methods with paper counts
  - confidence_meters (discovery only): Array of hypothesis scores

This JSON must be parseable. Do NOT embed it in prose. Return it as a separate clearly-delimited JSON block after the narrative.
```

The backend code must parse this JSON block from the LLM output and store it in the response object. If the LLM fails to produce valid JSON, fall back to computing visualization_data programmatically from the structured pipeline outputs (supporting_evidence counts, citation metadata, etc.).

---

# 6. DISCOVERY PIPELINE UPGRADE (11-STAGE) <a name="6-discovery-pipeline-upgrade"></a>

## 6.1 — Stage Definitions

The pipeline has 12 stages (11 processing + 1 formatting). The old pipeline is fully replaced.

```
Stage 1:  SEED       — Generate initial hypotheses from disease + discovery_type + external_factors
Stage 2:  EXPAND     — Broaden each hypothesis with related mechanisms, pathways, targets
Stage 3:  EVIDENCE   — Retrieve supporting evidence from all data sources
Stage 4:  COUNTER    — Generate counter-arguments and contradicting evidence for each hypothesis
Stage 4.5: REVISE    — Revise hypotheses based on counter-arguments (NEW STAGE)
Stage 5:  MECHANISM  — Detail the proposed biological/chemical mechanism
Stage 6:  VALIDATE   — Cross-validate mechanism against known biology
Stage 7:  GROUND     — Ground all claims against the 3-layer grounding system (Section 7)
Stage 8:  SCORE      — Score each hypothesis on confidence, novelty, feasibility, impact
Stage 9:  REFINE     — Final refinement of top hypotheses
Stage 10: TRANSLATE  — Generate translational roadmap (T0 basic research → T5 clinical adoption)
Stage 11: FINALIZE   — Final cleanup, formatting, visualization_data generation
```

## 6.2 — Parallelization Rules

```
- The pipeline processes 3 hypotheses per round
- Maximum 4 rounds = 12 hypotheses total maximum
- Stages 2-9 (EXPAND through REFINE) run CONCURRENTLY per hypothesis via asyncio.gather()
- Stage 1 (SEED) is sequential (generates the initial batch)
- Stage 10 (TRANSLATE), 11 (FINALIZE) are sequential (operate on the full ranked list)
- NO PRUNING: All hypotheses are kept regardless of confidence score. Do not discard low-confidence hypotheses.
```

## 6.3 — Input Schema for Discovery

```python
class DiscoveryRequest(BaseModel):
    disease: str                                    # e.g., "Rett syndrome"
    discovery_type: Literal[
        "treatment_discovery",
        "prevention_strategies",
        "biomarker_identification",
        "drug_repurposing",
        "combination_therapy"
    ]
    external_factors: list[str] | None = None       # e.g., ["age of onset", "genetic variant MECP2"]
    num_rounds: int = 3                             # 1-4
    hypotheses_per_round: int = 3                   # fixed at 3
    output_format: Literal["narrative", "structured_table", "knowledge_gap_map", "grant_sections", "comprehensive"] = "narrative"
    verbosity: Literal["brief", "standard", "comprehensive"] = "standard"
    grant_type: Literal["nih_r01", "nih_r21", "nsf", "dod", "private_foundation"] | None = None
    citation_style: Literal["numbered", "apa", "vancouver"] = "numbered"
    # lab_profile is read from the project, not passed in the request
```

## 6.4 — Output Schema for Discovery

```python
class DiscoveryResult(BaseModel):
    run_id: str                                     # UUID
    project_id: str                                 # UUID
    disease: str
    discovery_type: str
    hypotheses: list[HypothesisOutput]
    best_hypothesis_id: str | None                  # UUID of highest-scored hypothesis
    visualization_data: dict                        # See Section 5
    pipeline_trace: dict                            # Full trace: stage → { model, duration, tokens, grounding_ratio }
    total_cost_cents: int
    total_duration_seconds: float
    citations: list[Citation]

class HypothesisOutput(BaseModel):
    id: str                                         # UUID
    title: str
    summary: str
    mechanism: str
    confidence_score: float                         # 0.0 to 1.0
    novelty_score: float
    feasibility_score: float                        # From lab profile filtering
    impact_score: float
    required_methods: list[str]
    key_citations: list[Citation]
    fda_references: list[dict] | None
    clinical_trial_refs: list[dict] | None
    translational_roadmap: dict | None              # T0-T5 stages
    counter_arguments: list[str]                    # From COUNTER stage
    revisions: list[str]                            # From REVISE stage — what changed and why
    pipeline_trace: dict                            # Per-hypothesis stage outputs
    round_number: int
    hypothesis_index: int
```

---

# 7. 3-LAYER GROUNDING SYSTEM <a name="7-grounding-system"></a>

All grounding uses PostgreSQL pgvector — ChromaDB is fully replaced.

## 7.1 — Layer 1: RAG (Vector Similarity)

```
Database: PostgreSQL with pgvector extension
Table: grounding_cache (see Section 11 for schema)
Embedding models:
  Primary: Cohere Embed v3 (1024 dimensions)
  Secondary: text-embedding-3-large (1536 dimensions)
Threshold: Cosine similarity >= 0.7
Process:
  1. Embed the claim using BOTH embedding models
  2. Query pgvector for nearest neighbors from BOTH embedding spaces
  3. A claim is RAG-grounded if it has a match >= 0.7 in EITHER embedding space
  4. Return the matched source passages for citation
TTL: 30 days on cached entries (delete entries where updated_at < now() - 30 days)
```

## 7.2 — Layer 2: Citation Verification

```
For every citation produced by the pipeline:
  1. If PMID is present: Call PubMed E-Utilities (esummary) to verify the paper exists and metadata matches
     Endpoint: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={pmid}&retmode=json
  2. If DOI is present: Send HEAD request to https://doi.org/{doi} — if 302 redirect, the DOI is valid
  3. If neither PMID nor DOI: Mark citation as "unverified"
  4. Store verification result: citation.verified = True | False
```

## 7.3 — Layer 3: Cross-Source Corroboration

```
A factual claim in the pipeline output is considered "corroborated" if:
  - The claim appears in 2 or more independent sources (different papers, databases, or data sources)
  - Sources must be genuinely independent (not one citing the other)

Implementation:
  - After EVIDENCE and GROUND stages, cluster claims by semantic similarity
  - For each cluster, count the number of unique source DOIs/PMIDs
  - If count >= 2: claim is "corroborated" (high confidence)
  - If count == 1: claim is "single-source" (moderate confidence, flag for user review)
  - If count == 0: claim is "ungrounded" (low confidence, prefix with "[Unverified]")
```

## 7.4 — Knowledge Graph Traversal

Active at ALL pipeline stages, not just grounding:

```
Database: Neo4j
Traversal algorithms available:
  DFS (Depth-First Search): Used for deep causal chain exploration
    - "Gene X → regulates Protein Y → which activates Pathway Z → which causes Phenotype W"
    - Max depth: 6 hops
  BFS (Breadth-First Search): Used for broad neighborhood discovery
    - "What are all known interactions of Protein Y?"
    - Max breadth: 50 nodes per level, max depth: 3
  Dijkstra (Weighted Shortest Path): Used for highest-confidence connections
    - Edge weights = confidence scores (higher = better)
    - Find the most evidence-supported path between two entities

Each pipeline stage can invoke graph traversal:
  SEED:       BFS to discover related entities for hypothesis generation
  MECHANISM:  DFS to trace causal chains
  EVIDENCE:   BFS to find corroborating evidence nodes
  GROUND:     Dijkstra to find highest-confidence supporting paths
  VALIDATE:   DFS to check if proposed mechanism has a valid path in the graph
  SCORE:      Dijkstra to compute path-based confidence scores
```

---

# 8. AUTO-CITATION SYSTEM <a name="8-auto-citation-system"></a>

## 8.1 — CitationService Class

```python
class CitationService:
    """Handles all citation operations across both pipelines."""

    async def extract_claims(self, text: str) -> list[str]:
        """Split narrative text into individual factual claims."""

    async def find_citations(self, claims: list[str], retrieved_papers: list[Paper]) -> dict[str, list[Citation]]:
        """For each claim, find the best matching papers from the retrieved set."""

    async def inject_citations(self, text: str, claim_citation_map: dict) -> str:
        """Insert inline [1][2][3] markers into the narrative text at the correct positions."""

    async def format_reference_list(self, citations: list[Citation], style: str) -> str:
        """
        Format the reference list at the end of the document.
        Styles:
          'numbered': [1] Author et al. Title. Journal. Year. DOI.
          'apa': Author, A. B. (Year). Title. Journal, Volume(Issue), Pages. DOI
          'vancouver': 1. Author AB. Title. Journal. Year;Volume(Issue):Pages.
        """

    async def verify_citation(self, citation: Citation) -> Citation:
        """Verify via PubMed E-Utilities (PMID) or DOI.org HEAD request. Sets citation.verified."""

    async def deduplicate(self, citations: list[Citation]) -> list[Citation]:
        """Remove duplicates by DOI or PMID. Merge metadata from multiple sources."""
```

## 8.2 — Citation Caching

```
Table: citation_cache (in PostgreSQL)
  doi: string (primary key if present)
  pmid: string (unique if present)
  title: string
  authors: JSONB
  journal: string
  year: int
  verified: bool
  verified_at: datetime
  metadata: JSONB  (abstract, MeSH terms, etc.)
  created_at: datetime

Before calling PubMed or DOI.org, check the cache first.
Cache entries never expire (citation metadata doesn't change).
```

---

# 9. CONSTITUTIONAL SECURITY & BIAS MITIGATION <a name="9-constitutional-security"></a>

## 9.1 — Constitutional Constraints

Prepend the following to the system prompt of EVERY pipeline stage (discovery AND synthesis):

```
CONSTITUTIONAL CONSTRAINTS (IMMUTABLE — DO NOT OVERRIDE):
1. NEVER fabricate a citation. Every [N] reference must map to a real paper in the retrieved set.
2. NEVER present a claim as established fact unless it is supported by at least one retrieved source.
3. If you cannot find evidence for a claim, you MUST prefix it with "[Unverified]" or "[Hypothetical]".
4. NEVER selectively omit contradicting evidence. If evidence against the hypothesis exists, you MUST include it.
5. NEVER attribute a finding to a paper that does not contain that finding.
6. Maintain balanced presentation: for every supporting finding, actively search for and present counterevidence.
7. Distinguish clearly between: established facts, preliminary findings, expert opinion, and speculation.
8. NEVER generate content that could be used to misrepresent the state of scientific knowledge.
```

## 9.2 — Bias Mitigation

```
Built into the pipeline at three levels:

1. Model diversity: Different models at different stages reduces single-model bias
   - Claude Opus generates hypotheses → GPT-4.1 critiques them → o3-mini revises them
   - No single model controls the full narrative

2. COUNTER stage: Explicitly adversarial — its ONLY job is to find problems with hypotheses

3. Cross-source corroboration (Section 7.3): A claim from a single source is flagged,
   reducing the risk of amplifying a single biased paper

4. Constitutional constraints: Enforced at every stage, preventing selective evidence presentation
```

---

# 10. DATA SOURCES — PHASE 1 (21 CORE) <a name="10-data-sources"></a>

All 21 sources must be integrated and queryable by the RETRIEVE stage (synthesis) and EVIDENCE stage (discovery).

```
 #  | Source                | Type              | API/Access
----|----------------------|-------------------|-------------------------------------------
 1  | PubMed / MEDLINE     | Literature        | E-Utilities REST API (free, rate-limited 3/sec without API key, 10/sec with)
 2  | ClinicalTrials.gov   | Clinical trials   | REST API v2 (https://clinicaltrials.gov/api/v2/)
 3  | FDA Drug Labels       | Drug safety       | openFDA API (https://api.fda.gov/)
 4  | UniProt              | Protein data      | REST API (https://rest.uniprot.org/)
 5  | KEGG Pathways        | Pathways          | REST API (https://rest.kegg.jp/)
 6  | DrugBank             | Drug interactions | Academic license required, XML download
 7  | ChEMBL              | Bioactivity       | REST API (https://www.ebi.ac.uk/chembl/api/)
 8  | DisGeNET             | Disease-gene      | REST API (requires API key)
 9  | STRING               | Protein interact. | REST API (https://string-db.org/api/)
10  | Reactome             | Pathways          | REST API (https://reactome.org/ContentService/)
11  | OMIM                 | Genetic disorders | API key required (https://api.omim.org/)
12  | PharmGKB             | Pharmacogenomics  | REST API (https://api.pharmgkb.org/)
13  | Gene Ontology        | Gene function     | REST API (http://api.geneontology.org/)
14  | Human Protein Atlas  | Protein express.  | REST API (https://www.proteinatlas.org/api/)
15  | COSMIC               | Cancer mutations  | Academic license, API
16  | IntAct               | Mol. interactions | REST API (https://www.ebi.ac.uk/intact/)
17  | BioGRID              | Interactions      | REST API (https://webservice.thebiogrid.org/)
18  | Ensembl              | Genomics          | REST API (https://rest.ensembl.org/)
19  | PDB                  | Protein structure | REST API (https://data.rcsb.org/rest/v1/)
20  | MeSH                 | Terminology       | E-Utilities / SPARQL
21  | Europe PMC           | Literature        | REST API (https://www.ebi.ac.uk/europepmc/webservices/rest/)
```

Each source needs a client class in the backend:

```python
class DataSourceClient(ABC):
    """Abstract base for all data source clients."""

    @abstractmethod
    async def search(self, query: str, max_results: int = 20) -> list[SourceResult]:
        """Search this source for relevant results."""

    @abstractmethod
    async def get_by_id(self, identifier: str) -> SourceResult | None:
        """Retrieve a specific record by its ID (DOI, PMID, accession, etc.)."""

    @property
    @abstractmethod
    def source_name(self) -> str:
        """Return the canonical name of this source (e.g., 'PubMed')."""

class SourceResult(BaseModel):
    source: str
    identifier: str        # DOI, PMID, accession number, etc.
    title: str
    content: str           # Abstract, summary, or relevant text
    metadata: dict         # Source-specific metadata
    url: str | None
    retrieved_at: datetime
```

---

# 11. DATABASE SCHEMA & MIGRATIONS <a name="11-database-schema"></a>

## 11.1 — Projects Table (UPDATE existing)

Add the following columns to the existing `projects` table:

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discovery_config JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lab_profile JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_discovery_runs INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_api_cost_cents INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS best_confidence_score FLOAT DEFAULT 0.0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_discovery_at TIMESTAMPTZ;
```

## 11.2 — Discovery Runs Table (NEW)

```sql
CREATE TABLE discovery_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, cancelled
    disease VARCHAR(255) NOT NULL,
    discovery_type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,                          -- Full DiscoveryRequest as JSON
    num_rounds INTEGER NOT NULL DEFAULT 3,
    hypotheses_per_round INTEGER NOT NULL DEFAULT 3,
    best_hypothesis_id UUID,
    total_cost_cents INTEGER DEFAULT 0,
    total_duration_seconds FLOAT,
    pipeline_trace JSONB,                           -- Stage-level trace data
    error_message TEXT,
    visualization_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_discovery_runs_project ON discovery_runs(project_id);
CREATE INDEX idx_discovery_runs_status ON discovery_runs(status);
```

## 11.3 — Hypotheses Table (NEW)

```sql
CREATE TABLE hypotheses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_run_id UUID NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    summary TEXT NOT NULL,
    mechanism TEXT,
    disease VARCHAR(255),
    discovery_type VARCHAR(50),
    round_number INTEGER NOT NULL,
    hypothesis_index INTEGER NOT NULL,
    confidence_score FLOAT,
    novelty_score FLOAT,
    feasibility_score FLOAT,
    impact_score FLOAT,
    required_methods JSONB,                        -- list of method strings
    key_citations JSONB,                           -- list of Citation objects
    fda_references JSONB,
    clinical_trial_refs JSONB,
    counter_arguments JSONB,                       -- list of strings from COUNTER stage
    revisions JSONB,                               -- list of strings from REVISE stage
    translational_roadmap JSONB,                   -- T0-T5 stages
    pipeline_trace JSONB,                          -- Per-hypothesis 11-stage trace
    avg_feedback_quality FLOAT,
    feedback_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hypotheses_run ON hypotheses(discovery_run_id);
CREATE INDEX idx_hypotheses_project ON hypotheses(project_id);
CREATE INDEX idx_hypotheses_confidence ON hypotheses(confidence_score DESC);
```

## 11.4 — Grounding Cache Table (NEW — pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE grounding_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embedding_cohere vector(1024),                 -- Cohere Embed v3
    embedding_openai vector(1536),                 -- text-embedding-3-large
    content TEXT NOT NULL,
    source VARCHAR(100) NOT NULL,                  -- e.g., "PubMed", "DrugBank"
    source_id VARCHAR(255),                        -- DOI, PMID, accession
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grounding_cohere ON grounding_cache USING ivfflat (embedding_cohere vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_grounding_openai ON grounding_cache USING ivfflat (embedding_openai vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_grounding_source ON grounding_cache(source);
CREATE INDEX idx_grounding_updated ON grounding_cache(updated_at);  -- For TTL cleanup
```

## 11.5 — Imaging Records Table (NEW)

```sql
CREATE TABLE imaging_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path VARCHAR(1000) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT,
    format VARCHAR(20) NOT NULL,                   -- dicom, nifti, png, jpg, tiff
    modality VARCHAR(50) NOT NULL,                 -- MRI, EEG, CT, PET, microscopy, histology
    sub_modality VARCHAR(100),                     -- e.g., T1-weighted, T2-FLAIR, resting-state fMRI
    body_region VARCHAR(100),
    description TEXT,
    resolution JSONB,                              -- e.g., {"x": 1.0, "y": 1.0, "z": 1.0, "unit": "mm"}
    dimensions JSONB,                              -- e.g., {"width": 256, "height": 256, "depth": 180, "timepoints": 1}
    acquisition_params JSONB,                      -- TR, TE, flip angle, etc.
    patient_id_hash VARCHAR(64),                   -- UUID5 hash of patient ID for anonymization
    study_date DATE,
    series_description VARCHAR(500),
    linked_hypothesis_ids JSONB,                   -- list of hypothesis UUIDs this image is evidence for
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_imaging_project ON imaging_records(project_id);
CREATE INDEX idx_imaging_modality ON imaging_records(modality);
```

## 11.6 — Synthesis Runs Table (NEW)

```sql
CREATE TABLE synthesis_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, cancelled
    hypothesis TEXT NOT NULL,                        -- User's input hypothesis
    field_scope TEXT,
    time_range JSONB,                               -- {"start_year": 2015, "end_year": 2026}
    output_format VARCHAR(30) NOT NULL DEFAULT 'narrative',
    verbosity VARCHAR(20) NOT NULL DEFAULT 'standard',
    grant_type VARCHAR(30),
    citation_style VARCHAR(20) NOT NULL DEFAULT 'numbered',
    result JSONB,                                   -- Full SynthesisResult as JSON
    pipeline_trace JSONB,                           -- Stage-level trace (for verbosity re-runs)
    total_cost_cents INTEGER DEFAULT 0,
    total_duration_seconds FLOAT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_synthesis_runs_project ON synthesis_runs(project_id);
CREATE INDEX idx_synthesis_runs_status ON synthesis_runs(status);
```

## 11.7 — Citation Cache Table (NEW)

```sql
CREATE TABLE citation_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doi VARCHAR(255) UNIQUE,
    pmid VARCHAR(20) UNIQUE,
    title TEXT NOT NULL,
    authors JSONB,
    journal VARCHAR(500),
    year INTEGER,
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    metadata JSONB,                                -- Abstract, MeSH terms, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_citation_doi ON citation_cache(doi) WHERE doi IS NOT NULL;
CREATE INDEX idx_citation_pmid ON citation_cache(pmid) WHERE pmid IS NOT NULL;
```

## 11.8 — Hypothesis Feedback Table (NEW)

```sql
CREATE TABLE hypothesis_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hypothesis_id UUID NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    overall_quality FLOAT NOT NULL,                -- 1.0 to 5.0
    dimension_scores JSONB NOT NULL,               -- See feedback schema below
    boolean_flags JSONB,                           -- {"is_novel": true, "is_actionable": false, ...}
    tags JSONB,                                    -- ["promising", "needs-validation", "high-risk"]
    free_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_hypothesis ON hypothesis_feedback(hypothesis_id);

-- Feedback dimension_scores schema:
-- {
--   "scientific_rigor": 4.0,       // 1-5
--   "novelty": 3.5,                // 1-5
--   "feasibility": 4.5,            // 1-5
--   "clinical_relevance": 3.0,     // 1-5
--   "evidence_quality": 4.0,       // 1-5
--   "mechanism_clarity": 3.5       // 1-5
-- }
```

## 11.9 — Alembic Migrations

```
Migration 003: pgvector_grounding_cache
  - Enable pgvector extension
  - Create grounding_cache table with vector columns and IVFFlat indexes

Migration 004: research_project_management
  - ALTER projects table (add new columns)
  - CREATE discovery_runs table
  - CREATE hypotheses table
  - CREATE imaging_records table
  - CREATE synthesis_runs table
  - CREATE citation_cache table
  - CREATE hypothesis_feedback table
  - CREATE all indexes listed above
```

---

# 12. API ENDPOINTS (COMPLETE) <a name="12-api-endpoints"></a>

## 12.1 — Project Discovery Endpoints

```
PATCH  /projects/{id}/discovery-config      — Save discovery configuration (JSONB)
PATCH  /projects/{id}/lab-profile           — Update lab profile (JSONB)
GET    /projects/{id}/discovery-runs        — List discovery runs (paginated, filterable by status)
POST   /projects/{id}/discover              — Start discovery pipeline → returns { run_id, websocket_url, status: "running" }
POST   /projects/{id}/synthesize            — Start synthesis pipeline → returns { run_id, websocket_url, status: "running" }
DELETE /discovery-runs/{run_id}             — Cancel a running discovery (sets status to "cancelled", signals background task to stop)
```

## 12.2 — Hypothesis Endpoints

```
GET    /projects/{id}/hypotheses                    — List all hypotheses for a project (across all runs)
GET    /projects/{id}/hypotheses/{hypothesis_id}    — Get full hypothesis detail
POST   /hypotheses/{id}/feedback                    — Submit structured feedback (see feedback schema in Section 11.8)
POST   /hypotheses/{id}/generate-paper              — Generate a full research paper from this hypothesis
```

## 12.3 — Synthesis Endpoints

```
GET    /projects/{id}/synthesis-runs                — List synthesis runs
GET    /projects/{id}/synthesis-runs/{run_id}       — Get full synthesis result
POST   /projects/{id}/synthesis-runs/{run_id}/reformat — Re-run FORMAT stage with new verbosity/output_format (uses cached stages 1-4)
POST   /projects/{id}/synthesis-runs/{run_id}/export   — Export to docx/pdf/latex/markdown/clipboard
```

## 12.4 — Imaging Endpoints

```
POST   /projects/{id}/imaging/upload        — Upload imaging file (multipart form data)
GET    /projects/{id}/imaging               — List imaging records for project
GET    /projects/{id}/imaging/{record_id}   — Get imaging record detail
POST   /projects/{id}/imaging/{record_id}/link-hypothesis — Link imaging record to hypothesis
DELETE /projects/{id}/imaging/{record_id}   — Delete imaging record
```

## 12.5 — Pipeline Intelligence Endpoints

```
GET    /pipeline-intelligence/costs/summary     — Cost summary with project_id and period filters
GET    /pipeline-intelligence/models/performance — Model × stage performance metrics
GET    /pipeline-intelligence/benchmarks         — Benchmark test results
```

---

# 13. WEBSOCKET PROTOCOL <a name="13-websocket"></a>

```
Connection URL:
  ws://host/ws/discovery/{run_id}     (discovery pipeline)
  ws://host/ws/synthesis/{run_id}     (synthesis pipeline)

Server → Client events:
  { "event": "stage_started",       "stage": "SEED",     "model": "claude-opus-4-6",     "timestamp": "ISO" }
  { "event": "stage_completed",     "stage": "SEED",     "duration_seconds": 4.2,        "tokens_in": 2000, "tokens_out": 1500, "cost_cents": 12, "grounding_ratio": 0.85 }
  { "event": "hypothesis_completed","hypothesis_index": 0, "round": 1,                   "title": "...", "confidence_score": 0.78 }
  { "event": "round_completed",     "round": 1,           "hypotheses_in_round": 3 }
  { "event": "cost_update",         "total_cost_cents": 45,"elapsed_seconds": 23.1 }
  { "event": "run_completed",       "total_hypotheses": 9, "best_hypothesis_id": "uuid",  "total_cost_cents": 87 }
  { "event": "run_error",           "error": "Rate limit exceeded on Claude Opus, falling back to GPT-4.1", "recoverable": true }
  { "event": "db_sweep",            "message": "Cleaned 150 expired grounding cache entries" }

Client → Server commands:
  { "command": "cancel" }  — Cancel the running pipeline
  { "command": "ping" }    — Keep-alive

Connection management:
  - DiscoveryConnectionManager class manages active WebSocket connections
  - One WebSocket per run_id
  - Auto-close on run_completed or run_error (non-recoverable)
  - Client should auto-reconnect on disconnect (the server replays missed events from the pipeline_trace)
```

---

# 14. FRONTEND PAGES (COMPLETE) <a name="14-frontend-pages"></a>

## 14.1 — ProjectsList (`/projects-list`)

```
Data fetching: TanStack Query, NO localStorage for project data
Features:
  - Search bar (filters by project name, disease)
  - Status filter: active | completed | archived
  - Create Project modal:
      Fields: name, description, disease, discovery_type (dropdown), lab_profile (inline editor or "configure later")
  - Project cards showing:
      - Project name + disease
      - Best confidence score (badge)
      - Total discovery runs count
      - Last activity date
      - Status badge
  - Click card → navigate to /projects/:id/workspace
```

## 14.2 — ProjectWorkspace (`/projects/:id/workspace`)

```
6 tabs:

TAB 1: Overview
  - Project metadata (name, disease, created date)
  - Summary stats: total runs, total hypotheses, best confidence, total cost
  - Recent activity feed (last 5 events)
  - Quick action buttons: "Run Discovery", "Run Synthesis"

TAB 2: Discovery Runs
  - Table of all discovery runs with: status, disease, type, hypotheses count, best score, cost, date
  - Click row → navigate to DiscoveryRunner page for that run
  - "New Discovery" button

TAB 3: Hypotheses
  - Sortable table of all hypotheses across all runs
  - Columns: title, confidence, novelty, feasibility, impact, round, run, date
  - Click row → navigate to HypothesisReview page
  - Filter by: score range, discovery type, round

TAB 4: Evidence (Synthesis Runs)
  - Table of all synthesis runs with: hypothesis input, status, output format, date
  - Click row → view full synthesis result
  - "New Synthesis" button

TAB 5: Costs
  - Recharts visualizations:
      - Line chart: cumulative cost over time
      - Pie chart: cost by model
      - Bar chart: cost by discovery run
  - Data from pipeline_intelligence endpoints

TAB 6: Settings
  - Discovery config editor (JSON form)
  - Lab Profile editor (see Section 2.4)
  - Project metadata (name, description, status)
  - Danger zone: archive/delete project
```

## 14.3 — DiscoveryRunner (`/projects/:id/discover`)

```
Two-phase UI:

PHASE 1: Pre-run config panel
  - Disease input (pre-filled from project)
  - Discovery type dropdown
  - External factors multi-input (tag chips)
  - Number of rounds slider (1-4, default 3)
  - Output format dropdown
  - Verbosity dropdown
  - Grant type dropdown (shown only if output_format is "grant_sections")
  - Citation style dropdown
  - Lab profile summary (read-only, shows active profile from project settings)
  - "Start Discovery" button → POST /projects/{id}/discover → connects WebSocket

PHASE 2: Live pipeline viewer (shown after run starts)
  - 11-segment horizontal progress bar
      Each segment = one pipeline stage
      Color: gray (pending), blue (running), green (completed), red (error)
      Each segment shows the grounding ratio as a fill percentage
  - Round/hypothesis tracker grid
      Rows = rounds, columns = hypothesis slots
      Cells fill in as hypotheses complete
      Click cell → preview hypothesis summary
  - Real-time cost counter (top right, updates via WebSocket cost_update events)
  - Elapsed timer (top right)
  - Scrolling live stage feed (left panel)
      Each event from WebSocket rendered as a log entry with timestamp
      Animated entry (slide in from bottom)
  - Cancel button → sends { command: "cancel" } over WebSocket
  - Post-run summary (shown after run_completed):
      Best hypothesis card with score
      Stage duration heatmap (stages × rounds, color = duration)
      "View All Hypotheses" button → navigates to Hypotheses tab
```

## 14.4 — HypothesisReview (`/projects/:id/hypotheses/:hypothesisId`)

```
Layout: Full-page detail view

SECTION 1: Header
  - Hypothesis title
  - Score badges: confidence, novelty, feasibility, impact
  - Feasibility indicator (green/yellow/red per Section 2.5)
  - Required methods tags

SECTION 2: Pipeline Trace Accordion
  - One expandable section per pipeline stage (all 11)
  - Each shows: model used, duration, token count, grounding ratio
  - Expandable to show full stage output text

SECTION 3: Mechanism
  - Mechanism text with entity highlighting (genes in blue, proteins in green, drugs in orange, diseases in red)
  - Click entity → search for it in the knowledge graph

SECTION 4: Evidence
  - PubMed-linked citations (each citation is a clickable link to PubMed)
  - FDA references with links to openFDA
  - Clinical trial references with links to ClinicalTrials.gov
  - Grouped by: supporting, contradicting, related

SECTION 5: Translational Roadmap
  - T0 (Basic Research) → T1 (Preclinical) → T2 (Phase I/II) → T3 (Phase III) → T4 (Regulatory) → T5 (Clinical Adoption)
  - Horizontal timeline visualization
  - Each stage shows: what needs to happen, estimated timeline, key risks

SECTION 6: Version History
  - Show hypothesis as it was BEFORE the COUNTER stage
  - Show counter-arguments from COUNTER stage
  - Show revised hypothesis from REVISE stage
  - Diff view highlighting what changed

SECTION 7: Paper Generation
  - "Generate Paper" button → POST /hypotheses/{id}/generate-paper
  - Downloads a .docx file

SECTION 8: Feedback Form
  - Overall quality: 5-star slider
  - 6 dimension sliders (scientific rigor, novelty, feasibility, clinical relevance, evidence quality, mechanism clarity): each 1-5
  - Boolean toggles: is_novel, is_actionable, is_testable, needs_validation
  - Tag input: freeform tags
  - Free text comment
  - Submit → POST /hypotheses/{id}/feedback
```

## 14.5 — ProjectKnowledgeGraph (`/projects/:id/graph`)

```
Library: Cytoscape.js with force-directed layout (fcose or cola)
Data: Real Neo4j data fetched via backend API

Features:
  - Entity search bar (search by name or type)
  - Type filter checkboxes: gene, protein, drug, disease, pathway (toggle visibility)
  - Color-coded nodes:
      Gene: blue
      Protein: green
      Drug: orange
      Disease: red
      Pathway: purple
  - Click node → expand neighborhood (BFS 1 hop)
  - Click node → show detail panel (right sidebar) with:
      Entity name, type, properties
      List of connected entities
      Link to external database (UniProt, DrugBank, etc.)
  - Edge labels showing relationship type and confidence score
  - Zoom/pan controls
  - Export graph as PNG
```

## 14.6 — PipelineIntelligence (`/intelligence`)

```
4 tabs:

TAB 1: Costs
  - Recharts AreaChart: cumulative cost over time (all projects)
  - Recharts donut: cost by model
  - Recharts bar: cost by project

TAB 2: Model Performance
  - Model × Stage heatmap: cell value = avg duration or avg grounding ratio
  - Table: model, total calls, avg latency, avg tokens, error rate, fallback rate

TAB 3: Benchmarks
  - Benchmark test case list with score trends over time (line chart)
  - Each test case: disease, expected output, actual score, pass/fail

TAB 4: Optimizations
  - Recommendations generated from pipeline data:
      "Stage X is 3x slower than average — consider switching model"
      "Grounding ratio for Stage Y dropped below 0.7 in last 10 runs"
      "Model Z has 15% error rate — review fallback chain"
```

---

# 15. IMAGING INGESTION SERVICE <a name="15-imaging-ingestion"></a>

For neuroimaging data (MRI, EEG).

```python
class ImagingService:
    """Handles ingestion and metadata extraction for biomedical imaging files."""

    async def ingest(self, project_id: str, file: UploadFile) -> ImagingRecord:
        """
        1. Detect file format (DICOM, NIfTI, PNG, JPG, TIFF)
        2. Extract metadata via the appropriate parser
        3. Anonymize patient ID (UUID5 hash)
        4. Store file to project storage directory
        5. Create imaging_records row
        6. Return ImagingRecord
        """

    async def extract_metadata(self, file_path: str, format: str) -> dict:
        """
        Format-specific extraction:
          DICOM (pydicom): modality, body_region, resolution, acquisition_params (TR, TE, flip angle),
                           patient_id (to be hashed), study_date, series_description
          NIfTI (nibabel): dimensions (3D or 4D), voxel sizes, affine matrix, detect fMRI (4D with timepoints > 1)
          Basic image (PIL): dimensions, resolution (DPI), color mode
        """

    async def search(self, project_id: str, modality: str = None, body_region: str = None) -> list[ImagingRecord]:
        """Search imaging records by project, modality, body region."""

    async def list_by_project(self, project_id: str) -> list[ImagingRecord]:
        """List all imaging records for a project."""

    async def generate_description(self, record_id: str) -> str:
        """Use Claude Sonnet to generate a text description of the imaging metadata for linking to hypotheses."""

    async def link_to_hypothesis(self, record_id: str, hypothesis_id: str) -> None:
        """Add hypothesis_id to the linked_hypothesis_ids JSONB array on the imaging record."""

# Dependencies (guarded with try/except for environments without them):
#   pydicom — DICOM parsing
#   nibabel — NIfTI parsing
#   Pillow (PIL) — Basic image parsing
# If a dependency is not installed, the corresponding format raises a clear error:
#   "pydicom is required for DICOM files. Install with: pip install pydicom"
```

---

# 16. METHODS TAXONOMY <a name="16-methods-taxonomy"></a>

Static JSON file loaded at app startup. Used for: lab profile autocomplete, method filter parsing, gap heatmap axes, method frequency tables.

```
File: config/methods_taxonomy.json
Update: Edit file and restart app (no migration needed)

Structure:
{
  "categories": [
    {
      "name": "Neuroimaging",
      "methods": ["MRI", "fMRI", "DTI", "EEG", "MEG", "PET", "SPECT", "fNIRS", "CT", "TMS", "tDCS"]
    },
    {
      "name": "Molecular Biology",
      "methods": ["PCR", "qPCR", "RT-PCR", "Western Blot", "ELISA", "RNA-seq", "ChIP-seq", "CRISPR", "CRISPR-Cas9", "Northern Blot", "Southern Blot", "In Situ Hybridization", "Cloning"]
    },
    {
      "name": "Cell Biology",
      "methods": ["Flow Cytometry", "FACS", "Confocal Microscopy", "Fluorescence Microscopy", "Electron Microscopy", "Cell Culture", "Immunohistochemistry", "Immunofluorescence", "Live Cell Imaging", "Patch Clamp"]
    },
    {
      "name": "Animal Models",
      "methods": ["Mouse Models", "Rat Models", "Zebrafish", "Drosophila", "C. elegans", "Non-Human Primates", "Transgenic Models", "Knockout Models"]
    },
    {
      "name": "Clinical Research",
      "methods": ["Randomized Controlled Trial", "Observational Study", "Case-Control Study", "Cohort Study", "Cross-Sectional Study", "Meta-Analysis", "Systematic Review", "Clinical Trial Phase I", "Clinical Trial Phase II", "Clinical Trial Phase III", "Patient Survey", "Chart Review"]
    },
    {
      "name": "Computational",
      "methods": ["Bioinformatics", "Machine Learning", "Deep Learning", "Molecular Dynamics", "Network Analysis", "GWAS", "PRS", "Single-Cell Analysis", "Spatial Transcriptomics", "Structural Modeling", "Docking Simulation"]
    },
    {
      "name": "Omics",
      "methods": ["Proteomics", "Metabolomics", "Genomics", "Transcriptomics", "Lipidomics", "Epigenomics", "Metagenomics", "Phosphoproteomics", "Glycomics"]
    },
    {
      "name": "Biochemistry & Structural",
      "methods": ["Mass Spectrometry", "LC-MS", "GC-MS", "X-ray Crystallography", "NMR Spectroscopy", "Cryo-EM", "SAXS", "Surface Plasmon Resonance", "Isothermal Titration Calorimetry", "Circular Dichroism"]
    },
    {
      "name": "Electrophysiology",
      "methods": ["Patch Clamp", "Extracellular Recording", "Multi-Electrode Array", "ERP", "EMG", "ECoG", "Local Field Potential"]
    },
    {
      "name": "Pharmacology",
      "methods": ["Dose-Response Assay", "IC50 Determination", "Pharmacokinetics", "Pharmacodynamics", "Drug Screening", "ADMET Profiling", "Toxicity Testing"]
    }
  ]
}
```

API endpoint to serve this to the frontend:
```
GET /config/methods-taxonomy
  Response: The full JSON object above
  Caching: Cache-Control: public, max-age=86400 (24 hours)
```

---

# 17. ARCHITECTURE DECISIONS <a name="17-architecture-decisions"></a>

```
1. Active Orchestrator Registry:
   - Dict[str, DiscoveryOrchestrator] replacing singleton pattern
   - Keyed by run_id
   - Allows concurrent discovery runs without interference
   - Cleanup: Remove from registry on run_completed or run_error

2. All research data in PostgreSQL:
   - NO localStorage for project data (frontend uses TanStack Query + API only)
   - NO ChromaDB (replaced by pgvector)
   - Neo4j remains for knowledge graph ONLY

3. WebSocket per discovery/synthesis run:
   - DiscoveryConnectionManager class manages active connections
   - One WebSocket per run_id
   - Handles client disconnect/reconnect with event replay

4. Background task runner:
   - _run_discovery_pipeline() runs as a FastAPI background task
   - _run_synthesis_pipeline() runs as a FastAPI background task
   - Both write progress to the database AND push events to WebSocket
   - On crash, status is set to "failed" with error_message

5. Hypothesis version history:
   - pipeline_trace JSONB on hypotheses table stores the full output at each stage
   - COUNTER → REVISE creates a diff that is stored in the revisions JSONB column
   - Frontend can reconstruct any version by reading the pipeline_trace

6. Feedback aggregation:
   - On each new feedback submission, update hypotheses.avg_feedback_quality and feedback_count
   - avg_feedback_quality = running average across all feedback for that hypothesis
   - This feeds into future pipeline runs as "learning memory" (hypotheses with high feedback scores inform SEED prompts)

7. Dynamic reranker weights:
   - Fallback chain selection considers historical model performance
   - If a model's error rate exceeds 10% over the last 50 calls, it is deprioritized in the fallback chain
   - Metrics stored in a model_performance table (or JSONB config)
```

---

# 18. TESTING REQUIREMENTS <a name="18-testing"></a>

```
UNIT TESTS (pytest):
  - Every API endpoint: input validation, response shape, error cases
  - CitationService: extract_claims, find_citations, inject_citations, format_reference_list, verify_citation
  - ImagingService: metadata extraction for DICOM, NIfTI, basic image
  - Lab profile validation: valid/invalid JSONB, taxonomy matching
  - Grounding: cosine similarity threshold, TTL cleanup, cross-source corroboration logic

INTEGRATION TESTS (pytest + test database):
  - Full discovery pipeline with mocked LLM responses (verify stage ordering, parallelization, output schema)
  - Full synthesis pipeline with mocked LLM responses
  - Lab profile filtering: verify that strict mode actually removes hypotheses, permissive mode flags them
  - pgvector search: insert embeddings, verify cosine similarity retrieval
  - WebSocket: connect, receive events, send cancel, verify run stops

FRONTEND TESTS (Vitest + React Testing Library):
  - Snapshot tests for all new pages (ProjectsList, ProjectWorkspace, DiscoveryRunner, HypothesisReview, ProjectKnowledgeGraph, PipelineIntelligence)
  - Interaction tests: create project, start discovery, submit feedback
  - WebSocket mock: verify UI updates on stage_started, stage_completed, run_completed events
  - Lab profile editor: add/remove methods, save, verify API call

E2E TESTS (Playwright, optional but recommended):
  - Create project → set lab profile → run discovery → review hypothesis → submit feedback
  - Run synthesis → change verbosity → export to docx
```

---

# 19. DATA SOURCES — PHASES 2-4 (39 ADDITIONAL) <a name="19-data-sources-extended"></a>

These extend the 21 Phase 1 sources (Section 10) to 60+ total. Each uses the same `DataSourceClient` abstract base class defined in Section 10. All must be queryable by the RETRIEVE stage (synthesis) and EVIDENCE stage (discovery).

## 19.1 — Phase 2: Clinical & Regulatory (10 sources)

```
 #  | Source                     | Type                 | API/Access
----|---------------------------|----------------------|-------------------------------------------
22  | WHO International          | Clinical trials      | REST API (https://trialsearch.who.int/api/)
    | Clinical Trials Registry   |                      |
23  | EMA (European Medicines    | Drug approvals       | REST API (https://www.ema.europa.eu/en/medicines/)
    | Agency)                    |                      |
24  | DailyMed                   | Drug labels (US)     | REST API (https://dailymed.nlm.nih.gov/dailymed/services/)
25  | SIDER                      | Drug side effects    | Download (http://sideeffects.embl.de/) — TSV files, import to PostgreSQL
26  | FAERS                      | Adverse events       | openFDA API (https://api.fda.gov/drug/event.json)
27  | AACT (ClinicalTrials.gov   | Trial structured     | PostgreSQL mirror (https://aact.ctti-clinicaltrials.org/)
    | structured data)           | data                 | Direct PG connection or daily snapshot download
28  | EU Clinical Trials         | EU trials            | REST API (https://euclinicaltrials.eu/ctis-public/api/)
    | Register (CTIS)            |                      |
29  | Orange Book (FDA)          | Patent/exclusivity   | Download CSV (https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files)
30  | Drugs@FDA                  | FDA drug approvals   | openFDA API (https://api.fda.gov/drug/drugsfda.json)
31  | IQVIA / Cortellis          | Market intelligence  | Commercial API (requires enterprise license)
```

**Implementation notes:**
- SIDER: No live API. Download the TSV dumps, parse, and load into a PostgreSQL staging table (`sider_side_effects`). Refresh monthly via a cron job or Celery beat task.
- AACT: Option A — connect directly to their PostgreSQL mirror (read-only credentials from CTTI). Option B — download the daily snapshot pipe-delimited files and import to a local `aact_*` schema. Option A preferred for freshness.
- Orange Book: Download CSV quarterly. Parse and load into `orange_book_patents` table.
- IQVIA/Cortellis: Enterprise license required. Build the client class with a clear "license not configured" error if API key is missing. Do NOT block other sources if this one is unavailable.

## 19.2 — Phase 3: Genomics & Biological (15 sources)

```
 #  | Source                     | Type                 | API/Access
----|---------------------------|----------------------|-------------------------------------------
32  | ClinVar                    | Genetic variants     | E-Utilities + FTP (https://ftp.ncbi.nlm.nih.gov/pub/clinvar/)
33  | dbSNP                      | SNP data             | E-Utilities (https://eutils.ncbi.nlm.nih.gov/)
34  | HGNC                       | Gene nomenclature    | REST API (https://rest.genenames.org/)
35  | NCBI Gene                  | Gene info            | E-Utilities (https://eutils.ncbi.nlm.nih.gov/)
36  | RefSeq                     | Reference sequences  | E-Utilities + REST (https://api.ncbi.nlm.nih.gov/datasets/)
37  | GTEx                       | Gene expression      | REST API (https://gtexportal.org/api/v2/)
    |                            | (tissue-specific)    |
38  | ENCODE                     | Functional genomics  | REST API (https://www.encodeproject.org/)
39  | GnomAD                     | Population variants  | REST API (https://gnomad.broadinstitute.org/api)
40  | TCGA (The Cancer Genome    | Cancer genomics      | GDC API (https://api.gdc.cancer.gov/)
    | Atlas)                     |                      |
41  | GWAS Catalog               | GWAS associations    | REST API (https://www.ebi.ac.uk/gwas/rest/api/)
42  | WikiPathways               | Biological pathways  | REST API (https://webservice.wikipathways.org/)
43  | Pathway Commons            | Integrated pathways  | REST API (https://www.pathwaycommons.org/pc2/)
44  | ChEBI                      | Chemical ontology    | REST API (https://www.ebi.ac.uk/chebi/webServices.do)
45  | RxNorm                     | Drug normalization   | REST API (https://rxnav.nlm.nih.gov/REST/)
46  | HMDB (Human Metabolome     | Metabolites          | REST API (https://hmdb.ca/api/)
    | Database)                  |                      |
```

**Implementation notes:**
- ClinVar + dbSNP: Both accessible via NCBI E-Utilities. Use the same `NCBIClient` base class with different database parameters (`db=clinvar`, `db=snp`).
- GTEx: REST API returns tissue-specific expression data. Cache responses aggressively (expression data is versioned by release, not real-time).
- TCGA/GDC: The API has a complex filter syntax. Build a dedicated `GDCClient` that translates simple queries into GDC filter objects.
- GnomAD: GraphQL API. Build a dedicated `GnomADClient` with predefined queries for variant frequency lookup.

## 19.3 — Phase 4: Literature, Preprints & Specialized (14 sources)

```
 #  | Source                     | Type                 | API/Access
----|---------------------------|----------------------|-------------------------------------------
47  | Semantic Scholar           | Literature + graph   | REST API (https://api.semanticscholar.org/graph/v1/)
    |                            |                      | Rate limit: 100 req/5 min without key, 1 req/sec with key
48  | OpenAlex                   | Literature metadata  | REST API (https://api.openalex.org/)
    |                            |                      | Free, polite pool (include email in User-Agent)
49  | bioRxiv                    | Preprints (bio)      | REST API (https://api.biorxiv.org/)
50  | medRxiv                    | Preprints (med)      | REST API (https://api.medrxiv.org/)
51  | arXiv                      | Preprints (CS/math)  | REST API (https://export.arxiv.org/api/)
52  | Cochrane Library           | Systematic reviews   | Wiley API (requires institutional access)
53  | Scopus                     | Citation metrics     | REST API (requires Elsevier API key)
54  | CrossRef                   | DOI metadata         | REST API (https://api.crossref.org/)
    |                            |                      | Free, polite pool (include email in User-Agent)
55  | Unpaywall                  | Open access links    | REST API (https://api.unpaywall.org/)
    |                            |                      | Requires email parameter
56  | ZINC                       | Chemical compounds   | REST API (https://zinc15.docking.org/substances/)
57  | BindingDB                  | Binding affinities   | REST API (https://www.bindingdb.org/axis2/services/BDBService/)
58  | TTD (Therapeutic Target    | Drug targets         | Download (http://db.idrblab.net/ttd/)
    | Database)                  |                      |
59  | Monarch Initiative         | Disease-phenotype    | REST API (https://api.monarchinitiative.org/v3/)
60  | Open Targets               | Drug-target evidence | GraphQL API (https://api.platform.opentargets.org/api/v4/graphql)
```

**Implementation notes:**
- Semantic Scholar: Has excellent citation graph data. Use for citation network expansion — given a paper, retrieve all papers it cites and all papers that cite it.
- OpenAlex: Best free alternative to Scopus for citation metrics and author disambiguation. Use as the primary metadata enrichment source.
- bioRxiv/medRxiv: Same API pattern. Build a single `RxivClient` that accepts a `server` parameter ("biorxiv" or "medrxiv").
- Cochrane/Scopus: Both require institutional or commercial API keys. Guard with "license not configured" errors like IQVIA.
- Open Targets: GraphQL API. Build dedicated `OpenTargetsClient` with predefined queries for drug-target-disease associations.
- TTD: Download-only. Parse and load into `ttd_targets` table. Refresh quarterly.

## 19.4 — Data Source Registry & Health Monitoring

```python
class DataSourceRegistry:
    """Central registry for all 60+ data sources."""

    sources: dict[str, DataSourceClient]  # Keyed by source name

    async def register(self, client: DataSourceClient) -> None:
        """Register a source client. Called at app startup."""

    async def search_all(self, query: str, max_results_per_source: int = 10) -> list[SourceResult]:
        """Query ALL registered sources concurrently. Aggregate and deduplicate results."""

    async def search_subset(self, query: str, source_names: list[str], max_results_per_source: int = 10) -> list[SourceResult]:
        """Query only the specified sources."""

    async def health_check(self) -> dict[str, SourceHealth]:
        """Check connectivity and response time for all sources."""

    async def get_available_sources(self) -> list[SourceInfo]:
        """Return list of all registered sources with their status (configured, unconfigured, degraded)."""

class SourceHealth(BaseModel):
    source_name: str
    status: Literal["healthy", "degraded", "down", "unconfigured"]
    latency_ms: float | None
    last_checked: datetime
    error_message: str | None

class SourceInfo(BaseModel):
    name: str
    phase: int  # 1, 2, 3, or 4
    type: str   # "Literature", "Clinical trials", etc.
    status: Literal["configured", "unconfigured", "license_required"]
    requires_api_key: bool
    requires_license: bool
```

## 19.5 — Database Schema for Source Health

```sql
CREATE TABLE data_source_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name VARCHAR(100) NOT NULL UNIQUE,
    phase INTEGER NOT NULL,                          -- 1, 2, 3, or 4
    status VARCHAR(20) NOT NULL DEFAULT 'unconfigured',
    latency_ms FLOAT,
    last_successful_query TIMESTAMPTZ,
    last_error TEXT,
    last_checked TIMESTAMPTZ,
    total_queries INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    config JSONB,                                    -- API keys, endpoints, rate limits
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_source_health_name ON data_source_health(source_name);
CREATE INDEX idx_source_health_status ON data_source_health(status);
```

Add to **Migration 005**: `data_source_registry`

## 19.6 — API Endpoints for Data Sources

```
GET    /data-sources                    — List all registered sources with status
GET    /data-sources/{name}/health      — Get health info for a specific source
POST   /data-sources/{name}/test        — Run a test query against a specific source (admin/dev only)
PATCH  /data-sources/{name}/config      — Update source config (API key, endpoint, etc.)
```

## 19.7 — Phase Rollout Strategy

```
Phase 2 sources depend on Phase 1 being stable. Phase 3 depends on Phase 2. Phase 4 depends on Phase 3.

PHASE 2 ROLLOUT:
  - Implement all 10 clients
  - For download-based sources (SIDER, Orange Book): Build import scripts + Celery beat schedule
  - For AACT: Set up PostgreSQL foreign data wrapper OR daily import
  - Integration test: Run the same benchmark query against Phase 1+2 and verify result quality improves
  - Metric: ≥ 85% of Phase 2 sources returning results for a standard oncology test query

PHASE 3 ROLLOUT:
  - Implement all 15 clients
  - For GraphQL sources (GnomAD, Open Targets): Use httpx with custom query builders
  - For E-Utilities sources (ClinVar, dbSNP, NCBI Gene, RefSeq): Extend existing NCBIClient
  - Integration test: Run benchmark queries across genomics-focused hypotheses
  - Metric: ≥ 80% of Phase 3 sources returning results for a standard rare disease test query

PHASE 4 ROLLOUT:
  - Implement all 14 clients
  - For license-gated sources (Cochrane, Scopus): Stub clients that return "unconfigured" status
  - For preprint servers (bioRxiv, medRxiv, arXiv): Ensure deduplication against PubMed (many preprints are later published)
  - Integration test: Verify preprint sources add unique results not found via PubMed alone
  - Metric: ≥ 10% increase in unique papers retrieved for a standard neuroscience test query vs Phase 1-3 alone
```

---

# 20. pgvector MANAGEMENT UI (DEVELOPER) <a name="20-pgvector-ui"></a>

An internal developer-facing UI for managing the pgvector grounding cache and monitoring embedding quality.

## 20.1 — Purpose

The grounding_cache table (Section 11.4) is central to humanovo's anti-hallucination system. Developers need visibility into what's cached, cache health, and the ability to manually manage entries. This is NOT a researcher-facing page — it's behind a `/dev/` route prefix.

## 20.2 — Frontend Page: pgvector Manager (`/dev/pgvector`)

```
Route: /dev/pgvector
Access: Developer only (no auth system yet, but prefix route with /dev/ for future gating)

Layout: Full-page dashboard with 4 tabs

TAB 1: Cache Overview
  Stats cards (top row):
    - Total entries: COUNT(*) from grounding_cache
    - Entries with Cohere embeddings: COUNT(*) WHERE embedding_cohere IS NOT NULL
    - Entries with OpenAI embeddings: COUNT(*) WHERE embedding_openai IS NOT NULL
    - Entries with BOTH embeddings: COUNT(*) WHERE embedding_cohere IS NOT NULL AND embedding_openai IS NOT NULL
    - Oldest entry: MIN(created_at)
    - Entries expiring in 7 days: COUNT(*) WHERE updated_at < NOW() - INTERVAL '23 days'
    - Total cache size (estimated): pg_total_relation_size('grounding_cache')

  Source distribution chart (Recharts PieChart):
    - Segments = source (PubMed, DrugBank, ChEMBL, etc.)
    - Values = COUNT(*) GROUP BY source

  Cache growth over time (Recharts AreaChart):
    - X = date (created_at grouped by day)
    - Y = cumulative entry count
    - Show last 90 days

  TTL expiry forecast (Recharts BarChart):
    - X = next 30 days
    - Y = entries expiring each day
    - Red highlight for days with > 1000 expirations

TAB 2: Search & Browse
  Search bar:
    - Text input for semantic search (embeds query with Cohere, returns nearest neighbors)
    - Source filter dropdown (all sources)
    - Date range filter
    - Similarity threshold slider (0.5 to 1.0, default 0.7)
  Results table:
    - Columns: content (truncated to 200 chars), source, source_id, similarity_score, created_at, updated_at
    - Click row → expand to full content + metadata JSONB viewer
    - Checkbox selection for bulk actions
  Bulk actions:
    - Delete selected
    - Re-embed selected (recompute embeddings with current models)
    - Refresh TTL (update updated_at to NOW() to extend 30-day TTL)

TAB 3: Similarity Testing
  Purpose: Test the dual-embedding anti-hallucination mechanism
  Input:
    - Text input: "Enter a claim to test grounding for"
    - "Search" button
  Output:
    - Two columns side by side:
      Left: "Cohere Embed v3 Results" — top 10 nearest neighbors with similarity scores
      Right: "OpenAI text-embedding-3-large Results" — top 10 nearest neighbors with similarity scores
    - Overlap indicator: How many results appear in BOTH top-10 lists
    - Verdict:
      ✅ "Grounded" if best match >= 0.7 in EITHER embedding space
      ⚠️ "Weakly grounded" if best match is 0.5-0.7
      ❌ "Ungrounded" if best match < 0.5 in BOTH spaces
    - This helps developers debug false grounding or missed grounding cases

TAB 4: Maintenance
  Scheduled tasks status:
    - TTL cleanup: Last run, next run, entries deleted in last run
    - Re-indexing: Last IVFFlat rebuild, index size, estimated query latency
  Manual actions:
    - "Run TTL Cleanup Now" button → DELETE FROM grounding_cache WHERE updated_at < NOW() - INTERVAL '30 days'
    - "Rebuild IVFFlat Indexes" button → REINDEX INDEX idx_grounding_cohere; REINDEX INDEX idx_grounding_openai;
    - "Purge Source" dropdown + button → DELETE FROM grounding_cache WHERE source = '{selected}'
    - "Vacuum Analyze" button → VACUUM ANALYZE grounding_cache
    - "Export Cache Stats" → Download a JSON report of current cache state
  Each action shows a confirmation dialog and a progress indicator.
```

## 20.3 — API Endpoints for pgvector Management

```
GET    /dev/pgvector/stats                — Cache overview stats (counts, sizes, source distribution)
POST   /dev/pgvector/search               — Semantic search: { query: string, source: string|null, threshold: float, limit: int }
                                            Returns: list of grounding_cache entries with similarity scores
POST   /dev/pgvector/similarity-test      — Dual-embedding test: { query: string }
                                            Returns: { cohere_results: [...], openai_results: [...], overlap_count: int, verdict: string }
DELETE /dev/pgvector/entries               — Bulk delete: { entry_ids: list[uuid] }
POST   /dev/pgvector/entries/re-embed     — Bulk re-embed: { entry_ids: list[uuid] }
POST   /dev/pgvector/entries/refresh-ttl  — Bulk refresh TTL: { entry_ids: list[uuid] }
POST   /dev/pgvector/maintenance/ttl-cleanup  — Run TTL cleanup now
POST   /dev/pgvector/maintenance/reindex      — Rebuild IVFFlat indexes
POST   /dev/pgvector/maintenance/purge-source — Purge by source: { source_name: string }
POST   /dev/pgvector/maintenance/vacuum       — Run VACUUM ANALYZE
GET    /dev/pgvector/maintenance/status        — Scheduled task status (last run, next run, etc.)
```

## 20.4 — Backend: Scheduled Maintenance Tasks

```python
# Celery beat schedule (or FastAPI BackgroundTasks if Celery is not yet set up)

SCHEDULED_TASKS = {
    "grounding_cache_ttl_cleanup": {
        "schedule": "daily at 03:00 UTC",
        "action": "DELETE FROM grounding_cache WHERE updated_at < NOW() - INTERVAL '30 days'",
        "log_to": "maintenance_log table"
    },
    "grounding_cache_stats_snapshot": {
        "schedule": "hourly",
        "action": "INSERT INTO cache_stats_snapshots (timestamp, total_entries, total_size_bytes, source_counts)",
        "purpose": "Powers the cache growth chart on the UI"
    },
    "ivfflat_index_rebuild": {
        "schedule": "weekly on Sunday at 04:00 UTC",
        "action": "REINDEX INDEX CONCURRENTLY idx_grounding_cohere; REINDEX INDEX CONCURRENTLY idx_grounding_openai;",
        "note": "CONCURRENTLY avoids locking the table during rebuild"
    }
}
```

## 20.5 — Database Schema for Maintenance

```sql
CREATE TABLE cache_stats_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_entries INTEGER NOT NULL,
    total_size_bytes BIGINT,
    entries_with_cohere INTEGER,
    entries_with_openai INTEGER,
    entries_with_both INTEGER,
    source_counts JSONB,                             -- {"PubMed": 5000, "DrugBank": 1200, ...}
    expiring_in_7_days INTEGER
);

CREATE INDEX idx_cache_stats_time ON cache_stats_snapshots(snapshot_at DESC);

CREATE TABLE maintenance_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_name VARCHAR(100) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL,                     -- running, completed, failed
    entries_affected INTEGER,
    error_message TEXT,
    duration_seconds FLOAT
);

CREATE INDEX idx_maintenance_task ON maintenance_log(task_name, started_at DESC);
```

Add to **Migration 006**: `pgvector_management`

---

# 21. BILLING & USAGE DASHBOARD <a name="21-billing-dashboard"></a>

A user-facing dashboard showing API costs, usage patterns, and budget controls. Similar in spirit to Claude's billing page or OpenAI's usage dashboard.

## 21.1 — Purpose

Every pipeline run costs real money (LLM API calls, embedding calls, data source API calls). Researchers and administrators need to see what they're spending, set budgets, and get alerts before costs run away.

## 21.2 — Data Model

Usage is already tracked in `discovery_runs.total_cost_cents` and `synthesis_runs.total_cost_cents`. For granular billing, add a new table:

```sql
CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    run_id UUID,                                     -- discovery_run or synthesis_run ID
    run_type VARCHAR(20) NOT NULL,                   -- "discovery" | "synthesis" | "chat" | "embedding" | "data_source"
    model VARCHAR(100) NOT NULL,                     -- e.g., "claude-opus-4-6", "gpt-4.1", "cohere-embed-v3"
    provider VARCHAR(50) NOT NULL,                   -- "anthropic_bedrock", "azure_openai", "cohere", "openai"
    stage VARCHAR(30),                               -- Pipeline stage name if applicable
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,            -- Cost in cents (USD)
    latency_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_type VARCHAR(100),                         -- "rate_limit", "timeout", "auth_error", "model_error", null
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_project ON usage_events(project_id);
CREATE INDEX idx_usage_created ON usage_events(created_at DESC);
CREATE INDEX idx_usage_model ON usage_events(model);
CREATE INDEX idx_usage_provider ON usage_events(provider);
CREATE INDEX idx_usage_run ON usage_events(run_id);

-- Pre-aggregated daily summary for fast dashboard queries
CREATE TABLE usage_daily_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    model VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_tokens_input BIGINT NOT NULL DEFAULT 0,
    total_tokens_output BIGINT NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    total_errors INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms FLOAT,
    UNIQUE(date, project_id, model, provider)
);

CREATE INDEX idx_daily_summary_date ON usage_daily_summary(date DESC);
CREATE INDEX idx_daily_summary_project ON usage_daily_summary(project_id);
```

## 21.3 — Budget & Alert System

```sql
CREATE TABLE budget_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope VARCHAR(20) NOT NULL,                      -- "global" | "project"
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    monthly_budget_cents INTEGER NOT NULL,            -- Monthly spend limit in cents
    alert_threshold_pct INTEGER NOT NULL DEFAULT 80,  -- Alert when this % of budget is reached
    hard_limit BOOLEAN NOT NULL DEFAULT FALSE,        -- If TRUE, block pipeline runs when budget exceeded
    current_month_spend_cents INTEGER DEFAULT 0,      -- Updated by trigger or scheduled task
    last_alert_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scope, project_id)                        -- One budget per project + one global
);

CREATE INDEX idx_budget_scope ON budget_configs(scope);
```

**Budget enforcement logic:**

```python
class BudgetService:
    """Checks and enforces budget limits before and during pipeline runs."""

    async def check_budget(self, project_id: str | None) -> BudgetStatus:
        """
        Returns BudgetStatus:
          - ok: Under budget, proceed
          - warning: Over alert threshold but under limit. Log warning, proceed.
          - blocked: Over hard limit. Raise BudgetExceededError, do NOT start pipeline.

        Checks both project-level and global budgets.
        """

    async def record_cost(self, event: UsageEvent) -> None:
        """
        1. Insert into usage_events table
        2. Update budget_configs.current_month_spend_cents
        3. If threshold crossed, trigger alert (see 21.4)
        """

    async def reset_monthly_budgets(self) -> None:
        """
        Scheduled: 1st of each month at 00:00 UTC
        Reset current_month_spend_cents to 0 for all budget_configs.
        Archive the previous month's total to usage_daily_summary.
        """
```

## 21.4 — Alert System

```python
class BudgetAlertService:
    """Sends alerts when budget thresholds are crossed."""

    async def check_and_alert(self, budget: BudgetConfig) -> None:
        """
        If current_month_spend_cents >= (monthly_budget_cents * alert_threshold_pct / 100):
          AND last_alert_sent_at is NULL or was more than 24 hours ago:
            Send alert via configured channel.
            Update last_alert_sent_at.

        Alert channels (implement in order of priority):
          1. In-app notification banner (always, stored in notifications table)
          2. Email (if email is configured for the user — future)
          3. WebSocket push to active sessions
        """

# In-app notification storage
```

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,                                    -- NULL for global notifications
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,                       -- "budget_warning", "budget_exceeded", "pipeline_error", "system"
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',    -- "info", "warning", "critical"
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
```

## 21.5 — Frontend Page: Billing Dashboard (`/billing`)

```
Route: /billing
Access: All users (shows data scoped to their projects)

Layout: Full-page dashboard

SECTION 1: Current Month Summary (top banner)
  - Total spend this month: $XX.XX (large number)
  - Budget remaining: $YY.YY / $ZZ.ZZ (progress bar, green → yellow → red)
  - Projected end-of-month spend (linear extrapolation from daily average)
  - "Set Budget" button → opens budget config modal

SECTION 2: Spend Over Time (main chart area)
  Recharts AreaChart:
    - X = date (daily)
    - Y = daily cost in dollars
    - Stacked by provider (Anthropic = blue, Azure OpenAI = green, Cohere = orange, OpenAI = purple)
    - Time range selector: 7 days, 30 days, 90 days, custom
    - Hover shows: date, cost per provider, total, request count

SECTION 3: Cost Breakdown (two side-by-side charts)
  Left — Recharts DonutChart: Cost by model
    - Segments: claude-opus-4-6, claude-sonnet-4-6, gpt-4.1, o3-mini, cohere-command-a, cohere-embed-v3, text-embedding-3-large, grok-4-1-fast
    - Center text: Total cost this period

  Right — Recharts DonutChart: Cost by pipeline type
    - Segments: Discovery pipeline, Synthesis pipeline, Chat, Embeddings, Data source queries

SECTION 4: Cost by Project (table)
  - Columns: Project name, Disease, Discovery runs, Synthesis runs, Total cost, Avg cost per run
  - Sortable by any column
  - Click row → navigate to project's Cost tab

SECTION 5: Usage Details (expandable table)
  - Columns: Timestamp, Project, Run type, Stage, Model, Tokens in, Tokens out, Cost, Latency, Status
  - Filterable by: project, model, provider, date range, success/error
  - Paginated (50 per page)
  - Export to CSV button

SECTION 6: Budget Management
  - List of all budget configs (global + per-project)
  - Each row: scope, project name (if project), monthly budget, current spend, alert threshold, hard limit toggle
  - Edit button per row → modal with:
      Monthly budget input (in dollars, stored as cents)
      Alert threshold slider (50-100%, default 80%)
      Hard limit toggle (default: OFF)
      "When enabled, pipeline runs will be blocked once the budget is exceeded"
  - "Add Project Budget" button
  - "Set Global Budget" button (one global budget max)
```

## 21.6 — API Endpoints for Billing

```
GET    /billing/summary                   — Current month summary: total spend, budget status, projected spend
       Query params: project_id (optional, scopes to one project)

GET    /billing/daily                     — Daily cost breakdown for charting
       Query params: start_date, end_date, project_id (optional), group_by (provider | model | run_type)
       Response: list[{ date, group, cost_cents, request_count, tokens_input, tokens_output }]

GET    /billing/breakdown                 — Cost breakdown by model, provider, or run type
       Query params: period (7d | 30d | 90d | custom), start_date, end_date, group_by

GET    /billing/projects                  — Cost per project summary
       Query params: period
       Response: list[{ project_id, project_name, disease, discovery_runs, synthesis_runs, total_cost_cents, avg_cost_per_run }]

GET    /billing/usage                     — Detailed usage events (paginated)
       Query params: project_id, model, provider, start_date, end_date, success, page, page_size
       Response: { items: list[UsageEvent], total: int, page: int, page_size: int }

POST   /billing/usage/export              — Export usage events to CSV
       Query params: same as GET /billing/usage
       Response: CSV file download

GET    /billing/budgets                   — List all budget configs
POST   /billing/budgets                   — Create budget: { scope, project_id, monthly_budget_cents, alert_threshold_pct, hard_limit }
PUT    /billing/budgets/{id}              — Update budget config
DELETE /billing/budgets/{id}              — Delete budget config

GET    /billing/notifications             — List budget notifications for current user (paginated)
POST   /billing/notifications/{id}/read   — Mark notification as read
```

## 21.7 — Backend: Cost Tracking Integration

Every LLM call, embedding call, and data source API call in the pipeline must log a `usage_event`. Implement as a decorator or middleware:

```python
class CostTracker:
    """Wraps every external API call to log cost and usage."""

    async def track(
        self,
        project_id: str | None,
        run_id: str | None,
        run_type: str,
        model: str,
        provider: str,
        stage: str | None,
        tokens_input: int,
        tokens_output: int,
        latency_ms: int,
        success: bool,
        error_type: str | None = None
    ) -> None:
        """
        1. Compute cost_cents from model pricing table (see 21.8)
        2. INSERT into usage_events
        3. Call BudgetService.record_cost()
        """

# Usage in pipeline:
# After every LLM call:
#   await cost_tracker.track(
#       project_id=run.project_id,
#       run_id=run.id,
#       run_type="discovery",
#       model="claude-opus-4-6",
#       provider="anthropic_bedrock",
#       stage="SEED",
#       tokens_input=response.usage.input_tokens,
#       tokens_output=response.usage.output_tokens,
#       latency_ms=response_time_ms,
#       success=True
#   )
```

## 21.8 — Model Pricing Table

Store as a config file, updated manually when providers change pricing:

```json
// config/model_pricing.json
{
  "claude-opus-4-6": {
    "provider": "anthropic_bedrock",
    "input_cost_per_1m_tokens_cents": 1500,
    "output_cost_per_1m_tokens_cents": 7500
  },
  "claude-sonnet-4-6": {
    "provider": "anthropic_bedrock",
    "input_cost_per_1m_tokens_cents": 300,
    "output_cost_per_1m_tokens_cents": 1500
  },
  "gpt-4.1": {
    "provider": "azure_openai",
    "input_cost_per_1m_tokens_cents": 200,
    "output_cost_per_1m_tokens_cents": 800
  },
  "o3-mini": {
    "provider": "azure_openai",
    "input_cost_per_1m_tokens_cents": 110,
    "output_cost_per_1m_tokens_cents": 440
  },
  "cohere-command-a": {
    "provider": "cohere",
    "input_cost_per_1m_tokens_cents": 250,
    "output_cost_per_1m_tokens_cents": 1000
  },
  "cohere-embed-v3": {
    "provider": "cohere",
    "input_cost_per_1m_tokens_cents": 10,
    "output_cost_per_1m_tokens_cents": 0
  },
  "text-embedding-3-large": {
    "provider": "openai",
    "input_cost_per_1m_tokens_cents": 13,
    "output_cost_per_1m_tokens_cents": 0
  },
  "grok-4-1-fast": {
    "provider": "azure_ai_foundry",
    "input_cost_per_1m_tokens_cents": 300,
    "output_cost_per_1m_tokens_cents": 1000
  }
}
```

**Note:** These prices are approximate as of knowledge cutoff. The CostTracker reads from this file at startup. If a model is not found in the pricing table, log a warning and estimate cost as 0 (do not block the pipeline).

## 21.9 — Scheduled Tasks for Billing

```python
BILLING_SCHEDULED_TASKS = {
    "daily_summary_aggregation": {
        "schedule": "daily at 01:00 UTC",
        "action": """
            INSERT INTO usage_daily_summary (date, project_id, model, provider, total_requests, total_tokens_input, total_tokens_output, total_cost_cents, total_errors, avg_latency_ms)
            SELECT
                DATE(created_at), project_id, model, provider,
                COUNT(*), SUM(tokens_input), SUM(tokens_output), SUM(cost_cents),
                COUNT(*) FILTER (WHERE success = FALSE),
                AVG(latency_ms)
            FROM usage_events
            WHERE created_at >= NOW() - INTERVAL '2 days'
            GROUP BY DATE(created_at), project_id, model, provider
            ON CONFLICT (date, project_id, model, provider) DO UPDATE SET
                total_requests = EXCLUDED.total_requests,
                total_tokens_input = EXCLUDED.total_tokens_input,
                total_tokens_output = EXCLUDED.total_tokens_output,
                total_cost_cents = EXCLUDED.total_cost_cents,
                total_errors = EXCLUDED.total_errors,
                avg_latency_ms = EXCLUDED.avg_latency_ms;
        """,
        "purpose": "Pre-aggregate usage for fast dashboard queries"
    },
    "monthly_budget_reset": {
        "schedule": "1st of each month at 00:00 UTC",
        "action": "UPDATE budget_configs SET current_month_spend_cents = 0, updated_at = NOW()",
        "purpose": "Reset monthly spend counters"
    }
}
```

Add to **Migration 007**: `billing_and_usage`

---

# 22. IMPLEMENTATION PRIORITY ORDER <a name="22-priority-order"></a>

```
PHASE 0 — PREREQUISITES (do first, blocks everything):
  0a. Remove Chinese models from codebase
  0b. Configure new model providers (Bedrock, Azure OpenAI, Azure AI Foundry, Cohere)
  0c. Database migrations 003 + 004
  0d. Wire existing discovery modes to real backend (kill mock data)

PHASE 1 — CORE PIPELINE (the engine):
  1a. 11-stage discovery pipeline with new model assignments
  1b. 3-layer grounding system (pgvector + citation verification + cross-source)
  1c. Auto-citation system (CitationService)
  1d. Constitutional constraints (prepend to all prompts)
  1e. WebSocket streaming
  1f. Phase 1 data source integrations (21 sources)

PHASE 2 — JAMISON'S FEATURES:
  2a. Lab Capability Filter (lab_profile JSONB, prompt injection, feasibility scoring)
  2b. Backward/Synthesis Pipeline (5-stage, grant-aware formatting)
  2c. Output Format & Verbosity Control
  2d. Visual Summary Layer (Recharts charts from visualization_data)

PHASE 3 — FRONTEND (core pages):
  3a. ProjectsList page
  3b. ProjectWorkspace page (6 tabs)
  3c. DiscoveryRunner page (live pipeline viewer)
  3d. HypothesisReview page
  3e. ProjectKnowledgeGraph page (Cytoscape.js)
  3f. PipelineIntelligence page

PHASE 4 — SUPPORTING FEATURES:
  4a. Imaging Ingestion Service
  4b. Export system (docx, pdf, latex, markdown)
  4c. Hypothesis feedback system
  4d. Methods taxonomy API

PHASE 5 — BILLING & COST MANAGEMENT:
  5a. Usage events tracking (CostTracker integration into all pipeline calls)
  5b. Model pricing config + cost computation
  5c. Budget & alert system (BudgetService, BudgetAlertService)
  5d. Billing dashboard frontend (/billing)
  5e. Notifications system (in-app budget alerts)
  5f. Daily summary aggregation + monthly budget reset scheduled tasks
  5g. Database migration 007 (billing_and_usage)

PHASE 6 — pgvector MANAGEMENT:
  6a. Cache stats API endpoints
  6b. Semantic search + similarity testing endpoints
  6c. Maintenance endpoints (TTL cleanup, reindex, purge, vacuum)
  6d. Scheduled maintenance tasks (Celery beat or BackgroundTasks)
  6e. pgvector manager frontend (/dev/pgvector — 4 tabs)
  6f. cache_stats_snapshots + maintenance_log tables (migration 006)

PHASE 7 — EXTENDED DATA SOURCES:
  7a. Phase 2 data source clients (10 clinical & regulatory sources)
  7b. Phase 3 data source clients (15 genomics & biological sources)
  7c. Phase 4 data source clients (14 literature & specialized sources)
  7d. Data source registry + health monitoring
  7e. Data source health UI (integrated into PipelineIntelligence page)
  7f. Import scripts for download-based sources (SIDER, Orange Book, TTD)
  7g. Database migration 005 (data_source_registry)

PHASE 8 — TESTING & POLISH:
  8a. Unit tests
  8b. Integration tests
  8c. Frontend tests
  8d. E2E tests (optional)
```

---

# WHAT IS NOT IN SCOPE (explicitly deferred)

- Multi-tenancy infrastructure
- Authentication frontend (login/signup UI)
- Mobile responsive design
- Internationalization

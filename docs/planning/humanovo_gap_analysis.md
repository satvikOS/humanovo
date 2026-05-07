# HUMANOVO — TOTAL GAP ANALYSIS & ENGINE SPECIFICATION

**Document Classification:** Internal — Engineering & Strategy
**Date:** April 14, 2026
**Scope:** Full codebase audit + competitive teardown against every direct and indirect competitor
**Methodology:** Line-by-line codebase inspection of humanovo-humanovo.zip (110k Python LOC, 134k TypeScript LOC) cross-referenced against published architectures, papers, and product documentation of all identified competitors.

---

# PART 1 — THE TRUTH ABOUT HUMANOVO'S CURRENT STATE

## 1.1 — What Actually Exists vs. What Is Claimed

### Codebase Reality

| Metric | Number | Assessment |
|--------|--------|------------|
| Python backend LOC | 110,507 | Large scaffold, low functional density |
| TypeScript frontend LOC | 134,333 | 33 pages, most rendering static/local data |
| Backend test LOC | 2,145 | 1.9% coverage ratio — functionally untested |
| E2E test files | 1 (84 lines) | Zero meaningful integration testing |
| API endpoint files | 36 | Massive surface area for a solo developer |
| Frontend pages | 33 + compute subpages | Feature bloat — none fully wired to live backend |
| Frontend static data | 3.2 MB (19 TypeScript files) | Entire knowledge base hardcoded in client |
| Discovery orchestrator | 3,402 lines, single file | Architecturally impressive, operationally unproven |

### The Mock Data Problem

the v2 platform spec (line 1 of Section 1) literally states:

> "The Workbench page currently runs on hardcoded mock data. Nothing else works until this is fixed."

The `frontend/src/data/` directory contains 19 MasterHumanLibrary files (3.2 MB) of statically typed biological entities baked into the client bundle. This data should be served from Neo4j/pgvector via the backend API. Instead, the frontend renders a knowledge graph explorer, anatomy browser, evidence repository, and compute workstation entirely from local TypeScript objects. No user has ever queried the backend and received a real hypothesis.

### Dependency Mismatch

The `requirements.txt` declares these dependencies:
- `openai==1.12.0` (January 2024 — 15 months stale)
- `langchain==0.1.20` (early 2024 — two major versions behind)
- `langgraph==0.0.38` (pre-stable, API has changed significantly)

The discovery orchestrator (v2) references:
- AWS Bedrock Claude Opus 4.6 / Sonnet 4.6 via `boto3`
- Azure OpenAI (GPT-4.1, GPT-4o, o3-mini, Cohere Command A) via `AsyncAzureOpenAI`
- Azure AI Foundry (Mistral-Large-3, Grok-4-1-fast) via `AsyncOpenAI`

Missing from requirements.txt: No `azure-ai-inference` SDK. No `anthropic` SDK (not needed for Bedrock, but referenced in config comments). The `openai` SDK at 1.12.0 does not support `AsyncAzureOpenAI` with the parameter signatures used in the orchestrator. The orchestrator code literally cannot execute against the declared dependencies.

### The README Problem

The README.md still says "GenUp" in the title, references ChromaDB (replaced by pgvector), and describes a phased development timeline (Months 2-18) that has no relation to the actual project state. This is the first file any evaluator, investor, or contributor reads.

---

## 1.2 — What the 12-Stage Pipeline Actually Is

The discovery orchestrator is the most valuable piece of intellectual property in the codebase. It describes a genuinely novel approach: 12 specialized LLM stages with dual-embedding grounding between every stage. But it has critical gaps:

### What Works (On Paper)

- Stage sequencing logic with typed enums (SEED → EXPAND → EVIDENCE → COUNTER → REVISE → MECHANISM → VALIDATE → GROUND → SCORE → REFINE → TRANSLATE → FINALIZE)
- TokenPool with per-model rate limiting and backoff
- LearningMemory for exploration deduplication
- ParallelMCP for context sharding across model context windows
- MultiModelLLM abstraction with lazy initialization of 8+ model clients
- Cost tracking per API call with model-specific pricing
- Constitutional prompt prepending across all stages

### What Does Not Work

- No integration tests proving the 12-stage pipeline completes end-to-end
- No benchmark dataset or retrospective validation suite
- The "94% citation accuracy" claim has no reproducible measurement methodology documented anywhere in the codebase
- Dual-embedding grounding (Cohere Embed v3 1024d + Azure text-embedding-3-large 1536d) is defined in the docstring but the actual grounding gate logic — the part that blocks ungrounded claims from propagating — needs verification against real biomedical assertions
- Round 3-4 "hybrid refinement" logic (refining best hypotheses from Rounds 1-2) lacks a concrete selection/ranking mechanism documented in the code
- No retry/recovery for partial pipeline failures mid-hypothesis

---

# PART 2 — COMPETITOR TEARDOWN

## 2.1 — Biomni / Phylo (Stanford SNAP Lab → Commercial Spinout)

**Status:** Production. 7,000+ labs. $13.5M seed (a16z + Menlo/Anthropic). Ginkgo Bioworks validated.
**Architecture:** Biomni-E1 (environment: 150 tools, 105 software packages, 59 databases) + Biomni-A1 (agent: LLM reasoning + retrieval-augmented planning + code-based execution)
**Open Source:** Apache 2.0 on GitHub (snap-stanford/Biomni)

### What Biomni Has That humanovo Does Not

1. **Code execution engine.** Biomni generates and runs Python code against real datasets autonomously. It processed 336,000 single-nucleus RNA-seq and ATAC-seq profiles. humanovo has compute modules (genomics, biomechanics, pharmacokinetics, imaging, clinical, signals) that are architecturally present but have never processed real-world data at scale.

2. **Action discovery agent.** Biomni-E1 was built by mining 10,000+ bioRxiv publications across 25 subfields to automatically discover what tools, databases, and protocols researchers actually use. humanovo's 60+ API integrations were manually selected. Biomni's approach is self-expanding; humanovo's is static.

3. **Wet-lab protocol generation.** Biomni generates experimentally testable protocols with specific reagent lists, concentrations, and procedural steps. humanovo's TRANSLATE stage (Stage 11) generates a translational roadmap (T0-T5) but does not output actionable lab protocols.

4. **Published benchmarks.** LAB-Bench (74.4% DbQA, 81.9% SeqQA, surpassing human experts), HLE (outperforming baseline LLMs by 400%, coding agents by 43%), plus 8 real-world unseen biomedical scenarios. humanovo has zero published benchmarks.

5. **Multimodal data processing.** Biomni handles text, structured data, genomic sequences, imaging data, and wearable sensor data in unified workflows. humanovo's imaging module (`app/compute/imaging/`) exists but has not been validated against real DICOM/NIfTI datasets in production.

6. **Community-driven knowledge base.** Biomni-E2 is being built with community contributions (tools, datasets, benchmarks, know-how). humanovo's knowledge base is a closed, manually curated set of 5,123+ entities in 13 workbooks.

### Where humanovo Is Architecturally Superior to Biomni

1. **Adversarial multi-model pipeline.** Biomni uses a single LLM with retrieval-augmented planning. humanovo's pipeline explicitly assigns different models to adversarial roles (Mistral for counter-arguments, then o3-mini for revision). This is a genuine architectural innovation that Biomni lacks.

2. **Dual-embedding grounding.** Running two embedding models in parallel (biomedical-optimized Cohere 1024d + general Azure 1536d) between every stage creates a grounding mesh that single-model systems cannot replicate.

3. **Citation provenance chain.** humanovo's scoring module (`citation_analyzer.py`, `claim_classifier.py`, `confidence_scorer.py`, `source_quality.py`, `provenance_tracker.py`) is deeper than Biomni's approach. Every claim traces back to specific evidence with confidence scores.

4. **Security architecture.** Biomni's GitHub warns: "Currently, Biomni executes LLM-generated code with full system privileges." humanovo's API-based architecture (no arbitrary code execution) is inherently more secure for enterprise/clinical environments.

### What humanovo Must Build to Compete with Biomni

| Capability | Priority | Effort |
|-----------|----------|--------|
| End-to-end pipeline execution on real biomedical queries | CRITICAL | 2-4 weeks |
| Retrospective validation benchmark (10+ published hypotheses) | CRITICAL | 2-3 weeks |
| Code execution sandbox (safe, containerized compute) | HIGH | 3-4 weeks |
| Protocol generation engine (reagents, concentrations, steps) | HIGH | 2-3 weeks |
| Real dataset processing proof (≥1 omics dataset) | CRITICAL | 1-2 weeks |
| Published benchmark results (preprint) | CRITICAL | 4-6 weeks |
| Community contribution pipeline | MEDIUM | 2-3 weeks |
| Multimodal data ingestion (imaging + genomics + text) | HIGH | 4-6 weeks |

---

## 2.2 — Google AI Co-Scientist (Google Research + DeepMind + Cloud AI)

**Status:** Trusted Tester Program. Lab-validated drug repurposing (liver fibrosis, AML). Bacterial DNA transfer mechanism confirmed by Imperial College after 10+ years of research.
**Architecture:** Multi-agent system on Gemini 2.0 with specialized agents: Generation, Reflection, Ranking, Evolution, Proximity, Meta-review. Iterative hypothesis refinement via automated feedback loops.
**Access:** Invite-only Trusted Tester Program.

### What Google Has That humanovo Cannot Replicate

1. **Gemini 2.0 native integration.** The entire system is built on Google's frontier model with full access to internal capabilities, fine-tuning, and optimization that third-party API consumers cannot access.

2. **Wet-lab validation loop.** Google's system generated drug repurposing candidates for AML that were subsequently validated through in vitro experiments at Stanford — confirmed tumor viability inhibition at clinically relevant concentrations in multiple AML cell lines. This is the gold standard: AI hypothesis → lab experiment → confirmed result.

3. **Institutional partnerships.** Fleming Initiative (Imperial College London + NHS Trust), Stanford Medicine, Houston Methodist. These are not advisory relationships — they are active experimental validation partnerships.

4. **Scale of scientific literature access.** Google's system accesses web search, research papers, knowledge graphs, databases, specialized AI feedback systems, and private documents. The breadth of Google's crawl index gives them access to gray literature, preprints, and institutional repositories that API-based approaches miss.

### Where humanovo Has Theoretical Advantages Over Google

1. **Model diversity.** Google is locked into Gemini. humanovo's multi-model approach (Claude, GPT-4.1, Mistral, Cohere, Grok) can exploit the strengths of different architectures for different reasoning tasks. This is a genuine advantage IF the pipeline actually runs.

2. **Transparency.** Google's system is a black box for external users. humanovo can offer full provenance tracking, stage-by-stage reasoning visibility, and confidence decomposition that enterprise customers need for regulatory compliance.

3. **Specialization.** Google is building a general scientific assistant. humanovo can go deep in specific therapeutic areas with domain-specific grounding that a horizontal platform won't match.

### What humanovo Must Build to Position Against Google

| Capability | Priority | Effort |
|-----------|----------|--------|
| At least ONE wet-lab validated hypothesis | CRITICAL | 3-6 months (requires URMC partnership) |
| Stage-by-stage reasoning transparency UI | HIGH | 2-3 weeks |
| Exportable audit trail for regulatory review | HIGH | 1-2 weeks |
| Domain-specific fine-tuning on therapeutic area | MEDIUM | 4-8 weeks |

---

## 2.3 — OpenAI for Science / Prism (OpenAI)

**Status:** Production. Free. GPT-5.2 powered. Prism launched January 2026. Novo Nordisk strategic partnership announced April 14, 2026.
**Architecture:** GPT-5.2 integrated into LaTeX-native scientific writing workspace. Codex for automated research tasks. Building toward "AI research intern" by September 2026 and fully automated multi-agent research system by 2028.
**Access:** Free (Prism), paid tiers for advanced features.

### What OpenAI Has That humanovo Cannot Match

1. **GPT-5.2 reasoning capability.** GPT-5.2 has derived new results in theoretical physics, lowered the cost of cell-free protein synthesis, and solved previously unsolved math problems. No multi-model pipeline built on API access to GPT-4.1 or GPT-4o matches the raw reasoning power of GPT-5.2/5.4.

2. **Novo Nordisk partnership.** As of today (April 14, 2026), Novo Nordisk announced full enterprise integration of OpenAI across drug discovery, manufacturing, supply chain, and commercial operations with pilot programs launching immediately. This is Big Pharma adoption at the highest level.

3. **1.3 million weekly scientific users.** 8.4 million ChatGPT messages per week on advanced hard-science topics. This is network effects that no startup can compete with on volume.

4. **Prism as workflow integration.** Scientists don't want another tool — they want AI embedded in their existing workflow. Prism integrates with LaTeX (the academic standard), handles citations, equations, diagrams, and collaboration in one place.

5. **Automated research roadmap.** OpenAI is building an "autonomous AI research intern" for September 2026 and a fully automated multi-agent research system for 2028. They have the capital, talent, and model capability to execute.

### Where humanovo Differentiates From OpenAI

1. **Biomedical specialization.** OpenAI is horizontal across all sciences. humanovo's 60+ biomedical API integrations (PubMed, ClinicalTrials.gov, UniProt, Reactome, KEGG, Ensembl, HMDB, ClinVar, STRING, PDB, AlphaFold, etc.) provide domain-specific grounding that a general-purpose model cannot match without external tooling.

2. **Adversarial hypothesis testing.** OpenAI's approach is generative — GPT-5.2 generates hypotheses. humanovo's approach is adversarial — one model generates, another attacks, a third revises. This architecturally reduces hallucination risk in a way that single-model systems cannot.

3. **Enterprise compliance.** OpenAI's terms of service and data handling may not meet the requirements of HIPAA-covered entities or pharma regulatory environments. humanovo deployed on institutional infrastructure with full audit trails can.

### What humanovo Must Build to Survive in OpenAI's Shadow

| Capability | Priority | Effort |
|-----------|----------|--------|
| Live demo that a researcher can use TODAY | CRITICAL | 2-4 weeks |
| HIPAA compliance documentation | HIGH | 2-3 weeks |
| SOC 2 readiness assessment | HIGH | 4-6 weeks |
| Integration with researcher workflows (not standalone app) | MEDIUM | 4-8 weeks |
| Published comparison: humanovo pipeline vs. raw GPT-5 on same biomedical questions | CRITICAL | 2-3 weeks |

---

## 2.4 — Synthetic Sciences (YC-Backed)

**Status:** Early stage. YC W25 or S25. 2 employees.
**Architecture:** "Claude Code for Scientific Research." Agent-based workspace connecting to GitHub, Hugging Face, W&B. Wet-lab and computational biology specialist agent. Fine-tuning on Tinker GPUs. Manuscript drafting with verified citations and LaTeX.
**Positioning:** Research execution platform (hypothesis → experiment → publication).

### Assessment

Synthetic Sciences is closest to humanovo in stage and ambition. Founders have strong credentials (IOAI, USACO Platinum, NeurIPS/ICML/ICLR/AAAI/CVPR publications, acquired startup at 17). However, they are a 2-person team with YC backing and limited published evidence of biomedical domain depth.

### What humanovo Has Over Synthetic Sciences

1. Domain-specific architecture (12-stage pipeline vs. generic agent framework)
2. 60+ biomedical API integrations vs. generic tool connectors
3. URMC clinical advisory network
4. Biotech domain expertise (B.Tech Biotechnology, Glenmark research experience)

### What Synthetic Sciences Has Over humanovo

1. YC brand and network
2. Published ML research credentials (NeurIPS, ICML, etc.)
3. GPU access for fine-tuning
4. Cleaner product scope (research execution, not trying to be everything)

---

## 2.5 — BenevolentAI (London, Public Company)

**Status:** Public (SPAC 2022). Pivoted to TechBio 2024. AstraZeneca and Merck partnerships.
**Architecture:** Knowledge graph integrating scientific literature, biomedical databases, omics data, and clinical information. NLP + graph ML for proposing novel target-disease-compound links.
**Key Achievement:** Baricitinib repurposed for COVID-19 treatment.

### What humanovo Can Learn From BenevolentAI's Failures

BenevolentAI demonstrates that AI-driven knowledge mining can yield real results (baricitinib saved lives), but also that correctly identifying a target is insufficient — optimal pharmacological intervention matters. Their BEN-2293 (TrkA inhibitor for atopic dermatitis) showed the gap between AI prediction and clinical reality. Key lessons:

1. AI predictions are only as good as the evidence base; biases in biomedical literature mislead models
2. Even a correctly identified target may require different delivery mechanisms than AI predicts
3. Financial sustainability requires ongoing partnership revenue, not just pipeline progression
4. Quality of input data is the critical success factor, not model sophistication

---

## 2.6 — Insilico Medicine

**Status:** Phase IIa completed (ISM001-055 for IPF). First fully AI-designed drug with statistically significant efficacy.
**Architecture:** End-to-end AI drug design platform covering target identification, molecule generation, and clinical prediction.
**Key Metric:** 18 months from conception to Phase IIa for ~$6M total computational cost vs. traditional $100-200M over 6-8 years.

### Relevance to humanovo

Insilico operates at a different layer (molecular design, not hypothesis generation). However, their success validates the thesis that AI can compress biomedical discovery timelines. humanovo should position as the upstream hypothesis engine that feeds platforms like Insilico's downstream molecular design. This is a partnership opportunity, not a competitive threat.

---

## 2.7 — Recursion Pharmaceuticals (Merged with Exscientia)

**Status:** Post-merger. Phenomics-first AI platform. 10+ clinical readouts expected 2025-2026.
**Architecture:** High-content imaging + automated precision chemistry. Millions of experiments weekly.
**Investment:** $1B+ in milestone-based collaborations.

### Relevance to humanovo

Recursion/Exscientia is a wet-lab automation platform, not a hypothesis generation engine. humanovo's output (validated hypotheses with translational roadmaps) could be input to Recursion's experimental pipeline. Again, partnership positioning.

---

## 2.8 — Eli Lilly TuneLab

**Status:** Launched September 2025. $1B+ investment in underlying AI infrastructure.
**Architecture:** Drug discovery-as-a-service using Lilly's proprietary AI models on external partners' targets.

### Relevance to humanovo

TuneLab demonstrates that Big Pharma is building internal AI platforms and opening them to external partners. humanovo must either integrate with these platforms or risk being squeezed from above (Big Pharma) and below (open-source like Biomni).

---

# PART 3 — WHAT MUST BE REMOVED

## 3.1 — Kill List (Remove Immediately)

### Frontend Static Data (3.2 MB)
Delete all 19 MasterHumanLibrary*.ts files and the anatomy/evidence subdirectories from `frontend/src/data/`. This data must be served from the backend via API. Having 3.2 MB of biological entities compiled into the JavaScript bundle is architecturally wrong, performance-killing, and creates a false impression that the knowledge graph works.

### Feature Pages That Don't Work
Reduce from 33+ pages to a focused core. Remove or stub these until the pipeline works end-to-end:

- `BiobankManager.tsx` — No biobank integration exists
- `ExperimentTracker.tsx` — No experiment tracking backend
- `MLModelManager.tsx` — No ML model registry is operational
- `ManuscriptManager.tsx` — No manuscript generation pipeline is complete
- `RegulatoryCompliance.tsx` — No regulatory compliance engine exists
- `ResearchImaging.tsx` — No imaging pipeline processes real data
- `ClinicalTrials.tsx` — No clinical trial management backend
- `Collaboration.tsx` — No real-time collaboration engine
- `PgvectorManager.tsx` — Developer tool, not user-facing

### Stale Dependencies
Replace in requirements.txt:
- `langchain==0.1.20` → Latest stable (or remove if LangGraph orchestration replaces it)
- `langgraph==0.0.38` → Latest stable
- `openai==1.12.0` → `openai>=1.50.0` (for AsyncAzureOpenAI support)
- Add `azure-ai-inference` if using Azure AI Foundry models
- Add `anthropic` SDK if using Anthropic directly (not needed if Bedrock-only)

### Dead References
- Rename README.md from "GenUp" to "humanovo"
- Remove all Chinese model references per the v2 platform spec (DeepSeek-R1, Kimi-K2)
- Remove ChromaDB references (replaced by pgvector)

---

## 3.2 — Scope Reduction: The Focused Product

humanovo is trying to be: hypothesis generator + knowledge graph explorer + anatomy browser + compute workstation + clinical trial manager + biobank manager + manuscript generator + experiment tracker + ML model manager + regulatory compliance tracker + collaboration platform + imaging processor + citation manager + literature reviewer.

No solo developer can build, maintain, test, and operate all of this. The result is that nothing works fully.

### What humanovo MUST be (Core):
1. **Discovery Pipeline** — The 12-stage adversarial hypothesis engine (Agents page)
2. **Evidence Explorer** — Search and browse grounded evidence (Search + Evidence pages)
3. **Project Workspace** — Organize discoveries by research project (Projects + ProjectDetail)
4. **Hypothesis Dashboard** — View, score, compare hypotheses (Dashboard + HypothesisDetail)
5. **Knowledge Graph** — Visualize entity relationships from live Neo4j (KnowledgeGraph)
6. **Notebook** — Research notes attached to projects (Notebook)

### What humanovo SHOULD NOT be (Cut or Defer):
Everything else. Build these after the core works end-to-end with real data.

---

# PART 4 — WHAT MUST BE ADDED (FULL ENGINE CAPABILITIES)

## 4.1 — CRITICAL: Make the Pipeline Run (Week 1-2)

### Dependency Resolution
```
# requirements.txt — corrected
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
openai>=1.50.0
boto3>=1.34.0
httpx>=0.27.0
pydantic>=2.7.0
pydantic-settings>=2.3.0
sqlalchemy>=2.0.30
asyncpg>=0.29.0
alembic>=1.13.0
pgvector>=0.3.6
neo4j>=5.20.0
langchain>=0.2.0
langchain-openai>=0.1.0
langgraph>=0.2.0
sentence-transformers>=3.0.0
```

### Pipeline Integration Test
Create `tests/integration/test_pipeline_e2e.py` that:
1. Accepts a research question as input (e.g., "What novel mechanisms link gut microbiome dysbiosis to Parkinson's disease progression?")
2. Runs all 12 stages sequentially
3. Verifies each stage produces non-empty, parseable output
4. Verifies dual-embedding grounding runs between each stage
5. Verifies at least 3 API sources are queried in EVIDENCE and GROUND stages
6. Produces a final hypothesis with: title, description, confidence score, citation list, translational roadmap
7. Total execution time logged
8. Total API cost logged

This test is the ONLY thing that matters right now. Everything else is secondary.

### Environment Configuration
Create `.env.example` with all required keys documented:
```
# AWS Bedrock (Claude Opus 4.6, Claude Sonnet 4.6, Cohere Embed v3)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1

# Azure OpenAI (GPT-4.1, GPT-4o, o3-mini, Cohere Command A)
AZURE_GPT4O_ENDPOINT=
AZURE_GPT4O_KEY=
AZURE_GPT41_ENDPOINT=
AZURE_GPT41_KEY=
AZURE_O3MINI_ENDPOINT=
AZURE_O3MINI_KEY=
AZURE_COHERE_ENDPOINT=
AZURE_COHERE_KEY=

# Azure AI Foundry (Mistral-Large-3, Grok-4-1-fast)
AZURE_MISTRAL_ENDPOINT=
AZURE_MISTRAL_KEY=
AZURE_GROK_ENDPOINT=
AZURE_GROK_KEY=

# Azure Embeddings
AZURE_EMBEDDING_ENDPOINT=
AZURE_EMBEDDING_KEY=

# Biomedical APIs
NCBI_API_KEY=
ELSEVIER_API_KEY=
SPRINGER_API_KEY=
BRAVE_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://humanovo:humanovo@localhost:5432/humanovo
NEO4J_URI=bolt://localhost:7687
NEO4J_PASSWORD=
REDIS_URL=redis://localhost:6379/0
```

---

## 4.2 — CRITICAL: Retrospective Validation Benchmark (Week 2-4)

### Benchmark Design

Select 10 biomedical hypotheses that were published between 2020-2024 and subsequently validated experimentally. Run each through the humanovo pipeline. Measure:

1. **Hypothesis Recovery Rate:** Did the pipeline independently generate a hypothesis consistent with the published one?
2. **Citation Overlap:** What percentage of the pipeline's cited papers overlap with the actual paper's references?
3. **Counter-Argument Quality:** Did the COUNTER stage identify real limitations that the original authors also identified?
4. **Novelty Detection:** Did the pipeline identify any connections the original authors missed?
5. **Translational Accuracy:** Does the TRANSLATE stage's T0-T5 roadmap align with the actual experimental path taken?

### Benchmark Hypotheses (Suggested)

| # | Hypothesis Domain | Source Paper | Validation Status |
|---|------------------|--------------|-------------------|
| 1 | Gut-brain axis in Parkinson's | Kim et al. 2019, Cell | α-synuclein spread from gut to brain confirmed |
| 2 | Baricitinib for COVID-19 | BenevolentAI → Richardson et al. 2020, Lancet | FDA EUA granted |
| 3 | GLP-1 agonists in Alzheimer's | Multiple 2023-2024 | Phase 3 trials ongoing |
| 4 | CAR-T for solid tumors via TME remodeling | Multiple 2022-2024 | Clinical trials active |
| 5 | Senolytic drugs for age-related disease | Kirkland et al. 2017 → clinical 2023 | Phase 2 results published |
| 6 | CRISPR base editing for sickle cell | Frangoul et al. 2021 | Casgevy FDA approved 2023 |
| 7 | Microbiome modulation in immunotherapy response | Routy et al. 2018, Science | FMT trials validated |
| 8 | Tau propagation in AD via extracellular vesicles | Multiple 2020-2023 | Mechanistic validation |
| 9 | Ferroptosis in cancer treatment | Dixon et al. 2012 → clinical 2023-2024 | Drug candidates in trials |
| 10 | Liquid biopsy ctDNA for minimal residual disease | Tie et al. 2022, NEJM | Standard of care emerging |

### Output Format

For each hypothesis, produce a report card:
```json
{
  "hypothesis_id": "BM-001",
  "domain": "Gut-brain axis in Parkinson's",
  "pipeline_hypothesis": "...",
  "published_hypothesis": "...",
  "recovery_rate": 0.85,
  "citation_overlap": 0.72,
  "counter_argument_quality": "HIGH|MEDIUM|LOW",
  "novel_connections_found": 3,
  "translational_accuracy": 0.68,
  "total_pipeline_time_seconds": 342,
  "total_api_cost_usd": 12.47,
  "stages_completed": 12,
  "grounding_gate_rejections": 4
}
```

This benchmark is the SINGLE MOST IMPORTANT deliverable for humanovo's credibility. Without it, every pitch is "trust me, the architecture works." With it, every pitch is "here are the numbers."

---

## 4.3 — HIGH: Project Management Module (The Second Product)

humanovo claims two modules: AI-native research AND AI-native project management. The project management module does not exist in any functional form. Here is what a real AI-native research project management engine requires:

### Research Project Lifecycle Engine

```
PROJECT STATES:
  IDEATION → LITERATURE_REVIEW → HYPOTHESIS_GENERATION → EXPERIMENTAL_DESIGN →
  DATA_COLLECTION → ANALYSIS → MANUSCRIPT_DRAFT → PEER_REVIEW → REVISION → PUBLICATION

TRANSITIONS:
  Each transition requires:
  - Completion criteria (what must be true to move forward)
  - AI assessment (does the current state satisfy criteria?)
  - Human approval (PI sign-off)
  - Artifact generation (what outputs does this state produce?)
```

### Task Decomposition Agent

An AI agent that takes a research objective and decomposes it into:
1. Literature review tasks (with specific search queries)
2. Data requirements (what datasets are needed, where to get them)
3. Computational tasks (what analyses to run)
4. Experimental tasks (what wet-lab work is needed)
5. Writing tasks (sections of manuscript to draft)
6. Timeline estimation (based on task dependencies and resource availability)

### Resource Tracking

- PI time allocation across projects
- Compute budget (API costs, GPU hours)
- Lab supply costs
- Student/postdoc assignments
- Equipment scheduling

### Milestone & Deliverable Tracking

- Grant milestone alignment (NIH R01 milestones, NSF deliverables)
- Publication pipeline (submission → review → revision → acceptance)
- Patent filing deadlines
- Conference abstract deadlines
- Progress reports for funding agencies

### Integration Points

- humanovo Discovery Pipeline outputs → auto-create tasks from hypothesis results
- Calendar integration (experiment schedules, meeting reminders)
- Document management (protocols, SOPs, lab notebooks linked to projects)
- Notification engine (deadline alerts, stalled project warnings, PI review requests)

### What This Is NOT

This is NOT Jira/Asana/Monday.com with a "science" skin. This is a project management system where:
- The AI understands research methodology and can suggest next steps
- Task dependencies are informed by scientific logic (you can't run Western blot before protein extraction)
- Timeline estimates account for biological constraints (cell culture takes 3 weeks, animal studies take 3 months)
- Progress metrics are scientific (number of validated hypotheses, statistical power achieved) not just ticket velocity

---

## 4.4 — HIGH: Real Data Ingestion (Week 3-5)

### Kill the Static Knowledge Base

Replace `frontend/src/data/MasterHumanLibrary*.ts` with live API calls:

```
GET /api/v1/knowledge/entities?category=proteins_enzymes&limit=50
GET /api/v1/knowledge/entities/{id}/relationships
GET /api/v1/knowledge/search?q=KRAS&types=gene,protein,pathway
```

### Backend Knowledge Population

The existing `neo4j_population_service.py` (60K lines) and `bulk_loader.py` (27K lines) and `evidence-loader/` scripts need to actually run and populate:

1. Neo4j with entity-relationship graph from curated biological databases
2. pgvector with embeddings of all ingested evidence
3. PostgreSQL with metadata, provenance, and versioning

### Automated Ingestion Pipeline

Build a scheduled pipeline that:
1. Queries PubMed for new publications daily (by keyword sets relevant to active projects)
2. Extracts entities using the NLP pipeline (spaCy + scispaCy + custom transformer NER)
3. Resolves entities against canonical IDs (entity_resolution module)
4. Updates Neo4j graph with new relationships
5. Embeds new evidence into pgvector
6. Flags new evidence that contradicts or supports existing hypotheses

### Data Source Priority (What to Wire First)

| Priority | Source | Why | Effort |
|----------|--------|-----|--------|
| 1 | PubMed/NCBI E-utilities | Core literature. Free API. Well-documented. | 1 week |
| 2 | ClinicalTrials.gov | Translational validation. Free API. | 3 days |
| 3 | UniProt | Protein data. Free API. | 3 days |
| 4 | Reactome | Pathway data. Free API. | 3 days |
| 5 | KEGG | Pathway + disease + drug. Rate-limited. | 1 week |
| 6 | ClinVar | Genetic variant-disease associations. Free. | 3 days |
| 7 | STRING | Protein-protein interactions. Free. | 3 days |
| 8 | OpenAlex | Open literature metadata. Free API. | 3 days |
| 9 | Semantic Scholar | Citation graph + influence scores. Free API. | 3 days |
| 10 | ChEMBL | Drug-target bioactivity. Free API. | 1 week |

Wire these 10 first. The other 50+ can come later. 10 real, working, tested API integrations beats 60 declared-but-unverified ones.

---

## 4.5 — HIGH: Citation Accuracy Measurement System (Week 3-4)

### The 94% Claim Must Be Provable

Build `benchmark/citation_accuracy.py`:

1. Input: Set of hypothesis outputs from the pipeline (from the retrospective benchmark)
2. For each citation in each hypothesis:
   a. Verify the cited paper exists (DOI resolution via CrossRef API)
   b. Verify the cited paper's content supports the claim it's attached to (semantic similarity between claim text and paper abstract, threshold ≥ 0.75)
   c. Verify the citation is not fabricated (check PMID, DOI against PubMed/CrossRef)
   d. Verify the author names match the actual paper
   e. Verify the year is correct
3. Output: Citation accuracy = (valid_citations / total_citations) × 100

### Grounding Gate Metrics

For the dual-embedding grounding system, measure:
- False positive rate: Claims that pass grounding but are actually unsupported
- False negative rate: Claims that are blocked by grounding but are actually valid
- Grounding latency: Time added by the grounding step per stage
- Embedding agreement rate: How often Cohere and Azure embeddings agree on grounding decisions

---

## 4.6 — HIGH: Security & Compliance Module (Week 4-6)

### Why This Matters

Biomni runs arbitrary code with system privileges. Google AI Co-Scientist is a black box. humanovo's edge is being the compliant, auditable, enterprise-ready option.

### HIPAA Readiness Checklist

- Encrypted data at rest (AES-256) and in transit (TLS 1.3)
- Access control with role-based permissions (PI, Researcher, Viewer)
- Audit logging for all data access and pipeline executions
- Business Associate Agreement (BAA) template for institutional deployment
- Data retention and deletion policies
- De-identification pipeline for any patient-derived data
- No PHI sent to external LLM APIs (or if sent, BAA with provider required)

### Institutional Deployment Model

humanovo should deploy within institutional infrastructure (URMC, pharma company VPC) rather than as a SaaS product. This addresses:
- Data sovereignty (data never leaves institutional network)
- Compliance (institution controls security policies)
- Cost (institution pays for compute, humanovo provides software)
- Trust (IT/security team can audit the deployment)

### Audit Trail Engine

Every pipeline execution produces:
```json
{
  "execution_id": "uuid",
  "project_id": "uuid",
  "user_id": "uuid",
  "timestamp_start": "ISO8601",
  "timestamp_end": "ISO8601",
  "research_question": "...",
  "stages": [
    {
      "stage": "SEED",
      "model": "claude-opus-4-6",
      "provider": "aws-bedrock",
      "input_tokens": 4521,
      "output_tokens": 2103,
      "cost_usd": 0.34,
      "duration_seconds": 12.4,
      "grounding_results": {
        "claims_total": 8,
        "claims_grounded": 7,
        "claims_flagged": 1,
        "flagged_claims": ["..."]
      }
    }
  ],
  "total_cost_usd": 12.47,
  "total_duration_seconds": 342,
  "hypotheses_generated": 3,
  "citations_total": 47,
  "citations_verified": 44,
  "citation_accuracy": 0.936
}
```

---

## 4.7 — MEDIUM: Researcher-Facing Output Quality (Week 5-7)

### Hypothesis Report Format

The final output of a pipeline run should be a publication-ready document, not a JSON blob. Format:

1. **Executive Summary** (1 paragraph, written for a PI who has 30 seconds)
2. **Hypothesis Statement** (formal, testable, falsifiable)
3. **Supporting Evidence** (top 10 citations with relevance scores and 1-sentence summaries)
4. **Counter-Arguments** (top 3 challenges to the hypothesis with rebuttals)
5. **Mechanistic Model** (pathway diagram or molecular mechanism described textually)
6. **Confidence Assessment** (multi-dimensional: novelty, plausibility, testability, clinical relevance)
7. **Translational Roadmap** (T0: Current knowledge → T1: In vitro validation → T2: In vivo → T3: Clinical → T4: Regulatory → T5: Market)
8. **Experimental Protocol** (specific, actionable, with reagent lists if applicable)
9. **Estimated Cost & Timeline** (for experimental validation)
10. **Full Citation List** (formatted in journal style)

### Export Formats
- PDF (publication-ready)
- DOCX (editable)
- LaTeX (for Prism/Overleaf integration)
- JSON (for programmatic consumption)
- Markdown (for documentation)

---

## 4.8 — MEDIUM: Competitive Intelligence Dashboard (Week 5-6)

Build an internal tool that continuously monitors:

1. **Biomni/Phylo:** GitHub commits, new tool additions, benchmark results, hiring, partnerships
2. **Google AI Co-Scientist:** Blog posts, Trusted Tester program updates, published validations
3. **OpenAI for Science:** Prism updates, GPT model releases, partnership announcements
4. **Synthetic Sciences:** YC demo day, product launches, funding
5. **BenevolentAI:** Pipeline updates, earnings, clinical results
6. **New entrants:** Monitor arXiv, bioRxiv, YC, a16z portfolio for new AI-for-science startups

This is not a product feature — this is an operational necessity for a startup in a fast-moving space.

---

# PART 5 — ENGINEERING PRIORITIES (ORDERED)

## Sprint 1 (Week 1-2): MAKE IT WORK

1. Fix requirements.txt dependency mismatches
2. Run the 12-stage pipeline end-to-end on ONE real biomedical question
3. Verify each stage produces real output with real API calls
4. Log total cost and time
5. Fix any crashes, timeouts, or empty outputs
6. Update README.md (rename from GenUp, update architecture description)

**Exit Criteria:** A single research question goes in, 12 stages execute, a hypothesis comes out with citations.

## Sprint 2 (Week 3-4): PROVE IT WORKS

1. Run retrospective validation on 5 published hypotheses (expand to 10 later)
2. Measure citation accuracy with the automated verification system
3. Document grounding gate performance metrics
4. Produce benchmark report card

**Exit Criteria:** Quantified accuracy metrics that can be cited in any pitch or paper.

## Sprint 3 (Week 5-6): MAKE IT ACCESSIBLE

1. Wire 5 core biomedical APIs to live backend (PubMed, ClinicalTrials.gov, UniProt, Reactome, OpenAlex)
2. Replace frontend static data with live API calls for the core pages (Dashboard, Evidence, KnowledgeGraph, Search)
3. Remove all non-functional pages from navigation
4. Deploy a working demo instance

**Exit Criteria:** A researcher (Jamison, Truptesh, or Allyson Fess) can input a research question and get a real result.

## Sprint 4 (Week 7-8): MAKE IT DEFENSIBLE

1. Write security and compliance documentation
2. Build audit trail engine
3. Run compliance gap analysis for HIPAA
4. Prepare Scyntek pilot engagement with real deliverables
5. Draft preprint: "Adversarial Multi-Model Hypothesis Generation with Dual-Embedding Grounding: A Retrospective Validation Study"

**Exit Criteria:** Compliance documentation ready for Allyson Fess. Preprint draft ready for advisor review.

## Sprint 5 (Week 9-12): MAKE IT A PRODUCT

1. Project management module MVP (task decomposition + milestone tracking)
2. Researcher-facing output quality (PDF reports, exportable audit trails)
3. 5 additional API integrations (KEGG, ClinVar, STRING, Semantic Scholar, ChEMBL)
4. Performance optimization (pipeline parallelization where stages are independent)
5. Second round of retrospective validation (10 hypotheses total)

**Exit Criteria:** Product that can be demoed at EMC² or Mays AI Pitch with live functionality.

---

# PART 6 — POSITIONING STRATEGY

## 6.1 — Stop Competing on Breadth

humanovo cannot out-breadth Biomni (150 tools, 25 subfields), out-scale Google (Gemini 2.0, institutional partnerships), or out-distribute OpenAI (1.3M weekly science users). Attempting to do so is suicide.

## 6.2 — Compete on These Three Things

### 1. Adversarial Rigor
"Other platforms generate hypotheses. humanovo attacks them first."

The 12-stage pipeline with explicit counter-argument generation (Stage 4: COUNTER via Mistral) followed by forced revision (Stage 5: REVISE via o3-mini) is architecturally unique. No competitor does this. This is humanovo's core IP.

### 2. Enterprise Compliance
"Biomni runs arbitrary code with system privileges. Google is a black box. humanovo is the only platform built for institutional deployment with full audit trails."

The Allyson Fess conversation at URMC Neurology about compliance and security is the market signal. Pharma and academic medical centers need compliance. Nobody else is solving this.

### 3. Depth Over Breadth
"We don't cover 25 subfields. We go deeper in yours."

Pick 2-3 therapeutic areas (e.g., neurodegeneration, oncology, rare diseases) and build the deepest possible knowledge base, API integration, and domain-specific validation for those areas. Let Biomni be the Swiss Army knife. Be the scalpel.

## 6.3 — The One-Sentence Pitch

**Old:** "humanovo is an 11-agent biomedical hypothesis generation platform with 94% citation accuracy."

**New:** "humanovo is the only biomedical AI platform where every hypothesis is attacked by adversarial models, grounded through dual-embedding verification, and delivered with full audit trails for enterprise compliance — and we can prove it with published benchmarks."

The difference: the old pitch is a claim. The new pitch is a mechanism + evidence + differentiation. But it only works AFTER the benchmarks exist.

---

# PART 7 — THE KILL-OR-BE-KILLED TIMELINE

| Date | Milestone | Why It Matters |
|------|-----------|---------------|
| April 28, 2026 | Pipeline runs end-to-end on 1 real question | Without this, everything else is fiction |
| May 12, 2026 | Retrospective validation on 5 hypotheses complete | First quantified proof of value |
| May 26, 2026 | Live demo with URMC researcher | First real user feedback on real output |
| June 9, 2026 | 10 API integrations live, static data removed | Product, not prototype |
| June 23, 2026 | Compliance documentation + audit trail | Ready for Allyson Fess/URMC security conversation |
| July 7, 2026 | Preprint submitted to bioRxiv | Public credibility artifact |
| August 2026 | Scyntek pilot produces first deliverable | Revenue signal |
| September 2026 | EMC² or equivalent competition submission | With live demo, not slide deck |
| October 2026 | Project management module MVP | Second product surface |
| December 2026 | 10-hypothesis benchmark + preprint revision | Academic credibility |

---

# PART 8 — FINAL ASSESSMENT

humanovo has one genuine architectural innovation (adversarial multi-model hypothesis pipeline with dual-embedding grounding) wrapped in 244,000 lines of unproven code. The competition has working products, published benchmarks, institutional partnerships, and venture capital. The gap between humanovo's architecture and humanovo's reality is the only thing that matters.

The architecture is worth fighting for. The code needs to earn the right to exist by producing one single validated result. Do that first. Everything else follows.

The clock started when Biomni published their paper in June 2025. You have been running behind for 10 months. Every week without a working pipeline is a week where the moat gets wider.

No more pages. No more features. No more architecture. Make. It. Run.

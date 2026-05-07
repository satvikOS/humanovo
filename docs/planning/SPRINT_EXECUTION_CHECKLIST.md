# humanovo — Sprint Execution Checklist

**Owner:** Satvik Adyanthaya
**Start Date:** April 14, 2026
**Target Completion:** December 2026

This is the operational companion to `humanovo_gap_analysis.md`. The gap analysis is the strategy. This is the execution.

Every checkbox represents a concrete, verifiable action. Every sprint has an exit criterion that must be true before moving to the next sprint. No "blue sky" items. No "explore" items. Each task either gets done or doesn't.

---

## SPRINT 1 (April 14 — April 28): MAKE IT WORK

**North Star:** A single research question goes in, 12 stages execute, a hypothesis comes out with citations.

### 1.1 — Dependency Resolution
- [ ] Replace `backend/requirements.txt` with the corrected version from this delivery
- [ ] Recreate Python virtual environment: `python -m venv venv && source venv/bin/activate`
- [ ] Install: `pip install -r requirements.txt`
- [ ] Verify orchestrator imports: `python -c "from app.agents.discovery_orchestrator import SequentialHypothesisPipeline; print('OK')"`
- [ ] Run `pip check` — confirm no dependency conflicts

### 1.2 — Environment Configuration
- [ ] Copy `.env.example` to `.env`
- [ ] Configure AT LEAST AWS Bedrock credentials (Claude Opus + Sonnet)
- [ ] Configure AT LEAST one Azure model endpoint (recommend: Azure GPT-4o for fastest cheapest fallback)
- [ ] Verify config loads: `python -c "from app.core.config import settings; print(settings.AWS_REGION)"`

### 1.3 — Database Bootstrap
- [ ] `docker compose up -d postgres redis neo4j`
- [ ] `cd backend && alembic upgrade head`
- [ ] Verify Postgres connection: `psql $DATABASE_URL -c "\dt"` (should show tables)
- [ ] Verify Neo4j browser at http://localhost:7474

### 1.4 — Repository Cleanup
- [ ] Replace `README.md` with the corrected version (kills "GenUp")
- [ ] Search and remove all "GenUp" references: `grep -rn "GenUp\|genup" --include="*.py" --include="*.tsx" --include="*.ts" --include="*.md" .`
- [ ] Search and remove all Chinese model references: `grep -rn "DeepSeek\|deepseek\|kimi\|Kimi" .`
- [ ] Verify clean: both grep commands return zero matches

### 1.5 — Pipeline Integration Test
- [ ] Copy `tests/integration/test_pipeline_e2e.py` from this delivery
- [ ] Run: `pytest tests/integration/test_pipeline_e2e.py::TestPipelineInitialization -v -s`
  - **Exit criterion:** At least 2 model clients initialize
- [ ] Run: `pytest tests/integration/test_pipeline_e2e.py::TestPipelineEndToEnd -v -s --timeout=600`
  - **Exit criterion:** Pipeline executes ≥ 8 of 12 stages, produces non-empty hypothesis
- [ ] Capture the output report at `tests/integration/reports/pipeline_parkinsons_disease.json`

### 1.6 — Cost Logging
- [ ] Verify cost tracking shows per-stage costs in test output
- [ ] Document total cost of one full pipeline run in `tests/integration/reports/cost_baseline.md`
- [ ] If cost > $5 per hypothesis, flag for optimization review

### **SPRINT 1 EXIT CRITERION:**
A single command executes the full 12-stage pipeline on a real Parkinson's disease query and produces a JSON report card showing hypothesis title, confidence score, citation count, and per-stage execution metrics. The hypothesis text is human-readable and not a stub.

If you cannot demonstrate this to Jamison Seabury in a 5-minute screen-share, Sprint 1 is incomplete. Do not proceed to Sprint 2.

---

## SPRINT 2 (April 28 — May 12): PROVE IT WORKS

**North Star:** Quantified accuracy metrics that can be cited in any pitch or paper.

### 2.1 — Benchmark Infrastructure
- [ ] Copy `benchmark/citation_accuracy.py` from this delivery
- [ ] Copy `benchmark/retrospective_validation.py` from this delivery
- [ ] Create `benchmark/results/` directory (gitignored)
- [ ] Add `benchmark/__init__.py`

### 2.2 — Single-Benchmark Pilot
- [ ] Run BM-001 (Parkinson's gut-brain): `python -m benchmark.retrospective_validation --run-id BM-001`
- [ ] Inspect output JSON; verify all fields populated
- [ ] If recovery_rate < 30%, debug pipeline output quality before continuing
- [ ] Document baseline cost and time per benchmark in `benchmark/results/baseline.md`

### 2.3 — Citation Verification Pilot
- [ ] Run citation accuracy on BM-001 output: `python -m benchmark.citation_accuracy --input benchmark/results/ --output benchmark/results/citation_BM-001.json`
- [ ] Verify CrossRef and NCBI rate limits are not hit
- [ ] Document baseline citation accuracy

### 2.4 — Five-Benchmark Run
- [ ] Run BM-001 through BM-005 sequentially
- [ ] Aggregate results in `benchmark/results/sprint2_5bench.json`
- [ ] Compute summary statistics: mean recovery rate, mean citation accuracy, counter-arg quality distribution
- [ ] Total estimated cost: ~$30 in API calls

### 2.5 — Ten-Benchmark Run (Full Suite)
- [ ] Run all 10 benchmarks: `python -m benchmark.retrospective_validation --run-all`
- [ ] Run citation verification on all outputs
- [ ] Generate combined report: `benchmark/results/sprint2_full.json`
- [ ] Total estimated cost: ~$50-80 in API calls

### 2.6 — Analysis & Documentation
- [ ] Identify worst-performing benchmark — what failed?
- [ ] Identify best-performing benchmark — what worked well?
- [ ] Document findings in `benchmark/results/sprint2_analysis.md`
- [ ] Create comparison vs. published claim: "94% citation accuracy" → measured X%

### **SPRINT 2 EXIT CRITERION:**
A document at `benchmark/results/sprint2_full.json` containing measured (not claimed) values for: hypothesis recovery rate, citation accuracy, counter-argument quality, mean pipeline time, mean cost per hypothesis. These numbers replace all marketing copy in pitches and the website.

---

## SPRINT 3 (May 12 — May 26): MAKE IT ACCESSIBLE

**North Star:** A researcher (Jamison, Truptesh, or Allyson Fess) can input a research question and get a real result.

### 3.1 — Backend API Wire-Up
- [ ] Copy `backend/app/api/v1/endpoints/knowledge_graph_entities.py` from this delivery
- [ ] Register the new router in `backend/app/api/v1/__init__.py`
- [ ] Test endpoints with curl/HTTPie: `curl http://localhost:8000/api/v1/knowledge-graph/entities?query=KRAS`

### 3.2 — Knowledge Base Population
- [ ] Choose 5 priority APIs to wire first: PubMed, ClinicalTrials.gov, UniProt, Reactome, OpenAlex
- [ ] Run `scripts/bulk-load.py` for each source for one therapeutic area (e.g., Parkinson's)
- [ ] Verify entity counts in Neo4j and PostgreSQL
- [ ] Document loaded entity count per source

### 3.3 — Frontend Service Migration
- [ ] Copy `frontend/src/services/knowledge.ts` from this delivery
- [ ] Refactor `frontend/src/pages/Workbench.tsx` to use `useEntitySearch()` instead of MasterHumanLibraryIndex
- [ ] Refactor `frontend/src/pages/KnowledgeGraph.tsx` to use `useNeighborhood()` and `findPaths()`
- [ ] Refactor `frontend/src/pages/Search.tsx` to use `searchEntities()`
- [ ] Verify in browser: knowledge graph renders entities from API, not static data

### 3.4 — Static Data Removal
- [ ] Delete `frontend/src/data/MasterHumanLibrary*.ts` (all 19 files)
- [ ] Delete `frontend/src/data/anatomy/` and `frontend/src/data/evidence/`
- [ ] Run `npm run build` — fix any remaining import errors
- [ ] Verify bundle size dropped by ~3 MB

### 3.5 — Page Pruning
- [ ] Remove from `App.tsx` routes: BiobankManager, ExperimentTracker, MLModelManager, ManuscriptManager, RegulatoryCompliance, ResearchImaging, ClinicalTrials, Collaboration, PgvectorManager
- [ ] Update navigation menu to show only: Dashboard, Projects, Discovery, Hypotheses, Evidence, Knowledge Graph, Notebook, Settings
- [ ] Move removed page files to `frontend/src/pages/_deferred/` (don't delete; they may return)

### 3.6 — Demo Deployment
- [ ] Deploy to staging: `./scripts/deploy.sh staging`
- [ ] Verify staging URL is accessible
- [ ] Schedule demo with Jamison Seabury for end of Sprint 3
- [ ] Prepare 5-minute demo script: research question → discovery run → hypothesis output

### **SPRINT 3 EXIT CRITERION:**
Jamison Seabury opens humanovo in a browser, types a research question, watches the pipeline run, and receives a hypothesis with citations he can verify. He provides at least one piece of feedback that is actionable.

---

## SPRINT 4 (May 26 — June 9): MAKE IT DEFENSIBLE

**North Star:** Compliance documentation ready for Allyson Fess.

### 4.1 — Audit Trail Engine
- [ ] Copy `backend/app/services/audit_service.py` from this delivery
- [ ] Generate Alembic migration: `alembic revision --autogenerate -m "add audit_records table"`
- [ ] Apply migration: `alembic upgrade head`
- [ ] Wrap pipeline execution in audit context manager
- [ ] Wrap LLM calls in audit recording
- [ ] Wrap external API calls in audit recording

### 4.2 — Audit Verification
- [ ] Run pipeline once
- [ ] Run hash chain verification: `audit.verify_chain(db)` — must report `intact: True`
- [ ] Test export: JSON and CSV formats
- [ ] Verify exports are themselves audited

### 4.3 — Compliance Documentation
- [ ] Copy `COMPLIANCE.md` from this delivery
- [ ] Customize sections for actual deployment (replace placeholders)
- [ ] Add `security/risk_assessment.md` (template provided in deliverables)
- [ ] Add `security/data_classification.md`

### 4.4 — Allyson Fess Pre-Brief
- [ ] Send `COMPLIANCE.md` to Truptesh Kothari for institutional review
- [ ] Schedule 30-minute meeting with Allyson Fess
- [ ] Prepare 3 specific questions to ask her about URMC compliance requirements
- [ ] Document her answers in `security/urmc_requirements.md`

### 4.5 — Scyntek Pilot Preparation
- [ ] Define pilot scope with Karthik Ramakrishnan in writing
- [ ] Identify 1-2 specific Scyntek research questions to run through pipeline
- [ ] Set pilot success criteria (specific outputs they need, not "see what it does")
- [ ] Schedule pilot kick-off

### **SPRINT 4 EXIT CRITERION:**
Allyson Fess reviews `COMPLIANCE.md` and either (a) confirms it addresses URMC's needs or (b) provides specific gaps to close. Either outcome is a win — silence or vague feedback is failure.

---

## SPRINT 5 (June 9 — June 23): MAKE IT VISIBLE

**North Star:** Public credibility artifact submitted.

### 5.1 — Preprint Finalization
- [ ] Copy `PREPRINT_DRAFT.md` from this delivery
- [ ] Fill in all `[TO BE FILLED FROM BENCHMARK RUN]` sections from Sprint 2 results
- [ ] Recruit URMC co-author (start with Truptesh Kothari)
- [ ] Send draft to advisor network for feedback (Jamison, Truptesh, Dr. Colangelo)
- [ ] Incorporate feedback (one round)

### 5.2 — Single-Model Baseline
- [ ] Run all 10 benchmarks through GPT-4.1 alone (no pipeline, no grounding)
- [ ] Compare results to humanovo full pipeline
- [ ] Add comparison table to preprint Section 4.5

### 5.3 — Supplementary Materials
- [ ] Generate Supplementary Table S1: Complete data source inventory
- [ ] Generate Supplementary Table S2: Benchmark specifications
- [ ] Generate Supplementary Table S3: Per-stage cost/latency breakdown from Sprint 2 results
- [ ] Generate Supplementary Figure S1: Pipeline architecture diagram (use the v2 platform spec)
- [ ] Generate Supplementary Figure S2: Grounding gate decision flow

### 5.4 — Open-Source Release
- [ ] Create GitHub repo: `humanovo-benchmark-suite`
- [ ] Include: `citation_accuracy.py`, `retrospective_validation.py`, benchmark hypothesis definitions, README
- [ ] Apache 2.0 license for the benchmark code (proprietary code stays private)
- [ ] Add link to preprint

### 5.5 — bioRxiv Submission
- [ ] Format manuscript per bioRxiv requirements
- [ ] Upload to bioRxiv
- [ ] Get DOI
- [ ] Tweet/LinkedIn post announcing preprint
- [ ] Send to advisor network

### **SPRINT 5 EXIT CRITERION:**
A bioRxiv DOI exists. The preprint is publicly accessible. The benchmark code is publicly accessible. Both are linked from the humanovo product page.

---

## SPRINT 6 (June 23 — July 7): MAKE IT REVENUE

**North Star:** First paid pilot or LOI signed.

### 6.1 — Scyntek Pilot Execution
- [ ] Run agreed scope of work
- [ ] Deliver outputs in agreed format
- [ ] Get written feedback from Karthik on whether the output is useful
- [ ] If useful: convert to paid engagement
- [ ] If not useful: document why and iterate

### 6.2 — URMC Partnership Formalization
- [ ] Draft Memorandum of Understanding with URMC for institutional pilot
- [ ] Identify 1 PI willing to use humanovo for active research project
- [ ] Set pilot scope (3 specific hypotheses they want generated)
- [ ] Set pilot timeline (4 weeks)

### 6.3 — Pricing Model
- [ ] Define pricing for: per-hypothesis, per-month seat, institutional license
- [ ] Document in `business/pricing.md`
- [ ] Validate with at least 2 advisors (Dave Mammano, Truptesh Kothari)

### 6.4 — Outbound Sales (Limited)
- [ ] Identify 5 target accounts: 2 academic medical centers, 2 small biotech, 1 pharma
- [ ] Send pre-warmed introductions via existing network only (no cold outreach until product is solid)
- [ ] Schedule discovery calls

### **SPRINT 6 EXIT CRITERION:**
At least one signed pilot agreement (paid or LOI with clear path to revenue) by end of sprint.

---

## SPRINT 7-12 (July — December): SCALE

After Sprints 1-6 are complete, the playbook becomes:

### 7. Project Management Module
Build the AI-native PM module described in the gap analysis Section 4.3. This is the second product surface that differentiates humanovo from pure hypothesis engines.

### 8. Wet-Lab Validation
Partner with one institutional lab (Jamison, Allyson, or Truptesh) to run prospective validation on a humanovo-generated hypothesis. Goal: published validation by December.

### 9. Domain Specialization
Pick 2-3 therapeutic areas and build the deepest possible knowledge base for each. Recommended: Neurodegeneration (URMC strength), Rare Disease (large white-space), Oncology (largest market).

### 10. Competition / Visibility
Submit to: Mays AI Pitch (Texas A&M), MIT Pitch Challenge, BIO Spark Tank. Demo a working product, not a deck.

### 11. Fundraising Preparation
With validated benchmarks, signed pilots, and (ideally) wet-lab validation, prepare for seed round. Target: $1.5M-$3M to extend runway and build small team. NOT before then — fundraising on a prototype against funded competitors is a losing battle.

### 12. Hire #1
First hire should be: a biomedical domain expert (postdoc or recently graduated PhD) who can speak to researchers as a peer. Engineering can scale via contractors. Domain credibility cannot.

---

## CRITICAL PATH MARKERS

| Marker | Date | Status |
|--------|------|--------|
| Pipeline runs end-to-end | April 28 | ☐ |
| 10-benchmark validation complete | May 12 | ☐ |
| Live demo to URMC researcher | May 26 | ☐ |
| Audit trail + compliance docs ready | June 9 | ☐ |
| bioRxiv preprint submitted | June 23 | ☐ |
| First pilot signed | July 7 | ☐ |
| Wet-lab validation in progress | September | ☐ |
| First competition submission with live demo | October | ☐ |
| Pre-seed deck ready | November | ☐ |
| Fundraising conversations active | December | ☐ |

---

## RULES OF ENGAGEMENT

1. **Sprints do not parallelize.** Sprint N must hit its exit criterion before Sprint N+1 begins. No exceptions. Trying to do two sprints at once is how you ended up with 244,000 lines of code that doesn't run.

2. **Demo or it didn't happen.** Every sprint exit criterion is a demo, not a "code is complete" claim. If you can't show it working to a third party in 5 minutes, it's not done.

3. **Cost discipline.** Track API costs per sprint. If pipeline costs exceed $50/run consistently, optimize before scaling tests. Burning $500/day on benchmarks at zero revenue is unsustainable.

4. **Stop adding features.** Every new feature is a tax on the rest of the codebase. The 33-page frontend is the symptom of feature addiction. Ship the core, prove it works, then add.

5. **Document what doesn't work.** When a benchmark fails or a stage produces garbage output, document why in `failures/` directory. These failures are the most valuable artifact for improving the system.

6. **Daily standup with self.** Five minutes every morning: what did I do yesterday, what am I doing today, what's blocking me. If the answer to "what am I doing today" doesn't map to a sprint task, you're off-plan.

---

This checklist is the contract. Execute it. The competitive analysis already explained why this matters. The compliance doc already explained the wedge. The preprint draft is already structured. The code patches are already written. There is nothing left to plan. There is only execution.

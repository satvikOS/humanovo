# Humanovo — the v2 platform Continuation Plan

**Branch:** `claude/project-jamison-implementation-2R6V0`
**Last Session:** 2026-03-18
**Spec:** `/home/user/humanovo/the v2 platform.md` (Definitive Implementation Specification v2)

---

## WHAT WAS COMPLETED IN SESSION 1

### Commit 1: Major Platform Upgrade
- **pgvector migration** — Replaced ChromaDB with PostgreSQL-native vector search
  - `backend/app/knowledge/vector_store.py` — Full rewrite with dual embeddings (1024d biomedical + 3072d general)
  - `backend/migrations/versions/003_pgvector_embeddings.py` — HNSW indexes, vector_embeddings table
  - `docker-compose.yml` — Changed to `pgvector/pgvector:pg16` image
  - `backend/requirements.txt` — Replaced `chromadb` with `pgvector==0.3.6`

- **Model cleanup** — Removed DeepSeek-R1 and Kimi-K2 from active pipeline
  - `backend/app/core/config.py` — Removed AZURE_DEEPSEEK_*, AZURE_KIMI_* settings, added PGVECTOR_* settings
  - `backend/app/agents/discovery_orchestrator.py` — Removed from client init, model routing, parallel dispatch, _create_agents. Kept as legacy enums.

- **Neo4j real-time population service** — `backend/app/services/neo4j_population_service.py`
  - 17 entity types, 16 relationship types
  - NLP-based entity extraction, batch upsert with MERGE, provenance tracking

- **Document export service** — `backend/app/services/document_export_service.py`
  - 5 document types: research paper, hypothesis report, discovery summary, evidence compilation, translational roadmap
  - PDF (reportlab) + DOCX (python-docx)
  - New API endpoints: POST /documents/export, POST /documents/project/{id}/docx

- **Data sources API** — `backend/app/api/v1/endpoints/data_sources.py`
  - POST /data-sources/query, GET /data-sources/available, GET /data-sources/stats

- **Frontend Projects page** — Complete rewrite of `frontend/src/pages/Projects.tsx`
  - Stats bar, grid/list toggle, status filters, sort options, enhanced cards

### Commit 2: v2 Spec Foundations
- **Migration 004** — `backend/migrations/versions/004_research_project_management.py`
  - ALTER projects: lab_profile, discovery_config, total_discovery_runs, total_api_cost_cents, best_confidence_score, last_discovery_at
  - CREATE discovery_runs, synthesis_runs, grounding_cache (1024d + 1536d), citation_cache, imaging_records, hypothesis_feedback
  - ALTER hypotheses: feasibility_score, impact_score, required_methods, counter_arguments, revisions

- **Config files**
  - `backend/config/methods_taxonomy.json` — 10 categories, 100+ methods
  - `backend/config/model_pricing.json` — Per-model token costs
  - `backend/config/constitutional_constraints.txt` — Anti-hallucination constraints

- **API endpoints**
  - PATCH/GET /projects/{id}/lab-profile — Lab capability profile
  - PATCH /projects/{id}/discovery-config — Discovery defaults
  - GET /config/methods-taxonomy — Methods taxonomy
  - GET /config/model-pricing — Model pricing
  - GET /config/constitutional-constraints — Constitutional constraints

### Commit 3 (pending): Data Sources Service
- `backend/app/services/data_sources.py` — 21 Phase 1 sources fully implemented + stubs for Phase 2-4

---

## WHAT NEEDS TO BE DONE — COPY-PASTE THIS INTO THE NEXT SESSION

### Context for the next Claude Code session:

```
Continue implementing the v2 platform on branch claude/project-jamison-implementation-2R6V0
in the humanovo repo. The spec is at /home/user/humanovo/the v2 platform.md.

Session 1 completed:
- pgvector migration (replace ChromaDB) ✅
- DeepSeek/Kimi removal from pipeline ✅
- Neo4j real-time population service ✅
- Document export service (PDF + DOCX) ✅
- Migration 004 (discovery_runs, synthesis_runs, grounding_cache, etc.) ✅
- Config files (methods_taxonomy, model_pricing, constitutional_constraints) ✅
- Lab profile + discovery config API endpoints ✅
- Frontend Projects page polish ✅
- Data sources service (21 Phase 1 + stubs) — may need completion

REMAINING WORK by priority (from spec Section 22):

PHASE 0d (CRITICAL — blocks everything):
- Wire Workbench page discovery modes to real API calls (POST /projects/{id}/discover)
- Replace all mock data returns in Workbench.tsx with actual backend calls
- The spec (Section 1.3) lists 5 discovery modes that must call real endpoints

PHASE 1 — CORE PIPELINE:
1a. Upgrade to 12-stage pipeline (add REVISE between COUNTER and MECHANISM, add TRANSLATE before FINALIZE)
    - Spec Section 6.1 has full stage definitions with model assignments
    - Add Claude Sonnet 4.6 as EXPAND/VALIDATE/TRANSLATE/FINALIZE model
    - Implement per-stage fallback chains (spec Section 1.2)
1b. 3-layer grounding system (spec Section 7)
    - Layer 1: RAG via pgvector (grounding_cache table, cosine >= 0.7 threshold, dual embedding)
    - Layer 2: Citation verification (PubMed E-Utilities + DOI HEAD requests)
    - Layer 3: Cross-source corroboration (cluster claims, count unique DOIs)
1c. Auto-citation system (spec Section 8)
    - CitationService class: extract_claims, find_citations, inject_citations, format_reference_list, verify_citation
    - Citation caching in citation_cache table
1d. Constitutional constraints — prepend to ALL pipeline stage prompts (file already exists at config/constitutional_constraints.txt, needs integration into orchestrator)
1e. WebSocket streaming (spec Section 13)
    - ws://host/ws/discovery/{run_id} and ws://host/ws/synthesis/{run_id}
    - Events: stage_started, stage_completed, hypothesis_completed, round_completed, cost_update, run_completed
    - Client commands: cancel, ping
1f. Phase 1 data sources — verify all 21 are working (file may exist at backend/app/services/data_sources.py)

PHASE 2 — JAMISON'S FEATURES:
2a. Lab Capability Filter integration into pipeline
    - Inject into SEED stage prompt (spec Section 2.3, Point 1)
    - Inject into SCORE stage prompt for feasibility scoring (spec Section 2.3, Point 2)
    - Inject into SYNTHESIZE stage prompt (spec Section 2.3, Point 3)
2b. Backward/Synthesis Pipeline — 5-stage NEW pipeline (spec Section 3)
    - POST /projects/{id}/synthesize endpoint
    - Stages: DECOMPOSE (Opus) → RETRIEVE (Cohere) → SYNTHESIZE (Opus) → GAP_ANALYZE (GPT-4.1) → FORMAT (Sonnet)
    - Data types: CitedFinding, GapItem, Citation, SynthesisResult (spec Section 3.2)
    - Grant-aware formatting: nih_r01, nih_r21, nsf, dod, private_foundation
2c. Output Format & Verbosity Control (spec Section 4)
    - output_format: narrative, structured_table, knowledge_gap_map, grant_sections, comprehensive
    - verbosity: brief (300 words), standard (1000 words), comprehensive (3000 words)
    - Verbosity re-run optimization — cache stages 1-4, only re-run FORMAT
2d. Visual Summary Layer (spec Section 5)
    - 5 charts: evidence_landscape, method_frequency, gap_heatmap, confidence_meters, cost_breakdown
    - Backend must output visualization_data JSON from FORMAT/FINALIZE stages
    - Frontend renders with Recharts (already a dependency)

PHASE 3 — FRONTEND (core pages):
3a. ProjectWorkspace page (/projects/:id/workspace) — 6 tabs (spec Section 14.2)
    - Overview, Discovery Runs, Hypotheses, Evidence (synthesis), Costs, Settings
3b. DiscoveryRunner page (/projects/:id/discover) — spec Section 14.3
    - Pre-run config panel + live 12-segment progress bar + WebSocket events
    - Round/hypothesis tracker grid, real-time cost counter
3c. HypothesisReview page (/projects/:id/hypotheses/:hypothesisId) — spec Section 14.4
    - Pipeline trace accordion, entity highlighting, evidence with PubMed links
    - Translational roadmap T0-T5 timeline, version history (pre/post COUNTER)
    - Feedback form (6 dimension sliders + boolean toggles + tags)
3d. ProjectKnowledgeGraph (/projects/:id/graph) — spec Section 14.5
    - Cytoscape.js with Neo4j data, entity search, type filters, color-coded nodes
3e. PipelineIntelligence (/intelligence) — spec Section 14.6
    - 4 tabs: Costs, Model Performance, Benchmarks, Optimizations
3f. Lab Profile Editor component — spec Section 2.4
    - Multi-input equipment, modality dropdown from taxonomy, techniques, excluded methods, filter mode

PHASE 4 — SUPPORTING:
4a. Imaging Ingestion Service (spec Section 15) — DICOM (pydicom), NIfTI (nibabel), basic images
4b. Hypothesis feedback system — POST /hypotheses/{id}/feedback with dimension_scores JSONB

PHASE 5 — BILLING (spec Section 21):
5a. usage_events table + CostTracker wrapper for all LLM/embedding/API calls
5b. Budget configs + alert system
5c. Billing dashboard frontend (/billing)
5d. Migration 007: billing_and_usage tables

PHASE 6 — pgvector Management UI (spec Section 20):
6a. /dev/pgvector page with 4 tabs (Cache Overview, Search & Browse, Similarity Testing, Maintenance)
6b. API endpoints for pgvector management
6c. Scheduled maintenance tasks (TTL cleanup, index rebuilds)

PHASE 7 — Extended Data Sources:
7a. Phase 2 clients (10 clinical & regulatory sources)
7b. Phase 3 clients (15 genomics & biological sources)
7c. Phase 4 clients (14 literature & specialized sources)
7d. Data source registry + health monitoring

Important notes:
- Keep Mistral-Large-3 (it's French, not Chinese)
- No test infrastructure needed right now
- Export formats: PDF and DOCX only (no LaTeX/Markdown)
- All data in PostgreSQL — NO localStorage for project data on frontend
- Constitutional constraints must be prepended to EVERY pipeline stage prompt
```

---

## KEY DISCREPANCIES TO FIX EARLY

1. **Embedding dimensions**: Spec says OpenAI text-embedding-3-large at 1536d, current vector_store uses 3072d. The grounding_cache migration (004) uses the correct 1536d. Need to align vector_embeddings table or decide on one approach.

2. **Pipeline stages**: Current orchestrator has 10 stages. Spec requires 12 (add REVISE after COUNTER, add TRANSLATE before FINALIZE). Both new stages use models already configured.

3. **Claude Sonnet 4.6**: Config has the Bedrock model ID but it's not wired into the discovery orchestrator as a usable model type. Needs ModelType.CLAUDE_SONNET enum + client initialization.

4. **Workbench page**: Currently returns mock data. This is the BIGGEST blocker per the spec — "Nothing else works until this is fixed."

---

## FILE INVENTORY

### New files created this session:
```
backend/app/knowledge/vector_store.py           (rewritten — pgvector)
backend/app/services/document_export_service.py (new — PDF+DOCX)
backend/app/services/neo4j_population_service.py (new — real-time graph)
backend/app/services/data_sources.py            (pending — 60+ sources)
backend/app/api/v1/endpoints/data_sources.py    (new — data sources API)
backend/app/api/v1/endpoints/config_endpoints.py (new — config API)
backend/config/methods_taxonomy.json            (new — 100+ methods)
backend/config/model_pricing.json               (new — token costs)
backend/config/constitutional_constraints.txt   (new — anti-hallucination)
backend/migrations/versions/003_pgvector_embeddings.py (new)
backend/migrations/versions/004_research_project_management.py (new)
frontend/src/pages/Projects.tsx                 (rewritten — enhanced)
```

### Modified files:
```
backend/app/agents/discovery_orchestrator.py    (DeepSeek/Kimi removed)
backend/app/core/config.py                      (pgvector settings, model cleanup)
backend/app/api/v1/__init__.py                  (new routes registered)
backend/app/api/v1/endpoints/document_pipeline.py (DOCX export endpoints added)
backend/app/api/v1/endpoints/projects.py        (lab profile + discovery config)
backend/requirements.txt                        (chromadb→pgvector, +python-docx)
docker-compose.yml                              (pgvector image, DeepSeek env removed)
```

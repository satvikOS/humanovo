# API reference

One-page surface map of the humanovo backend. Sourced from
`backend/app/api/v1/__init__.py` — the canonical router registration —
so it stays accurate as long as new routers get included there.

For interactive exploration, hit `/docs` (Swagger UI) or `/redoc` on a
running backend; this doc is for readers who want to know where things
live without spelunking through 54 endpoint files.

**Base path:** `/api/v1`

---

## Domains

The API splits into nine functional domains. Each subsection lists the
routers that contribute, with the file you'll find their handlers in.

### Auth + identity

- `/auth/*` — `app/api/v1/endpoints/auth.py`
  - POST `/auth/register` — create account, returns user
  - POST `/auth/login` — JWT issue
  - GET `/auth/me` — current user (incl. `has_completed_onboarding`)
  - PATCH `/auth/me` — update profile, accepts `has_completed_onboarding`
  - POST `/auth/logout` / `/auth/change-password`

### Projects + research surface

- `/projects/*` — `app/api/v1/endpoints/projects.py`
  - CRUD on Projects (owner-scoped via `fetch_owned_or_404`)
- `/hypotheses/*` — `app/api/v1/endpoints/hypotheses.py`
  - CRUD on Hypothesis rows (owner-scoped)
- `/hypotheses/{id}/trace` + `/hypotheses/{id}/audit-log` —
  `hypothesis_trace.py` (Merkle-anchored event log replay; powers
  the /provenance product surface)
- `/saved-papers/*` — `saved_papers.py` (PDF/HTML papers users have
  generated and saved)
- `/project-documents/*` — `project_documents.py` (raw uploads —
  PDFs, datasets, etc.)
- `/evidence/*` — `evidence.py`
- `/citations/*` — `citations.py` (Mendeley-style library)
- `/citation-verify/*` — `citation_verify.py` (quote-level grounding;
  Stage 7 / B7 of `PATH_TO_100_PERCENT.md`)
- `/notebook/*` — `notebook.py`
- `/activities/*` — `activities.py` (the Timeline feed)

### Discovery pipeline

- `/agents/*` — `agents.py`
- `/discovery/*` — `discovery.py` (the typed disease-discovery service)
- `/discovery-sessions/*` — `discovery_sessions.py` (conversational
  persistence)
- `/orchestrator/*` — `orchestrator.py` (start/pause/resume/stop the
  12-stage pipeline + paper generation)
- `/agent-chat-stream/*` — `agent_chat_stream.py` (SSE streaming for
  conversational discovery)
- `/pipeline-intelligence/*` — `pipeline_intelligence.py` (cost,
  benchmarks, optimisation history; ~30 routes typed in A1)
- `/ws/discovery/*` — `websocket.py` + `ws_streaming.py` (WebSocket
  feed for in-flight pipeline events)

### Knowledge graph

- `/knowledge-graph/*` — `knowledge_graph.py`
  - GET `/nodes` / `/edges` — list with filters
  - POST `/nodes` / `/edges` — create
  - GET `/subgraph/{node_id}` — traversal
  - GET `/full` / `/stats` — aggregate views
  - GET `/scope/{private|common|all}` — visual-KG scope toggle
  - GET `/hypothesis/{id}` / `/paper/{id}` — subgraph for a
    hypothesis or saved paper (regex-tokeniser stand-in for NER;
    A3 Phase 2 follow-up)
- `/knowledge-graph-entities/*` — `knowledge_graph_entities.py`
- `/knowledge/*` — `knowledge.py` (legacy KG read API; being absorbed
  by `/knowledge-graph` per the A3 plan)
- `/kg-permissions/*` — `kg_permissions.py`
- `/rag/*` — `rag.py` (semantic search over the corpus)
- `/project-kg/*` — `project_kg.py` (project-scoped subgraph)

### Compute / analysis

- `/compute/*` + `/compute-engine/*` — `compute.py`,
  `compute_engine.py` (workstation, monte-carlo, equation plotter;
  these power the /compute-lab page after the B2 lazy-load)
- `/simulations/*` — `simulation.py` (frontend uses the plural prefix)
- `/statistics/*` — `statistics.py`
- `/genomics/*` — `genomics.py`
- `/imaging/*` — `imaging.py` (V1-hidden; behind `KG_BACKEND` parity)
- `/datasets/*` — `datasets.py`

### V1-hidden surfaces

These render-redirect to /dashboard via the V1Gate in `App.tsx`, but
the backend routes still exist (frontend tests skip; backend serves):

- `/clinical-trials/*` — `clinical_trials.py`
- `/manuscripts/*` — `manuscripts.py`
- `/biobank/*` — `biobank.py`
- `/collaboration/*` — `collaboration.py`
- `/regulatory/*` — `regulatory.py`
- `/ml-models/*` — `ml_models.py`
- `/experiments/*` — `experiments.py`

Re-enable when `VITE_V1_HIDDEN_ROUTES_ENABLED=true` ships in v1.1.

### Billing + commerce

- `/billing/*` — `billing.py` (Stripe checkout + webhook +
  idempotency LRU)
- `/user-budget/*` — `user_budget.py` (per-user $ cap; Stage 4 of
  PATH_TO_100_PERCENT will plug a circuit-breaker into every
  LLM-cost endpoint)

### Documents + ingestion

- `/document-pipeline/*` — `document_pipeline.py` (PDF/DOCX export)
- `/ingestion/*` + `/ws/ingestion/*` — `ingestion.py`,
  `ingestion_ws.py`
- `/data-sources/*` — `data_sources.py` (62-source registry +
  health endpoint; rate-limit fix from A5)
- `/paper-qa/*` — `paper_qa.py`

### Platform internals

- `/platform/*` — `platform_api.py` (~42 routes; Phase 6 of the
  production audit will runtime-validate these)
- `/monitoring/*` — `monitoring.py`
  - GET `/health` — basic liveness
  - GET `/health/full` — DB + sources + Stripe + version
  - GET `/metrics`, `/metrics/ingestion`, `/metrics/performance`,
    `/metrics/rag` (admin-only)
- `/config/*` — `config_endpoints.py`
  - GET `/methods-taxonomy` / `/model-pricing` /
    `/constitutional-constraints`
- `/user-state/*` — `user_state.py` (workspace tab persistence)
- `/evoe/*` — `evoe.py`

### Admin

- `/admin/*` — `admin.py`. **Two layers of dependency**:
  `ADMIN_REQUIRED` for auth + `rate_limit("admin")` for per-IP
  token-bucket (30 cap, 0.5 r/s).
  - GET `/admin/health`
  - GET `/admin/kg-stats` — Postgres-side counts + corpus stats
  - GET `/admin/kg-parity` — A3 parity check (both backends
    side-by-side, with `in_parity` verdict)
  - POST `/admin/seed-corpus`, `/admin/seed-kg`,
    `/admin/seed-common-kg` (refuses to run when ENVIRONMENT=production)

---

## Cross-cutting conventions

### Auth

- Most routes mount under `AUTH_REQUIRED = [Depends(get_current_active_user)]`.
- Admin routes layer `ADMIN_REQUIRED = [Depends(get_current_admin_user)]`
  on top.
- Tenant-isolation: every owner-scoped endpoint goes through
  `fetch_owned_or_404` (transitive via Project) or
  `fetch_owned_directly_or_404` (direct `owner_id`). Cross-tenant
  access returns **404**, never 403, to avoid leaking existence.
- WebSocket auth uses `authenticate_websocket()` (token via
  `?token=` query param or `Authorization` header).

### Response shapes

- Pydantic v2 throughout. `model_config = ConfigDict(...)` not
  `class Config:`.
- 84 routes typed in A1 (commit `a94afda`); ~80 still return raw
  dicts but Stage 2 C1 will runtime-validate them.
- The `PlatformPayload` / `PipelineIntelligencePayload` permissive
  wrappers (`extra='allow'`) are intentional — see the A1 commit
  for why we ship those instead of forcing premature concrete
  schemas onto free-form service-layer dicts.

### Error envelope

`safe_error(exc, code=ErrorCode.X)` from `app/core/errors.py`.
Frontend expects `{ detail: string, code?: ErrorCode }`. 5xx
responses have `[API]`-tagged console errors filtered out by the
e2e helpers (those mean infra, not JS bugs).

### Rate limiting

- App-level: `app/core/rate_limit.py` — in-process per-IP token
  bucket. Currently wired to `/admin/*` only. Add new buckets in
  `_DEFAULT_BUCKETS` and apply via `Depends(rate_limit("name"))`.
- Volumetric defence is upstream: CloudFront / AWS WAF.
- Per-source biomedical APIs: `app/services/data_sources.py`
  per-class `_rate_limit()` overrides. PubMed bumps to 10 r/s with
  an API key (A5 fix).

### Migrations

- Alembic, in `backend/migrations/versions/`.
- 23 migrations as of commit `0835393`.
- All reconcile-class migrations use `IF NOT EXISTS` / `IF EXISTS`
  + `pg_constraint` / `pg_indexes` checks. Re-runnable after partial
  application.

### Audit log

`app/services/audit_service.py` — Merkle-anchored event log.
- `audit.verify_chain(db) → {intact: bool}` runs the chain
  verification end-to-end. Surfaced via
  `GET /hypotheses/{id}/audit-log` for product use, and called
  directly during Stage 5 verification per `OPERATIONS.md`.

---

## Where the OpenAPI spec lives

Hit `GET /openapi.json` on a running backend for the machine-readable
spec. Swagger UI lives at `/docs`, ReDoc at `/redoc`. The Stage 2 C1
runtime audit (per `PATH_TO_100_PERCENT.md`) will validate every
route's response against this spec; today it's still informational.

## See also

- `DEVELOPMENT.md` — cold-start setup + daily commands.
- `OPERATIONS.md` — production runbooks.
- `docs/planning/PATH_TO_100_PERCENT.md` — roadmap.
- `docs/planning/SECURITY.md` — threat model.
- `docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md` — KG migration.

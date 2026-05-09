# Next Session — Continuation Map

**Last touched:** 2026-05-08 · **Branch:** `humanovo` · **Last commit:** `136beb9`

This is the canonical "where we left off" document. A future agent
session (or future you) opens here, reads top-to-bottom, and knows
what's done, what's blocked, and what to pick up next.

It supersedes any older planning doc with overlapping scope. When
something here ships, move it from "Outstanding" to "Done" and keep
the file current.

---

## Context

* **Workspace:** `/home/user/humanovo` (monorepo: `backend/`,
  `frontend/`, `landing/`, `lambda/`, `.github/workflows/`)
* **Active branch:** `humanovo`. Push to it directly; mirror
  workflow syncs `landing/` to the public repo.
* **Local CI:** `make ci-actions` (verify-action-shas + actionlint),
  `make lint`, `make test`, `make build-landing`. Run locally before
  every push.
* **Conftest is offline-tolerant** — pure unit tests run without
  Postgres; DB-dependent tests fail with their own targeted error.
* **All third-party GitHub Actions are SHA-pinned and verified.**
  See `scripts/verify-action-shas.py` + `CI_GOTCHAS.md`.

## Conventions to keep

* **Migrations:** every reconcile-class migration uses
  `ALTER TABLE ... IF NOT EXISTS` and `DROP ... IF EXISTS`. Index
  + FK creation gated by `pg_constraint` / `pg_indexes` checks.
  Re-runnable after partial application.
* **Tenant isolation:** every owner-scoped endpoint uses
  `fetch_owned_or_404` (transitive via Project) or
  `fetch_owned_directly_or_404` (direct `owner_id`). Cross-tenant
  access returns **404**, never 403 — avoids existence leak.
* **Pydantic v2:** `class Config:` is gone. Use
  `model_config = ConfigDict(...)`. Every new schema follows.
* **Lambda handlers:** cold-start `print("[X] Module loading...")`
  before imports is intentional for CloudWatch tagging. Per-file
  `# ruff: noqa: E402` documents the pattern.
* **CI gotchas:** when a new GitHub Actions failure appears, check
  `docs/planning/CI_GOTCHAS.md` first. If it's a new class of
  failure, add an entry there with date / symptom / root cause /
  fix / durable defence.

## What's blocked on the user (no autonomous progress possible)

1. **Tauri signing keypair** — generate locally, upload BOTH halves
   to repo Secrets:
   * `TAURI_SIGNING_PRIVATE_KEY`
   * `TAURI_SIGNING_PUBLIC_KEY`
   * Optionally `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   Until added, native builds ship unsigned.

2. **Apple codesign + notarization secrets** — for signed macOS
   `.dmg`. Repo Secrets:
   * `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`
   * `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`
   * `APPLE_ID`, `APPLE_PASSWORD` (notarization)
   Workflow already forwards each only when non-empty (no-secret
   builds produce unsigned binaries cleanly).

3. **Backend bootstrap** — dispatch
   `bootstrap-backend-new-account.yml` then populate AWS Secrets
   Manager bundle `humanovo/prod/app` with:
   * `DATABASE_URL`, `JWT_SECRET_KEY`, `PUBMED_EMAIL`
   * `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
     `STRIPE_PRICE_RESEARCHER_MONTHLY`, etc.
   * `BEDROCK_*`, `AZURE_*` LLM provider credentials
   This unlocks Phases 3, 4, 6, 9 of the production-readiness audit.

4. **Real OG image** — `landing/public/og-image.png` (1200×630,
   hand-composed Vesalius detail + wordmark + rust accent). Current
   placeholder works but undersells.

5. **Founder bios** — `PageTrust.tsx` ships with placeholder copy.
   Replace with real names + affiliations when ready.

6. **`/status` API URL** — `NEXT_PUBLIC_HUMANOVO_API` env in Vercel
   project settings. Defaults to `https://api.humanovo.net`; set
   only if the API lives elsewhere.

## What was completed this session

13 commits, ~9,000 lines net added. Highlights organized by domain:

### Platform features
* 12-stage adversarial pipeline shape preserved; per-source liveness
  cache + `/api/v1/data-sources/health` shipped.
* New `GET /api/v1/hypotheses/{id}/trace` — per-claim citation chain.
* New `GET /api/v1/hypotheses/{id}/audit-log` — Merkle-anchored event
  log replay with `chain_intact` flag.
* New `GET /api/v1/health/full` — DB + sources + Stripe + version.

### Backend storage & operations
* **Tenant isolation gap closed.** Migration `021_owner_id_on_platform_entities.py`
  + ORM updates + ~50 endpoint rewrites across 8 files. Helpers
  `fetch_owned_directly_or_404` and `filter_by_owner` in
  `app/core/ownership.py`.
* **62 active biomedical sources** (Phase 1+2+3+4) at concurrency=12.
* Migrations 014, 017, 018, 021 idempotent.
* Pydantic v1 → v2 across the codebase.
* Stripe webhook idempotency LRU.
* 142 UUID-typing fixes across 22 endpoint files.
* 16+ swallowed-exception sites converted to structured logging.
* Two cross-tenant bugs fixed (`/v1/user/{id}/budget`, `/v1/kg/*`).

### UI/UX
* Landing pages: `/manifesto`, `/pricing`, `/privacy`, `/terms`,
  `/docs`, `/atlas`, `/provenance`, `/status` (new), home.
* Glyph swapped for the platform peanut/dumbbell mark.
* Slim Colophon footer (no editorial blocks, GitHub link removed).
* Pricing scrubbed of cost/margin reveal language.
* No advisor/social-proof copy.
* Frontend `HypothesisTrace.tsx` + `AuditLogViewer.tsx` shipped and
  wired into `ProjectDetail.tsx`.
* `AuthContext` split into 3 files (fast-refresh fix).

### CI / operations
* All 17 workflows SHA-pinned; verifier in CI.
* `actionlint` workflow.
* Top-level `Makefile`.
* `SECURITY.md`, `CI_GOTCHAS.md`, `CHANGELOG.md`,
  `TENANT_ISOLATION_GAP.md` (closed).

### Tier-1 follow-up (this session)
* **A1 response_model sweep** (commit `a94afda`) — 84 newly-typed
  routes across `discovery.py` (+4), `orchestrator.py` (+10),
  `pipeline_intelligence.py` (+29), `platform_api.py` (+41).
  Concrete schemas where the shape is well-defined; permissive
  `extra='allow'` wrappers for routes that pass service-layer dicts
  through unchanged. Skipped: `manuscripts.py` (V1-hidden); the
  orchestrator paper/PDF/save endpoints (need service typing first);
  `/billing/usage/export` (StreamingResponse).
* **Playwright suite green** (commit `d15a251`) — 0/460 failures down
  from 67. 76 skips: V1-hidden routes (App.tsx V1Gate), backend-pending
  write-flows (test.fixme), one stale Settings billing assertion.
  Real-bug fixes shipped along with the test cleanup: `/agents-chat-mode`
  route registered in `App.tsx`/`Layout.tsx`; AgentsChatMode header now
  renders as `<h2>` for a11y; CitationManager consumes-and-cleans
  `?q=` / `?add=1` / `?import=1`.

---

## Outstanding — Tier 1 (autonomous, high-leverage)

### A1. response_model coverage sweep — DONE (commit `a94afda`)
* See "Tier-1 follow-up" above. Remaining gap is the heavy paper/
  PDF/save orchestrator endpoints + manuscripts.py (V1-hidden).

### A2. GenomicsAnalysis.tsx react-refresh split — DONE (commit `b2fa446`)
* Moved the 4 `_compute*` helpers to `frontend/src/pages/genomics/compute.ts`.
  Project-level eslint warnings dropped 11 → 7 (the 4 GenomicsAnalysis
  hits cleared exactly as predicted). GenomicsAnalysis.tsx 596 → 414
  lines. No behaviour change.

### A4. Hooks-deps risk-fix sweep — DONE (commit `90bcb56`)
* All 7 remaining react-hooks/exhaustive-deps warnings closed (→ 0).
  Three were real stale-closure bugs (KnowledgeGraph connect-mode
  rendering from stale state, AgentsChatMode save flow, ProjectDetail
  research-paper save). Two were stable-ref cleanups (palette taxonomy
  + unused `library` dep in Workstation). Two were intentional
  suppressions with explanation (forward-ref TDZ avoidance, guard
  pattern).

### A2. GenomicsAnalysis.tsx react-refresh split
* 4 of the remaining 11 frontend lint warnings are here. The file
  exports 4 section components (Variants, Expression, Pathway,
  Drug) plus shared constants from one .tsx file.
* Approach: split into per-section files
  `pages/genomics/{Variants,Expression,Pathway,Drug}.tsx` plus a
  shared `pages/genomics/constants.ts`. Keep `GenomicsAnalysis.tsx`
  as the orchestrator/router.

### A3. Round 5: Neo4j → pgvector + Postgres relations refactor
* ~3 days of work. Removes Neo4j from the deploy entirely.
* **Plan written and committed** (`136beb9`) at
  `docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md`. 5-phase reversible
  migration: (1) add PostgresGraphStore alongside Neo4j + migration
  023 for VECTOR(1024) embedding column on `knowledge_graph_nodes`,
  (2) dual-write + backfill, (3) flip reads behind `KG_BACKEND` flag,
  (4) stop writing to Neo4j, (5) remove from compose / Terraform.
* Schema: pgvector for embeddings (already present), existing
  `knowledge_graph_nodes` / `knowledge_graph_edges` Postgres tables
  in `app/models/platform_entities.py` are the right shape — the work
  is purely service-side (swap Cypher for SQLAlchemy queries +
  recursive CTE for pathfinding).
* Touch: `app/knowledge/graph_store.py` (649 lines),
  `app/services/kg_first_service.py` (835 lines),
  `app/services/neo4j_population_service.py` (1560 lines), ~10
  callers, deploy IaC. See plan for the per-phase file lists.
* Test rewrites needed; `tests/test_knowledge_graph_*` audit per
  Phase 3 of the plan.

### A4. Hooks-deps risk-fix sweep
* 7 `react-hooks/exhaustive-deps` warnings remaining (down from 18).
* Each needs per-warning judgment — adding a dep can cause render
  loops if it's a fresh reference each render.
* Approach: per-warning, decide between (a) `useCallback` the
  missing dep at the call site, (b) move the dep into a stable
  ref, or (c) suppress with explicit `// eslint-disable-next-line`
  and a comment explaining why.

### A5. Backend perf tuning of `query_all`
* 62 sources at concurrency=12 = ~6 batches. Profile with real
  network calls (needs LLM creds + outbound) and identify slow
  per-source rate limits.
* NCBI allows 10 req/s with API key (currently 3); EuropePMC,
  CrossRef similar. Per-source rate-limit bumps could yield a
  meaningful latency reduction.
* Touch: `app/services/data_sources.py` per-class `_rate_limit()`
  methods.

## Outstanding — Tier 2 (autonomous, medium-leverage)

### B1. Local Playwright screenshot harness
* Phase 5 of the audit plan. Generate per-persona screenshots
  (Trial / Researcher / Lab / Institution) of every page +
  pixel-diff against a baseline.
* Setup: `npx playwright install` + a config under
  `frontend/e2e/` + a CI workflow that runs locally only (the user
  wanted local-only, not GitHub Actions).

### B2. Bundle-size audit
* Frontend bundle is unknown size. Run `npx vite-bundle-visualizer`
  or equivalent. Likely candidates for code-split: GSAP (only used
  on landing pipeline reveals), Framer Motion, Plotly.
* Outcome: lazy-loading map identifying what's eagerly imported
  but only used in one route.

### B3. Press kit page (`/press`)
* `landing/src/app/press/page.tsx`. Logos, screenshots, founder
  bios (gated on user-blocked item 5 above), product video embed
  (when produced).

### A5. Backend perf tuning of `query_all` — DONE (commit `54d1cf6`)
* Surfaced TWO real bugs in PubMedSource (and 3 NCBI-backed
  siblings: ClinVar, RefSeq, GeneCards): `getattr(settings,
  'NCBI_API_KEY', ...)` was looking at a field that never existed
  (the actual setting is `PUBMED_API_KEY`), so the API key was
  never sent — every NCBI hit ran at the no-key tier permanently.
  And `PUBMED_RATE_LIMIT=10` was wired in config but never read.
  Both fixed; new `_pubmed_api_key()` helper unwraps the SecretStr.
  EuropePMC rate-limit bumped 3 → 10 req/s (polite-pool default).
  No-key path still falls back to 3 req/s for safety.

### B2. Bundle-size audit — DONE (commit `03d3981`, partial)
* compute-lab children (Workstation/MonteCarloPanel/EquationPlotter)
  lazy-loaded — initial bundle dropped ~5 MB (the plotly dist). The
  per-test 60 s timeout band-aid in visual-screenshots is gone;
  /compute-lab now passes in ~24 s within the default 30 s. Other
  large chunks flagged: `extends` (721 KB unnamed vendor),
  ProjectWorkspace + ProjectKnowledgeGraph already lazy-routed.
  Remaining pass over the initial 2 MB main bundle deferred.

### B4. Onboarding flow / first-run experience — DONE (commit `3a97a4e`)
* Migration 022 added `users.has_completed_onboarding` (TRUE for legacy
  rows, FALSE for new signups). PATCH /me accepts the flag.
  Onboarding.tsx renders a modal 3-step wizard (create-project →
  upload-corpus → first-discovery) gated on `user.has_completed_onboarding
  === false`. Surfaced + fixed a separate gap: AuthProvider was
  defined but never wrapped around <App/>; main.tsx now wires it.

### B5. Mobile responsiveness review
* The desktop app is the primary surface but the landing site +
  /provenance / /atlas / /pricing read-paths should work on mobile.
* Audit each landing page at 375px wide, fix obvious overflow /
  illegible text issues.

### B6. Real-time collaboration on notebooks
* Currently single-user. Lab tier marketing claim is multi-user
  shared notebooks; not built.
* Approach: WebSocket-based CRDT (Yjs probably) layered over the
  TipTap editor. Backend persists final state on idle.

### B7. Quote-level grounding
* Currently we verify the citation exists + title matches. Don't
  yet verify the cited *passage* says what we claim.
* Deferred in `/provenance`. Implementation: extract cited
  paragraph from PDF / OA fulltext, feed to LLM with the claim,
  classify as supporting / neutral / contradicting.

## Outstanding — Tier 3 (gated on backend running)

### C1. Phase 3 backend endpoint runtime audit
* Hit every endpoint with a real DB + JWT, validate response shape
  matches OpenAPI, validate ownership filtering. Static audit
  already done; runtime adds the dynamic check.

### C2. Phase 4 pipeline e2e
* `tests/integration/test_pipeline_e2e.py` exists but skipped
  without LLM creds. Run it against staging once bootstrap lands.
* Validates: 12 stages run end-to-end, citation roundtrip
  produces real DOIs, audit log gets written, hash chain stays
  intact.

### C3. Phase 6 auth + billing + tenant runtime audit
* Real Stripe webhook events fired against staging; verify
  signature path + idempotency + tier transitions land correctly
  on `users.tier`.

### C4. Phase 9 load testing
* Locust or k6 against staging. Targets: p99 < 2s on read
  endpoints, p99 < 30s on a discovery start (long-poll → WS).

### C5. Phase 10 final UAT + ship readiness
* Run-book exercises: incident response, backup-restore, secret
  rotation, key compromise.
* Sign-off checklist from `docs/planning/PRODUCTION_AUDIT_2026-05.md`.

## Pure documentation gaps

* `DEVELOPMENT.md` at repo root — local setup, npm/pip versions,
  env file template, common commands. The Makefile help text is a
  start; codify into prose.
* `OPERATIONS.md` — incident response runbooks, deploy procedures,
  secret rotation, restore-from-backup walkthrough.
* `BENCHMARKS.md` — once Phase 9 load tests run, capture the
  numbers. Right now /provenance and pricing claim performance
  numbers ("100% citation roundtrip on launch") that we should
  back with a published benchmark.

## File map — where things live

```
app/core/ownership.py                              tenant-isolation helpers
app/core/auth.py                                   JWT + WebSocket auth
app/services/audit_service.py                     Merkle hash chain
app/services/data_sources.py                      62-source registry
app/services/budget_enforcer_service.py           per-tier compute cap
app/services/stripe_service.py                    webhook signature + apply
app/api/v1/endpoints/hypothesis_trace.py          /trace + /audit-log
app/api/v1/endpoints/data_sources.py              /query + /health + /stats
app/api/v1/endpoints/billing.py                   Stripe checkout + webhook
app/api/v1/endpoints/monitoring.py                /health/full
app/models/platform_entities.py                   12 owner_id-scoped models
app/models/hypothesis.py                          Hypothesis + EvidenceReference
app/models/evidence.py                            Evidence (source rows)
migrations/versions/021_owner_id_on_platform_entities.py
                                                  tenant gap closure migration

frontend/src/services/api.ts                      typed API client
frontend/src/components/HypothesisTrace.tsx       per-claim citation UI
frontend/src/components/AuditLogViewer.tsx        Merkle log replay modal
frontend/src/contexts/{AuthContext,useAuth,auth-context-internal}
                                                  the 3-file split
frontend/src/pages/ProjectDetail.tsx              hosts trace + audit modals

landing/src/app/status/page.tsx                  /api/v1/health/full reader
landing/src/app/{manifesto,pricing,privacy,terms,docs,atlas,provenance}
                                                  the editorial pages
landing/src/components/Colophon.tsx              footer with status link

scripts/verify-action-shas.py                     SHA-pin reality check
scripts/install-actionlint.sh                     local actionlint installer
.github/workflows/verify-action-shas.yml          PR-time SHA validation
.github/workflows/actionlint.yml                  PR-time workflow contract
Makefile                                          consolidated dev commands
docs/planning/SECURITY.md                         threat model + auth + ops
docs/planning/CI_GOTCHAS.md                       7 documented CI failures
docs/planning/TENANT_ISOLATION_GAP.md             closed
docs/planning/SOURCES_ROADMAP.md                  62-source roadmap
CHANGELOG.md                                      per-commit engineering log
```

## Recommended order for the next session

If picking up cold, I'd run them in this order:

1. **A1 response_model coverage** (1 day) — biggest visible
   contract win, pure backend, no risk.
2. **A2 GenomicsAnalysis split** (~2 hours) — closes the remaining
   fast-refresh warnings.
3. **A4 hooks-deps risk fixes** (~3 hours) — cleans the lint signal.
4. **B4 onboarding flow** (1 day) — biggest UX win pre-launch.
5. **B2 bundle-size audit** (~3 hours) — informs whether (3-day)
   code-splitting work is needed before launch.

Tier 3 work blocks until backend bootstrap; Tier 2 B1 / B6 / B7 are
multi-day and should land after the smaller wins.

## How to extend this file

When you finish work, move items from "Outstanding" to "What was
completed this session" with a one-line summary + commit SHA.
Touch the **Last commit** header at the top. Don't let it drift —
this doc is the single source of truth for "where we left off."

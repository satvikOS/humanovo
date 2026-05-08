# Changelog

Engineering log of production-readiness rounds. Each entry is a single
commit and corresponds to a self-contained bundle of work. Pre-launch -
no semver yet, no public release schedule. The goal of this file is
project continuity: a future engineer (or a future agent session)
should be able to read this file and reconstruct what's been audited,
what's been fixed, and what's deliberately left as follow-up.

## 2026-05-08 — Round 11 commit 3: AuthContext react-refresh split

* `AuthContext.tsx` previously exported both a component
  (`AuthProvider`) and a hook (`useAuth`), which violates React
  Refresh's "components-only" rule and produced a fast-refresh
  warning that broke hot-reload during development.
* Split into three files:
    - `contexts/auth-context-internal.ts` — the bare `createContext`
      object + the value type. Internal; consumers don't import this
      directly.
    - `contexts/useAuth.ts` — the `useAuth()` hook.
    - `contexts/AuthContext.tsx` — `AuthProvider` only (the
      component file now satisfies the React Refresh rule).
* Three call sites migrated to `import { useAuth } from
  '../contexts/useAuth'`: `RequireAuth.tsx`, `Login.tsx`,
  `Signup.tsx`.
* eslint warnings: 12 → 11 (the fast-refresh warning on
  AuthContext.tsx is gone). The remaining 4 fast-refresh warnings
  are all in `pages/GenomicsAnalysis.tsx`, deferred to a future
  split (one file ships four section components plus shared
  constants - bigger refactor).
* tsc clean. No behaviour change for any caller.

Commits: bundle to be created.

## 2026-05-08 — Round 11 commit 2: public status page

* New `/status` route on the landing site (`landing/src/app/status/
  page.tsx`). Reads `/api/v1/health/full` (shipped earlier this
  session) every 30s, renders DB + vector_store + billing config +
  62-source liveness summary in the same Renaissance editorial
  register as `/manifesto` / `/provenance`.
* Headline status is colour-coded: rust for `healthy`, gold for
  `degraded`, deep red for `unhealthy`, ink-3 for `unknown`. The
  page falls back gracefully when the API is unreachable - shows
  the network error and continues retrying.
* `Colophon.tsx` adds a Status link between Provenance and Privacy.
* `docs/page.tsx` Chapter XVI flipped from "in-progress" to
  "shipped" and the body rewritten to point at the new route.
* API base URL configurable via `NEXT_PUBLIC_HUMANOVO_API`; defaults
  to `https://api.humanovo.net`.
* `next build` passes with all 11 routes prerendered (was 10).

Commits: bundle to be created.

## 2026-05-08 — Round 11 commit 1: trace UI wired into ProjectDetail

* Closes the deferred integration from Round 10 commit 3. Per-paper
  rows in `ProjectDetail.tsx` now expose a clock icon button between
  Regenerate and Remove that opens a modal hosting `HypothesisTrace`.
* `HypothesisTrace`'s `onOpenAuditLog` callback surfaces
  `AuditLogViewer` on top of the trace modal (nested-modal pattern):
  user goes from the paper row to the citation chain to the
  Merkle-anchored event log without leaving the page.
* New state in ProjectDetail: `traceHypothesisId` +
  `auditLogHypothesisId`. Modal close reverts cleanly; the
  AuditLogViewer overlay sits z-50, the trace modal z-40.
* tsc clean. ESLint 0 errors on ProjectDetail.tsx (pre-existing
  hooks-deps warning on `_saveResearchPaper` unchanged).

Commits: bundle to be created.

## 2026-05-08 — Round 10 commit 3: frontend trace UI + audit log viewer

* `services/api.ts` adds two API client methods + four TypeScript
  interfaces backing the Round 10 commit 2 endpoints:

      api.getHypothesisTrace(id) -> HypothesisTraceResponse
      api.getHypothesisAuditLog(id, params?) -> AuditLogResponse

  Types: `CitationVerificationStatus`, `CitationChainEntry`,
  `HypothesisTraceResponse`, `AuditLogEntry`, `AuditLogResponse`.

* `components/HypothesisTrace.tsx` — per-claim citation chip UI.
  Renders one row per CitationChainEntry with a colour-coded status
  pill (verified / unsupported / retracted / unknown), the cited
  paper's title, DOI/PMID/URL link-out, relevance score, and the
  passage snippet. Shows `N of M citations verified` summary at the
  top + a "Replay audit log" button that surfaces the parent
  AuditLogViewer.

* `components/AuditLogViewer.tsx` — Merkle-anchored event log modal.
  Top-line integrity banner (green if `chain_intact`, red with
  issue count otherwise), chronological table with sequence /
  timestamp / event_type / action / duration / cost / truncated
  record hash. Full hash + previous_hash exposed on hover for
  byte-for-byte verification against an external snapshot.

* Both components are self-contained and read-only - no edit /
  replay-execute paths. They render the /provenance promise
  ("every citation passes a roundtrip" + "every event is in a
  tamper-evident log") as actual UI a researcher can click through.

* ProjectDetail.tsx integration deferred - the two components are
  standalone-renderable and the integration point (per-hypothesis
  drill-down panel? a dedicated /provenance/{id} route?) needs a
  UX decision before wiring. The components are ready to attach the
  moment that decision lands.

* tsc clean. eslint clean on the two new components + the api.ts
  diff. No new lint warnings.

Commits: bundle to be created.

## 2026-05-08 — Round 10 commit 2: hypothesis trace + audit-log replay endpoints

* New `app/api/v1/endpoints/hypothesis_trace.py` registers two
  product-surface routes that turn the marketing claims on
  `/provenance` into real APIs:

  - `GET /api/v1/hypotheses/{id}/trace` — per-claim citation chain
    walking `evidence_refs` for the hypothesis, returning each linked
    Evidence row as a `CitationChainEntry` with title / DOI / PMID /
    URL / publication_date + `(citation_verified, verification_status)`
    pair (`verified` / `unsupported` / `retracted` / `unknown`).
    Eager-loads via `selectinload` to avoid N+1 round-trips.

  - `GET /api/v1/hypotheses/{id}/audit-log` — Merkle-anchored event
    log replay. Filters AuditRecord by `resource_id == hypothesis_id`,
    runs the existing `AuditService.verify_chain()` on the loaded
    subset, and returns each entry plus a top-level `chain_intact`
    boolean + `chain_issues` list for tamper-evidence rendering.

* Both endpoints route through `fetch_owned_or_404` (the parent
  Project must be owned by the caller). Cross-tenant access returns
  404 — same pattern as the rest of the project-scoped CRUD surface.

* Pydantic v2 schemas with `model_config = ConfigDict(from_attributes=True)`
  for ORM-row interop.

* New `tests/test_hypothesis_trace_smoke.py` (4 tests, all passing
  offline) verifies router registration + schema instantiation +
  the `_classify_verification` heuristic.

* Round 6 phase 5 sweep evaluated: the remaining ~70 swallowed-
  exception sites in `app/compute/*` are all graceful-degradation
  paths (math fallbacks for sphericity / GLCM texture, KDE
  estimation in plots) where silent-pass is the correct behaviour.
  Adding `logger.debug` to math fallbacks would just be noise. No
  changes shipped.

Commits: bundle to be created.

## 2026-05-08 — Round 10 commit 1: tenant-isolation gap closed

* Migration 021_owner_id_on_platform_entities.py adds `owner_id UUID`
  + FK + index to 12 platform-shared tables (clinical_trials,
  biobank_samples, storage_locations, irb_submissions,
  data_use_agreements, consent_forms, compliance_checklists,
  ml_models, imaging_studies, manuscripts, research_datasets,
  saved_analyses). Idempotent — re-runnable after partial
  application.
* ORM models updated to declare owner_id via a shared helper.
* New helpers in app/core/ownership.py:
  - `fetch_owned_directly_or_404` for models with a direct owner_id
  - `filter_by_owner` for list-endpoint WHERE clauses
* ~50 endpoints across biobank, clinical_trials, regulatory,
  ml_models, imaging, manuscripts, datasets, statistics rewired:
  list filters by owner_id; create sets owner_id=current_user.id;
  R/U/D routes through fetch_owned_directly_or_404 (404-not-403 on
  cross-tenant).
* TENANT_ISOLATION_GAP.md status flipped from open → closed
  (pending production migration apply).

Commits: bundle to be created.


## 2026-05-08 — fix(ci) actionlint -color flag + CI_GOTCHAS.md catalogue

* `actionlint -color always` invocation made actionlint treat
  `always` as a workflow-file path argument (the flag is a boolean,
  not a string-valued option). Fixed to `actionlint -color`.
* New `docs/planning/CI_GOTCHAS.md` records every CI failure we've
  hit, the root cause, and the durable fix. Seven entries to date:
  hallucinated SHA, ref-name-as-config, cache 400, annotated-tag
  SHA vs commit SHA, hallucinated runner label, download-script
  mkdir, boolean-flag mistaken argument. Future agent sessions
  should check this file before re-deriving a fix from a runner
  log.
* SECURITY.md cross-references CI_GOTCHAS.md under § Build pipeline
  ▸ workflow contract.
* `Makefile` gains `make ci-full` (CI suite + landing build) and the
  help text reflects the new target.

Commits: bundle to be created.

## 2026-05-08 — fix(ci) actionlint mkdir + windows-2025 revert + Makefile

* `actionlint` workflow was failing because the `download-actionlint.bash`
  script requires the target dir to exist before it'll write to it.
  Fixed by `mkdir -p` ahead of the call, plus moved the download
  destination to `$RUNNER_TEMP` (cleaner than `/tmp` on Windows
  runners) and added `--retry 3` to the curl in case the raw.github
  endpoint is briefly unavailable.
* Ran actionlint locally against every workflow. One finding:
  `windows-2025-vs2026` was an unknown runner label (actionlint's
  database hasn't picked up GitHub's 2026-05-12 transitional alias).
  Reverted to bare `windows-2025` — the redirect on May 12 will carry
  the build to the new VS-2026-bundled image automatically, and Tauri
  is toolchain-version-tolerant. Comment on the matrix row explains.
* New top-level `Makefile` consolidating local dev commands:
    `make lint`        - ruff + tsc/eslint + actionlint + verify-shas
    `make test`        - pytest (offline-tolerant)
    `make format`      - ruff --fix + eslint --fix
    `make ci`          - everything CI runs, in order
    `make ci-actions`  - workflow-only checks
  Per-tree targets surface the underlying tool: `lint-backend`,
  `lint-frontend`, `lint-actions`, etc. Single canonical place that
  knows what CI sees, so a dev running `make ci` locally gets the
  same signal a PR will get.
* `scripts/install-actionlint.sh` for one-shot local install of the
  pinned v1.7.9 binary into `~/.local/bin`. Keeps the version in
  lockstep with `verify-action-shas.yml`.

Commits: bundle to be created.

## 2026-05-08 — fix(ci) rust-toolchain ref-name + actionlint + SECURITY update

* `dtolnay/rust-toolchain@<sha>` was failing every Tauri build leg
  with `error: invalid toolchain name ''`. Root cause: the action
  reads its channel (`stable` / `nightly`) from the ref name, not a
  `with:` input. SHA-pinning replaced the ref with a hash, so the
  channel inference fell through to an empty string. Fixed by adding
  `with: toolchain: stable`.
* New `.github/workflows/actionlint.yml` runs actionlint on every PR
  that touches a workflow file. Catches input/expression mistakes
  the SHA verifier doesn't see (invalid action inputs, malformed
  matrices, shell-injection in `run:` interpolating
  `${{ github.event.* }}`, the ref-name-as-config gotcha).
* Audit: of the 13 SHA-pinned third-party actions, only
  `dtolnay/rust-toolchain` reads config from the ref name. All
  others take their config from `with:` inputs and are
  SHA-pin-safe. Documented in SECURITY.md § Build pipeline.
* `SECURITY.md` updated with the SHA-pinning gotcha + the
  `actionlint` audit layer.

Commits: bundle to be created.

## 2026-05-08 — CI fix + Node 20 deprecation + windows alias + SECURITY.md

* Fixed three failing native-build jobs caused by a hallucinated
  `tauri-apps/tauri-action` SHA. Pinned to `action-v0.6.2`
  (`84b9d35b...`).
* Bumped 35 GitHub Actions references across 15 workflows to v6 SHAs:
  `actions/{checkout,setup-node,setup-python,upload-artifact,
  download-artifact}`, plus `Swatinem/rust-cache` to v2.9.1
  dereferenced commit. Removes the Node-20 deprecation warning and
  the cache-service 400 error caused by the v5-bundled cache
  backend.
* Pinned the Windows runner explicitly to `windows-2025-vs2026` so
  the May-12 alias flip from `windows-2025` doesn't change the
  toolchain mid-build.
* `scripts/verify-action-shas.py` upgraded: tracks
  `NODE20_DEPRECATED_SHAS` and surfaces a warning row when any
  workflow still pins a deprecated SHA. New `--strict-deprecations`
  flag turns warnings into a non-zero exit.
* Wrote `docs/planning/SECURITY.md` — threat model, identity/auth,
  tenant isolation, secrets handling, Stripe hardening, build
  pipeline, incident response, compliance posture. Living document.
* This file: `CHANGELOG.md` for project continuity.

Commits: bundle to be created.

## 2026-05-08 — fix(ci) tauri-action + 4 production stages

* `tauri-apps/tauri-action@2a55bea...` was a hallucinated SHA from
  an earlier session. Replaced with `action-v0.6.2` (`84b9d35b...`),
  validated against the live commit endpoint.
* `windows-latest` → `windows-2025` (later → `windows-2025-vs2026`).
* Audited all 13 SHA-pinned third-party actions; 13/13 valid.
* Wrote `scripts/verify-action-shas.py` + `verify-action-shas.yml`
  workflow. Runs on every PR touching `.github/workflows/`, on push
  to humanovo/main, and nightly at 13:17 UTC. Future hallucinations
  fail at PR-time.
* Stripe webhook idempotency: 4096-entry in-process LRU keyed on
  `event["id"]`. Short-circuits Stripe's 3-day retry storms.
* New `GET /api/v1/health/full` aggregate endpoint: DB +
  vector_store status, Stripe-configured flag, 62-source liveness
  summary, version + timestamp. Reads the in-memory liveness cache;
  no outbound probes.

Commit: `6d6baf5`.

## 2026-05-08 — WebSocket + Round 6.4 + frontend hooks + concurrency + smoke

* WebSocket auth audit: all 10 endpoints (`ws_streaming.py`,
  `websocket.py`, `ingestion_ws.py`, `orchestrator.py`) confirmed
  to call `authenticate_websocket()` before any data exchange.
  Pattern is correct.
* Round 6 phase 4: 7 swallowed-exception sites converted to
  structured logging in `document_export_service.py`,
  `citation_verifier.py` (3), `preprint_agent.py` (2),
  `pubmed_agent.py`.
* Frontend hooks-exhaustive-deps: 18 → 12 lint warnings. Three safe
  fixes applied: `Notebook.tsx` (unnecessary `pageIndex` dep),
  `ProjectDetail.tsx` (`loadProject` now `useCallback`),
  `Projects.tsx` (explicit eslint-disable on mount-only effect).
* `query_all` default concurrency 5 → 12. ~2x latency reduction at
  the orchestrator level for the 62-source query without raising
  per-source pressure (each source has its own RateLimiter).
* New `tests/test_data_sources_registry.py`: 11 unit tests verifying
  the 62-source registry is structurally healthy (count, phase
  partition, base-class inheritance, instantiation, metadata,
  category vocabulary). All 11 pass.
* `tests/conftest.py` `_ensure_schema` fixture no longer hard-fails
  when Postgres is unreachable — warns and continues. Pure unit
  tests run offline; DB-dependent tests still fail with their own
  targeted errors.

Commit: `9ae07ce`.

## 2026-05-08 — Phase 6 tenant audit + ruff + tenant-gap doc + frontend lint + sources health

* Phase 6 audit: 2 cross-tenant bugs fixed
  (`/v1/user/{user_id}/budget` and `/v1/kg/*` accepted any user_id
  with no ownership check). New `_ensure_self_or_admin` helper
  raises 404 (not 403) on cross-tenant access. Plus 39 mutating
  endpoints on platform-shared models (BiobankSample,
  ClinicalTrial, IRBSubmission, MLModel, ImagingStudy, Manuscript)
  flagged for follow-up — they need `owner_id` columns.
* `docs/planning/TENANT_ISOLATION_GAP.md` documenting the
  follow-up; gated on backend bootstrap.
* 168 ruff errors in `migrations/` + `lambda/` cleaned (103 auto-fix,
  65 E402 in lambda handlers acknowledged with per-file
  `# ruff: noqa` for the intentional cold-start tag pattern).
* Frontend lint: 18 → 15 warnings (3 fixed: Dashboard unused
  directive, computeEngine dead `radius`, MonteCarloPanel
  documented `_runHistory`).
* `GET /api/v1/data-sources/health` per-source liveness endpoint;
  reads `_LAST_SUCCESS_AT` / `_LAST_ERROR_AT` caches populated by
  `DataSourceBase._safe_search`. Fixed the hardcoded
  `sources_queried=65` bug (now uses
  `len(orchestrator._sources)`).

Commit: `f550241`.

## 2026-05-08 — Pydantic v2 + UUID typing + Round 6.3 + migration idempotence

* Pydantic v1 `class Config:` → v2 `model_config = ConfigDict(...)`
  in `saved_papers.py` + `project_documents.py`. Deprecation
  warnings silenced.
* Phase 3 endpoint audit: 142 UUID-typing fixes across 22 endpoint
  files. Path params named `*_id` now resolve to `: UUID` so
  FastAPI returns 422 (not a downstream asyncpg error) on bad
  input.
* AUTH_REQUIRED audit: 5 routers without router-level
  `AUTH_REQUIRED` reviewed; all 5 confirmed correct
  (`billing.py` webhook needs to be public; WebSocket files use
  `authenticate_websocket()`; `monitoring.py` /health is
  intentionally public for LB probes).
* Round 6 phase 3: 8 lambda swallowed-exception sites converted
  to structured logging.
* 13 skipped tests verified as intentional environment-conditional
  skips (no LLM creds, no skimage, no live API host).
* Migrations 014, 017, 018 hardened with `IF NOT EXISTS` /
  `IF EXISTS` guards for safe re-run after partial application.

Commit: `0726017`.

## 2026-05-07 — Round 4f + Round 8 phase 2

* `ProjectDetail.tsx` and `Projects.tsx` drained off localStorage
  (`project-documents` key + IndexedDB blob shards) onto the
  `/api/v1/project-documents` API. DocumentViewer now streams
  blobs directly via `api.getProjectDocumentContent(id)` instead
  of a base64 round-trip — saves ~3x memory on large PDFs.
* `ACTIVE_SOURCES` expanded 21 → **62** (all four phases active by
  default in `DataSourceOrchestrator`). Each source's
  `_safe_search` wraps the network call in try/except so a single
  source failing surfaces as `error: ...` without blocking the
  others.
* Bug fix: `/api/v1/data-sources/query` was passing `disease=` to
  `orchestrator.query_all()` which doesn't accept that kwarg —
  silent TypeError on the no-categories no-sources branch. Disease
  context now prepends to the query string.
* Landing stats updated: "26 biomedical APIs" → "36" (Round 8.1) →
  "62" (Round 8.2).

Commit: `08fb0e6`.

## 2026-05-07 — Landing audit + Round 6.2 + Round 8.1 + ORM audit

* Landing user-feedback fixes: glyph swapped for the platform
  peanut/dumbbell mark, GitHub link removed (proprietary not OS),
  4 editorial colophon blocks (Plates / Composed at / Masthead /
  Acknowledged) removed, replaced with slim utilitarian footer.
  Pricing scrubbed of cost-and-margin reveal. PageTrust
  "Advised by..." block removed entirely. Casual phrasing
  replaced.
* Round 6 phase 2: 8 swallowed-exception sites converted in
  `synthesis_pipeline`, `orchestrator`, `integrations.base`,
  `etl.bulk_loader`, `ingestion.sources`,
  `clinical_trials_agent`.
* Round 8 phase 1: ACTIVE_SOURCES = PHASE_1 + PHASE_2 (36
  sources). Phase 3 / 4 opt-in via explicit source_names.
* ORM/migration audit: 49/49 tables aligned. Two false-positive
  flags resolved (`activities` created via raw SQL in 011,
  `audit_records` lazy-loaded from `app/services/audit_service`).

Commit: `0cf36f1`.

## Earlier rounds

See `git log` for detail. High-level rounds shipped pre-this-session:

* **Foundation cleanup** (`c5077e9`): 361/361 tests green.
* **Jamison rebrand** (`ae81ffb`): codename → neutral language.
* **CORS / heredoc / ruff sweep** (`3c2d3c7`).
* **Round 4 a-e**: citation API, saved papers, project documents
  backend, localStorage drain (frontend partial).
* **Landing v1-v3**: zip extract, Fortune-100 design pass, editorial
  layer, ink-drying / wordmark / marginalia, /provenance brief.
* **Round 6 phase 1**: 20+ swallowed-exception sites in
  user-facing API surface.
* **Round 7 strict ruff**: ~300 lint errors → 0.
* **Round 9**: rename `genup-*` → `humanovo-*` + SHA-pin GitHub
  Actions.

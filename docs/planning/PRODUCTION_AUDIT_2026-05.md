# humanovo — Day-1 Production Readiness Audit & 27-Day Sprint Plan

**Date**: 2026-05-04 (updated 2026-05-05)
**Branch**: `claude/production-platform-analysis-30H5c`
**Audience**: founder + engineering leads
**Scope locked in (Day-1 Q&A)**:
- v1 user: academic biomedical researchers (PhDs, postdocs, PIs)
- Packaging: native apps only — Tauri (Win/macOS/Linux) + iOS native (no humanovo.com browser product)
- Work mode: audit + plan first, then checkpointed sprints
- Launch posture: closed beta May 26-31 → public launch mid-June (revised from "public launch May 31" — rationale below)
- **Cloud strategy (locked 2026-05-05)**: three new clouds — AWS (full Org, Bedrock for Claude/Cohere/Nova), Azure (AI Foundry hub, 8 model deployments for the swarm), GCP (single project, `gemini-3-pro-image` only for 4K-8K publication-grade figures). See `MULTI_CLOUD_AGENT_ARCHITECTURE.md` for the full design.
- **Pricing tiers (locked 2026-05-05)**: B2B from day one — Trial (3 hyp + 1 paper free) → Researcher $20/mo → Lab $200/mo → Institution custom. Real-time Stripe top-ups (Anthropic/OpenAI-style prepaid credits).
- **Auth (locked 2026-05-05)**: email + Google OAuth + Apple OAuth; tokens in OS keychain; native apps only.

This doc is the source of truth for the production push. Each sprint will append a checkpoint section as it closes.

**Companion docs that this one references**:
- `MULTI_CLOUD_AGENT_ARCHITECTURE.md` — swarm-per-stage design, lane pools, cross-cloud failover, model selector, figure-gen QA/QC pipeline
- `KG_GOVERNANCE.md` — 4-layer KG model, Common KG promotion gates, HIPAA enforcement, downvote-quarantine
- `CREDENTIALS_HANDOFF.md` — exact cloud-signup steps + GitHub Actions Secret names per cloud
- `CREDENTIAL_POOL_DESIGN.md` — lane-pool primitives (still valid; extended in MULTI_CLOUD doc)

---

## 0. Executive verdict

The platform is feature-rich (35 routes, 12-stage adversarial LLM pipeline, ~13 confirmed integrations, 274 backend tests, 380 Playwright specs across 32 files, 28 visual-regression pages) but configured as if every user is an internal researcher with a trusted laptop. Three risk axes intersect:

1. **IP**: full system prompts (`backend/app/agents/prompts.py:768-1239+`) plus pipeline architecture in README plus stage names rendered in the UI plus the SSE stream emitting raw stage names. Anyone with the repo (or a logged HTTP trace) has the recipe.
2. **AuthN/Z**: `HTTPBearer(auto_error=False)` (`backend/app/core/auth.py:34`), default `SECRET_KEY="change-this-in-production"` (`backend/app/core/config.py:212`), 35+ unprotected endpoints, WebSockets fully open + no backpressure.
3. **Correctness coverage**: zero auth tests, zero integration-API smoke tests for the 13 data sources, zero export tests (PDF/DOCX/deck), zero error-recovery tests. Visual screenshots only on the frontend.

**Honest read on May 31**: a *full public commercial launch* by May 31 is not safely achievable without trading away large chunks of UX polish and test-gap closure. A *closed beta for vetted academic labs* by May 26-31 is achievable if we execute the plan below. **Recommended posture**: closed beta May 26-31 → public launch ~June 12 after one week of beta hardening. This decision is locked in for now; revisit at Sprint-3 checkpoint.

---

## 1. The 8 P0 blockers

Nothing else moves until these clear. Total budget ≈ 12 working days (Sprint 1).

| # | Blocker | Files | Why it kills launch | Effort |
|---|---|---|---|---|
| **P0-1** | System prompts checked into git — full 12-stage pipeline IP | `backend/app/agents/prompts.py:768-1239+` | Anyone with repo access (employee leak, misconfigured CI artifact, contractor) clones the moat in a weekend. | 2 days (move + history scrub) |
| **P0-2** | Auth is optional, not enforced | `backend/app/core/auth.py:34` (`auto_error=False`); 35+ endpoints lack `Depends(get_current_active_user)`: `endpoints/discovery.py:73`, `endpoints/projects.py:103`, `endpoints/hypotheses.py`, `endpoints/evidence.py`, `endpoints/knowledge.py`, `endpoints/agents.py`, `endpoints/admin.py:236`, all `endpoints/websocket.py` | Anyone hitting the API can spin up unlimited 12-stage pipeline runs (Bedrock + Azure cost bomb), read other users' hypotheses, listen to or spam WebSocket channels. | 3-4 days |
| **P0-3** | Default JWT/session secret | `backend/app/core/config.py:212` (`"change-this-in-production"`) and `infrastructure/terraform/main.tf:185` (predictable fallback `"genup-jwt-${env}-secret"`) | Token forgery / session hijacking. Cannot safely accept any logged-in user. | 0.5 day |
| **P0-4** | Error responses leak internals | `endpoints/discovery.py:100-102` (`str(e)` in 500 body); `main.py:113-138` (`/health` reveals service topology + error strings); SSE stream emits raw stage names + intermediate reasoning | Even with auth fixed, a single error leaks model names, stage names, provider names — same IP leak via runtime instead of repo. | 1 day |
| **P0-5** | Hardcoded DB creds in compose | `docker-compose.yml:10,42,69,128` (`humanovo:humanovo`, `neo4j/neo4jpassword`); `backend/scripts/seed_kg.py` literal fallback; `backend/app/core/config.py:38,48` literal defaults | If anyone runs the prod compose with these as-is, full DB compromise. | 0.5 day |
| **P0-6** | Sensitive artifacts in repo | `Speedrun.zip` (1.9 MB pitch deck + Cornell PDF + draft assets); `humanovo for Speedrun.pdf` (1.8 MB); `.terraform-outputs-dev.json` (live AWS infra IDs); `docs/planning/the v2 platform.md` (108 KB internal codename strategy doc); `docs/planning/Cormorant_Garamond.zip` (7 MB font bundle); `docs/planning/files.zip` (542 KB); `docs/planning/files (1).zip` (101 KB); `docs/planning/COMPETITIVE_POSITIONING.md`; `docs/planning/BENCHMARK_POSITIONING.md` | Investor materials, internal strategy, competitive positioning, and live infra IDs in source control. Existing clones already have them — history scrub needed. | 1 day (incl. history rewrite + key rotation) |
| **P0-7** | Stage names + legacy codenames leak | UI: `pages/Dashboard.tsx:552-553`, `pages/DiscoveryRunner.tsx:14`, `pages/HypothesisReview.tsx:160`. Infra: S3 buckets `genup-dev-frontend-…`, Terraform state `genup-terraform-state`, JWT prefix `genup-jwt-…`, Docker user `genup`, DynamoDB lock table `genup-terraform-locks` | "SEED/EXPAND/COUNTER/VALIDATE/GROUND/SCORE/REFINE/TRANSLATE" rebrandable in a day. "genup" is in AWS account names and would surface in any error or console screenshot. | 2 days |
| **P0-8** | Open WebSockets, no rate limit, no backpressure | `endpoints/websocket.py:108-265, 63-84` (`/ws/projects/{id}`, `/ws/tasks/{id}`, `/ws/simulations/{id}`, `/ws/global`) | DoS-trivial, broadcast amplification, listener tap on others' channels. | 1.5 days |

---

## 2. v1 feature cut list

35 routes today is too broad for a focused academic-researcher v1. Cut to ~18 + hide ~10 + delete ~7.

### Keep (v1 core — 18 routes)

| Route | Rationale |
|---|---|
| `/dashboard` | Landing surface |
| `/projects`, `/projects/:id` | Container; required |
| `/projects/:id/workspace` | Project hub. Audit flagged ROUGH — needs polish in Sprint 2. |
| `/projects/:id/discover` | The 12-stage pipeline runner — core differentiator |
| `/projects/:id/hypotheses/:hid` | Hypothesis review — core output |
| `/projects/:id/graph` | Per-project KG. Differentiator. |
| `/evidence` | Evidence manager |
| `/notebook` | Lab notebook (TipTap) — strong differentiator vs Jupyter |
| `/agents` | Chat with system. **Rename to `/assistant` and hide stage telemetry.** |
| `/timeline` | Project history |
| `/search` | Global search |
| `/settings` | Required |
| `/literature-review` | Researchers' workflow |
| `/citation-manager` | Researchers' workflow |
| `/data-manager` | Researchers need to upload datasets |
| `/data-visualization` | Differentiator (Plotly + 3D) |
| `/compute-lab` | Strong differentiator (Monte Carlo + equation plotting). `Workstation.tsx` is 8945 LOC — split before launch. |
| `/genomics` | Researchers want this; tested |

### Hide for v1 (keep code, gate behind feature flag — re-launch in v1.1)

| Route | Why hide |
|---|---|
| `/clinical-trials` | Read-only, useful, but secondary to academic researcher use case. Re-launch when MD-PhD/translational v1.1 hits. |
| `/anatomy` | Audit confirmed placeholder BP3D models (`Anatomy3DViewer.tsx:5,50-58`). Don't ship until real models. |
| `/imaging` | More clinical than academic. Defer to clinical v1.1. |
| `/biobank` | Specimen inventory — niche; biobanks have dedicated tools. |
| `/manuscripts` | Audit flagged ROUGH. Researchers use Overleaf/Word — ship when it's clearly better. |
| `/regulatory` | FDA/IRB compliance tracker — clinical/industry use case. Defer. |
| `/collaboration` | Audit flagged ROUGH. Not core to MVP. |
| `/ml-models` | Unclear scope — ship after pruning to a real use case. |
| `/experiment-tracker` | Niche; many labs already use Benchling. |
| `/workbench` | Audit flagged ROUGH (3825 LOC, silent error swallow at `pages/Workbench.tsx:2524`). |

### Delete (audit + remove code)

| Route | Reason |
|---|---|
| `/dev/pgvector` | Admin/dev surface in user routing (`App.tsx:138`). Move behind admin scope or delete. |
| `/knowledge-graph/viewer` | Duplicate of `/knowledge-graph`. Pick one. |
| `/hypotheses/:hid` (legacy) | Already redirected; consolidate. |
| Legacy `/simulations`, `/statistical-analysis`, `/numeric-compute`, `/matlab-compute` redirects | Working but cruft. Drop after a release cycle. |

### Backend endpoints to gate or remove

- `POST /admin/seed-*` (3 endpoints) — require admin role + IP allowlist; never just env-gate.
- `GET /api/docs`, `/api/redoc`, `/api/openapi.json` — gate behind `DEBUG`. Production users do not need OpenAPI.
- WebSocket `/ws/global` — confirm purpose; delete if not core.

---

## 3. Consolidated risk register

Severity scale: **P0** ship-stopper · **P1** must-fix before v1 · **P2** before public launch · **P3** post-launch

### Cybersecurity & auth
| Sev | Issue | Location |
|---|---|---|
| P0 | Auth is optional (`auto_error=False`) | `backend/app/core/auth.py:34` |
| P0 | Default `SECRET_KEY` | `backend/app/core/config.py:212` |
| P0 | Predictable JWT fallback in TF | `infrastructure/terraform/main.tf:185` |
| P0 | Open WebSockets, no rate limit, no backpressure | `endpoints/websocket.py:108-265` |
| P0 | Admin seed endpoints only env-gated | `endpoints/admin.py:203, 236, 331` |
| P1 | No SSRF allowlist on integration base | `backend/app/integrations/base.py` |
| P1 | No global rate limit | `backend/app/main.py` |
| P1 | No request size limit | `backend/app/main.py` |
| P1 | CORS S3 `*` | `infrastructure/terraform/modules/s3/main.tf:67` |
| P1 | DB ports exposed in compose | `docker-compose.yml` (5432/6379/7474/7687) |
| P2 | `dangerouslySetInnerHTML` on SVG without DOMPurify | `components/StrictPaperViewer.tsx:337` |
| P2 | Logs user medical query in plaintext | `backend/app/agents/controller.py:124` |
| P2 | Health endpoint reveals topology | `backend/app/main.py:113-138` |
| P2 | Neo4j Cypher: audit for parameterization | `backend/app/knowledge/graph_store.py` |
| P2 | No DLQ on Celery | `backend/app/core/celery*` |
| P3 | No soft-delete / audit trail on entities | `backend/app/models/` |

### IP / competitor protection
| Sev | Issue | Location |
|---|---|---|
| P0 | Full 12-stage prompts in git | `backend/app/agents/prompts.py:768-1239+` |
| P0 | SSE stream leaks raw stage names + reasoning | `endpoints/agent_chat_stream.py` (verify) |
| P0 | Investor / strategy materials in repo | `Speedrun.zip`, `humanovo for Speedrun.pdf`, `docs/planning/the v2 platform.md`, `docs/planning/Cormorant_Garamond.zip`, `docs/planning/files.zip`, `docs/planning/files (1).zip`, `docs/planning/COMPETITIVE_POSITIONING.md`, `docs/planning/BENCHMARK_POSITIONING.md` |
| P0 | Live AWS infra IDs in repo | `.terraform-outputs-dev.json` |
| P1 | Stage names rendered in UI | `Dashboard.tsx:552-553`, `DiscoveryRunner.tsx:14`, `HypothesisReview.tsx:160` |
| P1 | Pipeline architecture published in README | `README.md:37-50` |
| P1 | "genup" legacy codename in AWS infra | TF state bucket, S3 buckets, JWT prefix, Docker user, DynamoDB lock table |
| P2 | Error responses leak `str(e)` | `endpoints/discovery.py:100-102` |
| P2 | Hardcoded vendor list incl. paid sources (Elsevier/Springer/DrugBank) in README | `README.md:64-65` |

### Compliance & legal
| Sev | Issue | Location |
|---|---|---|
| P1 | No `LICENSE` file | repo root |
| P1 | No copyright headers in `.py`/`.ts`/`.tsx`/`.tf` files | repo-wide |
| P1 | No `THIRD_PARTY_LICENSES.md` for the 13 data integrations | repo root |
| P1 | Confirm ToS of public APIs (PubMed, ClinicalTrials, ChEMBL, etc.) — academic non-commercial vs commercial use | `backend/app/integrations/*` |
| P1 | Verify Cormorant Garamond font license (OFL) before bundling, then host on CDN | `docs/planning/Cormorant_Garamond.zip` |
| P2 | GDPR cookie/storage banner missing for EU researchers | frontend |
| P2 | No data-deletion / DSAR flow for users | backend |

### UI / UX
| Sev | Issue | Location |
|---|---|---|
| P1 | ~10 interactive divs without `role=button`/`tabIndex`/keyboard handler | `Evidence.tsx:901`, `Notebook.tsx:1034`, `MLModelManager.tsx:125`, `compute/Workstation.tsx:6079, 6430, 7515, 7797, 7845, 7859, 7869, 7884` |
| P1 | DataManager filter/sort inputs missing labels | `pages/DataManager.tsx` |
| P1 | Workbench library-fetch error swallowed silently | `pages/Workbench.tsx:2524` |
| P1 | DataVisualization chart errors swallowed | `pages/DataVisualization.tsx:1162-1224` |
| P2 | Focus rings missing on inputs | `AlertDialog.tsx:168`, `Layout.tsx:477, 1198` |
| P2 | Two figures missing alt text | `StrictPaperViewer.tsx:313, 333` |
| P2 | Disabled buttons visually weak | multiple |
| P2 | Anatomy3DViewer placeholder models | `Anatomy3DViewer.tsx:5,50-58` |
| P2 | No 3D viewer aria-label / SR fallback | 3D components |
| P3 | Workstation 8945 LOC, StrictPaperViewer 6983 LOC, Workbench 3825 LOC — split | several |
| P3 | `any[]` types throughout `Layout.tsx` command palette | `Layout.tsx:320, 417, 752-777, 832-834, 1238` |
| P3 | Plotly imported eagerly | `components/PlotlyPlot3D.tsx:9` |

### Test coverage
| Sev | Gap | Risk |
|---|---|---|
| P0 | Zero auth/login e2e tests | First user cannot onboard reliably |
| P1 | Zero integration-API smoke tests for 13 sources | Silent integration failures, broken pipeline at undocumented stage |
| P1 | Zero export tests (PDF/DOCX/deck) | Users cannot download results; corruption hides until user-visible |
| P1 | Zero error-recovery tests (LLM 429, timeout, malformed input) | Pipeline hangs on first real-world hiccup |
| P1 | Zero frontend unit tests despite vitest configured | Component regressions slip past visual snapshot |
| P2 | No WebSocket reconnect tests | Live updates silently die |
| P2 | No concurrent-request tests | Race conditions in citations / sessions |
| P2 | No 3D viewer functional tests (only screenshot) | Rendering bugs ship |

---

## 4. The 27-day sequenced plan

Day 1 = audit (this document). The remaining 26 days break into 5 sprints with hard checkpoints. Each section ends with a "300% pass" gate: (a) automated tests green, (b) manual persona walk-through passes, (c) adversarial probe finds nothing exploitable.

### Sprint 1 — Security & IP scrub (Days 2-7, 6 days)
Unblocks everything else.

- D2: Move `prompts.py` to AWS Secrets Manager + at-runtime fetch with version pin. Build `PromptLoader` module.
- D2-D3: History rewrite — remove `prompts.py`, `Speedrun.zip`, `humanovo for Speedrun.pdf`, `.terraform-outputs-dev.json`, `docs/planning/the v2 platform.md`, `docs/planning/Cormorant_Garamond.zip`, `docs/planning/files.zip`, `docs/planning/files (1).zip`, `docs/planning/COMPETITIVE_POSITIONING.md`, `docs/planning/BENCHMARK_POSITIONING.md` from full git history.
- D3: Rotate every credential (Postgres, Neo4j, JWT, AWS keys, Bedrock, all Azure endpoints, OpenAI, Google, Brave, PubMed). Move `.env.example` to canonical pattern; eliminate all defaults in code; fail-fast on missing env.
- D4: Implement global auth (`auto_error=True` + `Depends(require_auth)` baked into router groups). Add `require_admin` dependency. Add per-router auth tests so future endpoints cannot ship anonymous.
- D5: WebSocket auth + per-connection rate limit + send-side backpressure with disconnect-stale-clients. Sanitize all error responses (exception → opaque code + structured server-side log). Lock down `/health` to aggregate.
- D6: Strip `Bedrock`/`Azure`/`Claude`/`GPT` etc. from any error/log surface that reaches a client. Strip raw stage names from SSE stream — emit user-facing labels only. Rebrand stage names in UI. Sweep "genup" → "humanovo" in TF (resource recreation; maintenance window).
- D7: SSRF allowlist on integrations. Global rate limit middleware. Request size limit. CORS pinned to prod domain.

**Gate**: security probe (curl every endpoint without auth, attempt SSRF, attempt SSE intercept, attempt WS spam). Zero successes = pass.

### Sprint 2 — UX polish + persona walkthrough (Days 8-14, 7 days)
- D8: Cut & hide routes per §2. Single PR per cut group.
- D9: Fix the 10 keyboard-a11y P1 divs across `Evidence`, `Notebook`, `MLModelManager`, `Workstation`. Add focus rings. Fix DataManager labels.
- D10: Wire visible error states for `Workbench` library fetch + `DataVisualization` chart errors. Add empty states everywhere they're missing.
- D11: Anatomy3DViewer — either (a) integrate real BP3D models or (b) hide the route for v1.
- D12: DOMPurify on `StrictPaperViewer.tsx:337`. Alt text on figures. Fix `disabled:opacity` patterns.
- D13: Persona walkthroughs (see §6). Each persona logs friction. Rapid-fix loop.
- D14: Pointer/cursor sweep — every clickable has `cursor-pointer`, every drag area has `cursor-grab/grabbing`, every hover state actually changes something, every disabled has `cursor-not-allowed`.

**Gate**: Each kept route passes 5/7 persona walkthroughs with zero P1/P2 friction. Lighthouse a11y ≥ 95.

### Sprint 3 — Test gap closure (Days 15-21, 7 days)
- D15: Auth e2e (`register → login → reset → logout`).
- D16-D17: 13 integration-API smoke tests. Each integration: happy path, rate-limit response, malformed entity, network failure.
- D18: Export tests — PDF, DOCX, deck. Bytes-not-empty + opens-in-real-tool.
- D19: Error-recovery: LLM 429, LLM timeout, LLM truncation, citation hallucination probe, budget-enforcer cascade.
- D20: WebSocket reconnect, concurrent-request races on citations/sessions/compute.
- D21: First wave of frontend vitest unit tests on the 5 most-bug-prone components (`Layout` command palette, `StrictPaperViewer`, `HypothesisDocViewer`, `DataManager` filters, `Workstation` panels).

**Gate**: All new tests in CI. CI lint/type-check moved from `continue-on-error: true` to required. Coverage budgets set.

### Sprint 4 — Native packaging (Days 22-25, 4 days)
- D22: Tauri scaffold — wraps existing React build. Three targets: `.msi` (Windows), `.dmg` (macOS), `.AppImage` + `.deb` (Linux). Auto-updater pointing at S3 + signed manifest.
- D23: iOS PWA — manifest.json, service worker, Apple touch icons, status bar meta, install prompt, offline shell.
- D24: Code signing — Apple Developer cert (notarize macOS build), Microsoft EV cert (or initial SmartScreen reputation grind), GPG-sign Linux. Pending-cert fallback if certs not yet procured.
- D25: Auto-update channel + force-upgrade gate for v1 launch.

**Gate**: Each installer launches, auto-updates from a stale version, can be uninstalled cleanly. iOS PWA passes Lighthouse PWA audit ≥ 95.

### Sprint 5 — Beta + smoke (Days 26-27, 2 days)
- D26: Deploy to a fresh prod AWS account (clean of "genup" legacy). 5-10 vetted academic labs invited. SLA dashboard + on-call rotation.
- D27: Beta day-1 monitoring. Hot-fix any P0 surfaced.

**Realistic outcome**: closed beta May 26-31; public launch ~June 12 after 2 weeks of beta hardening.

---

## 5. Native packaging plan

| Target | Tool | Why | Distribution | Signing |
|---|---|---|---|---|
| Windows | Tauri (recommended over Electron) | 3-10 MB binary vs 80-150 MB Electron; uses system WebView2; better security defaults | `.msi` via Tauri bundler; auto-update from S3 | Microsoft EV cert or build SmartScreen reputation (3-6 weeks) |
| macOS | Tauri | Same; uses WebKit | `.dmg` notarized; auto-update | Apple Developer ID + notarization |
| Linux | Tauri | Same; WebKitGTK | `.AppImage` + `.deb`; flathub later | GPG-sign |
| iOS | PWA (no native) | Avoids App Store review delays; reuses 100% of frontend | "Add to Home Screen"; serve from `humanovo.net` with proper PWA manifest | n/a (HTTPS only) |

**Why Tauri over Electron**: smaller bundles, smaller attack surface, Rust-based shell, native menu/tray, better fits the IP-protection axis (less code to inspect than an Electron `.asar`). Electron is the safe pick if your team has Electron experience and Tauri is novel — but for fresh setup, Tauri wins.

**Pre-launch signing certs to procure now** (lead times 1-3 weeks): Apple Developer Program (~$99/yr), Microsoft EV code-signing cert ($300-500/yr from DigiCert/Sectigo). Without these the installers throw scary warnings.

**Risk to call out**: rebranding S3 buckets and Terraform resources from `genup-*` to `humanovo-*` requires resource recreation (CloudFront distribution rebuild, API Gateway endpoint change). Plan a maintenance window. Don't let this leak into the launch week.

---

## 6. Persona test matrix

For an academic-researcher v1, these are the 7 personas we walk every kept route through. Each persona has a 30-min scripted task plus a 30-min open exploration. A route doesn't pass unless **5/7 personas complete the scripted task without help**.

| # | Persona | Stack they bring | Routes they hit | Scripted task |
|---|---|---|---|---|
| 1 | PhD candidate (genomics, year 3) | Python/Jupyter, BioPython, GEO/SRA, IGV | `/projects`, `/genomics`, `/literature-review`, `/compute-lab`, `/knowledge-graph` | "Find genes plausibly upstream of phenotype X; pull supporting literature; export a 1-page brief for advisor." |
| 2 | Postdoc (drug discovery) | RDKit, ChEMBL, AlphaFold, R | `/projects`, full 12-stage pipeline, `/evidence`, `/citation-manager`, `/data-visualization` | "Generate hypotheses for repurposing existing approved drugs against target Y; surface adversarial counter-arguments and rank by mechanistic confidence." |
| 3 | PI (lab head) | Email, Slack, occasional Jupyter | `/dashboard`, `/projects`, `/timeline`, `/citation-manager` | "Compare 3 active projects this week; spot the one stalled; export status summary for grant report." |
| 4 | Master's student (computational biology) | RStudio, occasional Python | `/projects`, `/agents`, `/data-manager`, `/data-visualization` | "Upload a CSV from a recent experiment; ask the assistant to suggest analyses; produce one publishable figure." |
| 5 | Computational biologist (industry-adjacent academic) | Snakemake, Nextflow, AWS Batch | `/compute-lab`, `/data-manager`, `/data-visualization`, `/knowledge-graph` | "Run a Monte Carlo on a PK/PD model; overlay against published data; share a reproducible link with co-author." |
| 6 | Wet-lab biologist (no programming) | ELN (Benchling), Excel, GraphPad | `/projects`, `/notebook`, `/literature-review`, `/agents` | "Document an experiment, link supporting literature, ask for a plain-English mechanistic explanation." |
| 7 | MD-PhD / translational | UpToDate, ClinicalTrials.gov, REDCap | full 12-stage pipeline, `/evidence`, `/literature-review` | "Take a clinical observation; generate translational hypotheses with T0-T5 roadmap; assess evidence weight." |

Personas deferred to v1.1 (when /imaging, /clinical-trials, /regulatory come back): surgeon, clinician, technician, undergrad.

For each persona, score:
- **Time-to-first-value** (target < 5 min)
- **Number of explicit "I'm stuck" moments** (target = 0)
- **Pointer/cursor surprises** (target = 0)
- **Empty/loading/error states encountered well** (target = all)
- **Adversarial probe**: persona tries to do something destructive — does the system survive?

---

## 7. Decisions locked in (Day-1)

| Decision | Choice |
|---|---|
| Native packaging | Tauri desktop (Win/macOS/Linux) + iOS PWA |
| v1 paying user | Academic biomedical researchers (PhDs, postdocs, PIs) |
| Work mode | Audit + plan first, then checkpointed sprints |
| Cursor/IDE | Mouse cursor / pointer UX (not the IDE) — folded into UX axis |
| Git history scrub | Yes — full `git filter-repo` on a fresh clone, force-push to a new branch, replace |
| Prompts home | AWS Secrets Manager + at-runtime fetch with version pin |
| Branding | Full `genup-*` → `humanovo-*` migration during Sprint 1, with maintenance window |
| Code-signing certs | User procures; engineering plans pending-cert fallback |
| Launch posture (revised in §9) | Closed beta May 26-31 → public launch ~June 12 |
| Audit doc location | `docs/planning/PRODUCTION_AUDIT_2026-05.md` (this file) |
| Reporting cadence (Sprint 1 / Day 2) | End-of-day summary |

## 8. Sprint checkpoints

(Appended as each sprint closes.)

### Sprint 1 — Security & IP scrub
_Day 2 in progress_

## 9. Day-2 amendments (2026-05-04 PM)

Five architectural decisions taken on Day 2 that revise §1, §3, §4, §5, §7 of this document. Recorded here in chronological order; the prose above remains the original Day-1 snapshot.

### 9.1 Multi-account AWS Organization (replaces in-place rebrand)

Decision: provision a fresh AWS Organization with 4 accounts — **prod / staging / dev / security** — rather than rebrand the existing `genup-*` account in place. Baseline tooling: AWS Identity Center for SSO, AWS Control Tower for guardrail SCPs, GuardDuty + Security Hub aggregating to the security account.

Plan impact:
- Sprint 1 / D6 in-place TF rebrand → **deleted**.
- Sprint 1 / D2-3 → **adds** Organization bootstrap + Identity Center + Control Tower setup (~1 day).
- Old `genup-*` account becomes archive-only for 90 days, then decommissioned.
- The runbook in `REBRAND_RUNBOOK.md` will be revised to a multi-account-bootstrap runbook in a follow-up commit.

### 9.2 Per-user logical isolation on shared infrastructure

Decision: every researcher gets `tenant_id` scoping on Postgres rows (enforced by row-level security policies), per-user pgvector namespace, per-user S3 prefix, and per-user Neo4j label-based filtering. Physical infrastructure stays shared and auto-scales. **No** per-user dedicated infra at academic-researcher pricing.

Plan impact:
- Sprint 1 / D4 → **expands** auth migration to land alongside tenant scoping + RLS policies + S3 prefix scoping. Migration is one PR per module so frontend can keep up.
- Adds ~2 days to S1 D4 work (was 1 day, now 3).
- `AUTH_MIGRATION_PLAN.md` will be revised in a follow-up commit to incorporate ownership-check requirements per endpoint.

### 9.3 CredentialPool / key broker for upstream providers

Decision: every external provider we call (Bedrock, Azure OpenAI, Azure AI, NCBI, etc.) is fronted by a pool of N keys with a broker that picks healthy keys, fails over on 429/401/503, and tracks per-key utilization. Keys are stored in AWS Secrets Manager. **Auto-rotation cadence = quarterly default + 7-day grace overlap**, configurable per pool. Emergency revoke path completes in <60s regardless of schedule.

Implication for v1 wired sources: only NCBI takes an optional key (`PUBMED_API_KEY`). The other 13 wired sources are public APIs with polite-pool email only — no credential rotation needed for the *integrations* themselves. The CredentialPool earns its keep on the **LLM providers** (Bedrock, Azure OpenAI, Azure AI) where multi-key resilience is necessary at scale.

Plan impact:
- Sprint 2 / D9-12 → **replaces** half of the UX-polish work with the CredentialPool build (broker, rotation Lambda, per-pool config). UX polish compresses but completes.
- Existing `TokenPool` in `backend/app/agents/discovery_orchestrator.py:233` stays as the request-budget tracker and is wrapped by the CredentialPool.

### 9.4 Source-set reality vs claim — drop Brave, build 15 next

Decision: README's "60+ APIs" is aspirational; codebase has **15 wired** (9 core clients + 6 ingestion agents). After dropping **Brave Search** in Sprint 1 / D8 (only paid source; cleaner all-open-sources story), we're at **14 wired**. Sprint 3 builds **15 more** picked for public-domain or CC-BY licensing only (openFDA, RCSB PDB, WikiPathways, Semantic Scholar, cBioPortal, BiGG Models, IMPC, MGI, ClinVar, dbSNP, GTEx, NCI GDC, cellxgene Census, ProteomicsDB, DepMap). v1 ships with **30 sources fully tested**.

15 STUB integrations in `backend/app/services/biomedical_apis.py` and `backend/app/ingestion/sources.py` get **deleted** in Sprint 1 / D7 — dead code, simplifies attack surface and audit story.

Marketing copy update: README revised from "60+ APIs" to "30+ open biomedical data sources at v1, expanding to 60+ by Q4 2026 (see SOURCES_ROADMAP.md)".

Plan impact:
- Sprint 3 → **expands from 7 days to 10-12 days** to cover building + 5-tier testing of 15 new sources alongside the originally-planned smoke tests for the 14 wired.
- See `INTEGRATION_INVENTORY.md` for the authoritative list and `SOURCES_ROADMAP.md` for the build queue.

### 9.5 Revised launch dates

The Sprint 3 expansion plus the Sprint 2 CredentialPool work together push launch by ~3 days net.

| Original (Day 1) | Revised (Day 2) |
|---|---|
| Closed beta May 26-31 | **Closed beta June 2-7** |
| Public launch ~June 12 | **Public launch ~June 17-20** |

Still inside the "end of May / early June" envelope you set on Day 1. If the AWS Organization bootstrap stalls or the CredentialPool runs over, I'll surface it at the Sprint 1 checkpoint and either compress UX polish further or push beta one more week.

### 9.6 Integration testing — 5-tier harness for 30 sources

To address your directive ("do full testing like others on those 60+ sources"), Sprint 3 expands to:

| Tier | What it tests | Cost / source | CI cadence |
|---|---|---|---|
| T1 — Connectivity | Hit the API; expect 2xx for canonical query | ~30s | Daily smoke (cron) |
| T2 — Schema | Response parses against Pydantic model; required fields present | ~30s | Per-PR |
| T3 — Error path | Bad query, 429 backoff, timeout fallback, malformed entity | ~2 min | Per-PR |
| T4 — Pipeline E2E | `enrich_target()` / `enrich_disease()` actually use the data | ~5 min | Per-PR (mocked) + nightly (live) |
| T5 — Quality regression | Snapshot tests on canonical entities (TP53, EGFR, BRCA1, KRAS, lung cancer, COVID-19) — detects upstream drift | ~5 min | Nightly |

Total Sprint 3 budget: ~10-12 days for 30 sources. CI cost manageable: T1 daily smoke = ~15 min/day; T4-T5 nightly live = ~1 hr/night.

### 9.7 Updated decisions table (cumulative)

| Decision | Choice |
|---|---|
| AWS posture | 4-account Org (prod / staging / dev / security) + Identity Center + Control Tower + GuardDuty/Security Hub |
| Per-user model | Logical isolation on shared infra (tenant_id, RLS, per-user S3 prefix, pgvector namespace, Neo4j label) |
| Auto-scaling | Fargate ASG + RDS Proxy + read replica + ElastiCache cluster + SQS-driven worker scaling |
| Upstream credentials | CredentialPool per provider, multi-key with failover; quarterly rotation + 7-day grace overlap; emergency revoke <60s |
| User-facing API tokens | Out of scope for v1; JWT in `auth.py` is sufficient |
| Source set v1 | 14 wired + 15 built in Sprint 3 = **30 sources** at beta. All public-domain or CC-BY (commercial-use-OK). Brave dropped. |
| Native packaging v1 | Win + macOS + iOS PWA; Linux deferred to v1.1 |
| Launch dates (revised) | Closed beta **June 2-7**; public launch **~June 17-20** |

---

## 10. Cloud + business-model decisions — 2026-05-05 update

This section captures decisions locked during the 2026-05-05 founder Q&A. The earlier sections of this doc remain valid; this section supersedes any apparent conflicts.

### 10.1 Three new clouds, fully fresh accounts

The existing AWS dev (under `genup-*`) is being replaced. New clouds:

| Cloud | Role | Region | Models in scope |
|---|---|---|---|
| **AWS** (new Organization) | Full infra + Bedrock model agents | `us-east-1` | Claude Opus 4, Claude Sonnet 4.6, Claude Haiku 4.5, Cohere Embed v3 (English + Multilingual), Amazon Nova Pro |
| **Azure** (new tenant + subscription) | AI Foundry hub + 8 model deployments + per-stage agents | `East US 2` | GPT-4o, GPT-4.1, o3-mini, Cohere Command R+, Mistral Large 2, Phi-4, Grok-3, text-embedding-3-large |
| **GCP** (new project) | Figure generation **only** | `us-east1` | Gemini 3 Pro Image (4K-8K publication-grade figures) |

The full setup-and-credentials guide is in `CREDENTIALS_HANDOFF.md` — that's what the founder works through during cloud signups.

### 10.2 Architecture commitment — multi-cloud agent swarm

The 12-stage pipeline is implemented as **per-stage swarms** of agents, each picking the best model from the registry at task-dispatch time. Not one cloud per pipeline; not one model per stage; not one agent per user. See `MULTI_CLOUD_AGENT_ARCHITECTURE.md`.

Key properties:
- **Per-user lane keys** in pre-provisioned pools per cloud (CredentialPool primitive). Pool size auto-scales from 30 lanes → up by 10 every time peak utilization sits at 80% for 15 min. Auto-provision first, then alert dev team.
- **Shared swarm worker agents** (Bedrock Agents / AI Foundry Agents / Vertex Agents) — stateless executors scoped per-request to user's lane key + tenant_id + KG namespace. The only way to scale to 100K users.
- **Cross-cloud failover always-on** — Bedrock down for Stage 1? Selector routes to Azure GPT-4.1. Azure down for embeddings? Routes to Bedrock Cohere. GCP down for figures? Queue + retry up to 30 min, fall back to "[figure pending]" placeholders so the paper text still ships.
- **Cost-down loop via Common KG** — every successful run extracts verified edges into the Common KG (with HIPAA gating). Future runs hit the KG before calling source APIs. Per-run cost projects ~75% lower at month 12 vs launch.

### 10.3 Pricing tiers — B2B from day one

| Tier | Price | What it gets | CredentialPool monthly cap |
|---|---|---|---|
| **Trial** | Free | 3 hypotheses + 1 paper-synthesis run, signup-required (email + Google + Apple OAuth) | $1 lifetime |
| **Researcher** | $20 / mo / seat | Limited monthly hypotheses, core discovery + citation export. Real-time Stripe top-ups. | $5 model-cost cap (~75% margin) |
| **Lab** | $200 / mo / lab | Generous hypothesis volume, all discovery modes, API access, projects, burst top-ups for grant cycles | $50 |
| **Institution** | Custom | Dedicated GCP project, larger reserved lane allocation, SSO, audit-log access, solutions engineering, contracted SLAs | $500-$2000+ per contract |

Real-time top-up flow: Stripe checkout → webhook hits `/api/v1/billing/topup` → `monthly_credit_remaining` increases instantly → broker resumes accepting tasks within seconds. Same UX as Anthropic / OpenAI prepaid credits.

### 10.4 Knowledge Graph layering — 4 levels

See `KG_GOVERNANCE.md` for the full spec.

| Layer | Owner | Visibility | PHI? |
|---|---|---|---|
| Common Corpus KG | platform | read-only to all users | never (auto-detector + user-mark dual gate at promotion) |
| Private KG | the user | only the owner | yes — stays here forever |
| Hypothesis KG | the user | only the owner; UI button next to each hypothesis opens KG view | inherits from Private |
| Paper KG | the user | only the owner; UI button next to each paper opens KG view | inherits from Private |

Promotion to Common requires: HIPAA-clean (auto-detector AND user-mark) + ≥3 distinct public-corpus sources + grounding ratio ≥ 0.85 + adversarial pass + confidence ≥ 0.75 + no model dissent. Auto-promote on those gates; community downvote → quarantine on N flags (where N depends on edge confidence).

### 10.5 Distribution — native apps only

humanovo.com is a marketing site. The product itself runs **only** as native apps:

| Platform | Tech |
|---|---|
| Windows | Tauri (Rust + React frontend) |
| macOS | Tauri |
| Linux | Tauri |
| iOS | Native (Swift wrapper around React + Tauri-equivalent on iOS) |

Auth tokens live in OS keychain (Tauri's keytar / iOS Keychain). No browser-localStorage tokens. Distribution: Windows Store + Microsoft Store, App Store (iOS), direct download / snap / flatpak / AppImage (Linux), DMG + Mac App Store (macOS).

### 10.6 Migration plan — parallel-run validation

The existing langgraph pipeline keeps running. The new multi-cloud agent system runs in shadow for 1 week (results compared, only old pipeline output reaches users), then 50/50 split for 1 week with hypothesis-quality parity gates, then cutover. Two-week validation window protects against silent regressions on research output.

### 10.7 What changes for the cloud cutover

The existing AWS `genup-*` infrastructure gets archived (NOT migrated). Every name in production becomes `humanovo-*`. The Terraform state migrates fresh, no in-place imports. The cutover happens at the close of Sprint 1 and is the gate to Sprint 2 (auth + per-user data isolation work).

### 10.8 Open items the founder is doing right now

- Signing up for the three new clouds in the order specified by `CREDENTIALS_HANDOFF.md`
- Submitting Bedrock model-access requests on day 1 of AWS (24-72 hour approval window)
- Populating GitHub Actions Secrets per the handoff doc as each cloud comes online

### 10.9 Decisions table — 2026-05-05 additions

| Decision | Choice |
|---|---|
| Cloud stack | AWS (new Org, us-east-1) + Azure (new tenant, East US 2) + GCP (new project, us-east1, Gemini 3 Pro Image only) |
| Agent architecture | Per-stage swarms + shared workers + per-user lane keys + cross-cloud failover always-on |
| Per-user keys | Lane-assignment in pre-provisioned pool; auto-scale at 80% utilization; auto-provision first then alert dev team |
| Trial flow | Free 3 hypotheses + 1 paper, **signup-required** (email + Google + Apple OAuth) at app first-launch |
| Billing processor | Stripe with real-time top-ups (Anthropic/OpenAI-style prepaid credits) |
| KG model | 4 layers: Common Corpus + Private + Hypothesis + Paper. Hypothesis/Paper KG visible via UI button next to each item. |
| Common KG promotion | Auto-promote on validation gates + community downvote quarantine. Confidence-keyed downvote thresholds. |
| HIPAA enforcement | Auto-detector at upload + user-mark; both must be clean for promotion. Default = cautious (PHI assumed unless cleared). |
| Cloud failover | Always-on automatic; equivalents in registry. Figure-gen GCP-only with queue+retry+placeholder fallback. |
| Migration | Parallel-run validation: 1 week shadow → 1 week 50/50 → cutover. |
| Distribution | Native apps only — Win + macOS + Linux (Tauri) + iOS (native). No browser product. |
| Marketing site | humanovo.com — marketing + download links only. Not a product surface. |
| Bedrock Provisioned Throughput | Not used. All tiers on-demand. Institution "dedicated infrastructure" comes from dedicated GCP project + reserved lane allocation + SLA, not PT. |
| GCP project structure | Single shared project for Researcher/Lab; dedicated project per Institution tenant. |


# Path to 100% — humanovo platform plan

**Drafted:** 2026-05-09 from commit `c6fb8ab` (post-A3 Phase 3).
**Scope:** pure platform — operations, processes, functions. Non-tech
items (founder bios, OG image, pricing decisions, wet-lab partnerships,
press, etc.) are deliberately split into the appendix at the bottom.

This doc supersedes the punch-list portion of `NEXT_SESSION.md` for
**post-current-session** work. Both docs co-exist: NEXT_SESSION is the
"where we left off" handoff; this is the "where we're going". Items
landed here move to NEXT_SESSION's "completed" log as they ship.

---

## Definition of "100%"

A platform is at 100% when **all eight** of these are true:

1. Every user-facing surface (the 15 nav items the user named) passes
   edge-case hardening AND is gated by route-level auth.
2. Every backend endpoint has a runtime-validated response model and
   tenant-ownership filter.
3. The 12-stage pipeline runs end-to-end on staging with real LLM
   credentials, including audit-log Merkle-chain verification.
4. Load test confirms p99 SLOs: read endpoints < 2 s, discovery start
   < 30 s.
5. A3 migration is complete — Neo4j removed from compose + Terraform.
6. Compliance documentation has been reviewed by URMC (Allyson Fess
   confirms it addresses URMC's needs OR returns specific gaps).
7. Documentation is in place: DEVELOPMENT.md, OPERATIONS.md,
   BENCHMARKS.md, API_REFERENCE.md.
8. Last-mile bug bash from beta-tester feedback closed; no open
   ship-blocker tickets.

This excludes: marketing-site polish, founder bios, OG image, pricing
decisions, wet-lab outreach, fundraising. Those live in the appendix
and are sequenced separately because they don't unblock platform code.

---

## Where we are right now (2026-05-09)

Session-end state at commit `950a83c` (desktop hardening pass):

| Native-shell surface | State |
|---|---|
| Settings → Desktop App section | live — manual update check, report-issue, build version + platform display |
| Native OS notifications | wired into DiscoveryRunner + Agents discovery completions/failures |
| System tray | live — Show / Quit menu, left-click focuses window (Win/Linux), menu-on-left (mac) |
| Window-state persistence | live (commit pre-session) |
| Auto-updater | live, manual + 3 s post-launch check |
| Deep-link router | live, `humanovo://` payloads route to React Router |

Earlier session-end state at commit `c6fb8ab`:

| Surface | State |
|---|---|
| Frontend lint | 0 warnings |
| Frontend type-check | clean |
| Frontend e2e | 0/460 fails (76 annotated skips) |
| Initial JS bundle | ~5 MB lighter (compute-lab lazy) |
| Backend OpenAPI | +84 newly-typed routes |
| Backend NCBI throughput | unblocked (~3.3× via PubMed API key fix) |
| Onboarding | first-run wizard live |
| Visual KG | embedded in /knowledge-graph (Private/Common/All), HypothesisReview, paper viewer |
| KG migration | Phase 3 complete — `KG_BACKEND` flag flips reads, dual-write live, `/admin/kg-parity` check ready |

Native-app installer auto-update channel: live (per
`build-native-apps.yml`), unsigned until user-blocker #1 / #2 land.

---

## Stages

Stages are ordered by dependency, not by importance. Some run
concurrently — Stage 2 needs user-blocker #3, but Stages 3 / 4 / 5 / 6
can start immediately.

### Stage 1 — A3 migration tail (Phases 4 + 5)

**Effort:** ~1.5 days dev work, 2-3 weeks calendar (due to mandatory
prod-stable holds).

The remaining migration phases are deliberately spaced so each one's
escape hatch stays viable for a real prod week before the next removes
it.

| Phase | Effort | Calendar gate |
|---|---|---|
| **Phase 3 bake** | 0d code | hold ≥7 days post-flip with `/admin/kg-parity` reporting `in_parity=true` |
| **Phase 4** — stop Neo4j writes | ½d | hold ≥7 days after Phase 4 ships |
| **Phase 5** — remove Neo4j from deploy | ½d | structural; only ships when Phase 4 has been stable for a week |

Phase 4 file list (no surprises — already documented in
`A3_NEO4J_TO_PGVECTOR_PLAN.md` Phase 4):

- `app/knowledge/graph_store.py` — make Neo4j writes a no-op when
  `KG_BACKEND=postgres`. Helper paths reroute to PostgresGraphStore.
- `app/services/neo4j_population_service.py` — flip `dual_write`
  default to `False`; the bulk path becomes Postgres-only.
- `CHANGELOG.md` — operational note that the Neo4j container still
  runs but receives no traffic.

Phase 5 file list:

- `docker-compose.yml`, `docker-compose.dev.yml` — drop the `neo4j`
  service. Comment with date + link back to this plan.
- `backend/requirements.txt` — drop `neo4j` driver.
- `infrastructure/` (Terraform) — remove Neo4j resources. Cancel
  AuraDB subscription via the Aura console as a separate operational
  step.
- `app/core/config.py` — drop `NEO4J_URI`, `NEO4J_USER`,
  `NEO4J_PASSWORD`, `neo4j_password_value`.
- `app/knowledge/graph_store.py` — delete the Neo4j branch entirely;
  rename `PostgresGraphStore` → `GraphStore`.
- `app/services/neo4j_population_service.py` → rename to
  `kg_population_service.py`; rip Neo4j ingest path.
- `tests/conftest.py` — drop the Neo4j fixture.

### Stage 2 — Tier-3 runtime audits (gated on user-blocker #3)

**Effort:** ~5 days. **Gating:** AWS Secrets Manager bootstrap
(`humanovo/prod/app`) populated with `DATABASE_URL`, `JWT_SECRET_KEY`,
`PUBMED_EMAIL`, `STRIPE_*`, `BEDROCK_*`, `AZURE_*`. Until that lands,
none of these can run for real.

| Step | Effort | Gate |
|---|---|---|
| **C1** — endpoint runtime audit | 1d | bootstrap done |
| **C2** — pipeline e2e on staging | 1d | C1 + LLM creds |
| **C3** — auth + billing + tenant runtime | 1d | C1 |
| **C4** — load testing (Locust / k6) | 1-2d | C2 + C3 |
| **C5** — UAT + ship-readiness drills | 1d | C4 |

Per audit:

- **C1**: hit every endpoint with real DB + JWT. Validate response
  shape matches OpenAPI (especially the 84 routes typed in A1).
  Validate tenant ownership filter (every owner-scoped endpoint
  uses `fetch_owned_or_404` per migration 021). Capture raw counts
  in `tests/integration/reports/c1_endpoint_audit.json`.

- **C2**: run `tests/integration/test_pipeline_e2e.py` against staging.
  Validates: 12 stages run end-to-end, citation roundtrip produces
  real DOIs, audit log gets written and the Merkle chain stays intact
  POST-A3 (the dual-write path can't have desynced anything).

- **C3**: real Stripe webhook events fired against staging. Verify
  signature path + idempotency LRU + tier transitions land on
  `users.tier`. Cross-tenant test: user A cannot mutate user B's
  budget through any /v1/user/{id}/budget variant.

- **C4**: Locust scripts in `loadtest/` (new). Targets:
  read endpoints **p99 < 2 s** at 200 concurrent users; discovery
  start **p99 < 30 s** (long-poll → WS handoff). If we miss SLOs,
  diagnose before scaling — burning $500/day on a load test that
  paints over a real bottleneck is worse than diagnosing now.

- **C5**: run-book exercises. Each is timed and recorded.
  - Incident response (page-on-call, freeze deploys, restore previous)
  - Backup → restore (PostgreSQL + pgvector indices)
  - Secret rotation (DATABASE_URL, JWT_SECRET_KEY, Stripe webhook
    secret, PUBMED_API_KEY)
  - Key compromise (Tauri signing keypair, Apple cert, GitHub PAT)

### Stage 3 — Surface hardening (the 15 user-facing pages)

**Effort:** 15-20 days, ~½d to ~1.5d per page depending on complexity.
**Concurrency:** can run alongside Stages 2 / 4 / 5 / 6 since each page
is independent.

Per-page hardening checklist (the same 8 items, applied uniformly):

1. **Empty state** — first-run user, zero rows, zero results. Visually
   distinct, action-oriented (clear CTA back to creating something).
2. **Loading state** — skeleton or spinner that doesn't flash on fast
   responses (50ms grace before showing).
3. **Error boundary** — every async fetch caught; user sees a real
   message, not a white screen. Sentry breadcrumb on every catch.
4. **Pagination / virtualization** — list endpoints paginated; tables
   over 200 rows virtualised (react-window).
5. **Optimistic updates** — create/edit/delete shows the change
   immediately, reverts on backend error.
6. **Auth guard** — page wrapped in `<RequireAuth>` (see Stage 5).
7. **Mobile breakpoint** — at 375px wide the page is at minimum
   readable, ideally usable. Defer fully-mobile pages to Stage 7.
8. **Per-page e2e** — 1-2 happy-path tests + 1-2 edge-case tests in
   `frontend/e2e/page-{name}.spec.ts`.

Per-page sequencing (priority by daily-active surface):

| Order | Page | Special concerns |
|---|---|---|
| 1 | Dashboard | stats fan-out, real-time updates |
| 2 | Projects | create/edit modal, delete confirm |
| 3 | Discovery | WebSocket reconnect, partial-result render |
| 4 | Evidence (Hypotheses) | filter persistence, pagination |
| 5 | Knowledge Graph | URL-bookmarkable filters |
| 6 | Notebook | autosave, conflict resolution |
| 7 | Search | empty + zero-result UI |
| 8 | Timeline | live updates from activity log |
| 9 | Literature | import error recovery |
| 10 | Citations | bulk operations, drag-drop import |
| 11 | Visualization | chart export + share |
| 12 | Compute Lab | already strong; just hardening |
| 13 | Genomics | wire to backend (currently uses _compute* fallback) |
| 14 | Data Manager | large-file upload UX |
| 15 | Settings | profile + security + preferences |

### Stage 4 — Performance + scale

**Effort:** 3-5 days.

| Item | Effort | Notes |
|---|---|---|
| Bundle audit beyond compute-lab | 1-2d | lazy-load Workbench (153 KB), ResearchImaging (210 KB), ProjectKnowledgeGraph (543 KB), DataVisualization (183 KB). Identify the unnamed `extends-*.js` 721 KB chunk. |
| Per-user cost-cap circuit breakers | 1d | Every LLM-cost endpoint refuses with 429 when daily user cap hit. NEXT_SESSION mentions this; needs a sweep across orchestrator endpoints. |
| Sentry coverage | ½d | Every unhandled exception path has a Sentry breadcrumb. Frontend + backend. |
| WebSocket back-pressure | 1d | `/ws/discovery` reconnects on drop, queues backed-up events instead of dropping. |
| Background-job DLQ | ½d | Celery dead-letter queue for failed paper-generate / dual-write retries. |

### Stage 5 — Security + compliance

**Effort:** 3-5 days.

| Item | Effort | Notes |
|---|---|---|
| **Wire `RequireAuth` into App.tsx routes (P0)** | ½d | `RequireAuth.tsx` exists but isn't wired — every route currently public. Surfaced during B4 onboarding work. Real security gap. |
| Rate limiting on /admin/* + expensive POST | ½d | slowapi or AWS WAF rate rules. |
| DDoS posture | ½d | Cloudflare tier or AWS Shield Advanced. |
| Audit-log Merkle verify post-A3 | ½d | Confirm Phase 2 dual-write didn't introduce gaps. Run `audit.verify_chain(db) == intact:True` against staging. |
| `COMPLIANCE.md` review by URMC | external | Send to Truptesh Kothari for institutional review; schedule Allyson Fess. (Was Sprint 4 of the April plan; templates are in Downloads.) |
| HIPAA-readiness checklist | 1d | Map current architecture to the 18-item HIPAA controls list. Gap report. |
| Security review pass | 1d | `/ultrareview` or equivalent — multi-agent cloud audit on the auth + tenant + billing surface. |

### Stage 6 — Documentation

**Effort:** 2-3 days. **Concurrency:** can ship alongside any other
stage.

| Doc | Source of truth | Effort |
|---|---|---|
| `DEVELOPMENT.md` | repo root | env setup, npm/pip versions, env-file template, common commands. ½d |
| `OPERATIONS.md` | repo root | incident response runbooks, deploy procedures, secret rotation, restore-from-backup walkthrough. 1d |
| `BENCHMARKS.md` | repo root | from C4 load tests; pipeline cost / latency / accuracy numbers. ½d (after C4) |
| `API_REFERENCE.md` | repo root | autogenerated from OpenAPI; one-pager pointing at the canonical endpoints. ½d |
| Module docstrings sweep | per-file | every endpoint module gets a top-level docstring; the A1 sweep covered routes, this covers files. ½d |

### Stage 7 — Polish + finishing

**Effort:** 2-3 days. Scheduled last because most items are
beta-feedback-driven.

| Item | Effort | Notes |
|---|---|---|
| B3 press kit page | ½d | `/press` on humanovo.net |
| B5 mobile responsiveness review | ½d | Audit landing pages at 375px |
| B6 collab notebooks | 3-5d | Multi-day; only if beta feedback demands it. Ship as v1.1. |
| B7 quote-level grounding | 3-5d | Multi-day; same. Ship as v1.1. |
| Beta bug-bash | open-ended | one focused day per round of feedback |

---

## Total estimate

| Stage | Active dev | Calendar |
|---|---|---|
| 1 — A3 tail | 1.5d | 2-3 weeks (mandatory holds) |
| 2 — Tier 3 | 5d | gated on user-blocker #3 |
| 3 — Surface hardening | 15-20d | concurrent with 2 |
| 4 — Perf | 3-5d | concurrent |
| 5 — Security | 3-5d | concurrent |
| 6 — Docs | 2-3d | concurrent |
| 7 — Polish | 2-3d | last |
| **Total** | **~30-40d** | **~6-8 weeks** |

For solo + Claude at the velocity this session demonstrated (~7
substantive commits/day on small items, 1 commit/day on big phases like
A3), 30-40 active dev days is achievable in 6-8 calendar weeks given
the prod-stable holds in Stage 1 and the gating on Stage 2.

---

## Critical-path view

The shortest path to "all 8 of the 100% criteria are true":

```
Today
  │
  ├── Stage 5 (RequireAuth wiring)        ── unblocks security audit
  ├── Stage 1 Phase 3 bake (calendar)     ── 7 days
  ├── Stage 3 (page hardening)            ── concurrent
  └── User unblocks #3                    ── ENABLES Stage 2
        │
        ├── Stage 2 C1 (endpoint runtime audit)
        ├── Stage 2 C2 (pipeline e2e)
        ├── Stage 2 C3 (auth/billing runtime)
        ├── Stage 1 Phase 4 (after Phase 3 stable)
        ├── Stage 2 C4 (load test)
        ├── Stage 2 C5 (UAT drills)
        └── Stage 1 Phase 5 (after Phase 4 stable)
              │
              └── Stage 6 BENCHMARKS.md (uses C4 output)
                    │
                    └── 100% reached
```

User-blocker #3 is **the** critical unblocker. Stages 3, 4, 5, 6 can all
start without it; they fill the calendar while we wait. Stage 2 is the
bottleneck.

---

## Dependencies on user actions

These come from `NEXT_SESSION.md` and remain unchanged:

| # | Action | Stage gated |
|---|---|---|
| 1 | Tauri signing keypair → repo Secrets | Stage 7 (signed installer ships) |
| 2 | Apple cert + notarization secrets | Stage 7 |
| 3 | **AWS Secrets Manager bootstrap dispatch** | **Stage 2 (entire stage)** |
| 4 | Real OG image | non-tech (appendix) |
| 5 | Founder bios | non-tech |
| 6 | `NEXT_PUBLIC_HUMANOVO_API` env in Vercel | once if API URL changes |
| extra | Win EV Authenticode cert (1-2 wk lead) | Stage 7 |
| extra | Apple Developer Program enrolment ($99/yr) | Stage 7 |

If only one user action lands this week, make it #3. It single-handedly
unblocks 5 days of Stage 2 work.

---

## Decision points the next session needs

1. **Phase 4 hold duration.** Plan says ≥7 days. Should it be
   exactly 7, or anchor on a calendar event (e.g. wait for the first
   beta-tester week to finish)?
2. **Stage 3 ordering.** The priority list above is by daily-active
   usage. Override if specific named beta users prefer a different
   surface first.
3. **B6 / B7 inclusion.** Multi-day each; only worth it if beta
   feedback says collab + quote-level grounding are blockers.
4. **C4 SLO targets.** I picked p99 read < 2 s, discovery < 30 s
   from the prior plan. Confirm or adjust before C4 ships — chasing
   the wrong target is the most expensive mistake of Stage 2.

---

## What this plan deliberately does NOT cover

The following are real work but not platform-tech, so they live in the
appendix below or in a separate doc owned by you:

- Marketing-site copy + design tweaks
- Founder bios + OG image (user-blockers #4-#5)
- Pricing decisions
- Wet-lab partnerships (URMC PI, Truptesh, Allyson, Karthik / Scyntek)
- bioRxiv preprint — drafted in `Downloads/PREPRINT_DRAFT.md` already
- Press kit content (the page is B3 in Stage 7; the *content* is non-tech)
- LinkedIn / X announcement copy
- Legal: T&C, privacy, beta agreement (templates in Downloads)
- Domain ops: humanovo.net DNS, MX records, custom email
- Outbound sales (limited by April plan; defer past 100%)
- Fundraising prep

---

# Appendix — non-tech path to launch

These items are sequenced separately because they don't unblock
platform code. Group A is what closes user-blockers; Group B is launch
logistics; Group C is post-launch revenue.

## Group A — close user-blockers (1-2 weeks)

These are the only non-tech items that gate platform progress.

| Item | Owner | Effort | Notes |
|---|---|---|---|
| Generate Tauri signing keypair locally | you | 10 min | One-time. `tauri signer generate`. Upload PRIVATE + PUBLIC + optional password to repo Secrets. |
| Order Win EV Authenticode cert | you | 10 min order; 1-2 wk verification | Sectigo, DigiCert, SSL.com. ~$300-500/yr. |
| Apple Developer Program enrolment | you | 10 min apply; ~24-48 hr verify | $99/yr. Generate signing identity + notarization-service password. Upload to repo Secrets. |
| Dispatch `bootstrap-backend-new-account.yml` workflow | you | 30-60 min | Then populate AWS Secrets Manager bundle `humanovo/prod/app` with the full secret list. |
| OG image for landing | designer or DIY | 1-2 hr | 1200×630, hand-composed Vesalius detail + wordmark + rust accent. |
| Founder bios in `PageTrust.tsx` | you | 30 min | Replace placeholder copy with real names + affiliations. |
| Set `NEXT_PUBLIC_HUMANOVO_API` in Vercel | you | 1 min | Defaults to `https://api.humanovo.net`; set only if API lives elsewhere. |

## Group B — launch logistics (concurrent with platform Stages)

| Item | Owner | Effort | Notes |
|---|---|---|---|
| Named beta-user list | you | 1 hr | Jamison Seabury, Truptesh Kothari, Karthik Ramakrishnan / Scyntek, Allyson Fess + 1-2 buffers. Confirm each accepts. |
| Install instructions doc | you | ½d | Per-OS. Lives at humanovo.net/docs/install or sent via email. |
| Feedback channel | you | ½d | Slack channel, Linear board, or email alias. Pre-decide one and document it for the named users. |
| Beta agreement (legal) | counsel | external | Reusable T&C template + per-user sign-off. URMC may require institutional sign-off for Truptesh / Allyson. |
| LinkedIn / X announce copy | you | 1 hr | Drafted but not posted. Hold until 5 stable days post-soft-launch (per the v3 plan discipline). |
| bioRxiv preprint | you + advisor co-author | 1-2 weeks | Drafted in `Downloads/PREPRINT_DRAFT.md`. Section 4.5 needs Stage 2 C4 numbers. Co-author: Truptesh Kothari first ask. |

## Group C — post-launch revenue (defer past 100%)

| Item | Owner | Effort | Notes |
|---|---|---|---|
| Pricing model written down | you + 2 advisors | 1d | Per-hypothesis, per-month seat, institutional licence. Validate with Dave Mammano + Truptesh Kothari. |
| Scyntek pilot scope | you + Karthik | 1 wk | Define agreed-output deliverables. 1-2 specific Scyntek research questions. Pilot success criteria in writing. |
| URMC partnership formalisation | you + URMC | 2-4 wk | MoU draft + 1 PI willing to use humanovo for active research. 3 hypotheses, 4-week pilot. |
| Outbound sales (limited) | you | ongoing | 5 target accounts via warm intros only. No cold outreach until product is solid (Stage 1 + 2 done). |

## Group D — strategic / brand (no fixed schedule)

These are not blockers and have no deadline. Listed for completeness:

- BIO Spark Tank submission
- Mays AI Pitch (Texas A&M) submission
- MIT Pitch Challenge
- Wet-lab validation partner (Jamison or Allyson) — published validation by year-end is the original target
- Pre-seed deck refresh (after benchmarks, pilots, ideally wet-lab
  validation — NOT before)

---

## How this plan extends

When work lands, mirror it into `NEXT_SESSION.md`'s "completed" log
with a one-line summary and commit SHA. Don't let either doc drift —
they're both load-bearing for cold-pickup.

When the plan itself shifts (new gating item, scope change, deferred
phase), update this doc in-place with a `Last revised: YYYY-MM-DD` line
at the top so cold readers know they're on the current cut.

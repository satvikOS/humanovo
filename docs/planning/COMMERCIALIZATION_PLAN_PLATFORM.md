# Humanovo — Platform-Only Commercialization Plan

**Date:** 2026-05-10  •  **Branch:** `humanovo`  •  **Scope:** engineering-only

This is the **platform-only** cut of `COMMERCIALIZATION_PLAN.md`. Legal,
marketing, content, GTM, sales, founder time, and external-vendor
procurement are excluded. What remains is a pure engineering plan: the
atomic items that have to land in the codebase + infrastructure before
the platform is paid-grade.

The output: **8 workstreams, ~213 eng-days**, organized so each item is
a single ticket / PR with a verification path.

Current platform state (from audit):

* 35 frontend pages, 54 backend endpoint modules, 22 migrations
* 47 backend test files + 56 e2e tests + 7 new agent-layer test files this session
* 19 GH workflows (CI, deploy, native build, AI integration, E2E live)
* Tauri 2 desktop app, version `0.2.0`, identifier `com.humanovo.app`
* 12-stage discovery pipeline + agent layer (Bedrock + Foundry + sub-agent swarm + critic loopback + budget gate + audit chain + grounding tools)
* 62 active biomedical sources, pgvector + Neo4j, Stripe billing primitives, Merkle audit log

---

## Workstream 1 — DISCOVERY PIPELINE (engine maturity)

The 12-stage pipeline + agent layer is the product moat. Closing the last few mile.

| # | Item | Days | Verification |
|---|---|---|---|
| 1.1 | **Phase 2 of agent-layer migration** — flip `USE_AGENT_LAYER_FOR_STAGES=[9,10,11,12]` in staging, run 5 real discoveries, compare cost + quality vs legacy | 2 | A/B telemetry: same scientific output, ±20% cost |
| 1.2 | **Phase 3 of agent-layer migration** — `USE_AGENT_LAYER_FOR_STAGES=[1..12]` in staging | 3 | Same as 1.1 |
| 1.3 | **Stage diversification** — once new Foundry deployments land (Cohere, Mistral, GPT-4.1, o3-mini, Grok), update `STAGE_ASSIGNMENTS` so each stage uses a distinct model | 1 | swarm_smoke shows 12 distinct `agent_key` values |
| 1.4 | **Tool-calling rollout** — extend `AGENT_LAYER_TOOLS_FOR_STAGES=[10,11,12]`, then add 3,4,8 (evidence/counter/ground) once quality is validated | 3 | A/B shows agent emits ≥1 tool call per stage |
| 1.5 | **Stage-level retry policy** — transient model failures (rate limit, content filter) auto-retry once with reformulated prompt; permanent failures fall through to legacy | 3 | injected 429 in test agent → retry succeeds |
| 1.6 | **Cross-provider failover** — when Foundry stage fails, transparently fall over to Bedrock equivalent via `llm_failover.py` | 2 | unit test: bogus Foundry deployment → Bedrock answers |
| 1.7 | **Stage timeout + abort** — every stage has a per-stage wall-clock timeout (default 90s, o-series 180s); honour `pipeline_total_timeout` (default 30 min) | 2 | injected slow agent → stage aborts cleanly |
| 1.8 | **Adversarial-stage tightening** — counter/critic/score stages currently produce empty messages 5–10% of the time; tighten prompts + add fallback synthesizer | 4 | empty-rate <1% over 100 runs |
| 1.9 | **Loopback budget recovery** — after 3 loopbacks fire, current behaviour is "force forward". Add a "retry with relaxed grounding-ratio threshold" before forcing forward | 2 | 4th loopback path triggered + relaxed threshold accepted |
| 1.10 | **Per-hypothesis idempotency key** — re-running the same `hypothesis_id` returns the same Merkle-anchored result without re-charging | 3 | duplicate request → 0 new cost-events |
| 1.11 | **Resume from checkpoint** — orchestrator dies mid-stage 7; on retry, picks up from stage 7 instead of stage 1 (Step Functions task per `AWS_INFRASTRUCTURE_PLAN §1.1`) | 8 | injected mid-stage crash → resume succeeds |
| 1.12 | **Multi-hypothesis parallelism** — 4 rounds × 3 hypotheses = 12 hypotheses per run; today they execute sequentially. Parallelize at hypothesis granularity | 3 | wall-clock 12-hyp run drops from N×t to ~3×t |

**Workstream 1 total: ~36 eng-days.** 1.11 (Step Functions resume) is the long pole.

---

## Workstream 2 — DATA PLANE (sources, RAG, KG)

| # | Item | Days | Verification |
|---|---|---|---|
| 2.1 | **Source health auto-failover** — `data-sources/health` already exists; add automatic disable of a source after 3 consecutive failures, re-enable after 1h | 2 | injected source 500 → disabled+re-enabled |
| 2.2 | **pgvector ingest pipeline operational** — every newly retrieved evidence record from grounding sweep gets dual-embedded + indexed (Foundry now wired via task #73) | 3 | `grounding_cache` row count grows over time |
| 2.3 | **KG dual-write toggle stability** — `KG_DUAL_WRITE=True` must not block writes if Postgres mirror fails (currently logs only — verify) | 1 | injected Postgres write failure → Neo4j still authoritative |
| 2.4 | **KG read switchover** — `KG_BACKEND` controls reads; cut over from neo4j → postgres in staging, run gold-set queries, compare | 5 | retrieval recall@10 stays within ±2% |
| 2.5 | **Source addition runbook** — adding source #63 should be: declare in `data_sources.py` + add API client + ingest + flip in `SOURCES_ROADMAP.md`. Document each step | 2 | source #63 added in <1 day by following the runbook |
| 2.6 | **pgvector reindex on dim change** — if we ever switch from text-embedding-3-large (3072d) to a different dim, the reindex path must exist | 2 | dim-changed embedding written → migration runs cleanly |
| 2.7 | **Embedding cost throttling** — current ingest can fire unbounded embeddings; add semaphore + per-day token budget for ingest | 2 | injected 100k-string ingest → throttled correctly |
| 2.8 | **Stale evidence eviction** — papers older than X years OR retracted (PubMed retraction notice) auto-flagged as "stale", excluded from grounding | 4 | retracted paper PMID → flagged + excluded |
| 2.9 | **Citation chain export** — `GET /api/v1/hypotheses/{id}/trace` already exists; verify it returns full chain from final claim → tool call → source record | 1 | trace endpoint returns ≥3 verifiable PMIDs/NCTs |
| 2.10 | **Source diversity gate** — final hypothesis must cite ≥3 distinct source types (PubMed + ClinicalTrials + UniProt, not just PubMed×3) | 3 | injected mono-source hypothesis → rejected |

**Workstream 2 total: ~25 eng-days.**

---

## Workstream 3 — AUTH & IDENTITY

| # | Item | Days | Verification |
|---|---|---|---|
| 3.1 | **Email verification** at signup — magic-link confirmation, unverified users blocked from running discoveries | 3 | unverified account → 403 on /discovery/start |
| 3.2 | **Password reset flow** — magic-link reset, 1h TTL, single-use | 2 | full reset cycle works |
| 3.3 | **MFA TOTP for admin role** — required for admin login; recovery codes downloadable once | 4 | admin login w/o TOTP → blocked |
| 3.4 | **Refresh-token rotation** — short-lived access (15 min), refresh on rotation, max 30-day session | 3 | session beyond 30d → forced re-auth |
| 3.5 | **Concurrent-session limit** — max 5 active sessions per user; oldest evicted on 6th login | 1 | 6th login → 1st invalidated |
| 3.6 | **Account deletion** (GDPR Art. 17) — `POST /api/v1/account/delete`, 30-day soft-delete window, hard-delete cron | 3 | delete → all owned records gone after 30d |
| 3.7 | **Account export** (GDPR Art. 20) — `GET /api/v1/account/export` returns ZIP of all owned records as JSON | 2 | export contains all rows from owner-scoped tables |
| 3.8 | **API keys for programmatic access** — `POST /api/v1/account/api-keys`, scopes (`discovery:read`, `discovery:write`), rate-limited per-key | 5 | API key on `/discovery/start` works; bad scope → 403 |
| 3.9 | **OAuth login** — Google + GitHub at minimum (no Auth0 per memory) | 4 | OAuth round-trip works; account merges with email |
| 3.10 | **Per-tier rate limits** — `free` 10 req/min, `researcher` 100, `lab` 500, `institution` 2000 | 2 | exceeding tier → 429 with retry-after header |
| 3.11 | **Per-user kill switch** — admin endpoint `POST /admin/users/{id}/disable` immediately invalidates all sessions + blocks new logins | 2 | disabled user → 403 across all endpoints |

**Workstream 3 total: ~31 eng-days.**

---

## Workstream 4 — BILLING & USAGE METERING (engineering only)

| # | Item | Days | Verification |
|---|---|---|---|
| 4.1 | **Stripe webhook idempotency** — every webhook write logged with `stripe_event_id` unique; replay-safe | 1 | duplicate webhook → no double-charge |
| 4.2 | **Stripe webhook signing-secret rotation** runbook | 0.5 | secret rotated → webhooks still verified |
| 4.3 | **Subscription state machine** — `trialing → active → past_due → canceled → terminated`; transitions logged to audit | 2 | state changes tracked in `usage_events` |
| 4.4 | **Free-trial gate** — 14-day trial without credit card; auto-downgrade to free tier (50% reduced caps) on expiry | 3 | trial ends → tier flips, no charge |
| 4.5 | **Usage-overage charge** — runs beyond tier cap charged at $1.20/run via Stripe meter or invoice item | 4 | overage → invoice line item |
| 4.6 | **Failed-payment dunning** — 3 retry attempts (immediate / 3d / 7d), email between attempts, suspend on final fail | 3 | injected card-decline → flow completes |
| 4.7 | **Receipt + invoice generation** — branded PDF emailed on every charge | 2 | charge → email arrives |
| 4.8 | **Per-tenant cost dashboard** at `/account/usage` — daily / monthly cost, by-stage breakdown, projection | 4 | dashboard renders 30 days of data correctly |
| 4.9 | **Pre-flight cost preview in DiscoveryRunner UI** — calls `/admin/ai/cost-estimate`, shows "$X estimated" before Start button | 3 | UI shows estimate within ±20% of actual |
| 4.10 | **Upgrade CTA on budget abort** — when `SwarmResult.budget_aborted=True`, surface modal with "Upgrade to keep going" | 2 | aborted run → modal renders |
| 4.11 | **Stripe ↔ cost-tracking-service reconciliation** — daily cron compares Stripe revenue against our recorded `usage_events` totals; alert on >5% drift | 3 | injected 10% drift → alert fires |
| 4.12 | **Promo code system** — academic discount codes (PI@university.edu), 50% off, time-limited | 3 | code applied → invoice discounted |
| 4.13 | **Annual billing** — 17% discount, annual invoice, prorated upgrades | 3 | upgrade mid-cycle → prorated correctly |
| 4.14 | **Usage attribution** — every `record_llm_call` carries `user_id`, `project_id`, `discovery_run_id`, `stage_number` (already wired); verify lineage end-to-end | 1 | query: total cost by user × month works |

**Workstream 4 total: ~34 eng-days.**

---

## Workstream 5 — DESKTOP DISTRIBUTION (engineering only)

| # | Item | Days | Verification |
|---|---|---|---|
| 5.1 | **Bump version** `0.2.0 → 1.0.0` for launch | 0.5 | tag pushed, builds released |
| 5.2 | **App icon set** — placeholder script exists; need real 16/32/64/128/256/512px PNG + `.ico` + `.icns` | 1 | installer + dock + tray icons all sharp |
| 5.3 | **Installer branding** — MSI background, .dmg DS_Store layout, AppImage AppStream metadata | 2 | clean installer UX on all 3 OSes |
| 5.4 | **First-run onboarding tour** — 3-step intro overlay, skippable | 5 | new user lands on discovery page in <60s |
| 5.5 | **Auto-update UX verification** — toast on new version → download → restart-to-apply (already wired; visual check) | 1 | release pushed → installed app upgrades within 1h |
| 5.6 | **Crash reporter** — Sentry self-hosted; capture stack + last 100 audit-log entries on unhandled exception | 4 | injected crash → Sentry receives event |
| 5.7 | **Telemetry opt-in** — anonymous page-view + feature-usage events, default OFF, settings toggle, documented | 4 | toggle OFF → 0 outbound telemetry |
| 5.8 | **Offline mode** — show "Reconnecting..." banner when api.humanovo.net unreachable; queue writes, replay on reconnect | 4 | airplane mode → banner; reconnect → queued writes flush |
| 5.9 | **Update rollback** — if telemetry shows N% crash rate on release X, revert latest.json to release X-1 | 3 | injected high crash rate → rollback fires |
| 5.10 | **Uninstall completeness** — Win uninstaller removes all keys + appdata; macOS app + caches go to Trash; Linux .deb removes everything | 2 | post-uninstall: no humanovo files on disk |
| 5.11 | **Linux apt repo** — host humanovo's apt repo on S3+CloudFront, sign with project GPG key | 3 | `apt install humanovo` works on Ubuntu 22.04 |
| 5.12 | **AppImageHub submission** | 1 | listed on appimagehub.com |
| 5.13 | **Cross-OS Tauri smoke in CI** — Playwright on installed binary clicking through every route on Win/Mac/Linux (existing); verify still green at 1.0 | 2 | green on all 3 OS matrix |
| 5.14 | **Single-instance lock** — second launch of humanovo brings the existing window to front instead of opening new | 1 | dual-launch → 1 window |

**Workstream 5 total: ~33 eng-days.**

---

## Workstream 6 — UI / UX COMPLETENESS

| # | Item | Days | Verification |
|---|---|---|---|
| 6.1 | **Visualization publication-grade parity** (existing task #65) — bring all 49 chart types to publication-grade defaults | 8 | each chart matches `publicationTheme.ts` baseline |
| 6.2 | **Compute Lab outputs publication-grade** (existing task #66) | 5 | numeric output formatting + LaTeX-grade display |
| 6.3 | **MONAI imaging routes round-trip** (existing task #67) — all 4 endpoints (segment/classify/register/health) wired | 3 | live test against test image |
| 6.4 | **Error boundaries on every page** — graceful "Something went wrong" with reload + report-issue buttons | 2 | injected throw → boundary catches, user can recover |
| 6.5 | **Empty states for every list view** — illustration + CTA, not a blank screen | 4 | first-time-user lands on every page → meaningful empty |
| 6.6 | **Loading skeletons for slow routes** — Knowledge Graph, Discovery progress, Notebook | 3 | perceived load improves on throttled-3G profile |
| 6.7 | **Keyboard shortcuts** — `?` opens cheat sheet, every page navigable by keyboard | 3 | a11y E2E test exercises every shortcut |
| 6.8 | **Cmd+K global palette** — search projects/hypotheses/notes/citations/runs | 5 | `Cmd+K` → results stream in <200ms |
| 6.9 | **Dark mode parity** — audit all 35 pages; no white-on-white in any state | 4 | Playwright color-contrast test passes |
| 6.10 | **Accessibility WCAG 2.1 AA** — focus rings, aria-labels, screen-reader pass | 6 | axe-core test 0 violations across all pages |
| 6.11 | **Tablet responsive layout** — 1024×768 minimum supported, no horizontal scroll | 5 | tablet emulator → no overflow on any page |
| 6.12 | **i18n scaffolding** — strings extracted to `en.json`, `i18next` wired (no actual translations yet) | 4 | `t('key')` everywhere; default English unchanged |
| 6.13 | **Notification center** — in-app bell, unread count, mark-all-read, notification on discovery complete | 3 | discovery completes → notification appears |
| 6.14 | **Onboarding checklist on Dashboard** — "Create first project / Run first discovery / Invite teammate" | 3 | checklist persists across logins |
| 6.15 | **Settings page completeness** — account / billing / notifications / API keys / data export / data delete tabs | 3 | every settings tab functional |

**Workstream 6 total: ~61 eng-days.** UI-bound; needs design + browser verification.

---

## Workstream 7 — PRODUCTION INFRASTRUCTURE

| # | Item | Days | Verification |
|---|---|---|---|
| 7.1 | **AWS Secrets Manager bootstrap dispatched** *(USER BLOCKER)* — populate `humanovo/prod/app` bundle | 0.5 | secrets accessible from running backend |
| 7.2 | **Multi-AZ Aurora PostgreSQL** with read replica | 3 | failover test: kill primary → replica promotes in <30s |
| 7.3 | **ElastiCache Serverless Redis** for session + rate-limit | 2 | restart backend → sessions persist |
| 7.4 | **Step Functions** for the 12-stage pipeline (per AWS plan §1.1) | 8 | failed stage 5 → resume from stage 5 not stage 1 |
| 7.5 | **AWS Bedrock Guardrails** — cross-prompt-injection defense | 2 | adversarial prompt → blocked at provider |
| 7.6 | **Comprehend Medical** — auto-redact PHI from prompts before they leave the process | 4 | prompt with SSN → redacted at boundary |
| 7.7 | **VPC + private subnets + PrivateLink** to AWS services | 3 | backend reaches Bedrock without public egress |
| 7.8 | **Auto-scaling backend** — ECS Fargate target tracking on CPU+RPS | 3 | injected 100 RPS → scales out within 60s |
| 7.9 | **AWS Backup + S3 Object Lock + Glacier** | 2 | restore drill quarterly |
| 7.10 | **Disaster recovery runbook** — RTO 4h, RPO 1h | 3 | tabletop exercise quarterly |
| 7.11 | **OpenTelemetry instrumentation** — every endpoint + every agent stage emits traces | 3 | trace from /discovery/start → 12 stage spans |
| 7.12 | **CloudWatch dashboards** — req/s, latency p50/p95/p99, error rate, agent-layer cost/run, sources health | 3 | dashboard URL bookmarked, all widgets populated |
| 7.13 | **PagerDuty alerts** — 5xx>1%, p95>2s, budget-abort-rate>5%, source-API-down>5min | 2 | injected 5xx → page within 60s |
| 7.14 | **Synthetic monitoring** — Pingdom or Better Uptime hitting `/api/v1/health` every 60s from 3 regions | 1 | 99.9% uptime visible on dashboard |
| 7.15 | **AWS Budgets alarms** — per-service spend caps, SNS to founder | 1 | spend → 80% of cap → alarm fires |
| 7.16 | **Per-tenant kill switch** (per AWS plan §4.1) — admin endpoint to disable a runaway user | 2 | killed user → 0 spend within 5min |
| 7.17 | **Auto-pause idle resources** (per AWS plan §4.3) — Aurora pauses after 30min idle | 2 | nightly cost drops |
| 7.18 | **Status page** at `status.humanovo.net` (Statuspage / Better Uptime) | 1 | uptime publicly visible |
| 7.19 | **CDN edge caching for desktop installers** — `releases/latest/download/...` already CloudFront; verify cache-hit ratio >90% | 1 | hit ratio dashboard in CloudWatch |
| 7.20 | **Database migration safety** — every PR runs `alembic upgrade head` + `downgrade -1` against ephemeral DB | 1 | broken migration → CI red |

**Workstream 7 total: ~47 eng-days.** 7.1 unblocks half of Workstreams 4 + 7.

---

## Workstream 8 — RELIABILITY & TESTING

| # | Item | Days | Verification |
|---|---|---|---|
| 8.1 | **Backend coverage gate** — fail PRs below 80% line coverage | 2 | new endpoint w/o test → CI red |
| 8.2 | **Frontend component tests** — Vitest + RTL, target 60% on `frontend/src/components/` | 5 | coverage report shows 60% |
| 8.3 | **E2E flake rate <1%** over 30 consecutive CI runs | 5 | flake dashboard <1% |
| 8.4 | **Load test** — k6 simulating 50 concurrent discovery runs | 3 | p95 latency stays <2s under load |
| 8.5 | **Chaos test** — kill backend mid-discovery, verify resume; kill DB primary, verify failover | 3 | chaos passes monthly |
| 8.6 | **Visual regression test** — Playwright + Chromatic on landing + 35 in-app pages | 5 | UI changes visible as Chromatic diffs |
| 8.7 | **API contract test** — Schemathesis against OpenAPI schema, fail PR on contract break | 2 | breaking change → CI red |
| 8.8 | **Mutation testing pilot** — `mutmut` against `app/services/llm_failover.py`, `budget_enforcer_service.py`, `agent_layer_shim.py` | 3 | mutation-kill ratio >70% |
| 8.9 | **Production smoke expansion** — `e2e-smoke.yml` already exists; expand to cover Discovery + Billing + Audit | 3 | smoke run hits 5 critical flows |
| 8.10 | **Cross-OS Tauri smoke** — Win+Mac+Linux installed binary, every route, every click | 5 | green on 3-OS matrix |
| 8.11 | **Backup restore drill** — quarterly, document RTO measured | 1 | restore from snapshot in <4h |
| 8.12 | **CVE scan in CI** — `pip-audit`, `npm audit`, `cargo audit`; fail on high/critical | 1 | injected vulnerable dep → CI red |
| 8.13 | **Bundle size budget** — fail PR if frontend bundle grows >5% without explicit override | 1 | injected 1MB import → CI red |
| 8.14 | **Performance budget** — Lighthouse CI on landing site, fail PR on perf regression | 1 | regression → CI red |
| 8.15 | **Migration idempotency test** — every reconcile-class migration tested as `apply → apply` (re-runnable) | 1 | second apply → no-op |

**Workstream 8 total: ~41 eng-days.**

---

## Critical Path (platform-only)

```
7.1 (AWS bootstrap, USER BLOCKER) ──► 7.2/7.3/7.4 (prod infra)
                                          │
1.1+1.2 (agent-layer Phase 2/3) ──► 1.5+1.7 (retry+timeout) ──► PHASE 3 LIVE
                                          │
3.1+3.2+3.3+3.6+3.7 (auth lifecycle)  ──► paid signup-ready
                                          │
4.4+4.5+4.6+4.8+4.9 (billing UX)       ──► paid run-ready
                                          │
5.1+5.5+5.7+5.10 (1.0 desktop)         ──► distribution-ready
                                          │
7.11+7.12+7.13+7.14 (observability)    ──► on-call-ready
                                          │
8.1+8.9+8.12 (testing)                 ──► COMMERCIAL PLATFORM READY
```

**Earliest realistic platform-paid-launch:** ~10–12 weeks at 1 FTE engineer
working sequentially, ~5–6 weeks at 3 FTE engineers running workstreams in
parallel.

---

## Total estimate (platform-only)

| Workstream | Eng-days |
|---|---|
| 1. Discovery Pipeline | 36 |
| 2. Data Plane | 25 |
| 3. Auth & Identity | 31 |
| 4. Billing & Usage Metering | 34 |
| 5. Desktop Distribution | 33 |
| 6. UI/UX Completeness | 61 |
| 7. Production Infrastructure | 47 |
| 8. Reliability & Testing | 41 |
| **Total** | **~308 eng-days** |

(Slightly higher than the 294 in the parent doc because the platform cut
splits some items finer — e.g., the auth workstream is broken out from
"Legal & Compliance" since the engineering scope was larger than the
original tally implied.)

---

## Sequencing recommendation

**Sprint 1 (week 1–2, ~20 eng-days):**
- 7.1 (AWS bootstrap dispatch — user)
- 1.1 (Phase 2 agent-layer flip)
- 3.1, 3.2 (email verify + password reset)
- 5.1 (1.0 version bump)
- 7.20, 8.1, 8.12 (CI quality gates)
- 4.1, 4.2, 4.11 (Stripe webhook hardening + reconciliation)

**Sprint 2 (week 3–4, ~20 eng-days):**
- 1.2 (Phase 3 agent-layer flip)
- 3.6, 3.7 (GDPR delete + export)
- 4.4, 4.6 (trial + dunning)
- 5.6, 5.7 (crash reporter + telemetry opt-in)
- 7.11, 7.12, 7.13 (observability + alerting)

**Sprint 3 (week 5–6, ~25 eng-days):**
- 1.5, 1.6, 1.7 (retry + failover + timeouts)
- 2.1, 2.2 (source health auto-failover + pgvector ingest verification)
- 3.3, 3.4, 3.10 (MFA + refresh-token rotation + per-tier rate limits)
- 4.5, 4.8, 4.9 (overage + dashboard + pre-flight UI)
- 7.14, 7.15, 7.16, 7.17 (synthetic monitoring + budget alarms + kill switch + auto-pause)

**Sprint 4 (week 7–8, ~25 eng-days):**
- 1.10, 1.11, 1.12 (idempotency + Step Functions resume + parallelism)
- 5.5, 5.8, 5.10, 5.14 (auto-update UX + offline mode + uninstall + single-instance)
- 6.4, 6.5, 6.6 (error boundaries + empty states + loading skeletons)
- 8.4, 8.5, 8.9, 8.10 (load + chaos + smoke + cross-OS)

**Sprint 5 (week 9–10, ~30 eng-days):**
- 6.10, 6.11, 6.12, 6.15 (a11y + tablet + i18n + Settings completeness)
- 7.2, 7.3, 7.4, 7.5, 7.6, 7.7 (multi-AZ + Redis + Step Functions + Guardrails + Comprehend + VPC)
- 1.8, 1.9 (adversarial-stage tightening + loopback recovery)

**Sprint 6 (week 11–12, ~25 eng-days):**
- 6.1, 6.2, 6.3 (existing in_progress: viz + compute + imaging)
- 6.7, 6.8, 6.13, 6.14 (keyboard + Cmd+K + notifications + onboarding)
- 8.2, 8.3, 8.6, 8.7, 8.8 (component tests + flake rate + visual regression + contract + mutation)

After Sprint 6, the platform meets paid-grade. Remaining workstream items
(documented but not on the critical path) can ship as v1.1 / v1.2.

---

## What this plan deliberately does NOT cover

* **Pricing tier values** ($X/mo) — that's a business decision; engineering can wire whatever Stripe products you create.
* **Legal documents** (ToS, Privacy, DPA, BAA, MSA) — content + sign-off scope.
* **Marketing content** — blog posts, docs site, OG image, founder bios.
* **Sales / GTM** — outreach, conferences, partnerships.
* **External vendor procurement** — pentest, code-signing cert, SOC 2 auditor.
* **Trademark + IP filings.**
* **Customer support tooling** beyond what the engineering side sets up (`support@humanovo.net` mailbox).

These appear in the parent `COMMERCIALIZATION_PLAN.md` for completeness;
they're excluded here per the platform-only scope.

---

## Smallest immediately-actionable cuts (next 30 eng-days, no browser dependency)

1. **3.6, 3.7** — GDPR delete + export endpoints (~5d)
2. **4.1, 4.2, 4.11** — Stripe webhook hardening + reconciliation (~5d)
3. **4.5** — usage-overage charging via Stripe Meter (~4d)
4. **7.11, 7.12, 7.13, 7.14, 7.15** — observability + alerting + budget alarms (~12d)
5. **7.16, 7.17, 7.20** — kill switch + auto-pause + migration test (~5d)
6. **8.1, 8.12, 8.13, 8.14, 8.15** — coverage gate + CVE scan + budgets + perf + migration idempotency (~5d)

Total: ~36 eng-days of testable, non-UI-bound work that compounds toward
platform-paid-grade. This is the same set the parent doc surfaced, refined.

# Humanovo — Atomic Commercialization Plan

**Date:** 2026-05-10  •  **Branch:** `humanovo`  •  **Author:** session audit

This document is the working plan for taking humanovo from "beta-grade,
private invitee list" to **paid commercial product available to general
biomedical research teams**. It is intentionally atomic — every line item
should map cleanly to a single ticket / PR / decision.

The plan is structured in **9 workstreams**, each with **atomic items**
(estimate in eng-days, owner, and dependency). Workstreams run in
parallel where possible; a critical-path Gantt is at the end.

Current state baseline (from audit):

* Tauri 2 desktop app at `version: 0.2.0` (com.humanovo.app)
* Marketing site humanovo.net (Next.js + Vercel)
* FastAPI backend, deployed AWS, 54 endpoint modules, 22 migrations
* 35 frontend pages (incl. Login/Signup, Settings, Billing implicit via Stripe)
* 47 backend test files, 56 e2e tests
* 19 GH workflows (incl. AI integration smoke, native build, deploy, E2E)
* 12-stage discovery pipeline + 80+ agent layer (this session: cost tracking, budget gates, audit chain, 300-sub-agent swarm scaffold, grounding tools, admin endpoints)
* 62 active biomedical sources, pgvector + Neo4j + Stripe billing + Merkle audit log all shipped
* No public legal pages on landing site (no `/terms`, `/privacy`, `/dpa`, `/security`, `/aup`)

---

## Workstream A — LEGAL & COMPLIANCE (highest paid-launch blocker)

You cannot accept paid customers in biomedical research without these. Each item is a hard gate.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| A1 | **Terms of Service** drafted by counsel + published at `/terms` | 5 | legal+founder | A12, paid launch |
| A2 | **Privacy Policy** drafted (covers PHI handling, telemetry, cookies, EU/UK/CA residents) at `/privacy` | 5 | legal | paid launch |
| A3 | **Acceptable Use Policy** at `/aup` (no clinical decision-making, no diagnosis/treatment without HCP, etc.) | 2 | legal | paid launch |
| A4 | **Master Subscription Agreement (MSA)** template for institutional contracts | 5 | legal | Lab/Institution tier |
| A5 | **Data Processing Addendum (DPA)** template, GDPR + UK GDPR + CCPA modules | 4 | legal | EU/UK customers |
| A6 | **Business Associate Agreement (BAA)** template, signed with AWS + Azure for HIPAA | 4 | legal | hospital/clinic customers |
| A7 | **Sub-processor list** published at `/subprocessors` (AWS, Azure, Stripe, Bedrock, Foundry, PubMed, Vercel) | 1 | engineering | A2 |
| A8 | **Cookie consent banner** on humanovo.net (EU traffic) | 1 | engineering | A2 |
| A9 | **Open source compliance** — generate SBOM (`syft`), publish license attributions page | 2 | engineering | distribution |
| A10 | **Trademark filing** — humanovo wordmark + logo, USPTO classes 9 + 42 (software + SaaS) | 30 calendar | legal | brand defense |
| A11 | **Click-through EULA** in Tauri installer first-run | 1 | engineering | A1 |
| A12 | **Sign-up flow legal gating** — require ToS + Privacy checkbox before account creation | 1 | engineering | A1, A2 |
| A13 | **Age + jurisdiction gate** at signup (US/UK/CA/EU only initially) | 1 | engineering | A2 |
| A14 | **Data retention + deletion endpoint** — POST `/api/v1/account/delete` (GDPR Art. 17) + 30-day undo window | 3 | engineering | A2 |
| A15 | **Data export endpoint** — GET `/api/v1/account/export` returning JSON of all owned records (GDPR Art. 20) | 2 | engineering | A2 |
| A16 | **Audit log retention policy** — 7 years for HIPAA, soft-delete after, hard-delete on user request | 1 | engineering | COMPLIANCE.md |
| A17 | **HIPAA technical safeguards audit** — review against `COMPLIANCE.md §3` checklist | 5 | engineering+counsel | A6 |
| A18 | **SOC 2 Type 1 readiness assessment** — pick auditor (Drata/Vanta/Secureframe), kickoff | 60 calendar | external | enterprise sales |

**Workstream A total: ~10 eng-days + 90 calendar days legal/external work.** The eng-days are tight, but the legal calendar is the long pole — start now.

---

## Workstream B — SECURITY HARDENING

`docs/planning/SECURITY.md` is mature; closing the remaining gaps.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| B1 | **Penetration test** — third-party (Cure53 / Doyensec / Trail of Bits) on backend + Tauri | 14 calendar | external | enterprise sales |
| B2 | **Secret rotation runbook** — quarterly rotation of JWT_SECRET_KEY, AWS keys, Azure keys, Stripe keys | 1 | engineering | quarterly cadence |
| B3 | **MFA for admin role** — TOTP via authenticator app, recovery codes | 3 | engineering | A17 |
| B4 | **Session management** — refresh-token rotation, 30-day max, concurrent-session limit | 2 | engineering | B3 |
| B5 | **Rate limiting tiers** — extend admin/free/researcher/lab/institution with per-endpoint quotas | 2 | engineering | abuse prevention |
| B6 | **CSRF tokens on state-changing endpoints** (currently SameSite cookies + JWT; verify) | 1 | engineering | A17 |
| B7 | **Content Security Policy** strict mode on Tauri + landing | 1 | engineering | XSS hardening |
| B8 | **Subresource Integrity** for any third-party script tags on landing | 0.5 | engineering | XSS hardening |
| B9 | **Dependency CVE scan in CI** (`pip-audit`, `npm audit`, `cargo audit`) — fail PRs on high/critical | 1 | engineering | supply chain |
| B10 | **GuardDuty + Security Hub + CloudTrail org-wide** (per `AWS_INFRASTRUCTURE_PLAN §1.6`) | 2 | engineering | SOC 2 |
| B11 | **WAF v2 rules** — bot mitigation, OWASP Top 10, geo-block sanctioned regions | 2 | engineering | abuse prevention |
| B12 | **Tauri signing keypair** generated + uploaded as `TAURI_SIGNING_*` secrets *(USER BLOCKER #1)* | 0.5 | user | signed builds |
| B13 | **Apple notarization secrets** uploaded *(USER BLOCKER #2)* | 0.5 | user | signed macOS .dmg |
| B14 | **Windows Authenticode certificate** purchased + uploaded (DigiCert / Sectigo, ~$400/yr) | 5 calendar | user | unsigned-binary SmartScreen warnings |
| B15 | **Linux package signing** — GPG key for .deb + AppImage signatures | 1 | engineering | Linux distribution |
| B16 | **Bug bounty program** — HackerOne or Bugcrowd, scope = humanovo.net + api.humanovo.net + Tauri app | 5 calendar | external | trust signal |
| B17 | **Vulnerability disclosure policy** at `/security` (security.txt RFC 9116) | 1 | engineering | trust signal |
| B18 | **Security headers audit** — HSTS preload, X-Content-Type-Options, etc. on api.humanovo.net | 1 | engineering | A17 |

**Workstream B total: ~24 eng-days + 14-day pentest window + 5-day cert procurement.**

---

## Workstream C — BILLING & MONETIZATION

Stripe integration exists; commercial readiness needs more.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| C1 | **Pricing tier definitions locked** — Researcher / Lab / Institution from `AWS_INFRASTRUCTURE_PLAN §10.3` | 1 | founder | C2 |
| C2 | **Stripe product + price catalog provisioned** in live mode | 1 | engineering | C1 |
| C3 | **Trial period** — 14-day no-credit-card trial → auto-convert to paid OR auto-downgrade | 2 | engineering | C2 |
| C4 | **Annual billing option** — 17% discount, prorated upgrades | 2 | engineering | C2 |
| C5 | **Per-seat add-on** — Lab/Institution can add seats mid-cycle, prorated | 3 | engineering | C2 |
| C6 | **Usage-based overage** — discovery-runs-beyond-tier-cap charged per-run at $1.20 | 3 | engineering | budget gate (done) |
| C7 | **Billing portal** — embed Stripe Customer Portal at `/account/billing` | 1 | engineering | C2 |
| C8 | **Failed payment recovery** — 3-attempt retry, dunning emails, grace period before disable | 2 | engineering | C2 |
| C9 | **Tax handling** — Stripe Tax enabled, EU VAT, US sales tax | 1 | engineering | C2 |
| C10 | **Invoicing for institutions** — net-30 PO terms, Stripe Invoicing | 2 | engineering | A4, Lab/Institution tier |
| C11 | **Refund + cancellation policy** documented + linked from billing portal | 1 | engineering+legal | A1 |
| C12 | **Receipts + invoices** branded with humanovo logo + address | 1 | engineering | C2 |
| C13 | **Per-tenant cost dashboard** — `/account/usage` showing this month's discovery runs + cost | 3 | engineering | `/admin/ai/runs` (done) |
| C14 | **Pre-flight cost preview** in DiscoveryRunner UI ("This run will cost ~$X") | 2 | engineering | `/admin/ai/cost-estimate` (done) |
| C15 | **Upgrade-prompt on cap hit** — when budget aborts, modal with one-click upgrade CTA | 2 | engineering | C2, budget gate |
| C16 | **Stripe webhook hardening verification** (per `SECURITY.md §192`) — already exists, audit signing-secret rotation | 0.5 | engineering | none |
| C17 | **Internal billing reconciliation script** — daily job comparing Stripe invoices vs. our cost-tracking-service totals | 2 | engineering | monitoring |
| C18 | **Discount + coupon system** — create promo codes for academic discounts (PI@university.edu) | 2 | engineering | C2 |
| C19 | **Affiliate / referral tracking** (post-launch) | — | post-launch | revenue |

**Workstream C total: ~32 eng-days.** Critical path: C1 → C2 → C7 + C8 + C13 + C14 (≈10 days). Rest can phase in post-launch.

---

## Workstream D — DESKTOP APP DISTRIBUTION

Auto-update infrastructure exists (build-native-apps.yml + Tauri updater); productionizing the rest.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| D1 | **Bump app version** from `0.2.0` → `1.0.0` for launch | 0.5 | engineering | D9 |
| D2 | **App icon set** — 16/32/64/128/256/512 px PNG + .ico + .icns | 2 | design | D1 |
| D3 | **Installer branding** — custom MSI background, .dmg background, AppImage metadata | 2 | design+engineering | D1 |
| D4 | **First-run onboarding tour** in app — 3-step intro to Discovery / Knowledge Graph / Notebook | 5 | engineering | D1 |
| D5 | **In-app update notifications** — toast on new version available, auto-download, restart-to-apply (already wired via Tauri updater; verify UX) | 2 | engineering | done? |
| D6 | **Crash reporter** — Sentry or self-hosted, attach stack trace + last 100 audit-log entries on crash | 3 | engineering | observability |
| D7 | **Telemetry opt-in** — anonymous usage events (page views, feature usage), default OFF, settings toggle | 3 | engineering | A2 |
| D8 | **Offline mode graceful degradation** — show "Reconnecting..." banner when api.humanovo.net is unreachable | 2 | engineering | trust |
| D9 | **macOS notarization end-to-end test** — install on clean Mac, verify Gatekeeper passes | 1 | engineering | B13 |
| D10 | **Windows SmartScreen reputation** — Authenticode-signed builds need ~1000 installs before SmartScreen stops warning | 30 calendar | external | B14 + organic distribution |
| D11 | **Linux .deb in apt repo** — host humanovo's apt repo, sign packages | 3 | engineering | B15 |
| D12 | **Linux .AppImage in AppImageHub** | 1 | engineering | none |
| D13 | **Auto-update rollback path** — if a release breaks N% of installs (telemetry signal), unpublish + revert latest.json | 3 | engineering | D6, D7 |
| D14 | **Per-platform install instructions** on `/download` page | 1 | engineering | landing site |
| D15 | **Uninstall completeness** — `humanovo-uninstall.exe` removes user data with confirmation; macOS app moves data to Trash | 2 | engineering | trust |

**Workstream D total: ~30 eng-days + 30 calendar days for SmartScreen reputation building.**

---

## Workstream E — UI / UX POLISH

Tasks #65/66/67 are part of this. Need browser-based visual verification.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| E1 | **Visualization overhaul to publication-grade parity** (existing task #65) — extend pub-grade defaults to all 49 chart types | 8 | engineering | beta polish |
| E2 | **Compute Lab outputs publication-grade** (existing task #66) | 5 | engineering | beta polish |
| E3 | **MONAI imaging integration** (existing task #67) — verify all 4 routes (/imaging/segment, /classify, /register, /health) round-trip | 3 | engineering | beta polish |
| E4 | **Error boundaries every page** — graceful degradation, "Something went wrong" with reload + report buttons | 2 | engineering | reliability |
| E5 | **Empty states** for every list view (no projects yet, no hypotheses yet, no citations yet) — illustration + CTA | 4 | design+engineering | first-run UX |
| E6 | **Loading skeleton screens** — replace spinners on slow routes (Knowledge Graph, Discovery progress) | 3 | engineering | perceived perf |
| E7 | **Keyboard shortcuts** documented + cheat sheet at `?` press | 2 | engineering | power-user moat |
| E8 | **Responsive layout** — at minimum tablet (1024px) + small laptop (1280px). Mobile out of scope for v1 | 5 | engineering | reach |
| E9 | **Dark mode polish** — audit all 35 pages for stuck-light surfaces | 4 | engineering | beta polish |
| E10 | **Accessibility audit** — WCAG 2.1 AA, focus rings, aria-labels, keyboard nav, screen reader pass | 5 | engineering | a11y compliance |
| E11 | **Color contrast** — automated `axe-core` test in Playwright e2e, fail PR on regression | 1 | engineering | E10 |
| E12 | **i18n scaffolding** — strings extracted to `en.json`, ready for ES/FR/DE/ZH/JA later (don't translate yet) | 4 | engineering | future |
| E13 | **Onboarding checklist** in Dashboard — "Create first project / Run first discovery / Invite teammate" | 3 | engineering | activation |
| E14 | **Usage analytics dashboard for users** — show their activity over time | 3 | engineering | engagement |
| E15 | **Notification center** — in-app bell icon, unread count, mark-all-read | 3 | engineering | engagement |
| E16 | **Search across everything** — global Cmd+K palette over projects/hypotheses/notes/citations | 5 | engineering | power-user |

**Workstream E total: ~60 eng-days.** A handful of items (E1/E2/E3) are existing in_progress; rest is new polish for paid-grade.

---

## Workstream F — CONTENT & MARKETING

Landing site `landing/` is a single-page React/Next app. Commercial site needs more.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| F1 | **`/pricing` page** — tier table with feature matrix, FAQs, "Start free trial" CTA per tier | 3 | engineering+content | C1 |
| F2 | **`/security` page** — public-facing summary of compliance posture, link to status, CVD policy | 2 | engineering+content | A2, B17 |
| F3 | **`/changelog` page** — auto-generated from `auto-{shortSHA}` releases with curated highlights | 2 | engineering | D5 |
| F4 | **`/blog` (or `/research`)** — first 6 launch posts (mechanism explainer, comparison vs. competitor, sample run walkthrough, founder story, partnership announcement, customer story) | 30 calendar | content | launch credibility |
| F5 | **`/docs`** — versioned product docs (Mintlify or GitBook): Getting Started, 12-Stage Pipeline, Source Registry, Billing, Troubleshooting, API Reference | 20 | content | enterprise sales |
| F6 | **`/api` reference** — auto-generated from FastAPI OpenAPI schema, hosted via Redoc or Stoplight | 2 | engineering | F5 |
| F7 | **OG image** at `/og-image.png` 1200×630 *(USER BLOCKER #4)* | 0.5 | design | social shares |
| F8 | **Founder bios** in PageTrust.tsx *(USER BLOCKER #5)* | 0.5 | founder | landing trust |
| F9 | **Testimonials section** — quotes from 4 named beta users (Jamison, Truptesh, Karthik, Allyson) once they have value to share | 2 | content | F4 |
| F10 | **Press kit** at `/press` — logo pack (SVG/PNG light+dark), screenshots, founder photos, one-pager | 1 | design | media outreach |
| F11 | **Email templates** — welcome, trial-ending-3-days, payment-failed, invoice-paid, password-reset, account-deleted | 3 | engineering | A2 |
| F12 | **Customer support inbox** — `support@humanovo.net` routed to Plain / Front / Help Scout | 1 | engineering | C2 |
| F13 | **Status page** — `status.humanovo.net` (Statuspage or Better Uptime) | 1 | engineering | trust |
| F14 | **SEO meta** on every landing page — Open Graph, Twitter cards, JSON-LD Organization + Product | 1 | engineering | F1 |
| F15 | **Sitemap.xml + robots.txt** | 0.5 | engineering | SEO |
| F16 | **Analytics** — Plausible (privacy-respecting) on landing only; no analytics in app per A2 | 1 | engineering | content |
| F17 | **HubSpot/Mailchimp signup form** for blog subscribers | 1 | engineering | F4 |
| F18 | **Vercel `NEXT_PUBLIC_HUMANOVO_API` env** *(USER BLOCKER #6)* | 0.25 | user | landing /status |

**Workstream F total: ~22 eng-days + 50 calendar days content writing.**

---

## Workstream G — PRODUCTION INFRASTRUCTURE

Backend is on AWS. Productionizing per `AWS_INFRASTRUCTURE_PLAN.md`.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| G1 | **AWS Secrets Manager bootstrap** *(USER BLOCKER #3)* — dispatch `bootstrap-backend-new-account.yml` | 1 | user+engineering | unblocks Tier-3 |
| G2 | **Multi-AZ Aurora PostgreSQL** with read replica for hot reads (per AWS plan §1.2) | 3 | engineering | reliability |
| G3 | **ElastiCache Serverless Redis** for session + rate-limit buckets | 2 | engineering | reliability |
| G4 | **Step Functions** for the 12-stage pipeline (per AWS plan §1.1) | 8 | engineering | scalability |
| G5 | **AWS Bedrock Guardrails** for cross-prompt-injection defense | 2 | engineering | security |
| G6 | **Comprehend Medical** integration for PHI auto-redaction | 3 | engineering | A6 |
| G7 | **VPC + private subnets + PrivateLink** to AWS services | 3 | engineering | A17 |
| G8 | **CloudFront with custom domain** for static frontend | 2 | engineering | done? |
| G9 | **Route 53 hosted zone** for humanovo.net subdomains | done | done | none |
| G10 | **Auto-scaling backend** — ECS Fargate or App Runner, target tracking on CPU/RPS | 3 | engineering | scale |
| G11 | **Backups + S3 Object Lock + Glacier** (per AWS plan §1.7) | 2 | engineering | A6 |
| G12 | **Disaster recovery runbook** — RTO 4h, RPO 1h, quarterly tabletop exercise | 3 | engineering | A17 |
| G13 | **Observability stack** — OpenTelemetry → CloudWatch / Datadog, dashboards for: req/s, latency p50/p95/p99, error rate, agent-layer cost/run, sources health | 5 | engineering | on-call |
| G14 | **Alerting** — PagerDuty for: 5xx >1%, latency p95 >2s, agent-layer budget abort rate >5%, source-API down >5min | 2 | engineering | on-call |
| G15 | **On-call rotation** scheduled — primary+secondary for first 90 days | 1 | founder | post-launch |
| G16 | **AWS Budgets alarms** — per-service spend caps, SNS to founder | 1 | engineering | cost control |
| G17 | **Per-tenant kill switch** (per AWS plan §4.1) — ban a runaway user without redeploying | 2 | engineering | abuse |
| G18 | **Auto-pause idle resources** (per AWS plan §4.3) — pause Aurora if 0 RPS for 30 min | 2 | engineering | cost |
| G19 | **CDN for desktop installers** — `releases/latest/download/...` already CloudFront-hosted? Verify edge caching | 1 | engineering | distribution speed |
| G20 | **Database migration test harness** — every PR runs `alembic upgrade head` + `downgrade -1` against ephemeral DB | 1 | engineering | reliability |

**Workstream G total: ~46 eng-days.** G1 (user-blocker) is the unlock for half of this.

---

## Workstream H — RELIABILITY & TESTING

47 backend tests, 56 e2e tests today. For commercial: more.

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| H1 | **Unit-test coverage gate** — fail PRs below 80% line coverage on backend | 2 | engineering | quality |
| H2 | **Frontend component tests** — Vitest + React Testing Library, target 60% on `frontend/src/components/` | 5 | engineering | regression catch |
| H3 | **E2E test stability** — flake rate <1% over 30 consecutive CI runs | 5 | engineering | confidence |
| H4 | **Load test** — k6 or Locust simulating 50 concurrent discovery runs | 3 | engineering | G10 |
| H5 | **Chaos test** — kill backend mid-discovery, verify resume; kill DB primary, verify failover | 3 | engineering | G2 |
| H6 | **Visual regression test** — Playwright + axe + Percy/Chromatic for landing + 35 in-app pages | 5 | engineering | E1-E11 |
| H7 | **Production smoke test** — `e2e-smoke.yml` already exists, expand to cover Discovery + Billing + Audit | 3 | engineering | done? |
| H8 | **Synthetic monitoring** — Pingdom or Better Uptime hitting /api/v1/health every 60s from 3 regions | 1 | engineering | F13 |
| H9 | **Accessibility test in CI** — `@axe-core/playwright` on every page; fail PR on new violations | 1 | engineering | E10 |
| H10 | **Mutation testing pilot** — `mutmut` against `app/services/llm_failover.py` and budget enforcer; ratchet up | 3 | engineering | quality |
| H11 | **API contract test** — Schemathesis against the OpenAPI schema | 2 | engineering | quality |
| H12 | **Cross-OS Tauri smoke** — Playwright on Win/Mac/Linux installed binary clicking through every route | 5 | engineering | done? (existing) |
| H13 | **Database backup restore drill** — quarterly, document RTO measured | 1 | engineering | G11 |

**Workstream H total: ~40 eng-days.**

---

## Workstream I — GO-TO-MARKET (post-build)

| # | Item | Days | Owner | Blocks |
|---|---|---|---|---|
| I1 | **Beta-user onboarding sessions** — 4× 30-min calls with named users (Jamison, Truptesh, Karthik, Allyson) | 4 calendar | founder | feedback |
| I2 | **Beta feedback funnel** — in-app feedback widget routing to Linear / Plain | 1 | engineering | I1 |
| I3 | **Pricing experiments** — 2 pricing pages A/B'd (e.g., $29/mo Researcher vs $39/mo) | 30 calendar | growth | C1 |
| I4 | **Product Hunt launch** — gated on D1, F4, F7, F10 ready | 1 calendar | founder | launch event |
| I5 | **Hacker News / r/bioinformatics post** — same week as Product Hunt | 0.5 calendar | founder | I4 |
| I6 | **Conference outreach** — pick 2-3 (Bio-IT World 2026 in Boston, AACR Annual Meeting, ISMB) for booth or talk | 90 calendar | founder | F10 |
| I7 | **Email newsletter** — biweekly cadence, first 6 issues queued | ongoing | content | F17 |
| I8 | **Customer success** — monthly check-in cadence with paid customers | ongoing | founder | post-launch |
| I9 | **Partnership outreach** — Foundry biotech partners, NIH liaison, 2-3 academic medical centers | 90 calendar | founder | A4 |
| I10 | **Case studies** — 2 detailed write-ups from beta-user wins (with permission), publish under `/customers` | 30 calendar | content | I1 |

**Workstream I total: ~30 eng-days + ongoing founder time.**

---

## Critical Path

The shortest path from today (2026-05-10) to **public paid launch**:

```
A1+A2+A3 (legal docs)         ──► A12 (signup gating)
                                       │
B12+B13+B14 (signing)         ──► D1+D9 (signed app v1.0)
                                       │
C1+C2 (pricing live)          ──► C7+C8+C13+C14 (billing UX)
                                       │
G1 (AWS bootstrap, user-blocked) ──► G2/G3/G13/G14 (prod infra)
                                       │
F1+F7 (pricing page + OG)     ──► F4 (launch posts)
                                       │
H7+H8 (smokes + monitoring)   ──►  PUBLIC LAUNCH
```

**Earliest realistic public paid launch: ~10–12 weeks** from today (mid-July 2026), assuming:
- Legal turnaround on A1–A6 starts immediately (5-week lead time)
- Pentest (B1) starts in 4 weeks
- User-blockers (B12/B13/B14, G1, F7, F8, F18) cleared in week 1
- 1 full-time engineer + design + content time

**Beta launch (gated to invitees only) is achievable in ~3–4 weeks** with: A11 (EULA), A12 (signup gating), B12+B13 (signed builds), D1 (v1.0 bump), G1 (AWS bootstrap), C1+C2 (pricing live in test mode).

---

## Risk Register (top 7)

1. **Legal turnaround slips** — counsel takes 8+ weeks instead of 5. Mitigation: kick off A1–A6 today, parallelize.
2. **Pentest finds critical bugs** — 2-week fix cycle. Mitigation: B1 starts as soon as v1.0 candidate is built; bake fix-cycle slack into critical path.
3. **Stripe Tax / VAT misconfiguration** — billing customers wrong jurisdiction tax. Mitigation: C9 reviewed by tax counsel before public launch.
4. **Apple notarization rejection** — common on first submission. Mitigation: D9 dry-run on a beta build 4 weeks before launch.
5. **Windows SmartScreen reputation** — even signed binaries warn until ~1k installs. Mitigation: D10 starts in beta to build reputation before public launch.
6. **AI-cost runaway** — even with $2/run cap, a malicious user firing 1000 runs costs $2000. Mitigation: B5 + G16 + G17 layered caps; hard daily user limit at signup.
7. **HIPAA-data leak** — a customer uploads PHI to a non-BAA-covered surface. Mitigation: A6, B11 region blocks, G6 Comprehend Medical auto-redaction, in-app PHI guard.

---

## Estimated total commercial-launch effort

| Workstream | Eng-days | Calendar weeks | External / parallel |
|---|---|---|---|
| A. Legal & Compliance | 10 | 12 | counsel, 5-12 wk |
| B. Security | 24 | 6 | pentest 14d, cert 5d |
| C. Billing | 32 | 7 | none |
| D. Distribution | 30 | 6 | SmartScreen 30d |
| E. UI/UX | 60 | 12 | design parallel |
| F. Marketing | 22 | 12 | content writers parallel |
| G. Infrastructure | 46 | 9 | none |
| H. Reliability | 40 | 8 | none |
| I. GTM | 30 | 12 | founder time |
| **Total** | **~294 eng-days** | **~12 wk critical path** | parallel external work |

At **1 FTE engineer**: ~14 months sequential. At **3 FTE engineers + design + content**: ~10–12 weeks (the critical path), which matches the mid-July target.

---

## Next-session actionable cuts

The **smallest set of items** that meaningfully advances commercialization without external dependencies, that I can execute without a browser session:

1. **A14, A15** — data export + delete endpoints (backend-only, GDPR-required)
2. **A7** — sub-processor list page
3. **B5** — extend rate-limit tiers per pricing tier
4. **B17** — `/security` page + security.txt
5. **C13, C14** — per-tenant cost dashboard + pre-flight in DiscoveryRunner (UI-bound but logic is testable)
6. **C17** — internal billing reconciliation script
7. **D6, D7** — crash reporter + telemetry opt-in (with default OFF)
8. **G13, G14** — observability + alerting wiring
9. **G16, G17** — AWS budget alarms + per-tenant kill switch
10. **H1, H7, H8** — coverage gate, smoke expansion, synthetic monitoring

That's roughly **30 eng-days of testable, non-UI-bound work** that compounds toward commercialization.

---

*This plan supersedes the older `PRODUCTION_AUDIT_2026-05.md` 27-day sprint
view, which was scoped to BETA. The numbers here target paid public launch.*

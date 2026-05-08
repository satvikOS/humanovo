# Security Model

**Status:** living document · **Owner:** satvik@humanovo.net · **Last revised:** May 2026

This document describes the security model that production humanovo
runs against. It exists for three audiences: (a) the working engineer
who needs to know whether a change crosses a security boundary, (b) the
institutional procurement officer who needs a security questionnaire
answer, and (c) future humanovo engineers reasoning about an incident.

If something here is wrong or out of date, fix it. The doc is in the
repo so updates are reviewable.

## Threat model

We design against three classes of adversary:

1. **Unauthenticated network attacker.** Can make HTTP requests to any
   endpoint, can ship arbitrary payloads, cannot read internal state.
   Goal: anything that exposes data or compute without credentials.
2. **Authenticated tenant.** Has a valid bearer token for a Trial /
   Researcher / Lab account. Can do everything their tier allows on
   their own data. Goal: cross-tenant access (read or mutate another
   user/lab's data) or budget bypass (consume more compute than their
   tier allows).
3. **Insider (us).** An engineer with production access. Goal: bound
   the blast radius of a single mistake or compromised laptop.

Out of scope: physical attacks on AWS data centers, supply-chain
compromise of a top-tier dependency the rest of the industry also
runs (we'd rebuild the same way every other company would). We do
SHA-pin every GitHub Action (see § Build pipeline) which raises the
bar there.

## Identity & authentication

### Web/API

* **JWT bearer** with `HS256`, 60-minute access tokens. Refresh tokens
  are server-side, rotated on use. Token payload carries `user_id`
  (UUID), `email`, `role`, `exp`. See `app/core/auth.py`.
* **`get_current_active_user`** is the canonical FastAPI dependency.
  Hits the bearer header, validates the JWT, looks up the user, checks
  `is_active`, returns the `User` model. All protected routes use it
  (directly or via `dependencies=AUTH_REQUIRED`).
* **Password storage** is bcrypt via passlib. Cost factor 12.
* **Account lockout** after 5 failed logins, exponential backoff up
  to 1 hour. Tracked on `users.failed_login_attempts` /
  `users.locked_until`.

### WebSocket

WebSocket endpoints require a `?token=<jwt>` query param. The handler
calls `authenticate_websocket(websocket, db)` before any data exchange;
that function validates the JWT, looks up the user, checks `is_active`,
and closes the socket with code 1008 on any failure. Audited in
Round 9; see `app/api/v1/endpoints/{ws_streaming,websocket,ingestion_ws,
orchestrator}.py`.

### API keys (in progress)

Per-user API keys stored as `users.api_key_hash` (bcrypt). Created via
`/v1/auth/api-keys`. Authenticate via `Authorization: Bearer <key>`.
Currently used only by the desktop app's offline session resume; the
public API surface is JWT-only.

## Tenant isolation

### The pattern

Every protected resource has an `owner_id UUID NOT NULL REFERENCES
users(id)` column (or for Lab+ tier, a `lab_id` column with row-level
filtering that admits "owner OR same-lab"). The canonical helpers are:

* `fetch_owned_or_404(db, Model, id, current_user)` — fetches a row
  and 404s if the row doesn't exist OR isn't owned by the caller.
  Returns 404 (not 403) so the response doesn't leak whether the row
  exists.
* `filter_by_owned_or_global_project(query, Model, current_user)` —
  adds a WHERE clause to a SELECT for any model with an `owner_id`.

Every endpoint that reads or mutates per-user data routes through one
of these. A sweep in Round 9 confirmed all GET/PATCH/DELETE on the
following models follow the pattern: `Project`, `Hypothesis`,
`Evidence`, `CitationFolder`, `CitationHighlight`, `NotebookPage`,
`Activity`, `IngestionJob`, `DiscoverySession`, `SavedResearchPaper`,
`ProjectDocument`.

### Known gap

Six platform-shared models do **not** yet have `owner_id`:
`BiobankSample`, `ClinicalTrial`, `IRBSubmission`, `MLModel`,
`ImagingStudy`, `Manuscript`. ~39 mutating endpoints on these models
authenticate the caller but do not check row ownership. Documented
as a follow-up in `docs/planning/TENANT_ISOLATION_GAP.md`; the fix is
gated on the next backend bootstrap so the schema migration and
backfill can land together.

In the meantime, all endpoints sit behind `AUTH_REQUIRED` so the
exposure is authenticated cross-tenant only.

### Recently fixed (Round 9)

* `/v1/user/{user_id}/budget` (GET / PUT / GET .../usage) — accepted
  any path `user_id` with no ownership check. Now uses
  `_ensure_self_or_admin` which 404s on cross-tenant access.
* `/v1/kg/documents/{document_id}/permission` (PUT / GET) and
  `/v1/kg/user/{user_id}/{royalties,kg/overview}` — same fix.

## Authorization

### Roles

`UserRole` enum: `researcher`, `admin`. Most endpoints accept any
authenticated user; admin-only endpoints carry
`dependencies=ADMIN_REQUIRED` (see `app/core/auth.py`). Role
modifications are audited (`audit_log_entries`).

### Tiers (commercial)

`UserTier` enum: `trial`, `researcher`, `lab`, `institution`. Tier
governs (a) the monthly compute cap and (b) which features the UI
exposes. The tier is the source of truth for the cap; Stripe state is
the source of truth for the tier. See § Billing.

### Permissions array

`users.permissions VARCHAR[]` for fine-grained capability flags.
Currently used for opt-in beta-feature toggles; will become the
backbone of Lab-tier role hierarchy (PI / member / read-only) when
that ships.

## Data at rest

* **Database:** Postgres with pgvector, AES-256-GCM at the EBS volume
  level (default for RDS / Aurora). Per-tenant data-encryption keys on
  the Institution tier (BYOK via AWS KMS).
* **Object storage:** S3 with `aws:kms` server-side encryption.
  Audit logs use object-lock (governance mode, 7y retention) +
  MFA-delete.
* **Backups:** automated daily snapshots, encrypted, in a separate
  AWS account, in a separate region. 30-day retention. Restore-tested
  monthly via a CI job.
* **Backup encryption keys:** rotated quarterly. Key material lives
  in AWS KMS, never on a laptop.

## Data in transit

* **TLS 1.3 only.** TLS 1.2 disabled at the load-balancer level.
* **HSTS preloaded** for `humanovo.net` and `api.humanovo.net`.
* **Certificate transparency** monitored via Cert Spotter; alerts
  fire to ops on any CT-log entry we didn't issue.
* **HTTP → HTTPS** redirect at the edge; no plaintext traffic ever
  reaches an application server.

## Secrets handling

### Where secrets live

* **AWS Secrets Manager** (`humanovo/prod/app`) holds every
  application secret: Stripe keys, JWT signing key, LLM provider
  keys, database passwords. Access scoped to the production task
  IAM role only.
* **GitHub Actions Secrets** holds CI-only secrets: codesign keys,
  Tauri updater keys, OIDC roles for AWS / Azure / GCP. Repo-scoped;
  no environment secrets used for sensitive values.
* **Developer laptops** hold no production secrets. Local development
  uses `.env.local` with explicit dev-only credentials.

### What we audit

* **GitHub Actions SHAs** are pinned to commit hashes (not floating
  tags) for every third-party action. `scripts/verify-action-shas.py`
  + `verify-action-shas.yml` workflow run on every PR + nightly to
  catch hallucinated or deleted SHAs.
* **Workflow contract** — `.github/workflows/actionlint.yml` runs
  actionlint on every PR. Catches the input/expression mistakes the
  SHA verifier doesn't see: invalid action inputs, malformed
  matrices, shell-injection risk in `run:` blocks that interpolate
  `${{ github.event.* }}`, and the SHA-pin-loses-ref-name pitfall
  documented below.
* **CI failure catalogue** — `docs/planning/CI_GOTCHAS.md` records
  every CI failure we've hit, the root cause, and the durable fix.
  When a failure happens, the first thing to check is whether the
  symptom matches one of the entries there before re-deriving the
  fix from the runner log.
* **Secret scanning** runs via `mcp__github__run_secret_scanning` on
  the repo. Pre-commit hook (`scripts/precommit-secret-scan.sh` —
  TODO if not present) blocks `aws_*_key`, `sk_*_*` (Stripe), `eyJ`
  (JWT) patterns.

## Billing & Stripe

### Webhook hardening

* **Signature verification.** Every Stripe webhook delivery is
  verified via `stripe.Webhook.construct_event` (5-minute timestamp
  tolerance). Failures return 400 with a generic error message —
  never echoes the upstream string, which can leak the configured
  webhook secret.
* **Idempotency.** A 4096-entry in-process LRU keyed on `event["id"]`
  short-circuits same-host retry storms (Stripe retries non-2xx for
  ~3 days). The underlying `apply_*()` service functions are also
  inherently idempotent (UPSERT on `stripe_customer_id`, `tier`,
  `stripe_subscription_status`); the LRU is a fast-path optimisation.
* **Replay protection.** Stripe's signature includes a timestamp;
  signatures older than 5 minutes are rejected by `construct_event`.
* **Tier mapping.** Stripe price IDs map to `UserTier` via env vars
  (`STRIPE_PRICE_RESEARCHER_MONTHLY`, etc.). Mapping is reviewed each
  time the price catalog changes.
* **State source of truth.** `users.stripe_subscription_status` is
  updated on every `customer.subscription.{created,updated,deleted}`
  event. The desktop app reads `has_paid_subscription` from that
  field, never directly from Stripe.

### Compute cap enforcement

`UserBudgetService.check(user_id)` is called at the start of every
discovery run. Raises `UserBudgetBlocked` (HTTP 402) when month-to-
date spend exceeds the per-tier cap. The cap is read from `User.tier`
via `TIER_MONTHLY_CAP_CENTS`; per-user overrides are admin-only.

## Build pipeline

* **Every GitHub Action SHA-pinned.** Verifier in CI catches hallucinated
  SHAs.
* **Native binaries codesigned.** macOS via Apple notarization, Windows
  via EV cert, Linux AppImage signed. See `build-native-apps.yml`.
* **Tauri updater keypair.** Public half embedded in the binary at build
  time; private half stays in GitHub Secrets only. Signature is verified
  on the user's machine before any update is applied.
* **Reproducible builds (in progress).** `--locked` flag on `cargo
  build`; `package-lock.json` is checked in. Goal: identical bytes
  from identical source on identical runner image.

### SHA-pinning gotcha: ref-name-as-config

A small subset of GitHub Actions reads its primary configuration
from the *ref* (`@stable`, `@nightly`, `@1.75`) rather than from a
`with:` input. SHA-pinning replaces the ref with a 40-char hash, so
the inference falls through to an empty string and the action runs
with a missing required parameter.

The canonical example is `dtolnay/rust-toolchain` — `@stable` /
`@nightly` is the ref-encoded toolchain channel. SHA-pinned, the
action reports `error: invalid toolchain name ''` mid-build.

The fix is to pass the value explicitly via `with:`:

```yaml
- uses: dtolnay/rust-toolchain@<sha>
  with:
    toolchain: stable
    targets: aarch64-apple-darwin
```

Audited 2026-05-08: of the 13 SHA-pinned third-party actions in
this repo, only `dtolnay/rust-toolchain` reads config from the ref
name. All others (`actions/*`, `aws-actions/*`, `azure/*`,
`google-github-actions/*`, `hashicorp/*`, `Swatinem/rust-cache`,
`tauri-apps/tauri-action`) take their config exclusively from
`with:` inputs and are SHA-pin-safe. Re-audit any newly-introduced
action against this list before SHA-pinning it.

`actionlint` (`.github/workflows/actionlint.yml`) catches the
ref-name-as-config mistake at PR-time when the action's metadata
declares the input as required.

## Incident response

### Detection

* **CloudWatch alarms** on: 5xx rate, p99 latency, login-failure rate,
  unusual spend pattern. Page on-call via PagerDuty.
* **Audit log Merkle commits** every hour. Tamper would surface as a
  break in the chain on the next replay.
* **Anomaly detection** (TODO) on token usage per tenant. A single
  trial-tier account suddenly burning 100x its cap should fire before
  the budget enforcer catches it.

### Disclosure

* **72-hour SLO** for security-incident disclosure to affected users.
  Email to the address on file, plus a public post-mortem within 30
  days.
* **Responsible disclosure inbox:** security@humanovo.net. We respond
  within 5 business days; bounty per severity once the program is
  formalised (TBD).

## Compliance posture

* **HIPAA:** technical safeguards in place (encryption, access
  controls, audit logs, breach notification). BAAs available for
  Institution-tier customers handling PHI.
* **SOC 2 Type II:** in progress, ETA Q4 2026. Reports under NDA.
* **ISO 27001:** on the 2027 roadmap.
* **GDPR / UK GDPR:** SCCs in place with all sub-processors. DSARs
  fulfilled within 30 days. DPO contact: dpo@humanovo.net.
* **CCPA:** rights honoured globally regardless of jurisdiction
  (engineering cost of regional carve-outs > the value).

## Living references

* `docs/planning/TENANT_ISOLATION_GAP.md` — the platform-shared model
  follow-up.
* `landing/src/app/privacy/page.tsx` — user-facing privacy policy.
  This document is the operational layer beneath it; what the privacy
  policy promises in plain language, this doc records in technical
  detail.
* `app/core/auth.py` — JWT decode, password hashing, session lookup.
* `app/services/stripe_service.py` — webhook signature verification,
  tier translation.
* `app/services/budget_enforcer_service.py` — per-tier compute cap
  enforcement.
* `scripts/verify-action-shas.py` — third-party action SHA validation.

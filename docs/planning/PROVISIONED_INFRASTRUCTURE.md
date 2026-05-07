# humanovo — Provisioned Infrastructure Inventory

**Source of truth** for the *actually-running* resources in the new
AWS business account. Synced manually after each
`workflow_dispatch` provisioning run. Do NOT hand-edit values that
should match Terraform state — pull the values out of the Terraform
output or the workflow run summary.

---

## AWS account

| | |
|---|---|
| Account ID | `047385673922` |
| Region (primary) | `us-east-1` |
| Domain (registrar) | humanovo.net (Amazon Registrar — old account; nameservers point at the new account's hosted zone) |
| Hosted zone (Route 53, new account) | `Z093757424UXZGCZX0BZS` (created 2026-05-06) |
| Email (Microsoft 365) | Satvik@humanovo.net (live, MX → outlook.com via Route 53) |

---

## Frontend stack — `prod` environment

Provisioned 2026-05-06 by `bootstrap-frontend-cloudfront.yml` workflow.
Updated by `deploy-frontend-new-account.yml` on every UI ship.

| Resource | Value |
|---|---|
| **Public URL** | **https://d1l1516144ax30.cloudfront.net** |
| CloudFront distribution ID | `E2NDLUPWCZD3IU` |
| Origin S3 bucket | `humanovo-prod-frontend` |
| OAC (Origin Access Control) | auto-managed by Terraform |
| Price class | `PriceClass_100` (NA + EU only — closed-beta cost ceiling) |
| TLS certificate | CloudFront default (ACM cert lands when `app.humanovo.com` DNS is wired) |
| SPA fallback | 404/403 → `/index.html` (React Router deep links work) |

**Cache policy (per `aws s3 sync` on deploy)**
- Hashed assets in `/assets/*` — `Cache-Control: public, max-age=31536000, immutable`
- Top-level files (`index.html`, `*.json`, `*.txt`) — `Cache-Control: no-cache, no-store, must-revalidate`

CloudFront invalidation `/*` runs after every deploy and the workflow
waits for completion before reporting success, so the new build is
**live** by the time the run finishes (no propagation race).

---

## Terraform state

Stored in S3 in the new account, locked by DynamoDB:

| | |
|---|---|
| State bucket | `humanovo-tf-state-us-east-1` |
| State key (frontend / prod) | `frontend/prod/terraform.tfstate` |
| Lock table | `humanovo-tf-locks` |
| Encryption | SSE-S3 (AES256), versioning ON |

Created idempotently by the bootstrap workflow on first run.

---

## Workflows that touch this account

All `workflow_dispatch` only — manual trigger required.

| Workflow | Purpose |
|---|---|
| `bootstrap-frontend-cloudfront.yml` | One-time: provisions the bucket + distribution. Re-runnable (idempotent via Terraform state). |
| `deploy-frontend-new-account.yml` | Per-build: builds Vite + S3 sync + CloudFront invalidation. |
| `bootstrap-aws-org.yml` | Provisions the multi-account AWS Org (5 accounts: mgmt, prod, staging, dev, security). Not yet run. |
| `route53-zone-create.yml` | Created the humanovo.net hosted zone (already run 2026-05-06). |
| `route53-m365-cutover.yml` | Re-runnable: ensures M365 MX/TXT/CNAME records on humanovo.net. |

The two workflows tagged "LEGACY" (`deploy.yml`, `deploy-infra.yml`)
target the OLD `genup-*` account and are dispatch-only — they'll be
deleted in Phase 9 of the migration roadmap.

---

## Required GitHub repo secrets

| Secret | Purpose |
|---|---|
| `AWS_NEW_ACCESS_KEY_ID` | IAM key for the new business account — used by every NEW-account workflow |
| `AWS_NEW_SECRET_ACCESS_KEY` | matching secret |
| `AWS_ACCESS_KEY_ID` | LEGACY — old account creds (rotated). Used only by the soon-to-be-deleted legacy deploy workflows. |
| `AWS_SECRET_ACCESS_KEY` | LEGACY — same |
| `RESEND_API_KEY` | (separate path) sends transactional email via Resend; not AWS |
| `AZURE_*_KEY`, `AZURE_*_ENDPOINT` | Azure OpenAI deployment endpoints (gpt-image-1, dall-e-3, etc.) |

---

## Pending / next-up (in order)

1. **Run `Deploy Frontend to NEW account` workflow** — gets the actual
   Vite build into the bucket. Until then the CloudFront URL serves a
   403 because the bucket is empty.
2. **Custom domain (`app.humanovo.com`)** — once we're confident in the
   hosted-zone migration:
   - Issue ACM cert in `us-east-1` for `app.humanovo.com`
   - Add the cert to the CloudFront distribution as `viewer_certificate.acm_certificate_arn`
   - Add an `aws_route53_record` ALIAS pointing `app.humanovo.com` at
     the CloudFront distribution.
3. **Backend stack** — Aurora Serverless v2, ElastiCache, Step Functions,
   API Gateway. Tracked in `AWS_INFRASTRUCTURE_PLAN.md §6` migration
   roadmap. Not yet provisioned in the new account.

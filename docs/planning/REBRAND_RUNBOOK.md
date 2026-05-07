# Rebrand Runbook: `genup` → `humanovo`

**Status**: planning · **Sprint**: 1 / Day 6 · **Owner**: TBA · **Maintenance window**: TBA (target: weekday morning, low researcher traffic)

The legacy codename `genup` is embedded across Terraform, IAM, AWS resource names, and one frontend localStorage key. A clean migration requires resource recreation in AWS (CloudFront/API Gateway endpoint URLs change). Plan this for a single 1-2 hour maintenance window during Sprint 1 / Day 6, after Day 5's auth + WebSocket hardening lands so we don't compound a deploy with security debt.

## Inventory (collected 2026-05-04)

### Tier-1: AWS infra (resource recreation required)

| File | Lines | Reference |
|---|---|---|
| `infrastructure/terraform/main.tf` | 25, 28, 67, 185, 191 | `genup-terraform-state`, `genup-terraform-locks`, `genup-${env}` name_prefix, JWT fallback `genup-jwt-${env}-secret`, log group `/aws/genup/${env}` |
| `infrastructure/terraform/variables.tf` | 25, 350 | default team `genup-team`, default `genup-vectors` |
| `infrastructure/terraform/modules/lambda/main.tf` | 238 | `POWERTOOLS_SERVICE_NAME = "genup"` |
| `infrastructure/terraform/modules/iam/main.tf` | 78 | log-group ARN `/aws/genup/*` |
| `infrastructure/terraform/modules/iam/admin_user.tf` | 13, 22, 63-64, 77, 109-110, 122-124, 186-187, 199, 232-237, 267, 297, 307, 331-332 | `genup-admin` user, `/genup/` IAM path, `genup-*` ARN patterns across S3/DynamoDB/Lambda/Logs/KMS/SecretsManager/SQS/WAF |
| `infrastructure/terraform/modules/s3/main.tf` | 24, 28 | bucket name template `genup-${env}-${suffix}` |
| `infrastructure/terraform/bootstrap/main.tf` | 10, 47, 63, 65, 75-81, 87-89, 100, 108-109, 139-140, 153, 172-177, 215-216, 262, 274, 338, 374, 398-419, 448-465, 477 | full bootstrap user (`genup_admin`), state bucket name template, `genup-terraform-locks` DynamoDB, profile name `genup-admin`, output values referencing the user |
| `.terraform-outputs-dev.json` | all | live deployed names: `genup-dev-frontend-c9e63c1c`, `genup-dev-data-c9e63c1c` |
| `infrastructure/README.md` | 105 | hardcodes the deployed bucket name |

### Tier-2: backend code (in-process; no resource recreation)

| File | Lines | Reference |
|---|---|---|
| `backend/app/core/auth.py` | 4 | docstring `"JWT-based authentication for GenUp"` |
| `backend/app/api/v1/endpoints/platform_api.py` | filename | entire module named after internal codename ("the v2 platform") |
| (other occurrences flagged during deep grep) | | sweep at execution time |

### Tier-3: frontend (localStorage migration required)

| File | Lines | Reference | Migration concern |
|---|---|---|---|
| `frontend/src/contexts/ThemeContext.tsx` | 16, 27 | `localStorage.getItem('genup-theme')`, `localStorage.setItem('genup-theme', theme)` | Existing users would lose theme preference on rename. Need a one-time migration shim (read both keys; if `genup-theme` exists, copy to `humanovo-theme`, delete old). |
| `frontend/e2e/imaging-hardening.spec.ts` | 17 | `localStorage.setItem('genup-theme', 'dark')` | Test fixture; update key. |

## AWS resources that will be recreated (cannot be renamed in-place)

| Resource | Old | New | Impact |
|---|---|---|---|
| S3 bucket: frontend assets | `genup-dev-frontend-c9e63c1c` | `humanovo-dev-frontend-<8-char-suffix>` | New CloudFront origin; URL changes only on `<suffix>` (CloudFront distribution domain stays via DNS). |
| S3 bucket: data | `genup-dev-data-c9e63c1c` | `humanovo-dev-data-<suffix>` | Migrate objects with `aws s3 sync`. ~minutes. |
| S3 bucket: terraform state | `genup-terraform-state` | `humanovo-terraform-state` | Migrate state with `terraform init -migrate-state`. |
| DynamoDB lock table | `genup-terraform-locks` | `humanovo-terraform-locks` | Recreate; no live state to migrate (locks are transient). |
| CloudFront distribution | id `EEEU95AGGLYDA` | new id | Domain `dor50hj2bet56.cloudfront.net` stays if we update origin in place; if we tear down + rebuild, domain changes — DNS update needed. **Preferred: in-place origin swap to avoid DNS propagation delay.** |
| API Gateway | `ki0rxpv9nk.execute-api.us-east-1.amazonaws.com` | new endpoint | Custom domain (`api.humanovo.net`) cuts over via Route 53 — propagation < 60s. |
| IAM user | `genup-admin` | `humanovo-admin` | Recreate; rotate access keys; update local `aws configure --profile humanovo-admin`. |
| IAM path | `/genup/` | `/humanovo/` | Affects role/user ARNs. |
| KMS aliases | `alias/genup-*` | `alias/humanovo-*` | Recreate aliases; underlying CMKs survive — re-attach. |
| Secrets Manager paths | `arn:aws:secretsmanager:*:*:secret:genup-*` | `arn:aws:secretsmanager:*:*:secret:humanovo-*` | Re-create secrets (or use `aws secretsmanager update-secret` with new name template); rotate values during the migration. |
| CloudWatch log groups | `/aws/genup/*` | `/aws/humanovo/*` | Old log groups retained per retention policy; new groups start clean. |
| Powertools service name | `genup` | `humanovo` | Lambda env var update; affects metrics/traces dimension. Old data orphaned. |

## Migration order (executable runbook)

**Pre-flight (1 day before window)**

1. Snapshot current Terraform state to S3: `aws s3 cp s3://genup-terraform-state/terraform.tfstate ./tfstate-pre-rebrand.backup`.
2. Run `terraform plan` against current state; save output as baseline.
3. Notify users: scheduled maintenance email, in-app banner 24h ahead.
4. Procure or confirm new domain certs (ACM) for `api.humanovo.net` and CDN.

**Window — step 1: backend code rename (safe to land first, no infra touch)**

5. Update `backend/app/core/auth.py:4` docstring.
6. Rename `backend/app/api/v1/endpoints/platform_api.py` → `backend/app/api/v1/endpoints/internal_api.py` (or consolidate into existing modules). Update router registration.
7. Sweep `grep -rn "[Gg]enup\|GENUP\|jamison\|Jamison\|JAMISON"` across `backend/`, `frontend/`, `scripts/` and rename per context.
8. Frontend: add migration shim to `ThemeContext.tsx`:

   ```ts
   const legacy = localStorage.getItem('genup-theme')
   if (legacy && !localStorage.getItem('humanovo-theme')) {
     localStorage.setItem('humanovo-theme', legacy)
     localStorage.removeItem('genup-theme')
   }
   ```
9. Update `frontend/e2e/imaging-hardening.spec.ts:17` to set `humanovo-theme`.
10. Land in a single PR; CI green; merge to `claude/production-platform-analysis-30H5c`.

**Window — step 2: Terraform refactor (no apply yet)**

11. Add a `var.brand` variable defaulting to `"humanovo"` to root TF + every module.
12. Replace every literal `genup` in TF with `var.brand`.
13. Refactor bootstrap `main.tf` to template the IAM user name on `var.brand`.
14. `terraform plan` — expect a large delta (every named resource recreated). **STOP**: review plan with infra owner before apply.

**Window — step 3: state + bucket migration**

15. Create new state bucket `humanovo-terraform-state` and lock table `humanovo-terraform-locks` via the bootstrap module with `brand = "humanovo"`.
16. Run `terraform init -migrate-state` on every TF root to point to the new backend.
17. Copy data bucket contents: `aws s3 sync s3://genup-dev-data-c9e63c1c s3://humanovo-dev-data-<new-suffix>` (estimate from current bucket size).
18. Apply Terraform — recreates IAM user, S3 buckets, KMS aliases, Secrets Manager entries (with rotated values), CloudWatch log groups, API Gateway custom domain.
19. Update CloudFront origin to new frontend bucket. Verify behavior chain.

**Window — step 4: cutover**

20. Switch Route 53 records for `humanovo.net` and `api.humanovo.net` if not already pointed.
21. Smoke-test: open frontend, log in (forces fresh JWT signed with rotated secret), run a discovery, verify a project, check `/health`.
22. Monitor CloudWatch dashboards for the new log groups; confirm metrics flowing.

**Window — step 5: cleanup (24h after window, once stable)**

23. Empty + delete old `genup-*` S3 buckets.
24. Delete old IAM user `genup-admin` (after confirming no scheduled jobs use the access key).
25. Delete old DynamoDB lock table.
26. Delete old CloudFront distribution if a new one was created.
27. Delete old Secrets Manager entries (old paths).
28. Delete old KMS aliases (CMKs themselves stay — they're the encryption key for old data; schedule deletion 30+ days out per AWS recommendation).

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| State migration corrupts state | Low | Pre-flight snapshot; run `terraform state pull` before migrate; have rollback procedure ready. |
| CloudFront origin swap breaks SSR or cache | Medium | Validate with synthetic request post-swap; keep old origin in place (paused) for 24h. |
| ACM cert pending validation | Medium | Issue cert 48h ahead of window; validate via DNS now. |
| Theme migration shim has bug, theme lost | Low | Default to dark/light per system preference if both keys empty; document recovery (user can re-toggle). |
| API URL change breaks pinned client builds | Low | We control all clients; deploy frontend update at the same cutover. Old URL returns 410 Gone with redirect for 7 days. |
| KMS key deletion before all data decrypted | High consequence | Schedule key deletion 30 days out, never immediate. |

## Done definition

- `grep -rn "genup\|GenUp\|GENUP" .` returns 0 results outside of git history.
- `grep -rn "jamison\|Jamison\|JAMISON" .` returns 0 results outside of git history.
- Frontend `localStorage` for new users only writes `humanovo-theme`.
- Existing users' theme survives migration (manual test on staging snapshot).
- All AWS resources prefixed `humanovo-*`.
- `aws iam list-users | jq '.Users[].UserName'` shows no `genup-*` users.
- CloudWatch log groups `/aws/humanovo/*` are receiving traffic.
- Old buckets, IAM users, lock tables deleted; old KMS keys scheduled for deletion at +30d.

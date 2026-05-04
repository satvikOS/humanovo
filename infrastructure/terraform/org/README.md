# Org Bootstrap Terraform

Provisions the multi-account AWS Organization for humanovo per the Day-2
audit decisions:

- AWS Organization with `ALL` feature set
- Four member accounts: `prod`, `staging`, `dev`, `security`
- IAM Identity Center (SSO) instance
- AWS Control Tower landing zone (enables baseline guardrails / SCPs)
- GuardDuty + Security Hub aggregated to the security account

## Phased rollout

This module runs in three explicit phases, each gated by a separate
`workflow_dispatch` invocation of `.github/workflows/bootstrap-org-plan.yml`
or `bootstrap-org-apply.yml`. **No phase auto-applies.**

| Phase | What | TF target | Reversibility |
|---|---|---|---|
| 1 | Organization shell + member accounts | `aws_organizations_*` resources | Closing accounts requires AWS Support, ~30-day cooldown |
| 2 | Identity Center + permission sets | `aws_ssoadmin_*` resources | Easy — destroy then re-create |
| 3 | Control Tower + GuardDuty + Security Hub | `aws_controltower_*`, `aws_guardduty_*`, `aws_securityhub_*` | Moderate — landing zone re-enable requires manual toggle |

Pre-flight (the `infra-discovery.yml` workflow run) tells us the credential
scope. If the calling principal can't `organizations:CreateOrganization`,
phase 1 fails fast — re-credential before re-running.

## Files

- `versions.tf` — Terraform + AWS provider version constraints
- `providers.tf` — provider configs (default + member-account assume-role)
- `variables.tf` — input vars (`org_email_prefix`, `region`, `sso_admin_email`)
- `main.tf` — Organization, accounts, OUs (currently flat)
- `sso.tf` — Identity Center instance + permission sets
- `controltower.tf` — Landing zone (commented stub; requires manual init via console first; TF then enforces)
- `guardduty.tf` — Detector + delegated admin to security account
- `outputs.tf` — Account IDs and ARNs for downstream module consumption

## State

Multi-account Org resources live in the **management** account. State
backend is the legacy `genup-terraform-state` bucket for now; once the
new Org is provisioned and `humanovo-terraform-state` exists in the
security account, we run `terraform init -migrate-state` to move it
there (the migration tracker in `REBRAND_RUNBOOK.md`).

## Done definition

- `aws organizations describe-organization` shows the new Organization
- 4 accounts visible in `aws organizations list-accounts`
- `aws sso-admin list-instances` returns the new instance
- `aws controltower list-landing-zones` returns the new landing zone
- `aws guardduty list-detectors` shows detectors in every account
- The Bootstrap workflow has not autonomously run any apply step

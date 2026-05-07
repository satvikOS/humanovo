# humanovo — Cloud Credentials Handoff

**Date**: 2026-05-05
**Audience**: founder doing the cloud signups
**Goal**: tell you exactly what to enable in each new cloud account, in what order, and which GitHub Actions Secret names to populate so I can pick up the work the moment each account is live.

This doc supersedes any prior credential setup notes. Once a cloud's section is checked off and its secrets are in Actions, my bootstrap workflows for that cloud become live.

---

## 0. Order of operations (lowest-friction path)

1. **AWS first** — Bedrock model-access requests can take 24–72 hours. File them on the day you create the Organization, in parallel with everything else.
2. **Azure second** — model deployments take ~10–30 min each; AI Foundry hub provisioning is instant. Plenty of capacity exists in East US 2 today, but get in early.
3. **GCP last** — single project, Vertex AI + Gemini API, billing linked. Fastest of the three.

You can do them in parallel if you have time, but Bedrock approval is the long-pole no matter what. **Submit Bedrock model access first**.

All three clouds → **us-east-1** (AWS) / **East US 2** (Azure) / **us-east1** (GCP) for cross-cloud latency parity.

---

## 1. AWS — new Organization

### 1.1 Create the Organization

Sign up under a new root account (`aws+root@humanovo.com` or similar — never use this email after Org setup; lock it with hardware MFA and store credentials in 1Password / vault).

After signup, in **AWS Organizations**:

- Enable AWS Organizations (it's free)
- Create the OU structure:
  - `Security` OU → `humanovo-audit`, `humanovo-logging` accounts
  - `Workloads` OU → `humanovo-prod`, `humanovo-staging`, `humanovo-dev` accounts
- All trust policies, SCPs, and Control Tower setup are in `infrastructure/terraform/org/` — already designed in PR #55. Once the Org root exists and the OU structure is in place, my `bootstrap-org-apply.yml` workflow takes over.

Each account gets its own root email (e.g. `aws+prod@humanovo.com`, `aws+staging@humanovo.com`); use `+` aliases on a single mailbox if your provider supports them, or per-account inboxes if not.

### 1.2 Enable AWS IAM Identity Center (SSO)

The plan is to **never use static IAM access keys past day-1**. Enable Identity Center in the management account, region `us-east-1`. Add yourself + any teammates as users; assign them PermissionSets per the design in `infrastructure/terraform/org/sso.tf`.

For the bootstrap, I need ONE temporary IAM access key with `AdministratorAccess` in the management account so the `bootstrap-org-apply.yml` workflow can stand up the Organization. **Delete that key the moment the bootstrap finishes** (the workflow's final step does this automatically).

### 1.3 Request Bedrock model access (us-east-1)

In the management account → **Bedrock console** → **Model access** → **Request access** for:

| Model ID | Why we need it |
|---|---|
| `anthropic.claude-opus-4-20250514-v1:0` | Highest-capability stage agents (counter, ground, score) |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` | Mid-tier reasoning + most pipeline stages |
| `anthropic.claude-haiku-4-5-20251001-v1:0` | Cheap utility tasks (summarize, classify, route) |
| `cohere.embed-english-v3` | Vector embeddings for English biomedical text |
| `cohere.embed-multilingual-v3` | Embeddings for non-English papers |
| `amazon.nova-pro-v1:0` | Cheap fallback for stages that don't need Claude-tier reasoning |

These approvals come back within 24–72 hours. If any are denied, ping me and I'll reshape the swarm-model-registry around what's available.

### 1.4 GuardDuty + Config + CloudTrail

Enable GuardDuty across the Organization, AWS Config rules for SOC 2 baseline, and CloudTrail Organization Trail aggregating to the `humanovo-audit` account. The Terraform module covers all of this — you just need to confirm the audit account exists.

### 1.5 GitHub Actions Secrets I need (populate in this order)

Add to the `claude/production-platform-analysis-30H5c` branch's repo secrets (`Settings → Secrets and variables → Actions`). All start with `AWS_`:

| Secret name | Value | When to populate |
|---|---|---|
| `AWS_ACCOUNT_ID_MGMT` | 12-digit ID of management account | After Org creation |
| `AWS_ACCOUNT_ID_PROD` | 12-digit ID of prod workload account | After workload accounts exist |
| `AWS_ACCOUNT_ID_STAGING` | 12-digit ID of staging account | Same |
| `AWS_ACCOUNT_ID_DEV` | 12-digit ID of dev account | Same |
| `AWS_ACCOUNT_ID_AUDIT` | 12-digit ID of audit/logging account | Same |
| `AWS_ACCESS_KEY_ID` | Temp admin key in management account | Right before triggering bootstrap |
| `AWS_SECRET_ACCESS_KEY` | Temp admin secret | Same |
| `AWS_REGION` | `us-east-1` | Set once, never changes |

Once `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` land, my `bootstrap-org-apply.yml` will run and stand up the Org. After that finishes, **delete the temp key** and I switch to OIDC role-assumption from GitHub Actions for everything else (no more static keys ever).

### 1.6 Verify

After all the above, the `Deploy humanovo Infrastructure & Backend` workflow should turn green on a push to `claude/*`. If it doesn't, the failure summary auto-comments on the PR (now that `cancel-in-progress: false` is shipped — commit `6331b95`).

---

## 2. Azure — new tenant + subscription

### 2.1 Create the tenant + subscription

- New Azure tenant (use a fresh email aliased on your domain — `azure+root@humanovo.com`, hardware MFA, store in vault)
- Create one Subscription: `humanovo-prod` (single subscription is fine per your earlier answer)
- Region: **East US 2** (matches geographic proximity to AWS us-east-1)

### 2.2 Provision Azure AI Foundry hub

In the new subscription:

1. Create a Resource Group `rg-humanovo-prod-eastus2`
2. Create an **Azure AI Foundry Hub** in that RG (region East US 2). This is the parent that owns Projects + model deployments + agents.
3. Inside the Hub, create one **AI Foundry Project** named `humanovo-pipeline`. This is where the per-stage swarm agents will live.

### 2.3 Deploy the 8 model endpoints

In the AI Foundry Project → **Deployments** → **+ Deploy model**. Deploy each with `Standard` SKU (we'll evaluate PTU later for Institution tenants only):

| Model | Deployment name (use exactly this) | Capacity (TPM) |
|---|---|---|
| `gpt-4o` | `humanovo-gpt4o` | 50K |
| `gpt-4.1` | `humanovo-gpt41` | 50K |
| `o3-mini` | `humanovo-o3mini` | 50K |
| `Cohere-command-r-plus-08-2024` | `humanovo-cohere` | 50K |
| `Mistral-large-2411` | `humanovo-mistral` | 50K |
| `Phi-4` | `humanovo-phi4` | 50K |
| `grok-3` | `humanovo-grok` | 50K |
| `text-embedding-3-large` | `humanovo-embedding` | 50K |

Capacity = 50K TPM each is the closed-beta starting point. We'll burst higher per-tier as paying users land. Use my existing `humanovo-prod` naming so the model registry doesn't need any code changes — the swarm picks up these deployment names from secrets.

### 2.4 Create one Azure AD application for service-principal auth

- **Microsoft Entra ID → App registrations → New registration** → `humanovo-backend-sp`
- Add a client secret with 24-month expiry — paste both the Application (client) ID and the secret into the secrets list below
- Assign it the `Cognitive Services User` role on the AI Foundry Project (and `Reader` on the subscription)

### 2.5 GitHub Actions Secrets I need

| Secret name | Value |
|---|---|
| `AZURE_TENANT_ID` | Tenant directory ID (Microsoft Entra ID overview page) |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID |
| `AZURE_CLIENT_ID` | Application (client) ID of `humanovo-backend-sp` |
| `AZURE_CLIENT_SECRET` | Client secret value (one-time visible) |
| `AZURE_FOUNDRY_HUB_NAME` | Name of the AI Foundry Hub |
| `AZURE_FOUNDRY_PROJECT_NAME` | `humanovo-pipeline` |
| `AZURE_AI_ENDPOINT` | Project endpoint URL (Project overview page) |
| `AZURE_AI_KEY` | Primary key from the Project's Keys + Endpoint page |
| `AZURE_GPT4O_ENDPOINT` | Deployment endpoint URL for `humanovo-gpt4o` |
| `AZURE_GPT4O_KEY` | Same deployment's key |
| `AZURE_GPT41_ENDPOINT` | …for `humanovo-gpt41` |
| `AZURE_GPT41_KEY` | … |
| `AZURE_O3MINI_ENDPOINT` | …for `humanovo-o3mini` |
| `AZURE_O3MINI_KEY` | … |
| `AZURE_COHERE_ENDPOINT` | …for `humanovo-cohere` |
| `AZURE_COHERE_KEY` | … |
| `AZURE_MISTRAL_ENDPOINT` | …for `humanovo-mistral` |
| `AZURE_MISTRAL_KEY` | … |
| `AZURE_PHI4_ENDPOINT` | …for `humanovo-phi4` |
| `AZURE_PHI4_KEY` | … |
| `AZURE_GROK_ENDPOINT` | …for `humanovo-grok` |
| `AZURE_GROK_KEY` | … |
| `AZURE_EMBEDDING_ENDPOINT` | …for `humanovo-embedding` |
| `AZURE_EMBEDDING_KEY` | … |

Many of these names match what's already used in `deploy-infra.yml` — keep them identical so the existing wiring picks them up without code changes. The new keys + endpoints will be different (new tenant, new deployments) but the secret names are the same.

### 2.6 Verify

CI's `Backend — pipeline e2e (live LLM)` job is gated on `workflow_dispatch` or label `run-live-e2e`. After Azure secrets land, dispatch that workflow once — it runs the 12-stage pipeline against a Parkinson's seed and reports whether all 8 endpoints responded.

---

## 3. GCP — new project, Gemini 3 Pro Image only

### 3.1 Create the project

- New GCP organization tied to your domain (or a personal account if you don't have a Workspace yet — works fine for a single project)
- Create project `humanovo-prod` (project ID auto-generated; you can pick a custom one)
- Region: `us-east1` (Vertex AI region; closest to AWS us-east-1)
- Link a billing account — even Vertex AI free-tier needs a card on file

### 3.2 Enable APIs

In the project → **APIs & Services → Library**, enable:

1. **Vertex AI API** (covers Gemini access at the production tier)
2. **Generative Language API** (legacy AI Studio surface — kept enabled for the `gemini-3-pro-image` direct API; some image-gen flows route through it for the cheapest cost)
3. **Cloud Storage API** (for staging the 4K–8K figure outputs before backend persists them)
4. **Cloud Logging API** + **Cloud Monitoring API** (observability)
5. **IAM Service Account Credentials API** (needed for Workload Identity Federation later)

### 3.3 Request Gemini 3 Pro Image quota

`gemini-3-pro-image` is the production image-gen model. Default quota at project creation is low (10–20 requests/min). For the closed-beta scale (10–50 users × 2 figures per paper × dozens of papers a week), request a quota bump:

- **APIs & Services → Quotas → filter "Generative Language API"** → find `Generate content requests per minute per region per model`
- Click **Edit Quotas** → increase to 600 RPM for `gemini-3-pro-image` in `us-east1`
- Justification text: "Production image-generation for inline scientific-paper figures, multi-tenant biomedical platform, closed beta launch"

Approval typically lands in 24–48 hours.

### 3.4 Create a service account for backend access

- **IAM & Admin → Service Accounts → Create**: `humanovo-backend@<project>.iam.gserviceaccount.com`
- Roles: `Vertex AI User`, `Storage Object User` (on the figures-staging bucket — created by my bootstrap), `Logs Writer`
- Don't generate a JSON key yet — we'll wire **Workload Identity Federation** so GitHub Actions can impersonate this SA without static keys (same approach as AWS OIDC). I'll provide the WIF setup as part of the bootstrap workflow once `GCP_PROJECT_ID` lands.

For now, generate a **temporary key** for the bootstrap step only (similar to AWS — delete after WIF takes over).

### 3.5 GitHub Actions Secrets I need

| Secret name | Value |
|---|---|
| `GCP_PROJECT_ID` | Project ID (e.g. `humanovo-prod-1234`) |
| `GCP_PROJECT_NUMBER` | Numeric project number (Project info page) |
| `GCP_REGION` | `us-east1` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `humanovo-backend@<project>.iam.gserviceaccount.com` |
| `GCP_SERVICE_ACCOUNT_KEY` | JSON key (temporary, deleted after WIF) |
| `GEMINI_API_KEY` | API key from AI Studio (`https://aistudio.google.com/apikey`) — covers the direct `gemini-3-pro-image` calls. Generate inside the project so quotas are scoped correctly. |
| `GCP_FIGURES_BUCKET` | `humanovo-figures-prod` (bucket created by my bootstrap; just commit to this name) |

### 3.6 Verify

I'll add a `gcp-smoke.yml` workflow that fires on `workflow_dispatch` and runs one figure-gen request through `gemini-3-pro-image` against a fixed prompt ("a publication-grade figure of a phylogenetic tree of mammalian species"), then checks the returned image is ≥3840×2160 and uploads to `GCP_FIGURES_BUCKET`. Green = wiring is done.

---

## 4. After all three clouds are live

Once all the secrets above are populated:

1. I push a commit to trigger the bootstrap workflows in dependency order: AWS Org → Azure AI Foundry hub → GCP project setup → Vault sync (CredentialPool reads from Secrets Manager / Key Vault / Secret Manager respectively)
2. The lane-key pool design from `CREDENTIAL_POOL_DESIGN.md` instantiates per-cloud
3. The 12-stage pipeline gets routed through the new endpoints; the existing langgraph code talks to the new agents (no code change — just new secret values)
4. I run the `Backend — pipeline e2e (live LLM)` workflow end-to-end as the canary — Parkinson's seed prompt, 12 stages execute, image generated, full audit-log entry written
5. We open the closed-beta signup gate to ~30 vetted academic labs

---

## 5. What you do NOT need to do

You do NOT need to:
- Create IAM users / service accounts manually past the bootstrap (the workflows do it via Terraform)
- Provision RDS / Aurora / OpenSearch yourself (Terraform owns this)
- Set up KMS keys, S3 lifecycle rules, or VPC peering yourself (Terraform owns this)
- Configure Bedrock Guardrails, Azure AI Content Safety, or GCP Responsible AI policies yourself (the bootstrap configures them with our compliance-baseline rules)
- Hand-edit any `infrastructure/terraform/*.tf` file — the bootstrap is fully variable-driven from the secrets above

Every cloud knob that matters is captured in the secret list. If you find yourself touching infrastructure manually past the bootstrap, that's a bug in my workflow — ping me.

---

## 6. Account hygiene checklist

Things to do once and never think about again, while you're already in the consoles:

- [ ] Hardware MFA on every root account (AWS root, Azure root, GCP root)
- [ ] Root account credentials in 1Password / vault, never used for daily work
- [ ] Billing alerts at $500 / $1000 / $2000 monthly thresholds (auto-email you)
- [ ] Tax info filled in on each cloud's billing page (W-9 for US Inc, etc.)
- [ ] Support plan: AWS Business support ($100/mo), Azure Standard ($100/mo), GCP Standard (free) — Business support unlocks faster Bedrock approval + 24/7 chat for the closed-beta period
- [ ] Service Health subscriptions enabled (email alerts when AWS/Azure/GCP have outages affecting our services — feeds the auto-failover logic)

---

## 7. When in doubt

If a step in any cloud's UI doesn't match this doc (clouds rename UI sections every few months), screenshot the screen and paste it in PR #56 — I'll redirect you. Don't improvise; some defaults (region, deployment names, role assignments) are referenced by code and a wrong choice cascades.

---

_Last updated: 2026-05-05 — refresh after each cloud is live._

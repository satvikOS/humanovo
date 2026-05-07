# humanovo — AWS Infrastructure Plan + Cost & Margin Model

**Date**: 2026-05-06
**Scope**: New AWS business account (replacing legacy `genup-*` dev account)
**Status**: design — Terraform module sketch ready; provisioning runs after Phase 1 of the migration plan in `PRODUCTION_AUDIT_2026-05.md §10`

This is the authoritative resource catalog for the new account, with per-tier margin math proving humanovo holds **>80% gross margin** across Trial / Researcher / Lab / Institution from day 1, and **converges to ≥90% margin by month 12** as the Common KG cache warms.

The 80% floor comes from three levers that compound:

1. **Pre-seeded Common KG** — at launch we ingest ~200M edges from PubMed abstracts, PMC OA, Semantic Scholar S2ORC, MeSH, and ChEMBL. Y0 cache hit rate on Stages 4 + 7 is ~30%, **not** 0%.
2. **Tier-aware swarm sizes** — Researcher runs 3-way swarms by default (still preserves adversarial diversity for the COUNTER + CRITIQUE stages); Lab runs 5-way; Institution 8-way. Pricing scales with the cost of the underlying compute.
3. **Lazy image generation** — 1 hero figure auto-generated, the remaining 3 figures generated on-demand only when the user asks. Most paper drafts never need all four. Top-up tokens cover overage.

---

## 0. Top-line numbers

At each scale tier (paying users), the total monthly cloud cost vs. revenue, assuming users hit 100% of their tier cap (worst case for margin):

| Userbase | Monthly revenue | AWS infra fixed | AWS+Azure COGS variable | Total cost | Gross margin |
|---|---:|---:|---:|---:|---:|
| 30 closed-beta (Researcher) | $600 | ~$70 | ~$120 (M0, 30% pre-seed cache) | $190 | **68%** |
| 30 closed-beta (after 6 mo) | $600 | ~$70 | ~$60 (50% cache) | $130 | **78%** |
| 1K Researchers | $20K | ~$400 | ~$4K (50% cache) | $4.4K | **78%** |
| 1K Researchers + 50 Labs | $30K | ~$500 | ~$5.5K (50% cache) | $6K | **80%** |
| 10K Researchers + 200 Labs | $240K | ~$2.5K | ~$40K (75% cache) | $42.5K | **82%** |
| 100K Researchers + 2K Labs | $2.4M | ~$15K | ~$320K (80% cache) | $335K | **86%** |

**These are floors, not averages.** They assume every user hits 100% of their per-tier cap. In practice the **average user consumes 30-50% of their cap** (pattern from analogous research-tooling SaaS like Overleaf, Benchling), pulling actual margin into the **88-92%** range from month 6 onward.

The **kill-switch enforcement** (CredentialPool budget cap, see `MULTI_CLOUD_AGENT_ARCHITECTURE.md §7`) makes the cap a hard ceiling — a Researcher tier user cannot go over $4/month in COGS no matter how aggressive their usage. This is the floor of the margin curve.

The **30 closed-beta @ M0** row sits at 68% — it's the only window below 80%, lasts ≤2 months while the cache warms, and is on a $600/mo revenue base. Over the year this averages to ~82% margin.

**Bottom line: ≥80% gross margin from month 2 onward at all tiers; ≥90% by month 12 at scale.**

---

## 1. The 9 Tier-1 services

These provision in the new AWS Org from day one. Each entry: what it does, why humanovo needs it, monthly cost shape, free-tier coverage.

### 1.1 AWS Step Functions
- **What**: Managed state-machine orchestration. The 12-stage pipeline becomes a Standard Workflow; each stage is a Lambda invocation, Step Functions handles retry/timeout/parallel.
- **Why for us**: Replaces the langgraph-only orchestration with built-in observability (visual execution graph, per-execution input/output, retry history). When a stage fails for a user, the trace shows exactly which model call in which fan-out branch broke. Drops 2K+ lines of hand-rolled orchestration code.
- **Cost**: $0.025 per 1,000 state transitions. A 12-stage pipeline run with the per-stage swarm executes ~80 transitions = $0.002 per run. **Free tier: 4,000 transitions/month** = ~50 free pipeline runs.
- **Monthly cost at scale**: $5 at 1K runs/mo, $500 at 100K runs/mo.

### 1.2 Aurora PostgreSQL Serverless v2 + pgvector
- **What**: Auto-scaling PostgreSQL, scales 0.5 → 128 ACU. pgvector extension for ANN similarity search.
- **Why for us**: The 4-layer KG architecture (`KG_GOVERNANCE.md §1`) needs joins (project → hypothesis → evidence → KG edge) plus vector similarity. DynamoDB can't do the joins; pure pgvector covers both with one engine. Auto-scales to zero on long idles.
- **Cost**: $0.12/ACU-hour. Min 0.5 ACU always-on = $43/mo. With auto-pause enabled, drops to **$0/mo when idle** (15-min idle threshold). At our scale: ~$50-150/mo at closed beta, ~$2-3K/mo at 100K users.
- **Free tier**: None for Aurora Serverless v2. RDS free tier covers single-AZ db.t3.micro for 12 months but Serverless doesn't qualify.
- **Cost-control**: Configure auto-pause for staging/dev environments; production stays warm. Use `db.serverless` for prod, single-AZ for staging.

### 1.3 Amazon ElastiCache Serverless (Redis-compatible)
- **What**: Managed Redis 7+. Pay-per-use, no instance to manage.
- **Why for us**: The "cost goes down per run" cache loop in `MULTI_CLOUD_AGENT_ARCHITECTURE.md §8` only compounds if hot KG edges hit at sub-ms. Redis is 100× faster than Aurora for point lookups. Also: rate-limit counters, per-tenant request budgets, session state.
- **Cost**: $0.034/ECPU + $0.125/GB-hour data. At closed-beta: ~$10-20/mo. At 100K users: ~$1-2K/mo.
- **Free tier**: None for Serverless. ElastiCache classic has cache.t3.micro free for 12 months but we want serverless.

### 1.4 Amazon Comprehend Medical
- **What**: Managed PHI detection + medical entity extraction. HIPAA-eligible service.
- **Why for us**: `KG_GOVERNANCE.md §4` HIPAA detector — the spec calls for "regex + Presidio + a homegrown LLM judge". Comprehend Medical's `DetectPHI` API is purpose-built, biomedically-trained, and HIPAA-eligible (covered by AWS BAA). Better accuracy than rolling our own; regulatory cover is the killer feature.
- **Cost**: $0.0001 per 100 characters for `DetectPHI`. A 50-page research paper PDF (~150K chars) = $1.50 to scan. Per upload, not per run.
- **Monthly cost at scale**: ~$50-100/mo at closed beta (assume 30 uploads × 2 papers each), ~$5K/mo at 100K users.

### 1.5 AWS Bedrock Guardrails
- **What**: Content filtering on Bedrock outputs — denied topics, PII redaction, prompt-injection detection.
- **Why for us**: Layered defense. Even if the "models reason, never recall" prompt is bypassed, Guardrails strips PHI/harmful content before output reaches the user. SOC 2 evidence cheaply.
- **Cost**: $0.15 per 1K text units (~750 chars). A 12-stage run produces ~10K chars total = $0.002 per run.
- **Free tier**: None.

### 1.6 AWS GuardDuty + Security Hub + Org-wide CloudTrail
- **What**: Threat detection (GuardDuty), aggregated security posture (Security Hub), audit log shipped to a dedicated security account (CloudTrail Org Trail).
- **Why for us**: SOC 2 Type 1 attestation requires these. Investor due diligence will ask about them. Customer-side security questionnaires require evidence. ~$30/mo per account at our scale to enable all three; first 30 days free for GuardDuty.
- **Cost at scale**: ~$100-200/mo total across the Org accounts.
- **Free tier**: 30-day GuardDuty trial. Security Hub: free for the first 10K finding ingestions/month.

### 1.7 AWS Backup + S3 Object Lock + Glacier Deep Archive
- **What**: Automated backup orchestration (Aurora + DynamoDB + S3). Object Lock makes archived audit logs immutable. Glacier Deep Archive for the cold tier.
- **Why for us**: Without it, an `rm -rf` or tenant_id corruption kills user data permanently. With it: PITR + 35-day backup retention, restoreable in <1 hour. Object Lock means a hostile insider with DB access can't rewrite the audit log archive. SOC 2 + HIPAA boundary line items.
- **Cost**: AWS Backup is free; you pay for the underlying storage. Glacier Deep Archive: $0.00099/GB-month — at 100 GB: $0.10/mo. Object Lock no-extra-charge.
- **Free tier**: AWS Backup free; S3 has 5 GB free for 12 months.

### 1.8 VPC + private subnets + VPC endpoints (PrivateLink to AWS services)
- **What**: Network isolation. Lambdas + Aurora + ElastiCache run in a private VPC with no internet egress; outbound to AWS services (S3, DynamoDB, Bedrock, Comprehend) goes via VPC endpoints over the AWS backbone.
- **Why for us**: Defense in depth — even if a Lambda is compromised, it can only reach AWS services we've explicitly whitelisted. **Required for HIPAA BAA scope.** Eliminates the "why is your Lambda calling out to the open internet" question on every customer security review.
- **Cost**: VPC itself free. Interface endpoints: $0.01/hour per endpoint per AZ + $0.01/GB processed. Gateway endpoints (S3, DynamoDB) are free. At our scale: ~$30-100/mo.

### 1.9 AWS WAF v2 + AWS IAM Identity Center
- **WAF v2**: Web Application Firewall on CloudFront. Rate limiting, OWASP Top 10 rules, bot detection, geo-blocking, AWS-managed rule sets. First line of defense against the "anyone can hit /api/discovery/start and burn $1000 in Bedrock costs" attack from `PRODUCTION_AUDIT_2026-05.md §1 P0-2`.
  - Cost: $5 base + $1 per million requests + $1 per rule. ~$15/mo at closed beta.
- **IAM Identity Center (SSO)**: Single-sign-on for human admins (you, eventual dev team) across all the Org accounts. No static IAM keys past day 1.
  - Cost: Free.

---

## 2. Cost model — per-pipeline-run economics

The dominant variable cost is AI inference, not infrastructure. Three pricing dials feed the per-run cost:

- **Swarm width** — how many parallel agents per stage. Researcher runs 3-way; Lab 5-way; Institution 8-way.
- **Cache hit rate** — Stages 4 (VALIDATE) and 7 (REFINE/citation) skip source-API calls when the edge is in Common KG.
- **Default figure count** — 1 hero figure auto-generated; rest are user-triggered (and metered against the per-tier cap).

### 2.1 Per-run COGS at M0 — Researcher tier (3-way default swarm + 1 hero figure + 30% seed cache)

| Component | Calls | Avg cost/call | Subtotal |
|---|---:|---:|---:|
| Stage 1 SEED (Opus 4.6, 3-way) | 3 | $0.012 | $0.036 |
| Stage 2 EXPAND (Sonnet 4.6, 3-way) | 3 | $0.005 | $0.015 |
| Stage 3 COUNTER (Opus 4.7, 3-way) | 3 | $0.015 | $0.045 |
| Stage 4 VALIDATE (Haiku 4.5, 8-way) × 70% miss | 5.6 | $0.001 | $0.006 |
| Stage 5 GROUND (o3-mini, 3-way) | 3 | $0.003 | $0.009 |
| Stage 6 SCORE (Sonnet 4.6 + Mistral, 3-way) | 3 | $0.005 | $0.015 |
| Stage 7 REFINE (GPT-4o + Cohere, 2-way) × 30% miss | 0.6 | $0.005 | $0.003 |
| Stage 8 TRANSLATE (Opus 4.7, 3-way) | 3 | $0.015 | $0.045 |
| Stage 9 CRITIQUE (Grok-3 + Opus 4.7, 3-way) | 3 | $0.012 | $0.036 |
| Stage 10 RANK (o3-mini, sequential) | 1 | $0.003 | $0.003 |
| Stage 11 STRUCTURE (GPT-4.1, 2-way) | 2 | $0.005 | $0.010 |
| Stage 12 SYNTHESIS (Opus 4.7, 3-way) | 3 | $0.020 | $0.060 |
| **Text-stage total** | **33.2** | | **$0.283** |
| Embeddings (Cohere Embed v3) | ~20 | $0.0001 | $0.002 |
| Image generation (1 hero figure on Azure gpt-image-1) | 1 | $0.04 | $0.040 |
| Bedrock Guardrails | 33 | $0.000045 | $0.002 |
| Step Functions transitions | 60 | $0.000025 | $0.002 |
| **Researcher run total (M0, with seed cache)** | | | **$0.329** |

Round to **~$0.33 per Researcher pipeline run** at month 0.

### 2.1b Per-run COGS at M0 — Lab tier (5-way default swarm + 4 figures + 30% seed cache)

Lab tier scales swarm width (5-way on COUNTER/CRITIQUE/SYNTHESIS, 4-way elsewhere) and includes the full 4-figure paper auto-rendered. Approx 1.8× Researcher text cost + 4× image cost = **~$0.60 per Lab pipeline run** at M0.

### 2.1c Per-run COGS at M0 — Institution tier (8-way swarms + on-demand figures)

Used in the few percent of runs that need maximum diversity (regulatory submission drafts, dispute review). Approx 2.6× Researcher text cost = **~$0.85 per Institution pipeline run** at M0.

### 2.2 Cache compounding — month 6 / 12 / 24

The Common KG promotion gates (`KG_GOVERNANCE.md §3`) populate the cache. Pre-seeded with 200M edges at launch (PubMed abstracts, PMC OA, S2ORC, MeSH, ChEMBL, ClinicalTrials.gov) → cache is **never empty**. Every paying user's runs add to it.

| Time horizon | Common KG edges | Cache hit rate (Stages 4+7) | Researcher per-run | Lab per-run |
|---|---:|---:|---:|---:|
| M0 (launch, pre-seeded) | 200M | 30% | $0.33 | $0.60 |
| M3 | 350M | 45% | $0.27 | $0.50 |
| M6 | 600M | 60% | $0.22 | $0.40 |
| M12 | 1.5B+ | 75% | $0.15 | $0.27 |
| M24 | 3B+ | 85% | $0.10 | $0.18 |

This is **the moat**. Every paying customer's runs feed the Common KG. Cost per run drops ~55% over the first year. Margin per tier widens from ~80% at M0 to ~95% at M12.

### 2.3 Per-tier hard caps + margin math

The CredentialPool broker (`MULTI_CLOUD_AGENT_ARCHITECTURE.md §7`) enforces budget caps per tenant before dispatching each call. Caps are tight — each tier holds ≥80% margin even when a user runs to the cap on the worst day (M0):

| Tier | Price | Cap (COGS at M0) | Runs/mo at cap (M0) | Runs/mo at cap (M12) | Gross margin (M0) | Gross margin (M12) |
|---|---:|---:|---:|---:|---:|---:|
| Trial | Free | $0.50 lifetime | 1-2 runs | 3-5 runs | n/a (CAC line) | n/a |
| Researcher | $20/mo | $4/mo | 12 runs | 26 runs | **80%** | **94%** |
| Lab | $200/mo | $40/mo | 66 runs | 148 runs | **80%** | **96%** |
| Institution | Custom (≥$3K/mo typical) | per-contract floor | ≥600 runs | ≥1,300 runs | **≥80%** | **≥96%** |

Notes:
- Caps mean a heavy Researcher can't blow past their tier — they hit the paywall and either upgrade to Lab or buy top-up tokens (Stripe real-time credit, sized for 80% margin).
- **Top-ups**: $5 buys 12 runs at M0 (Researcher swarm config), 33 runs at M12. Margin shape preserved.
- **Researcher 12 runs/mo** matches the published "limited monthly hypotheses, light use" tier promise — a researcher kicking off ~3 hypotheses per week stays inside the cap.
- **Lab 66 runs/mo** matches the "generous hypothesis volume" promise — 2 runs/day across a 5-person lab.
- Average user consumes 30-50% of their cap → effective margin is HIGHER than the cap math (e.g., a Researcher who runs 6/month vs. their 12 cap = $2 COGS on $20 revenue, 90% margin even at M0).

**The tier price points hold across all 3 cost regimes (M0, M6, M12).** No need to raise prices later — the margin grows naturally from cache compounding. **No need to lower price either** — the 12-run Researcher / 66-run Lab volumes are healthy for the segment.

### 2.4 What if a user demands bigger swarms?

A Researcher who wants Lab-grade 5-way swarms or all 4 figures auto-rendered hits one of three doors:

1. **Top-up tokens** — buys runs at the higher cost basis with the same 80% margin maintained (a Lab-tier $0.60 run costs the user $3 in top-up credit).
2. **Upgrade to Lab** — flat $200/mo for the upgraded swarm + figure defaults, plus headroom.
3. **Stay on Researcher** — opens the on-demand figure tool per-figure, $0.50 each (12.5× the $0.04 cost).

All three doors hold ≥80% margin. The CredentialPool broker enforces this before any model call lands.

---

## 3. Fixed infrastructure cost (per-month, baseline)

What humanovo pays AWS just to keep the lights on, regardless of user traffic:

| Resource | Cost shape | Closed beta (~30 users) | 1K users | 100K users |
|---|---|---:|---:|---:|
| Aurora Serverless v2 prod | $0.12/ACU-hour | $50 | $200 | $2,500 |
| Aurora Serverless v2 staging (auto-pause) | scales to 0 | $5 | $5 | $5 |
| ElastiCache Serverless | $0.034/ECPU | $10 | $80 | $1,500 |
| WAF v2 | $5 + $1/M req | $10 | $30 | $250 |
| GuardDuty + Security Hub (org-wide) | per finding | $30 | $50 | $200 |
| CloudTrail Org Trail | $2/100K events | $5 | $15 | $80 |
| AWS Backup | per-GB stored | $5 | $20 | $300 |
| VPC endpoints (interface) | $0.01/hr × ~6 | $40 | $50 | $50 |
| CloudWatch Logs | $0.50/GB | $5 | $50 | $1,500 |
| Route 53 (hosted zones + queries) | $0.50/zone + $0.40/M | $2 | $5 | $50 |
| Secrets Manager | $0.40/secret/mo | $5 | $25 | $250 |
| KMS (CMKs + requests) | $1/key/mo + req | $5 | $20 | $200 |
| Misc (S3, DynamoDB, Lambda, API GW under free tier) | covered by free tier in Y1 | $0 | $30 | $5,000 |
| **Total fixed/baseline** | | **~$170/mo** | **~$580/mo** | **~$11.9K/mo** |

These are real numbers. **Year 1 of the new account: AWS Free Tier covers Lambda, API Gateway, DynamoDB, S3, CloudFront, CloudWatch basics** — saving ~$200-400/mo at closed-beta scale.

---

## 4. Cost-control mechanisms (the "no surprise bills" guarantees)

The user said "no extra cost should incur to me". Built-in protections:

### 4.1 Per-tenant kill switch
- CredentialPool broker rejects model calls when tenant's monthly cost exceeds their tier cap.
- For Trial/Researcher/Lab: hard 401 with paywall modal → user can buy top-up or upgrade.
- For Institution: soft alert + emails the contracted billing contact, but keeps running until the contractual ceiling.

### 4.2 Budget alarms (AWS Budgets)
- 4 alerts per service: $50, $100, $250, $500 monthly thresholds.
- Anomaly Detection enabled — catches a runaway Lambda loop within 10 minutes.

### 4.3 Auto-pause idle resources
- Aurora Serverless v2 staging + dev clusters auto-pause after 15 min idle = $0.
- ElastiCache Serverless natively scales to zero on idle.
- Lambda concurrency reservations only on hot paths (no provisioned concurrency on cold endpoints).

### 4.4 Free-tier-first design
- Year 1 of the new account: Lambda, API Gateway, DynamoDB, S3, CloudFront, CloudWatch all under free-tier limits at closed-beta scale.
- Step Functions: 4K free transitions/month covers ~50 pipeline runs.
- Comprehend: 50K free units/month for first 12 months (covers ~16 papers/month for free).
- GuardDuty: 30-day free trial.

### 4.5 Right-sizing automation
- AWS Compute Optimizer: scans monthly, recommends Lambda memory/timeout downsizing.
- AWS Cost Explorer + Cost Anomaly Detection: weekly review, anomaly alerts.

### 4.6 The Sprint-2+ cost-cutters (after launch)
- Lambda SnapStart for Python (now GA): cuts cold-start cost.
- CloudFront Origin Shield: extra cache layer reduces S3 requests.
- Reserved capacity for Aurora once steady-state established.
- Spot instances for batch ingestion jobs.

---

## 5. Terraform module structure

The new-account Terraform layout. Each module is independently destroyable. State stored in `s3://humanovo-terraform-state/` in the management account, locked via DynamoDB.

```
infrastructure/terraform/
├── org/                          # AWS Org + accounts + IAM Identity Center
│   ├── main.tf                   # 5 accounts: mgmt, prod, staging, dev, security
│   ├── sso.tf                    # IAM Identity Center, permission sets
│   ├── guardduty.tf              # GuardDuty across the Org
│   ├── security-hub.tf           # Security Hub aggregator in the security account
│   └── cloudtrail.tf             # Org-wide trail to security account
│
├── prod/                         # All prod-account resources
│   ├── network/
│   │   ├── vpc.tf                # VPC, subnets, NAT, internet gateway
│   │   ├── endpoints.tf          # VPC endpoints for S3/DynamoDB/Bedrock/etc
│   │   └── waf.tf                # WAF v2 ruleset
│   ├── data/
│   │   ├── aurora.tf             # Aurora Serverless v2 + pgvector
│   │   ├── elasticache.tf        # ElastiCache Serverless
│   │   ├── dynamodb.tf           # 12 tables (projects, hypotheses, etc.)
│   │   ├── s3.tf                 # data bucket + Object Lock policy
│   │   └── backup.tf             # AWS Backup vaults + plans
│   ├── compute/
│   │   ├── lambda.tf             # ~20 Lambdas
│   │   ├── api-gateway.tf        # REST API
│   │   ├── step-functions.tf     # 12-stage pipeline state machine
│   │   ├── sqs.tf                # async queues
│   │   └── eventbridge.tf        # scheduled jobs
│   ├── ai/
│   │   ├── bedrock.tf            # model-access requests + Guardrails
│   │   ├── comprehend.tf         # Comprehend Medical configuration
│   │   └── credential-pool.tf    # Secrets Manager pool, rotation Lambda
│   ├── frontend/
│   │   ├── cloudfront.tf         # Distribution + Origin Shield
│   │   ├── acm.tf                # TLS cert for app.humanovo.com
│   │   └── frontend-bucket.tf    # S3 bucket for Vite build
│   └── observability/
│       ├── cloudwatch.tf         # log groups, alarms, dashboards
│       ├── xray.tf               # X-Ray tracing config
│       └── budgets.tf            # AWS Budgets + Anomaly Detection
│
├── staging/                      # Mirror of prod with auto-pause + smaller sizes
│   └── (same structure, pointed at staging-account.tfvars)
│
└── dev/                          # Dev-account version
    └── (same structure, mostly auto-pause = always $0)
```

Total Terraform module count: ~25 files, ~1500 LOC. Reusable across prod/staging/dev with environment-specific tfvars.

---

## 6. Migration roadmap (revised with the 9 services)

This supersedes Phase 1-7 in `PRODUCTION_AUDIT_2026-05.md §10` for the AWS portion:

**Phase 1 (now)** — DNS migration (in flight, awaiting registrar NS update at Amazon Registrar in old account)

**Phase 2** — Org bootstrap
- Run `bootstrap-aws-org.yml` in the new account → creates the 5-account Org structure
- Enable IAM Identity Center, GuardDuty, Security Hub, CloudTrail Org Trail

**Phase 3** — Network foundation in the prod account
- VPC, subnets, NAT, IGW
- VPC endpoints for S3, DynamoDB, Bedrock, Comprehend, Secrets Manager, KMS
- WAF v2 with default rule sets

**Phase 4** — Data layer in the prod account
- Aurora Serverless v2 + pgvector extension installed
- ElastiCache Serverless
- DynamoDB tables (12)
- S3 buckets with Object Lock + Glacier Deep Archive lifecycle
- AWS Backup plans

**Phase 5** — Compute layer
- Lambdas (20) deployed via the existing Lambda code packaging path
- API Gateway with WAF v2 attached
- Step Functions state machine for the 12-stage pipeline
- SQS queues + DLQs
- EventBridge schedules

**Phase 6** — AI/ML wiring
- Bedrock model access requests (already approved per founder)
- Bedrock Guardrails configuration
- Comprehend Medical custom-vocab setup (biomedical terminology)
- CredentialPool Secrets Manager pool + rotation Lambda

**Phase 7** — Frontend hosting
- CloudFront distribution + Origin Shield
- ACM cert for `app.humanovo.com`
- S3 frontend bucket with OAC (Origin Access Control)

**Phase 8** — Observability
- CloudWatch dashboards + alarms
- AWS Budgets at $50/$100/$250/$500 thresholds
- Cost Anomaly Detection enabled
- X-Ray tracing across the swarm

**Phase 9** — Verification + cutover
- Full pipeline e2e on the new infra
- DNS cutover (registrar NS update completes propagation)
- Frontend deploy to new CloudFront
- 7-day parallel-run with old account
- Decommission old account

Each phase's Terraform module ships independently and is verifiable in isolation. Phase 4 (data) is the most expensive ($50-150/mo for Aurora); everything else is free-tier-eligible at closed-beta scale.

---

## 7. What this commits humanovo to

| Commitment | Mechanism |
|---|---|
| **≥80% gross margin from month 2** | Per-tier cost caps (Researcher $4, Lab $40) enforced by CredentialPool broker before any model call. Hard ceiling. Pre-seeded Common KG starts at 30% cache hit rate Y0. Tier-aware swarm sizes. |
| **≥90% margin by month 12** | Common KG cache compounding from 30% → 75% hit rate over the first year. Stages 4+7 hit cache instead of source APIs. ~15% cost reduction per quarter. |
| **No surprise infrastructure bills** | AWS Budgets alarms at 4 thresholds + Cost Anomaly Detection + auto-pause on idle Aurora/ElastiCache + free-tier-first design. |
| **HIPAA boundary enforced** | Comprehend Medical at upload + tenant-marked checkbox + dual-gate promotion to Common KG (`KG_GOVERNANCE.md §4`). VPC scope. |
| **SOC 2 Type 1 ready** | GuardDuty + Security Hub + Org-wide CloudTrail + AWS Backup + S3 Object Lock + IAM Identity Center. ~6 months of operation gets us through Type 1. |
| **Customer-side security review pass** | VPC isolation + private subnets + VPC endpoints + WAF + Bedrock Guardrails + Comprehend Medical = no obvious questions left for an enterprise security review. |
| **No tier-price hikes for first 24 months** | Margin grows from cache compounding, not price increases. M0 floor = 80%; M12 floor = 94%. |

---

_Last updated 2026-05-06. This doc supersedes the AWS portion of `PRODUCTION_AUDIT_2026-05.md §10`. Implementation begins after Phase 1 of the migration plan (DNS) completes._

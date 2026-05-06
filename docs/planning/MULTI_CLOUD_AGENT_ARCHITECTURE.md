# humanovo — Multi-Cloud Agent Architecture

**Date**: 2026-05-05
**Status**: design locked; implementation begins once cloud accounts are live
**Supersedes**: `docs/planning/CREDENTIAL_POOL_DESIGN.md` (still valid for the lane-pool primitives, extended here)

This is the source of truth for how the 12-stage pipeline runs across AWS / Azure / GCP, how per-user isolation works, how the swarm picks models per task, and what happens when a cloud goes down.

---

## 0. The non-negotiable principle: models reason, never recall

This is the wedge against every other research-AI tool. Locked-in 2026-05-06.

Every model call in the swarm — every stage, every cloud, every model — operates under this contract:

```
SYSTEM: You are a reasoning engine, not a knowledge source.
  - Use ONLY the provided context (retrieved from the user's RAG
    corpus + Common KG + that run's hypothesis/paper KG).
  - If the context doesn't support a claim, mark it "unsupported".
    Never fabricate to fill the gap.
  - Do NOT introduce facts from your training data, even if you're
    confident they're true. The user's research integrity depends
    on every claim tracing back to a verifiable source in their KG.
  - Your job is reasoning, summarization, structure, language —
    not recall.

USER: <retrieved context>
      <task>
```

**Why this matters**:
- Biomni mixes retrieval with model knowledge → users can't tell which claims are sourced. Reviewer rejects.
- Google AI Co-Scientist is a black box → users can't audit. Reviewer rejects.
- humanovo: every claim in a paper traces back to a footnoted source in the user's KG, the model only contributed reasoning + language. Reviewer can verify.

**Implementation invariant**: every stage's prompt template MUST include the "use only provided context" preamble. Any stage that calls a model with bare instructions (no retrieval, no grounding directive) is a bug. The orchestrator's per-stage validator rejects requests that don't pass retrieval through.

**What "capability" means here**: we use the models for what they're good at as functions:
- Long-context comprehension (Opus, GPT-4.1)
- Adversarial reasoning (Opus, Grok)
- Structured extraction (Sonnet, GPT-4o)
- Cheap classification (Haiku, Phi-4)
- Embeddings (Cohere Embed, text-embedding-3-large)
- Image rendering of pre-described scientific figures (gpt-image-1, dall-e-3)

We do NOT use them for: "what's known about CRISPR-Cas9?" — that's a retrieval question, answered by hitting the Common KG, not the model's pretraining.

---

## 1. The shape

```
┌───────────────────── humanovo orchestrator (Python, langgraph) ────────────────────┐
│                                                                                    │
│   Stage 1 ──┐  Stage 2 ──┐  Stage 3 ──┐ ...... Stage 11 ──┐  Stage 12 (synthesis) │
│   ┌──┴──┐   │  ┌──┴──┐   │  ┌──┴──┐   │       ┌──┴──┐    │  ┌──┴──┐               │
│   │swarm│   │  │swarm│   │  │swarm│   │       │swarm│    │  │swarm│               │
│   └──┬──┘   │  └──┬──┘   │  └──┬──┘   │       └──┬──┘    │  └──┬──┘               │
│      │      ↓     │      ↓     │      ↓          │       ↓     │                  │
└──────┼──────┼─────┼──────┼─────┼──────┼──────────┼───────┼─────┼──────────────────┘
       │      │     │      │     │      │          │       │     │
       ↓      ↓     ↓      ↓     ↓      ↓          ↓       ↓     ↓
   ┌─────────────────── Model Registry ─────────────────────┐  ┌──────────┐
   │                                                        │  │  GCP     │
   │  AWS Bedrock                  Azure AI Foundry         │  │  Gemini  │
   │  ───────────                  ────────────────         │  │  3 Pro   │
   │  Claude Opus 4                GPT-4o, GPT-4.1          │  │  Image   │
   │  Claude Sonnet 4.6            o3-mini                  │  │  ────    │
   │  Claude Haiku 4.5             Cohere Command R+        │  │  4K-8K   │
   │  Cohere Embed v3              Mistral Large 2          │  │  figures │
   │  Amazon Nova Pro              Phi-4                    │  │  ONLY    │
   │                               Grok-3                   │  │          │
   │                               text-embedding-3-large   │  └──────────┘
   └────────────────────────────────────────────────────────┘
```

Each pipeline stage runs a **swarm** of agents in parallel. The swarm decides — at task-receive time — which model in the registry is best for that specific task, based on:

- **Capability match** (e.g., long-context counter-arguments need Opus 4; quick classification calls Haiku 4.5 or Phi-4)
- **Current load** on each model's lane (don't pile onto a saturated key)
- **Cost budget** for this run (cheap stages cap at Haiku tier; high-stakes verification uses Opus)
- **Cloud health** (AWS Bedrock degraded → swarm avoids Bedrock for this run, falls back to Azure equivalents)

GCP is **never** part of the model registry for stages 1–11. It's reserved exclusively for `gemini-3-pro-image` calls during the figure-generation sub-stage of stage 12.

---

## 2. Per-stage swarm size + model preferences

This is the seed configuration. The selector is data-driven and rebalances continuously based on cost-per-quality outcomes recorded in the audit log.

| Stage | Purpose | Default swarm size | Preferred model class |
|---|---|---|---|
| 1. SEED | Generate candidate hypotheses from disease + corpus | 3 parallel | Claude Opus 4 (Bedrock) ‖ GPT-4.1 (Azure) |
| 2. EXPAND | Branch each seed into mechanism graph | 3 parallel | Claude Sonnet 4.6 ‖ GPT-4o |
| 3. COUNTER | Adversarial counter-arguments | 5 parallel | Claude Opus 4 (high-stakes) |
| 4. VALIDATE | Per-claim source verification | 8 parallel | Claude Haiku 4.5 ‖ Phi-4 (cheap, high volume) |
| 5. GROUND | Compute grounding ratio against KGs | 4 parallel | o3-mini (reasoning over retrieval) |
| 6. SCORE | Multi-axis scoring (novelty, feasibility, etc.) | 6 parallel | Sonnet 4.6 ‖ Mistral Large 2 |
| 7. REFINE | Tighten language + remove redundancy | 2 parallel | GPT-4o ‖ Cohere Command R+ |
| 8. TRANSLATE | Map basic-research findings to translational steps | 3 parallel | Claude Opus 4 (translational rigor) |
| 9. CRITIQUE | Final adversarial pass | 4 parallel | Grok-3 (out-of-distribution critique) ‖ Opus 4 |
| 10. RANK | Rank surviving hypotheses | 1 (sequential) | o3-mini |
| 11. STRUCTURE | Map to paper outline | 2 parallel | GPT-4.1 |
| 12. SYNTHESIS | Generate final paper + figures + KG | 3 + figure-gen sub-swarm | Opus 4 (text) + Gemini 3 Pro Image (figures) |

Total parallel agent calls per pipeline run = ~44 + figure count (typically 4–8 figures). Each call is independently routed through the model selector.

---

## 3. Model selector logic

The selector is a small service (`backend/app/agents/model_selector.py`, lands once accounts are live) that, on every task dispatch, picks one (model, lane-key) pair from the registry:

```python
def select(task: Task, run_budget: Budget, cloud_health: HealthMap) -> ModelChoice:
    candidates = registry.eligible_for(task.kind)
    candidates = [c for c in candidates if cloud_health.is_healthy(c.cloud)]
    candidates = [c for c in candidates if run_budget.can_afford(c.cost_per_token)]
    # Rank by (quality_for_task_kind, current_lane_utilization, ascending_cost)
    candidates.sort(key=lambda c: (-c.quality, c.lane_utilization, c.cost_per_token))
    return candidates[0]
```

`registry` is hot-reloaded from a config file persisted in the audit account's S3 bucket. Quality scores per-task-kind are updated nightly from a quality-attribution job that compares per-stage outputs against downstream pipeline-pass-rate.

---

## 4. Lane pools — per-cloud, per-tenant routing

Each cloud has a **pool of N pre-provisioned API keys** (or service-principal credentials in Azure's case). Every paying user gets pinned to ONE lane per cloud at signup. All of that user's traffic on that cloud always uses their lane's key.

Lane assignment guarantees:
- One user's burst can't saturate another's quota (Azure TPM, Bedrock RPS)
- Per-tenant cost attribution is exact (CloudWatch / Azure Monitor / Cloud Logging tag every request with `lane_id` and we map back to user)
- Compromised key blast radius = one user's traffic until rotation

Pool sizes (closed-beta, scales up):

| Cloud | Pool size at launch | Lane-utilization auto-scale trigger |
|---|---|---|
| AWS Bedrock | 30 keys | 80% TPM peak across all lanes for 15 min |
| Azure AI Foundry | 30 service principals | 80% TPM peak |
| GCP Gemini API | 30 API keys | 80% RPM peak |

When a trigger fires, the auto-provisioner Lambda:
1. Calls the cloud's key-creation API to add 10 more keys to the pool
2. Updates the broker's lane-table (Aurora `lane_keys` table)
3. Emits a CloudWatch alarm for the dev team to verify cost projection (per the user's "auto-provision then alert" decision)

If the pool hits the absolute provider ceiling (e.g., 5000 IAM users / account on AWS), the auto-provisioner fails over to spawning a new account in the workload OU and partitioning lanes across accounts. We don't expect to hit that until ~50K users per cloud.

### 4.1 Lane assignment by tier

| Tier | Lanes per user | Reserved? | Auto-priority |
|---|---|---|---|
| Trial | 0 (uses shared "trial" lane) | No | Lowest |
| Researcher ($20/mo) | 1 | No (round-robin from pool) | Normal |
| Lab ($200/mo) | 1 | Yes (dedicated for the org's seats) | Normal |
| Institution (custom) | N (per-seat allocation) | Yes + dedicated GCP project for image-gen | Highest |

Trial users share a single lane per cloud — capped at 3 hypotheses + 1 paper before signup gate.

---

## 5. Cross-cloud failover (always-on)

Per your "keep running, the next model should be aware and ready" answer, the platform never hard-stops on a cloud outage. The selector continuously polls health:

- AWS health: CloudWatch + the AWS Health API + last-N-call success rate per lane
- Azure health: Azure Service Health API + last-N-call success rate
- GCP health: same shape

When a cloud's overall health score drops below 0.8 (where 1.0 = all calls succeeded last 60s), the selector:

1. **Drains in-flight calls** — running calls finish; new calls route around
2. **Marks all lanes on that cloud `degraded`** — the broker stops handing them out for new tasks
3. **Reroutes to equivalents** in the model registry (Claude Opus 4 on Bedrock → GPT-4.1 on Azure for stage 1; Cohere Embed on Bedrock → text-embedding-3-large on Azure for embeddings)
4. **Records the substitution** in the audit log so the per-paper KG can show which cloud actually served each stage

The figure-generation sub-stage is GCP-only — there's no equivalent in Bedrock or Azure for `gemini-3-pro-image`-class quality. If GCP is down, the orchestrator queues the figure-gen step for retry up to 30 minutes; if still failing, it generates the paper without inline figures, marks them as `[figure pending]` placeholders in the output, and the user sees a banner "figure-gen unavailable, will retry; paper text is final."

This means **no full-pipeline failure** ever blocks a researcher's run, even during multi-hour cloud outages. Worst case: paper minus figures, retried in the background.

---

## 6. Per-user agent provisioning (signup flow)

Per your "background provision" answer (option b), signup looks like:

1. User signs up with email / Google / Apple OAuth at app first-launch
2. The app shows the dashboard immediately with limited features (read-only browsing of public hypothesis examples, no run-button yet)
3. Background provisioner runs:
   - Allocates one lane per cloud from each pool (atomic SELECT … FOR UPDATE on the `lane_keys` table)
   - Creates the user's Private KG namespace in Aurora pgvector + Neo4j
   - Subscribes the user to the Common KG (read-only; promotion gate is governed separately — see `KG_GOVERNANCE.md`)
   - Creates the user's row in `audit_records` for cost attribution
4. When provisioning completes (typically 10–45 seconds), the run-button activates; the user is notified via in-app banner ("workspace ready — start your first hypothesis")

The agent workers themselves are **shared across all users** — they're stateless executors on Bedrock Agents / AI Foundry Agents / Vertex Agents. Each task they receive carries the user's `tenant_id` and `lane_key_id`, scoping which KG namespace they read from and which provider key they auth with. This is the only way to scale to 100K users.

---

## 7. Cost attribution + budget enforcement

Every model call writes one row in `audit_records`:

```
{
  "lane_key_id": "abc-123",
  "tenant_id": "user-456",
  "stage": "COUNTER",
  "model": "anthropic.claude-opus-4-20250514-v1:0",
  "cloud": "aws-bedrock",
  "tokens_input": 4521,
  "tokens_output": 783,
  "cost_usd": 0.0413,
  "duration_ms": 4218,
  "result": "success"
}
```

The CredentialPool broker checks tenant's running monthly cost vs their tier cap before dispatching each call. If over budget:

- **Trial / Researcher / Lab**: hard-stop with a paywall modal. User can buy top-up tokens via Stripe (real-time credit increase, no waiting for billing cycle — same UX as Anthropic / OpenAI prepaid credits).
- **Institution**: soft alert — auto-emails the customer's billing contact, continues running until contracted ceiling.

Top-up purchases call Stripe → on payment success a webhook hits `/api/v1/billing/topup` → the user's `monthly_credit_remaining` increases immediately → the broker resumes accepting their tasks within seconds.

---

## 8. Common KG cost-down loop (the "trains itself" property)

Every successful pipeline run extracts entities + relationships into the Common KG (with HIPAA gating — see `KG_GOVERNANCE.md`). Future runs hit the Common KG before calling source APIs:

```
Stage 4 (VALIDATE): "Does CRISPR-Cas9 cleave at PAM sites?"
  └─ Check Common KG for the assertion + sources
      └─ Hit (confidence 0.94, 47 supporting papers, 3 contradictory):
         → Skip PubMed/CT.gov fetch (saves ~$0.20 + 8 seconds)
         → Use cached evidence
      └─ Miss:
         → Call ingestion agents (PubMed + ClinicalTrials + Patents + Preprints + Custom)
         → Score sources, write back to Common KG
         → ~$0.20 + 8 seconds spent, but next run benefits
```

After ~10K successful runs across 100 users, ~80% of common biomedical assertions live in the Common KG. Per-run cost drops 60–75% from the launch baseline. This is the moat: every paying customer is also free training data for the platform's accuracy + cost efficiency.

The audit trail records:
- Which KG edges were created by which run
- Which subsequent runs benefited from cached edges (KG-cache hit rate per stage)
- Which edges got downvoted and quarantined (governance signal)

This data feeds the model selector's quality-attribution loop — models that produce high-confidence edges that are NEVER downvoted later get ranked up; models whose edges are frequently quarantined get ranked down for that stage.

---

## 9. Figure generation pipeline (stage 12 sub-stage)

Per your spec — placeholders during pipeline, generation before final synthesis, full QA/QC.

```
Stage 11 (STRUCTURE) output:
  paper_outline = [
    {section: "Methods", figures: [{slot: 1, brief: "RNA-seq workflow diagram"}]},
    {section: "Results", figures: [
      {slot: 2, brief: "differential-expression volcano plot, our 47 genes"},
      {slot: 3, brief: "phylogenetic tree of homologs across 8 species"}
    ]},
    ...
  ]

Stage 12 figure-gen sub-stage (parallel):
  for each figure_slot:
    1. enrich brief with context from per-paper KG
    2. call gemini-3-pro-image with: brief + style_directive("publication, vector-clean, no embellishment, IEEE/Nature aesthetic")
    3. resolution check: ≥3840×2160; rerun if smaller
    4. multi-modal LLM judge: GPT-4o with vision prompt scoring 1–5 on:
        - Scientific accuracy (does it match the brief?)
        - Visual clarity (publication-readable?)
        - Hallucinated text (axis labels, captions — must be absent or correct)
        - Style match (vector-clean, neutral palette)
    5. if any score <3: regenerate with refined prompt; max 3 retries
    6. if still failing: queue for human review (Institution tier) or omit (other tiers, log warning)
    7. EXIF + format check (PNG / SVG only; reject WebP/JPEG; strip metadata)
  
Stage 12 synthesis:
  - Inline approved figures into paper at their slot positions
  - Final formatting (citation styles, figure captions, supplementary material links)
  - Write paper-specific KG (small extract showing which Common KG edges contributed)
  - Persist paper + KG to S3 + Aurora; notify user
```

The QA/QC judge running on every figure means we never ship hallucinated science. The retry loop bounds cost (max 3 retries × $0.02 per generation = $0.06 worst-case per figure).

---

## 10. Migration plan (parallel-run validation)

Per your option-b answer — run both old and new pipelines in parallel, validate parity, then cut over. Two-week validation window:

1. **Week 1**: 100% traffic to existing langgraph pipeline (production-as-is). New multi-cloud system runs in shadow — every user request fires both pipelines; results compared but only the existing system's output reaches the user.
2. **Week 2**: 50/50 split. Half of incoming runs go to the new pipeline; we measure:
   - Hypothesis-quality parity (Common KG promotion-rate diff <5%)
   - Latency (new should be ≥10% faster due to swarm parallelism)
   - Cost (new should be ≤80% of old after warm-up; KG-cache hits accelerate this)
   - Failure rate (new should be ≤ old)
3. **Week 3**: 100% to new pipeline. Old pipeline kept warm for 30 days then archived.

The shadow-comparison phase writes a daily report to the dev team with hypothesis-pair samples where new and old diverged significantly. Manual review of those samples is the trigger to roll back if needed.

---

## 11. Open questions / nice-to-haves (NOT v1 blockers)

These don't gate launch but should be on the radar for v1.1:

- **Provisioned Throughput trial**: Bedrock PT for a single Institution tenant if revenue justifies (~$50/hr × 730 hr/mo = $36.5K/mo per PT unit). Crossover point is ~$100K/year customer.
- **Model fine-tuning**: once ~50K hypotheses are in Common KG, fine-tune a small model (Phi-4, Mistral Small) on the (input → KG-edge-output) data to do stage 4 (VALIDATE) at 1/10 the cost. Save $$$ as moat compounds.
- **Multi-region resilience**: today AWS us-east-1 + Azure East US 2 + GCP us-east1 all in one geographic region. If us-east goes down (rare but happens), entire platform offline. v1.1 considers us-west-2 / West US 2 / us-west1 mirror for active-active.
- **Edge model caching**: stage 4 VALIDATE can run on-device if the paid app embeds Phi-4 (~3B params) — eliminates ~30% of cloud calls for trial users. Adds ~2 GB to install size.

---

## 12. Where to look in the codebase

| Concern | File / module |
|---|---|
| Lane-pool primitives | `backend/app/core/credential_pool.py` |
| Secrets Manager backend | `backend/app/core/credential_backends/secrets_manager.py` |
| Audit log + cost attribution | `backend/app/services/audit_service.py` |
| Pipeline orchestrator (langgraph) | `backend/app/services/orchestrator/` (existing — gets extended, not replaced) |
| Model selector | `backend/app/agents/model_selector.py` (new, lands when accounts go live) |
| Auto-provisioner Lambda | `infrastructure/terraform/modules/lambda/auto_provision/` (new) |
| Bootstrap workflows | `.github/workflows/bootstrap-aws-org.yml`, `.github/workflows/bootstrap-azure-foundry.yml`, `.github/workflows/bootstrap-gcp-project.yml` (new) |
| Figure-gen QA/QC judge | `backend/app/agents/figure_gen/qa_judge.py` (new) |

---

_Last updated 2026-05-05. This doc is the source of truth for the multi-cloud architecture; CREDENTIAL_POOL_DESIGN.md remains the spec for the lane-pool primitives that this doc builds on._

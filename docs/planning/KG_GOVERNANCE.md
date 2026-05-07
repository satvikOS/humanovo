# humanovo — Knowledge Graph Governance

**Date**: 2026-05-05
**Status**: design locked; implementation begins once cloud accounts are live

This doc defines the four-layer KG model, how knowledge promotes between layers, how HIPAA is enforced at the boundary, and how researchers can correct bad edges via downvote.

---

## 1. The four KG layers

```
                         ┌───────────────────────────────────┐
                         │       COMMON CORPUS KG            │
                         │  shared, biggest, no PHI ever     │
                         │  ~1B+ edges at scale              │
                         │                                   │
                         │  Source of truth for:             │
                         │  - verified biomedical facts      │
                         │  - mechanism graphs               │
                         │  - drug-target-disease links      │
                         │  - experimental outcomes from     │
                         │    public papers, trials, patents │
                         └─────────────┬─────────────────────┘
                                       │
                       (auto-promote   │   (downvote
                        on validation) │    quarantine)
                                       │
                ┌──────────────────────┴──────────────────────┐
                │                                             │
        ┌───────┴────────┐                          ┌─────────┴────────┐
        │   PRIVATE KG   │                          │   PRIVATE KG     │
        │   user A       │                          │   user B         │
        │                │                          │                  │
        │  - PHI-tagged  │                          │  - PHI-tagged    │
        │  - private     │                          │  - private       │
        │    uploads     │                          │    uploads       │
        │  - in-progress │                          │  - in-progress   │
        │    research    │                          │    research      │
        └────────────────┘                          └──────────────────┘
                │                                             │
                ↓                                             ↓
        ┌───────────────┐                           ┌───────────────┐
        │ Hypothesis KG │                           │ Hypothesis KG │
        │   (per H)     │                           │   (per H)     │
        │  small        │                           │  small        │
        │  extract      │                           │  extract      │
        └──────┬────────┘                           └───────────────┘
               │
               ↓
        ┌──────────────┐
        │   Paper KG   │
        │   (per P)    │
        │  small       │
        │  extract     │
        └──────────────┘
```

Each layer has different ownership, retention, visibility, and write rules.

---

## 2. Layer-by-layer spec

### 2.1 Common Corpus KG

- **Owner**: humanovo platform
- **Storage**: Aurora PostgreSQL + pgvector + Neo4j (read replica per region)
- **Visibility**: read-only to all users; write-protected (only the platform's promotion gate writes)
- **Retention**: forever; edges are append-only with version markers
- **PHI**: never. Auto-detector + user-mark dual gate at promotion (see §4)
- **Initial seed**: ingestion agents seed it during Sprint 3 from PubMed, ClinicalTrials.gov, Patents (USPTO + WIPO + EPO), Preprints (bioRxiv + medRxiv + arXiv), and the 15 sources roadmap'd in `SOURCES_ROADMAP.md`. About 50–100M edges at launch.
- **Growth**: every user-run adds verified edges via the promotion gate. Target: 1B+ edges by month 12.

Edge schema (Aurora):
```sql
CREATE TABLE common_kg_edges (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  promoted_from_run_id TEXT NOT NULL,
  promoted_at TIMESTAMP NOT NULL,
  source_count INT NOT NULL,
  source_ids TEXT[] NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'quarantined' | 'retired'
  quarantined_at TIMESTAMP,
  quarantine_reason TEXT,
  downvote_count INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_common_kg_subject ON common_kg_edges (subject_id);
CREATE INDEX idx_common_kg_predicate ON common_kg_edges (predicate);
CREATE INDEX idx_common_kg_status_active ON common_kg_edges (status) WHERE status = 'active';
```

### 2.2 Private KG (per user)

- **Owner**: the user
- **Storage**: same Aurora cluster, namespace-isolated by `tenant_id` column + Postgres Row-Level Security policies. Per-user S3 prefix for binary uploads.
- **Visibility**: only the owner. Even humanovo support staff cannot read these without an explicit support-mode escalation that's audit-logged.
- **Retention**: until user deletion + 30-day grace period, then hard-deleted (GDPR Article 17 compliance).
- **PHI**: allowed. Anything tagged PHI by the upload-time detector or user mark stays here forever — never promotes to Common.
- **Growth**: from user uploads (PDFs, datasets, lab notebooks) + drafts + in-progress hypotheses.

### 2.3 Hypothesis KG (per hypothesis)

- **Owner**: the user, scoped to one hypothesis
- **Storage**: small subgraph extracts; ~50–500 edges per hypothesis; cached in Aurora for fast UI rendering
- **Visibility**: visible to the user when they open `/projects/:pid/hypotheses/:hid`. A button next to the hypothesis title — "View Knowledge Graph" — opens a dedicated KG view that shows JUST the edges contributing to this hypothesis.
- **Retention**: same as the parent hypothesis
- **PHI**: inherits from Private KG (it's an extract); cannot include Common-KG edges that came from quarantined sources

The view shows:
- Nodes: entities involved (genes, drugs, diseases, trials, etc.)
- Edges: relationships used for this hypothesis
- Per-edge provenance: hover an edge to see "from Common KG (47 papers, confidence 0.94)" or "from your private upload `experiment_log_2026.pdf`" or "from this run's stage 4 validation"
- A downvote button on each Common-KG-derived edge — see §5

### 2.4 Paper KG (per generated paper)

- **Owner**: the user, scoped to one paper
- **Storage**: small subgraph extracts; ~100–1000 edges per paper
- **Visibility**: same as Hypothesis KG — button next to the paper in the project view opens a Paper KG visualization
- **Retention**: same as parent paper
- **PHI**: inherits from Private KG

This is THE differentiator versus Google AI Co-Scientist or any black-box research tool: **every single paper humanovo generates ships with the KG that produced it.** A reviewer can see exactly which prior work supported each claim, which mechanisms were hypothesized, which experiments were proposed, and which Common KG edges were quarantined during the run.

---

## 3. The promotion gate (Private/Hypothesis → Common)

Per your spec — auto-promote on the 12-stage validation pass + downvote-quarantine community correction.

### 3.1 Auto-promotion rules

After the 12-stage pipeline validates a hypothesis, the orchestrator extracts candidate Common-KG edges from the run. An edge is auto-promoted **iff ALL of the following hold**:

1. **HIPAA gate clean** — both auto-detector AND user-mark say no PHI involved (see §4)
2. **Multi-source verification** — the edge is supported by ≥3 distinct sources from the Common Corpus (not just user uploads). "Sources" = published papers, trials, patents, preprints — not the user's private docs.
3. **Grounding ratio ≥ 0.85** — the stage-5 GROUND output for this edge scored at least 0.85
4. **Adversarial pass-through** — stage-3 COUNTER did not produce a serious counter-argument that survived stage-9 CRITIQUE. Soft counter-arguments are allowed; hard refutations block.
5. **Confidence ≥ 0.75** — the stage-6 SCORE confidence axis for the edge is ≥0.75
6. **No model dissent** — the swarm running on this stage did not split (i.e., it wasn't 2 models say "yes" and 3 say "no")

If all 6 pass, the edge is promoted to Common KG with `status='active'`, the promoting `run_id` recorded, and the `source_count` + `source_ids` populated. The user is notified in their dashboard: "your run contributed 12 new edges to the platform's Common Knowledge Graph."

If any of the 6 fail, the edge stays in the user's Private + Hypothesis KG only. The user can still see and use it; it just doesn't propagate to other users.

### 3.2 Why these gates

- **3 sources**: prevents a single bad paper from polluting Common KG
- **Grounding 0.85**: prevents speculative leaps from corrupting the cache
- **Adversarial pass**: makes the 12-stage pipeline's IP visible in the KG quality
- **Confidence 0.75**: cuts the long tail of low-confidence guesses
- **No model dissent**: gates split-decision claims to private until consensus emerges

These thresholds are tuned based on quarterly KG-quality reviews. We open-publish the thresholds (transparency = trust) but the model selector's per-stage quality scores stay private (that IS the moat).

---

## 4. HIPAA enforcement (the gate that prevents PHI leakage)

Per your A+B answer — auto-detector AT upload + user-mark, both required clean for promotion.

### 4.1 Auto-detector (runs on EVERY upload, no opt-out)

A short pipeline running on the upload Lambda:

1. **Pattern matchers**:
   - SSN regex (`\d{3}-\d{2}-\d{4}` + checksum)
   - MRN heuristics (per-institution patterns; pre-trained matchers cover the top 200 US health systems)
   - DOB patterns (`MM/DD/YYYY` + `Mon DD, YYYY` + `YYYY-MM-DD`)
   - Phone numbers, addresses, full names co-occurring with dates
2. **Microsoft Presidio** (open-source PII detection) over the document text
3. **A small LLM judge** (Phi-4 or Haiku 4.5 — cheap) running a prompt: "Does this text contain any of: protected health information, named individuals associated with medical conditions, identifiable patient cohorts, MRNs, dates of service, geographic data smaller than state level?"
4. The strictest of {regex, Presidio, LLM} verdict wins. Any positive flag → entire document marked `phi_status='detected'`.

### 4.2 User mark

At upload, the file picker offers a checkbox: **"This document may contain PHI / patient data — keep it private to my account, never contribute to Common Knowledge Graph."** Default = checked (cautious).

### 4.3 Combined rule

```
def can_promote_to_common(edge: Edge) -> bool:
    source_docs = edge.source_documents
    for doc in source_docs:
        if doc.phi_status == 'detected':
            return False
        if doc.user_phi_mark is True:
            return False
        if doc.tenant_id is not None:  # private upload, even if clean
            # Edges from private uploads can be promoted ONLY if they
            # are also corroborated by ≥2 public-corpus sources. The
            # private source itself never appears in Common KG metadata.
            if not edge.has_public_corroboration(min_sources=2):
                return False
    # ... plus the §3.1 gates
    return True
```

### 4.4 Audit trail

Every promotion attempt — successful or rejected — writes one row in `audit_records`:

```json
{
  "event_type": "kg.promotion.attempt",
  "edge_id": "...",
  "outcome": "promoted" | "rejected_phi" | "rejected_grounding" | ...,
  "phi_signals": {"presidio": false, "regex": false, "llm_judge": false, "user_mark": false},
  "verification": {"sources_found": 4, "grounding_score": 0.91, "confidence": 0.83},
  "tenant_id": "user-456",
  "run_id": "run-789"
}
```

This is the SOC 2 / HIPAA paper trail. Anyone can audit (with proper authorization) which edges were promoted, why, and from whose data.

---

## 5. Downvote / quarantine flow (community correction)

When a researcher views a Hypothesis or Paper KG and spots a wrong edge (e.g., "Drug X inhibits Protein Y" — but they know from recent unpublished work it actually activates), they can downvote it.

### 5.1 UI

In the Hypothesis / Paper KG view, hover any Common-KG edge → a small toolbar appears:
- **View sources** (opens a modal listing the 47 papers behind the edge)
- **Disagree with this edge** (opens a downvote dialog)
- **Suggest correction** (opens a longer-form annotation UI; lands in v1.1)

The downvote dialog asks for a brief justification (1–2 sentences) + optional attached evidence (DOI, paper PDF). The user must be signed in (no anonymous downvotes from trial users).

### 5.2 Auto-quarantine threshold

Each Common KG edge has a `downvote_count`. When it crosses a threshold, the edge auto-quarantines:

| Edge confidence | Downvotes to quarantine |
|---|---|
| ≥ 0.95 | 5 distinct researcher accounts |
| 0.85–0.95 | 3 |
| 0.75–0.85 | 2 |

Quarantine sets `status='quarantined'`. Quarantined edges are:
- **Hidden from new pipeline runs** — the model selector never reads them as evidence
- **Visible in audit trail** — historic Hypothesis/Paper KGs that used the edge keep showing it but with a "⚠ quarantined since {date}" badge
- **Reviewable by the dev team** — quarantined edges queue for human resolution

### 5.3 Resolution

Dev team reviews quarantined edges weekly. Outcomes:
- **Confirmed wrong** → `status='retired'`, edge permanently removed from active pipeline
- **Confirmed right** → `status='active'` restored, downvote_count reset, downvoters notified ("we reviewed your downvote on {edge}; we kept it because {reason}")
- **Disputed (genuine scientific disagreement)** → edge gets a `note` flag explaining the dispute; pipeline still uses it but flags the disagreement in the per-paper KG

The dispute outcome is itself surfaced in the per-paper KG view: researchers see when an edge is disputed and can choose to manually exclude it from their next run via a UI toggle.

### 5.4 Anti-abuse

Downvoting power scales with reputation. New trial users can't downvote. Researcher-tier signed-in users get 10 downvotes/month. Lab/Institution tier get unlimited but rate-limited per session. Repeated bad-faith downvotes (later overturned in resolution) lower a user's reputation score.

---

## 6. Storage projections (when the cost-down loop kicks in)

| Time | Common KG edges | Common KG storage | Avg run cost (vs launch) |
|---|---|---|---|
| Launch (M0) | 50M (seeded) | 30 GB | $0.40 |
| Month 3 | 200M | 120 GB | $0.30 (-25%) |
| Month 6 | 500M | 300 GB | $0.20 (-50%) |
| Month 12 | 1B+ | 700 GB | $0.10 (-75%) |

Cost-down comes from KG-cache hits: stage 4 (VALIDATE) hits the cache for ~80% of common biomedical assertions by month 12, so the source-fetch step is skipped. Same for stage 5 (GROUND), stage 7 (REFINE for citation lookups).

Per-user Private KG averages 100–500 MB at heavy usage. 100K active users × 250 MB avg = 25 TB private storage. Aurora handles this fine; we'll partition by `tenant_id` once tables hit ~10TB to keep query plans tight.

---

## 7. Where to look in the codebase

| Concern | File / module |
|---|---|
| Edge promotion gate | `backend/app/services/kg_promotion.py` (new) |
| HIPAA detector | `backend/app/services/hipaa_detector.py` (new) |
| Aurora schema for Common KG | `backend/migrations/<next>_common_kg.sql` (new) |
| Per-user RLS policies | `backend/migrations/<next>_kg_rls.sql` (new) |
| Audit log integration | `backend/app/services/audit_service.py` (already exists; gets new event types) |
| KG view UI (Hypothesis/Paper) | `frontend/src/pages/HypothesisDetail.tsx` + `frontend/src/pages/HypothesisReview.tsx` (extended) |
| KG view rendering | `frontend/src/pages/ProjectKnowledgeGraph.tsx` (refactored to handle layered KGs) |
| Downvote dialog | `frontend/src/components/kg/EdgeDownvoteDialog.tsx` (new) |
| Quarantine resolution dashboard | `frontend/src/pages/admin/KGQuarantineQueue.tsx` (new, admin-only) |

---

_Last updated 2026-05-05. This is the spec for the KG governance layer. Implementation begins after cloud accounts are live and the Aurora cluster exists in the new AWS Org._

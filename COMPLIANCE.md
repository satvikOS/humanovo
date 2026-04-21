# humanovo — Compliance & Security Documentation

**Audience:** Institutional Security Officers, IRB members, Compliance Officers, Pharma Procurement
**Last Updated:** April 14, 2026
**Document Owner:** Adyanthaya Ventures (humanovo)

---

## Executive Summary

humanovo is designed for deployment in HIPAA-covered, FDA-regulated, and pharma-grade environments. Unlike consumer AI tools and open-source research agents, humanovo provides:

1. **Tamper-evident audit trail** — every LLM call, API request, and data access is logged in an append-only chain
2. **No arbitrary code execution** — humanovo never executes LLM-generated code with system privileges
3. **Institutional deployment** — runs inside customer infrastructure, data never leaves the network
4. **Provenance for every claim** — every hypothesis citation is verifiable against source databases
5. **Role-based access control** — granular permissions with least-privilege defaults

This document describes the controls in place to support compliance with HIPAA Privacy and Security Rules, SOC 2 Type II Trust Services Criteria, FDA 21 CFR Part 11, and the EU AI Act.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Classification & Handling](#2-data-classification--handling)
3. [HIPAA Compliance Controls](#3-hipaa-compliance-controls)
4. [SOC 2 Trust Services Criteria Mapping](#4-soc-2-trust-services-criteria-mapping)
5. [FDA 21 CFR Part 11 Considerations](#5-fda-21-cfr-part-11-considerations)
6. [EU AI Act Considerations](#6-eu-ai-act-considerations)
7. [Audit Trail Engine](#7-audit-trail-engine)
8. [Comparison vs. Competing Products](#8-comparison-vs-competing-products)
9. [Deployment Models](#9-deployment-models)
10. [Incident Response](#10-incident-response)

---

## 1. Architecture Overview

humanovo deploys as a containerized application stack within customer infrastructure. The stack consists of:

| Component | Technology | Data Sensitivity |
|-----------|-----------|------------------|
| API Backend | FastAPI (Python) | All PHI flows through here |
| Discovery Pipeline | Multi-model orchestrator | LLM calls outbound |
| Knowledge Graph | Neo4j 5.x | Curated public data only |
| Vector Store | PostgreSQL + pgvector | Embeddings of public + customer data |
| Metadata DB | PostgreSQL | User accounts, project metadata, audit |
| Cache/Queue | Redis | Ephemeral, no PHI |
| Frontend | React (browser) | Renders only data user is authorized for |
| Audit Log | PostgreSQL `audit_records` table | Append-only, hash-chained |

### Critical Architectural Decisions

1. **No on-disk PHI persistence in cache or queue.** Redis and Celery message bodies contain only IDs that resolve through authenticated API calls.
2. **All LLM API traffic is configurable.** Deployments can route exclusively to AWS Bedrock (HIPAA-eligible BAA) or Azure OpenAI (HIPAA-compatible BAA) and disable other providers.
3. **No telemetry to humanovo.** The product never phones home. There is no usage telemetry sent outside the customer network unless explicitly enabled by the customer for support purposes.

---

## 2. Data Classification & Handling

humanovo classifies data into four tiers:

### Tier 1 — Public Reference Data
Source: PubMed, ClinicalTrials.gov, UniProt, KEGG, Reactome, etc.
Handling: Cached locally for performance, no special controls required.

### Tier 2 — Customer Research Data (De-identified)
Source: Customer-uploaded literature, internal protocols, hypothesis lists.
Handling: Encrypted at rest (AES-256), encrypted in transit (TLS 1.3), access-controlled per project.

### Tier 3 — Customer Operational Data
Source: User accounts, project metadata, audit records.
Handling: Same as Tier 2, plus role-based access enforcement, plus audit logging on every access.

### Tier 4 — PHI / PII
Source: Any patient-derived data uploaded by customer.
Handling:
- **Default:** Deployment configuration must explicitly enable PHI handling
- **De-identification pipeline:** Available for converting Tier 4 → Tier 2 data
- **No PHI to external LLMs unless BAA covers the provider**
- **Audit log captures every PHI access**
- **Data retention policy enforced (configurable, default 6 years per HIPAA)**

---

## 3. HIPAA Compliance Controls

### 3.1 — Administrative Safeguards (45 CFR § 164.308)

| Standard | Implementation |
|----------|---------------|
| Security Management Process | Risk assessment performed annually; documented in `security/risk_assessment.md` |
| Assigned Security Responsibility | Customer designates Security Officer at deployment |
| Workforce Security | Customer manages user provisioning via RBAC roles |
| Information Access Management | Project-level access control; entity-level filters |
| Security Awareness and Training | Customer responsibility; humanovo provides admin documentation |
| Security Incident Procedures | Documented in [Section 10](#10-incident-response) |
| Contingency Plan | Customer-managed via standard PostgreSQL/Redis backup strategy |
| Evaluation | Annual security review; SBOM updates per release |
| Business Associate Contracts | BAA template provided; customer executes with humanovo if SaaS, with LLM providers if applicable |

### 3.2 — Physical Safeguards (45 CFR § 164.310)

humanovo deploys to customer infrastructure. Physical safeguards are the customer's responsibility (their data center or their cloud provider's physical controls).

### 3.3 — Technical Safeguards (45 CFR § 164.312)

| Standard | Implementation |
|----------|---------------|
| Access Control | Role-based: Admin, PI, Researcher, Viewer; OAuth2/JWT |
| Audit Controls | Append-only `audit_records` with hash chain (see [Section 7](#7-audit-trail-engine)) |
| Integrity | SHA-256 hash chain on audit log; checksum validation on data exports |
| Person or Entity Authentication | OAuth2/SAML SSO support; MFA enforceable |
| Transmission Security | TLS 1.3 for all external connections; mTLS option for internal |

### 3.4 — Encryption Standards

- **At Rest:** AES-256-GCM (PostgreSQL Transparent Data Encryption, Neo4j enterprise encryption)
- **In Transit:** TLS 1.3 minimum; TLS 1.2 fallback explicitly disabled
- **Key Management:** Customer-managed via HashiCorp Vault, AWS KMS, or Azure Key Vault
- **Application-Level Encryption:** Sensitive fields (API keys, PHI exports) double-encrypted with envelope encryption

---

## 4. SOC 2 Trust Services Criteria Mapping

| TSC Category | humanovo Control |
|--------------|------------------|
| **Security** — Common Criteria | RBAC, MFA, encryption, audit log, vulnerability scanning, dependency monitoring |
| **Availability** | Stateless API design; horizontal scaling supported; database HA via PostgreSQL replication |
| **Processing Integrity** | Pipeline determinism; idempotent endpoints; transaction guarantees in PostgreSQL |
| **Confidentiality** | Data classification, access control, encryption, audit; NDA-compatible deployment model |
| **Privacy** | De-identification pipeline; data minimization defaults; retention policies; export & deletion APIs |

### SOC 2 Readiness Status

humanovo is **SOC 2 Type II ready** for the following common controls:

- CC6.1 — Logical and physical access controls (RBAC + audit)
- CC6.2 — User access provisioning (admin API + audit)
- CC6.3 — User access removal (admin API + audit)
- CC6.6 — Encryption of data at rest (configurable per-deployment)
- CC6.7 — Encryption of data in transit (TLS 1.3)
- CC6.8 — Logical access prevented for terminated users (token revocation)
- CC7.1 — System monitoring (audit log + Prometheus metrics)
- CC7.2 — System monitoring for anomalies (log alerting integration)
- CC7.3 — Incident response procedures ([Section 10](#10-incident-response))

A formal SOC 2 Type II audit requires 6+ months of operating history in a customer production environment. humanovo will pursue formal certification once first institutional deployment passes the 6-month mark.

---

## 5. FDA 21 CFR Part 11 Considerations

For pharmaceutical and clinical research deployments where humanovo outputs may be referenced in regulatory submissions:

| Part 11 Requirement | Implementation |
|---------------------|----------------|
| § 11.10(a) — Validation | Pipeline produces deterministic outputs given same inputs and seeds; validation suite available |
| § 11.10(b) — Record generation | All outputs include execution metadata, model versions, timestamps |
| § 11.10(c) — Record protection | Append-only audit log; cryptographic hash chain |
| § 11.10(d) — System access | RBAC + authentication |
| § 11.10(e) — Audit trails | Comprehensive audit log captures who/what/when for all actions |
| § 11.10(f) — Operational checks | Sequential pipeline stages with validation between each |
| § 11.10(g) — Authority checks | Permission checks before every action |
| § 11.50 — Signature manifestations | Electronic signatures supported via integration with customer IDP |
| § 11.70 — Signature/record linking | Signatures cryptographically bound to records via audit chain |

**Important caveat:** humanovo is a **decision-support tool**, not a regulated medical device. Final scientific judgment and any regulatory submissions remain the responsibility of qualified human researchers. The audit trail supports defensibility of outputs but does not constitute regulatory approval of the AI system itself.

---

## 6. EU AI Act Considerations

The EU AI Act treats AI for biomedical research as a high-risk application in some contexts. humanovo provides:

| EU AI Act Article | Implementation |
|-------------------|----------------|
| Article 9 — Risk Management | Documented in `security/risk_assessment.md` |
| Article 10 — Data Governance | Source provenance tracked for all training data references; bias monitoring built-in |
| Article 11 — Technical Documentation | This document + architecture docs constitute technical file |
| Article 12 — Record-Keeping | Audit trail engine satisfies logging requirements |
| Article 13 — Transparency | Stage-by-stage reasoning visibility; confidence decomposition |
| Article 14 — Human Oversight | Pipeline outputs require human approval before downstream actions |
| Article 15 — Accuracy/Robustness/Cybersecurity | Benchmark suite + security controls in this document |

---

## 7. Audit Trail Engine

humanovo's audit trail is the cornerstone of its compliance story.

### 7.1 — What Gets Audited

Every event of these types is recorded:

**Pipeline Events**
- Pipeline start/complete/error
- Stage start/complete/error (per all 12 stages)
- Grounding gate decisions (claim accepted/rejected with similarity score)

**LLM Events**
- Every request to every LLM provider (model, prompt token count, response token count, cost)
- Every response (hash of response, latency, success/failure)
- Every error (provider error, retry attempt, fallback triggered)

**External API Events**
- Every PubMed query, every ClinicalTrials.gov fetch, every UniProt lookup
- Request URL, parameters, response size, latency
- Rate limit events

**Data Access Events**
- Every read of a hypothesis, evidence record, or knowledge graph entity
- Every write (hypothesis created, evidence added, project modified)
- Every delete (with original record preserved in audit detail)
- Every export (format, scope, recipient)

**Authentication Events**
- Login successful / failed
- Logout
- Permission denied
- Token refresh

### 7.2 — Tamper Evidence

Each audit record contains:
- `sequence` (monotonically increasing integer)
- `timestamp` (UTC, with timezone)
- `previous_hash` (SHA-256 of the prior record)
- `record_hash` (SHA-256 of this record's contents + previous_hash)

This forms a hash chain. Any tampering with a historical record invalidates all subsequent record hashes, making modification detectable through the verification function:

```python
from app.services.audit_service import get_audit_service

audit = get_audit_service()
report = await audit.verify_chain(db)
# Returns: {"verified_count": N, "issues_found": 0, "intact": True, ...}
```

### 7.3 — Export & Reporting

Audit logs can be exported as JSON or CSV, scoped by:
- User
- Project
- Execution ID
- Time range
- Event type

Exports are themselves auditable events.

### 7.4 — Retention

Default retention: 6 years (HIPAA minimum).
Configurable per deployment via `AUDIT_RETENTION_DAYS` environment variable.
Retention deletion does NOT remove records — it archives them to cold storage and removes from the live database. Archive integrity is verified annually.

---

## 8. Comparison vs. Competing Products

| Capability | humanovo | Biomni / Phylo | Google AI Co-Scientist | OpenAI Prism |
|-----------|----------|----------------|------------------------|--------------|
| **Tamper-evident audit log** | ✓ Hash-chained | ✗ | ✗ | ✗ |
| **Arbitrary code execution risk** | None (API-only) | YES — full system privileges | Black box | Sandbox |
| **Customer infrastructure deployment** | ✓ | ✗ (web service) | ✗ (web service) | ✗ (web service) |
| **HIPAA BAA available** | ✓ via deployment | ✗ | Limited (Cloud BAA) | ✓ via Enterprise |
| **PHI handling controls** | Built-in | Not designed for PHI | Limited | Limited |
| **Provenance for every claim** | ✓ | Partial | Partial | Partial |
| **Stage-by-stage reasoning visibility** | ✓ All 12 stages | Partial (agent trace) | ✗ | ✗ |
| **Open source** | Proprietary | Apache 2.0 | Closed | Closed |
| **Air-gapped deployment** | ✓ | ✗ | ✗ | ✗ |

The Biomni README explicitly warns: *"Currently, Biomni executes LLM-generated code with full system privileges. If you want to use it in production, please use in isolated/sandboxed environments. The agent can access files, network, and system commands. Be careful with sensitive data or credentials."*

This is a fundamental architectural difference. humanovo cannot execute arbitrary code because it does not have a code execution layer in the hypothesis pipeline. The 12 stages are LLM reasoning + structured tool calls only.

---

## 9. Deployment Models

### 9.1 — Institutional On-Premises

humanovo deploys as a Docker Compose or Kubernetes stack within the customer's VPC or data center. All data, all LLM credentials, all audit logs reside within customer infrastructure. humanovo has zero visibility into customer usage.

This is the recommended model for:
- Academic medical centers (e.g., URMC)
- Pharmaceutical companies
- Any HIPAA-covered entity

### 9.2 — Customer Cloud (BYO Cloud Account)

humanovo deploys to the customer's AWS/Azure account using infrastructure-as-code (Terraform). Customer owns all resources, IAM policies, and billing. humanovo provides operational support via authenticated bastion access on demand.

### 9.3 — Multi-Tenant SaaS (Future)

For non-HIPAA research deployments, a hosted multi-tenant SaaS option will be available. This model is not appropriate for PHI handling and is not currently offered.

---

## 10. Incident Response

### 10.1 — Detection

Triggers for incident response:
- Audit log integrity verification failure
- Unauthorized access detected
- Pipeline producing anomalous outputs (defined per deployment)
- External LLM provider security incident
- Dependency CVE disclosure

### 10.2 — Response

1. **Containment** (0-1 hour): Disable affected services, revoke credentials, snapshot audit log
2. **Investigation** (1-24 hours): Audit log analysis, scope determination
3. **Notification** (per applicable regulation):
   - HIPAA breach: 60 days to affected individuals, OCR notification
   - GDPR: 72 hours to supervisory authority
4. **Remediation**: Patch, rotate credentials, restore from clean backup
5. **Post-Incident Review**: Documented within 30 days

### 10.3 — Customer Responsibilities

Customer maintains responsibility for:
- Operating system and infrastructure patching
- Network security controls
- User account lifecycle management
- Backup and disaster recovery

humanovo provides:
- Application security patches (within 7 days of CVE disclosure for High/Critical)
- Security advisories
- Coordinated disclosure for any humanovo-discovered vulnerabilities

---

## Appendix A — Compliance Officer Quick Reference

**Q: Does humanovo send my data to OpenAI / Anthropic / Google?**
A: Only if you configure those providers in your deployment. You can route exclusively through HIPAA-eligible providers (AWS Bedrock, Azure OpenAI with BAA). LLM provider selection is per-stage and configurable.

**Q: Can humanovo run arbitrary code on my infrastructure?**
A: No. The discovery pipeline executes LLM API calls and structured tool calls (database queries, API requests) only. There is no code execution layer.

**Q: Where is the audit log stored?**
A: In your PostgreSQL instance, in the `audit_records` table. You control retention, backup, and access.

**Q: How do I prove the audit log hasn't been tampered with?**
A: Run `audit_service.verify_chain(db)`. The function recomputes the hash chain and reports any inconsistencies.

**Q: Can I delete a user's data per GDPR right-to-be-forgotten?**
A: Yes. The `DELETE /api/v1/users/{id}/data` endpoint cascades through projects, hypotheses, and evidence. The deletion itself is audited (event type: `data.delete`). Audit records about the deleted user are anonymized but retained per legal hold requirements.

**Q: What happens if an LLM provider has a breach?**
A: humanovo's logs allow you to identify exactly which prompts and responses transited the affected provider, scoped to the affected time window. You can then assess your exposure precisely rather than assuming worst case.

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-14 | S. Adyanthaya | Initial release |

**Next review date:** 2026-07-14 (quarterly review cycle)

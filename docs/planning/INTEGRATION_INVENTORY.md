# Integration Inventory — Authoritative Source List

**Date**: 2026-05-04 · **Sprint**: 1 / Day 2 · **Status**: ground truth from code audit

This is the authoritative list. The README's "60+ APIs" claim is aspirational — the codebase has 15 wired integrations, 15 dead-code stubs, and 30+ mentioned-only references. Every claim here is backed by a file path you can verify.

## Wired & working today (15)

These are invoked by the discovery orchestrator, ingestion scheduler, or user-triggered endpoints. All test through to a real API call.

### 9 core API clients (`backend/app/integrations/`)

| Source | Type | File | Domain | License | Auth |
|---|---|---|---|---|---|
| UniProt | proteomics | `integrations/uniprot.py` | `rest.uniprot.org` | CC0 (public domain) | none — polite-pool email |
| ChEMBL | chemistry / drugs | `integrations/chembl.py` | `www.ebi.ac.uk/chembl/api/data` | CC-BY 4.0 | none — polite-pool |
| Ensembl | genomics | `integrations/ensembl.py` | `rest.ensembl.org` | open data | none — polite-pool |
| Reactome | pathways | `integrations/reactome.py` | `reactome.org` | CC-BY 4.0 | none — polite-pool |
| OpenTargets | drug-target-disease | `integrations/opentargets.py` | `api.platform.opentargets.org` | open data | none |
| EuropePMC | literature | `integrations/europepmc.py` | `www.ebi.ac.uk/europepmc/...` | CC-BY 4.0 | none |
| OpenAlex | literature / bibliographic | `integrations/openalex.py` | `api.openalex.org` | CC0 | polite-pool email |
| AlphaFold | structure prediction | `integrations/alphafold.py` | `alphafold.ebi.ac.uk` | CC-BY 4.0 | none |
| Human Protein Atlas | tissue expression | `integrations/human_protein_atlas.py` | `www.proteinatlas.org` | CC-BY 3.0 | none |

Pipeline stages that call these: SEED, EXPAND, EVIDENCE, MECHANISM, VALIDATE.

### 6 ingestion agents (`backend/app/agents/ingestion/`)

| Source | Type | File | Domain | License | Auth |
|---|---|---|---|---|---|
| PubMed (NCBI E-utilities) | literature | `agents/ingestion/pubmed_agent.py` | `eutils.ncbi.nlm.nih.gov` | public domain (US gov) | optional API key (10 req/s vs 3) |
| ClinicalTrials.gov | clinical | `agents/ingestion/clinical_trials_agent.py` | `clinicaltrials.gov/api/v2` | public domain | none |
| USPTO PatentsView | patents | `agents/ingestion/patents_agent.py` | `api.patentsview.org` | public domain | optional |
| ~~Brave Search~~ | ~~web~~ | ~~`agents/ingestion/brave_search_agent.py`~~ | ~~`api.search.brave.com`~~ | ~~proprietary (paid)~~ | ~~required key~~ |
| Preprint (bioRxiv / medRxiv via Crossref) | literature | `agents/ingestion/preprint_agent.py` | `api.biorxiv.org`, `api.crossref.org` | CC-BY 4.0 (bioRxiv) | none |
| Custom Document upload | user-data | `agents/ingestion/custom_document_agent.py` | n/a (file) | user-controlled | n/a |

**v1 cut: Brave Search dropped** (only paid source; web search adds noise to a biomedical pipeline; researchers can paste URLs/articles manually). Removed in Sprint 1 / D8.

After Brave is dropped, **all 14 wired sources are fully open** (CC0 / public domain / CC-BY 3.0 or 4.0 / open data) — every one is commercial-use-OK with attribution. No academic-only or commercial-restricted licenses in the v1 set. Clean licensing story for any future pharma-enterprise pivot.

## Dead code — STUB integrations (15) — to delete in Sprint 1 / D7

These have class scaffolding but are **not invoked by any orchestrator, agent, or endpoint**. Deleting them shrinks the attack surface and reduces audit confusion.

| Service | File | Action |
|---|---|---|
| ElsevierService | `backend/app/services/biomedical_apis.py:ElsevierService` | Delete (commercial subscription, not used) |
| SpringerService | `backend/app/services/biomedical_apis.py:SpringerService` | Delete (not invoked) |
| ChEBIService | `backend/app/services/biomedical_apis.py:ChEBIService` | Delete (not invoked; OLS lookups can be added later) |
| HCAService (Human Cell Atlas) | `backend/app/services/biomedical_apis.py:HCAService` | Delete; add proper integration in v1.1 |
| CellOntologyService | `backend/app/services/biomedical_apis.py:CellOntologyService` | Delete (not invoked) |
| FMAService | `backend/app/services/biomedical_apis.py:FMAService` | Delete (not invoked) |
| NCBIExtendedService | `backend/app/services/biomedical_apis.py:NCBIExtendedService` | Delete; capabilities to be folded into PubMed agent or new ClinVar/dbSNP agents in Sprint 3 |
| KEGGExtendedService | `backend/app/services/biomedical_apis.py:KEGGExtendedService` | Delete (KEGG full API has commercial restrictions; not in v1) |
| PubMedSource (ingestion) | `backend/app/ingestion/sources.py:PubMedSource` | Delete; PubMed agent is canonical |
| ClinicalTrialsSource (ingestion) | `backend/app/ingestion/sources.py:ClinicalTrialsSource` | Delete; agent is canonical |
| ReactomeSource (ingestion) | `backend/app/ingestion/sources.py:ReactomeSource` | Delete; integration client is canonical |
| DrugBankSource | `backend/app/ingestion/sources.py:DrugBankSource` | Delete (placeholder; commercial license required for full data) |
| PubMedSource (literature) | `backend/app/literature/sources.py:PubMedSource` | Delete; mock-only |
| PatentSource (literature) | `backend/app/literature/sources.py:PatentSource` | Delete; no impl |
| ClinicalTrialsSource (literature) | `backend/app/literature/sources.py:ClinicalTrialsSource` | Delete; no impl |

Net impact: removes ~1500 lines of dead code, simplifies module graph, makes the integration count honest in the codebase itself.

## Mentioned-only — README claims with no implementation (~30+)

Tracked separately in `SOURCES_ROADMAP.md`. The README will be updated to remove unsupported claims; the roadmap doc lists what we plan to add and when.

## Authoritative SSRF allowlist for Sprint 1 / D7

Every domain we make outbound requests to. No others permitted.

```
# Tier 1 — every-discovery essential (9)
rest.uniprot.org
www.ebi.ac.uk            # ChEMBL, EuropePMC
rest.ensembl.org
api.platform.opentargets.org
reactome.org
api.openalex.org
alphafold.ebi.ac.uk
www.proteinatlas.org

# Tier 2 — ingestion jobs (5)
eutils.ncbi.nlm.nih.gov  # PubMed, NCBI E-utilities
clinicaltrials.gov
api.patentsview.org      # USPTO
api.biorxiv.org          # preprints
api.crossref.org         # DOI resolution

# Tier 3 — Sprint 3 additions (15)
api.fda.gov              # openFDA
files.rcsb.org           # PDB
data.rcsb.org            # PDB API
www.wikipathways.org
api.semanticscholar.org
www.cbioportal.org
bigg.ucsd.edu
www.mousephenotype.org   # IMPC
www.informatics.jax.org  # MGI
gtexportal.org
api.gdc.cancer.gov       # NCI Genomic Data Commons
api.cellxgene.cziscience.com
www.proteomicsdb.org
depmap.org
```

Total: 14 in Sprint 1, growing to 29 by end of Sprint 3. Anything not on this list returns SSRF-blocked.

## Credential pool requirements

Pulled into `CREDENTIAL_POOL_DESIGN.md` separately. For the wired set, the only optional/required credentials are:

| Provider | Credential | Required? | Pool size needed |
|---|---|---|---|
| NCBI (PubMed, ClinVar, dbSNP, etc.) | `PUBMED_API_KEY` | Optional (boosts 3→10 req/s) | 1 key per ~50 active users |
| NCBI polite-pool email | `PUBMED_EMAIL` | Required by NCBI ToS | n/a (single value) |
| All other 13 wired sources | none | n/a | n/a |

After dropping Brave, the upstream credential surface is **one optional API key for NCBI**. The "CredentialPool" is mostly architectural foresight for the LLM providers (Bedrock, Azure OpenAI, Azure AI) where the multi-key resilience pattern earns its keep.

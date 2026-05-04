# Sources Roadmap

**Status**: planning · **Drives**: marketing claim ("30+ growing to 60+") and Sprint 3 / Day 18-22 build work

## v1 wired (after Sprint 1 / D8 Brave drop) — 14 sources

See `INTEGRATION_INVENTORY.md` for the authoritative table. All are CC0 / public domain / CC-BY 3.0 or 4.0 / open data — commercial-use-OK with attribution.

## v1 build queue — Sprint 3 (15 new) → ships beta with 30 sources

These are picked for: (a) high pipeline value, (b) public-domain or CC-BY licensing only, (c) reasonable rate limits, (d) stable APIs. Explicitly avoids academic-only or commercial-restricted sources to keep the licensing story clean.

| # | Source | Type | Stage benefit | License | Domain |
|---|---|---|---|---|---|
| 1 | **openFDA** | drugs / adverse events / labels / recalls | drug repurposing, safety signals (SCORE, TRANSLATE) | public domain (US FDA) | `api.fda.gov` |
| 2 | **RCSB PDB** | structure (experimental) | mechanism (complements AlphaFold predictions) | CC0 | `data.rcsb.org` |
| 3 | **WikiPathways** | pathways | mechanism, alternative to Reactome | CC-BY | `www.wikipathways.org` |
| 4 | **Semantic Scholar** | literature / bibliographic | EXPAND, EVIDENCE (alternative to OpenAlex) | open (Allen Institute) | `api.semanticscholar.org` |
| 5 | **cBioPortal** | cancer genomics | oncology hypothesis grounding | open | `www.cbioportal.org/api/v2` |
| 6 | **BiGG Models** | metabolic models | systems-biology mechanism | open | `bigg.ucsd.edu` |
| 7 | **IMPC** | mouse phenotyping | preclinical translation, target validation | open | `www.mousephenotype.org` |
| 8 | **MGI** | mouse genome informatics | model-organism gene/phenotype | open (Jackson Lab) | `www.informatics.jax.org` |
| 9 | **ClinVar (standalone)** | variant clinical significance | EVIDENCE, SCORE | public domain (NCBI) | `eutils.ncbi.nlm.nih.gov` |
| 10 | **dbSNP (standalone)** | variant catalog | EVIDENCE, MECHANISM | public domain (NCBI) | `eutils.ncbi.nlm.nih.gov` |
| 11 | **GTEx** | tissue-specific gene expression | mechanism (complements HPA) | open | `gtexportal.org/api/v2` |
| 12 | **NCI GDC** | cancer genomics commons | TCGA-grade evidence | open | `api.gdc.cancer.gov` |
| 13 | **cellxgene Census** | single-cell atlases | single-cell hypothesis grounding | CC-BY (CZI) | `api.cellxgene.cziscience.com` |
| 14 | **ProteomicsDB** | proteomics expression | proteome evidence | open (TUM) | `www.proteomicsdb.org` |
| 15 | **DepMap** | cancer cell line dependencies | target prioritization | CC-BY 4.0 | `depmap.org` |

These 15 round out the discovery pipeline with: drug safety (openFDA), experimental structure (PDB), alternative pathways (WikiPathways), single-cell (cellxgene), cancer genomics (cBioPortal, GDC, DepMap), variant biology (ClinVar, dbSNP), tissue specificity (GTEx), proteomics (ProteomicsDB), model organism (IMPC, MGI), metabolic models (BiGG), and a literature alternative (Semantic Scholar).

## v1.1 / Q3 2026 candidates — pushes claim toward 60+

These need additional license review or scope work; held for the next release.

| Source | Why deferred |
|---|---|
| KEGG (full API beyond stub) | Commercial restrictions; subscription required for full programmatic access. Use Reactome + WikiPathways for v1. |
| DrugBank (full) | Academic-free, commercial-paid. Investigate paid tier for pharma-enterprise. ChEMBL covers most v1 drug needs. |
| DisGeNET | CC-BY-NC-SA — non-commercial only. Cannot use in a commercial SaaS. Consider DisGeNET-plus paid tier for v1.1. |
| STRING | Academic-free, commercial-paid. Same issue. OmniPath as alternative. |
| HMDB | Academic-free, commercial-paid. |
| COSMIC | Academic-free, commercial-paid. |
| OmniPath | Academic-free, license review needed. |
| IntOGen | License review needed. |
| Pathway Commons | Open — fold in v1.1. |
| Human Cell Atlas (full) | Open — replaces the stub deletion in Sprint 1; do properly in v1.1. |
| ChEBI | Open — fold in via OLS in v1.1. |
| Cell Ontology | Open — via OLS in v1.1. |
| FMA (anatomy) | Open — via OLS in v1.1. |
| Open Phacts | Federated open API — v1.1. |
| Drugs@FDA (separate from openFDA) | Public domain. |
| RxNorm | Public domain. |
| MeSH | Public domain — fold into NCBI tooling. |
| GENECARDS API | License review (mostly aggregated; some fields restricted). |
| cBioPortal extensions | covered in v1; v1.1 adds tier-2 endpoints. |
| Allen Brain Atlas | Open — v1.1 (neuroscience expansion). |
| ImmPort | Open — v1.1 (immunology). |
| GEO (Gene Expression Omnibus) | Public domain — v1.1 (raw expression data). |
| ArrayExpress | Open — v1.1. |
| Single Cell Portal (Broad) | Open — v1.1. |
| FlyBase / WormBase / ZFIN | Open — model-organism v1.2. |
| PRIDE (proteomics archive) | Open — v1.2. |
| GnomAD | Open — v1.1 (population genomics). |
| TCRdb | License review — immunology. |
| MSigDB | Open — v1.1 (gene set enrichment). |
| Enrichr | Open — v1.1 (gene set enrichment alternative). |
| BindingDB | Open — v1.1. |
| GuideToPharmacology | Open — v1.1. |

That's 30+ deferred. Combined with v1's 30, total roadmap reaches ~60+. The README marketing claim becomes *honestly defensible* once it reads "**30+ open biomedical sources, 60+ in roadmap**" — not "60+" implying all wired.

## License taxonomy guard

Before any new source is added, it must pass:

1. **License**: CC0, public-domain, CC-BY (any version), or "open data" with explicit commercial-use clause. **No** academic-only, NC (non-commercial), or commercial-restricted licenses for v1 / v1.1.
2. **Stability**: API has been live and unchanged for ≥12 months, OR has a versioned API contract.
3. **Rate limit**: ≥1 req/s without authentication, OR ≥10 req/s with a free API key.
4. **Test coverage**: passes T1-T3 of the integration test harness on first build (connectivity, schema, error path) before merging.

The user's directive — "they are all open sources" — is therefore the binding constraint. Any deferred source that we decide to include later must be re-licensed or upgraded before reaching v1.x.

## Marketing copy update

Current README:
> Core: PubMed, ClinicalTrials.gov, openFDA, UniProt, Reactome, KEGG, Ensembl, HMDB
> Extended: Elsevier/Scopus, Springer Nature, ChEBI, HCA, NCBI Gene, ClinVar, Semantic Scholar, OpenAlex, ChEMBL, DrugBank, DisGeNET, STRING, PDB, AlphaFold, WikiPathways, and more.

Sprint 1 / D8 update:
> 30+ open biomedical data sources at v1 launch, expanding to 60+ by Q4 2026 (see [SOURCES_ROADMAP](docs/planning/SOURCES_ROADMAP.md)).
>
> v1 set spans literature (PubMed, EuropePMC, OpenAlex, Semantic Scholar, bioRxiv/medRxiv), clinical (ClinicalTrials.gov, openFDA), genomics (Ensembl, ClinVar, dbSNP, GTEx, NCI GDC, IMPC, MGI), proteomics (UniProt, Human Protein Atlas, ProteomicsDB, AlphaFold, RCSB PDB), pathways (Reactome, WikiPathways, BiGG), drugs (ChEMBL, openFDA), single-cell (cellxgene Census), oncology (cBioPortal, DepMap), patents (USPTO PatentsView), and OpenTargets disease-target-drug associations.

Honest, defensible, and counts to 30 if anyone tallies.

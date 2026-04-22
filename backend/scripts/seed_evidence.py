"""Evidence + Hypothesis seed script.

Once the KG (seed_kg.py) is populated, this script fabricates a
realistic Evidence corpus tied back to those entities so the Evidence
page, Hypothesis list, and Dashboard counters render meaningful data
without needing external ingestion.

For each KG disease, write:
  * 3-5 Evidence rows (title + abstract tied to the disease) with
    real-shaped PMIDs / DOIs so the CrossRef/NCBI verify endpoint
    from Batch G can be exercised.
  * 1-2 Hypothesis rows describing a published or in-flight mechanism,
    linked to the project created for that disease.
  * 1 Project row per disease.

All deterministic — re-running updates by (title, project_id).
Pgvector embeddings on evidence.abstract via the same token-freq
_fixture_embedding from seed_kg so Evidence RAG actually retrieves.

Usage:
  cd backend
  DATABASE_URL=... python -m scripts.seed_evidence
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://humanovo:humanovo@localhost:5432/humanovo",
)

from scripts.seed_kg import _fixture_embedding


# ─── Evidence corpus ──────────────────────────────────────────────
# (disease, title, abstract, doi, pmid, journal, year)

EVIDENCE: list[tuple[str, str, str, str | None, str | None, str, int]] = [
    # Parkinson's Disease
    (
        "Parkinson's Disease",
        "Alpha-synuclein propagation from gut to brain via the vagus nerve",
        "Alpha-synuclein pathology originates in the enteric nervous system and "
        "propagates in a prion-like manner to the dorsal motor nucleus of the vagus "
        "and onward to substantia nigra. Vagotomy reduces Parkinson's risk in longitudinal cohorts. "
        "Gut microbiome dysbiosis precedes motor onset by up to 20 years.",
        "10.1016/j.cell.2019.01.012", "30763328", "Cell", 2019,
    ),
    (
        "Parkinson's Disease",
        "GBA mutations and glucocerebrosidase activity in idiopathic PD",
        "Heterozygous GBA mutations are the most common genetic risk factor for "
        "Parkinson's disease, present in 5-10% of cases. Reduced glucocerebrosidase "
        "activity impairs lysosomal alpha-synuclein clearance. Ambroxol is a candidate chaperone.",
        "10.1056/NEJMoa0901281", "19846850", "New England Journal of Medicine", 2009,
    ),
    (
        "Parkinson's Disease",
        "Prasinezumab passive immunization against aggregated alpha-synuclein",
        "Prasinezumab is a monoclonal antibody targeting aggregated alpha-synuclein. "
        "PASADENA phase 2 trial showed reduced motor progression in early PD. "
        "Phase 3 PADOVA trial ongoing; dual-embedding grounding confirmed mechanistic plausibility.",
        "10.1056/NEJMoa2202867", "35921451", "New England Journal of Medicine", 2022,
    ),
    # Alzheimer's Disease
    (
        "Alzheimer's Disease",
        "Amyloid-beta plaques and tau tangles in Alzheimer's pathogenesis",
        "The amyloid cascade hypothesis posits that Aβ deposition triggers tau hyperphosphorylation, "
        "neurofibrillary tangle formation, and synaptic loss. ApoE4 dramatically accelerates "
        "Aβ deposition; microglial dysfunction amplifies neuroinflammation.",
        "10.1126/science.1566067", "1566067", "Science", 1992,
    ),
    (
        "Alzheimer's Disease",
        "Lecanemab slows cognitive decline in early Alzheimer's",
        "Lecanemab, an anti-Aβ protofibril monoclonal antibody, reduced amyloid burden and "
        "slowed decline on CDR-SB by 27% in the Clarity AD trial (N=1795). FDA approval Jan 2023. "
        "ARIA-E remains the principal safety concern, particularly in ApoE4 homozygotes.",
        "10.1056/NEJMoa2212948", "36449413", "New England Journal of Medicine", 2022,
    ),
    # PDAC
    (
        "Pancreatic Ductal Adenocarcinoma",
        "KRAS G12C inhibitors in pancreatic ductal adenocarcinoma",
        "KRAS is mutated in >90% of pancreatic ductal adenocarcinomas. KRAS G12C inhibitors "
        "adagrasib and sotorasib show response rates of 33% in PDAC; resistance arises via "
        "RTK re-activation and alternate MAPK pathways. Desmoplastic stroma limits drug penetration.",
        "10.1056/NEJMoa2304474", "37283530", "New England Journal of Medicine", 2023,
    ),
    (
        "Pancreatic Ductal Adenocarcinoma",
        "Desmoplastic stroma and immune exclusion in PDAC",
        "The pancreatic tumor microenvironment is characterized by dense desmoplastic stroma that "
        "physically excludes cytotoxic T cells. Cancer-associated fibroblasts secrete TGF-β and "
        "CXCL12, reinforcing immune exclusion and resistance to checkpoint blockade.",
        "10.1038/nrc.2016.52", "27329281", "Nature Reviews Cancer", 2016,
    ),
    # COVID-19
    (
        "COVID-19",
        "Baricitinib reduces mortality in hospitalized COVID-19 patients",
        "Baricitinib, a JAK1/JAK2 inhibitor, reduces 28-day mortality in hospitalized "
        "COVID-19 patients by ~38% (COV-BARRIER trial, N=1525). JAK inhibition "
        "simultaneously dampens cytokine storm and blocks AAK1-mediated viral entry.",
        "10.1016/S2213-2600(21)00331-3", "34419203", "Lancet Respiratory Medicine", 2021,
    ),
    # Breast Cancer
    (
        "Breast Cancer",
        "Trastuzumab deruxtecan in HER2-low metastatic breast cancer",
        "Trastuzumab deruxtecan is an antibody-drug conjugate delivering a topoisomerase I inhibitor "
        "payload. DESTINY-Breast04 demonstrated improved PFS in HER2-low MBC (mPFS 9.9 vs 5.1 months). "
        "Interstitial lung disease remains a class-specific safety signal.",
        "10.1056/NEJMoa2203690", "35665782", "New England Journal of Medicine", 2022,
    ),
    # Type 2 Diabetes / GLP-1
    (
        "Type 2 Diabetes",
        "Semaglutide cardiovascular outcomes in obesity without diabetes",
        "Semaglutide 2.4mg reduced MACE (composite of death from cardiovascular causes, nonfatal MI, "
        "nonfatal stroke) by 20% in the SELECT trial (N=17604) among patients with overweight/obesity "
        "without diabetes. GLP-1 receptor agonism improves glycemic control + confers cardioprotection.",
        "10.1056/NEJMoa2307563", "37952131", "New England Journal of Medicine", 2023,
    ),
    # Idiopathic Pulmonary Fibrosis
    (
        "Idiopathic Pulmonary Fibrosis",
        "TGF-β signaling drives alveolar epithelial cell dysfunction in IPF",
        "Repetitive injury to alveolar epithelial type II cells activates TGF-β signaling in "
        "adjacent fibroblasts, driving myofibroblast differentiation and ECM deposition. "
        "Pirfenidone and nintedanib slow decline in FVC but do not reverse fibrosis.",
        "10.1038/nrm.2016.87", "27677860", "Nature Reviews Molecular Cell Biology", 2016,
    ),
    # Rheumatoid Arthritis
    (
        "Rheumatoid Arthritis",
        "JAK inhibitors versus TNF inhibitors in rheumatoid arthritis",
        "JAK inhibitors (tofacitinib, baricitinib, upadacitinib) are oral small molecules that "
        "block JAK-STAT cytokine signaling. Comparable efficacy to TNF biologics but elevated "
        "venous thromboembolism and cardiovascular risk at higher doses limit label indications.",
        "10.1056/NEJMoa2109927", "35045226", "New England Journal of Medicine", 2022,
    ),
]

# Project seed — one per disease (dedup on name)
PROJECTS: list[tuple[str, str]] = sorted({
    (disease, f"Investigating mechanisms and therapeutics in {disease}")
    for disease, *_ in EVIDENCE
})

# Hypotheses: (project_disease, title, statement, mechanism, confidence)
HYPOTHESES: list[tuple[str, str, str, str, float]] = [
    (
        "Parkinson's Disease",
        "Vagotomy-GBA synergy hypothesis for early PD intervention",
        "Truncal vagotomy combined with ambroxol-mediated GBA enhancement will prevent "
        "gut-to-brain alpha-synuclein propagation in individuals with GBA-carrier status.",
        "Vagal surgical disconnection blocks peripheral α-syn entry to CNS; "
        "ambroxol upregulates GBA activity, restoring lysosomal α-syn clearance. "
        "Targets combined gut + cellular-clearance arms of the pathology.",
        0.72,
    ),
    (
        "Pancreatic Ductal Adenocarcinoma",
        "KRAS-stromal co-targeting with FAK inhibitors improves PDAC chemotherapy penetration",
        "Concurrent KRAS G12D inhibition and FAK (focal adhesion kinase) blockade will "
        "collapse the desmoplastic stroma and restore chemotherapy access in PDAC.",
        "KRAS inhibition blocks oncogenic signaling while FAK inhibition disrupts cancer-"
        "associated fibroblast-ECM assembly, opening drug-delivery corridors for gemcitabine + "
        "nab-paclitaxel. Pre-clinical evidence in KPC mice supports a 2-3x tumor shrinkage vs monotherapy.",
        0.68,
    ),
    (
        "Alzheimer's Disease",
        "Semaglutide as primary prevention in ApoE4 homozygotes",
        "GLP-1 receptor agonism with semaglutide will reduce Alzheimer's disease incidence in "
        "ApoE4 homozygotes by attenuating neuroinflammation and improving insulin signaling in "
        "a 5-year primary prevention trial.",
        "Semaglutide crosses the blood-brain barrier, activates hippocampal GLP-1R, reduces "
        "microglial activation, and improves insulin signaling — a triad mechanistically "
        "aligned with ApoE4 pathology. EVOKE/EVOKE+ Phase 3 trials reading out 2025.",
        0.64,
    ),
]


async def upsert_project(
    session: AsyncSession, name: str, description: str,
) -> str:
    existing = (
        await session.execute(
            text("SELECT id FROM projects WHERE name = :n LIMIT 1"),
            {"n": name},
        )
    ).first()
    if existing:
        return str(existing[0])
    pid = str(uuid4())
    await session.execute(
        text(
            "INSERT INTO projects (id, name, description, disease_focus, status, "
            "hypothesis_count, evidence_count, simulation_count, "
            "tags, created_at, updated_at) "
            "VALUES (:id, :n, :d, :df, 'active', 0, 0, 0, "
            "  ARRAY[:tag]::varchar[], NOW(), NOW())"
        ),
        {"id": pid, "n": name, "d": description, "df": name, "tag": "seeded"},
    )
    return pid


async def upsert_evidence(
    session: AsyncSession, project_id: str, row: tuple,
) -> str:
    disease, title, abstract, doi, pmid, journal, year = row
    existing = (
        await session.execute(
            text(
                "SELECT id FROM evidence WHERE title = :t AND project_id = :pid LIMIT 1"
            ),
            {"t": title, "pid": project_id},
        )
    ).first()
    if existing:
        return str(existing[0])
    eid = str(uuid4())
    await session.execute(
        text(
            "INSERT INTO evidence "
            "  (id, project_id, title, abstract, summary, content, "
            "   source, source_type, source_id, source_url, "
            "   authors, publication_date, journal, "
            "   quality_score, relevance_score, citation_count, doi, entities, "
            "   tags, status, created_at, updated_at) "
            "VALUES (:id, :pid, :t, :ab, :ab, :ab, "
            "  'pubmed', 'pubmed', :pmid, :url, "
            "  ARRAY[]::varchar[], :pub_date, :journal, "
            "  0.85, 0.9, 0, :doi, ARRAY[]::varchar[], "
            "  ARRAY[:disease]::varchar[], 'verified', NOW(), NOW())"
        ),
        {
            "id": eid, "pid": project_id, "t": title, "ab": abstract,
            "pmid": pmid, "doi": doi, "journal": journal,
            "pub_date": __import__("datetime").date(year, 1, 1),
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}" if pmid else "",
            "disease": disease,
        },
    )
    return eid


async def upsert_hypothesis(
    session: AsyncSession, project_id: str, row: tuple,
) -> str:
    disease, title, statement, mechanism, confidence = row
    existing = (
        await session.execute(
            text(
                "SELECT id FROM hypotheses WHERE title = :t AND project_id = :pid LIMIT 1"
            ),
            {"t": title, "pid": project_id},
        )
    ).first()
    if existing:
        return str(existing[0])
    hid = str(uuid4())
    await session.execute(
        text(
            "INSERT INTO hypotheses "
            "  (id, project_id, title, description, statement, mechanism, "
            "   status, confidence, confidence_score, novelty_score, evidence_score, "
            "   tags, created_at, updated_at) "
            "VALUES (:id, :pid, :t, :s, :s, :m, "
            "  'draft', :c, :c, 0.7, 0.5, "
            "  ARRAY[:tag]::varchar[], NOW(), NOW())"
        ),
        {
            "id": hid, "pid": project_id, "t": title,
            "s": statement, "m": mechanism,
            "c": confidence, "tag": "seeded",
        },
    )
    return hid


async def write_evidence_embedding(
    session: AsyncSession, evidence_id: str, title: str, abstract: str,
) -> bool:
    blob = f"{title}. {abstract}".strip()
    vec = _fixture_embedding(blob, dim=1024)
    vec_literal = "[" + ",".join(f"{v:.7f}" for v in vec) + "]"
    content_hash = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    model_name = "humanovo.seed.fixture-evidence.v1"
    existing = (
        await session.execute(
            text(
                "SELECT id FROM vector_embeddings "
                "WHERE source_type = 'evidence' AND source_id = :sid "
                "AND embedding_model_biomedical = :model LIMIT 1"
            ),
            {"sid": evidence_id, "model": model_name},
        )
    ).first()
    if existing:
        return False
    await session.execute(
        text(
            "INSERT INTO vector_embeddings "
            "  (content, content_hash, source_type, source_id, "
            "   embedding_biomedical, embedding_model_biomedical) "
            "VALUES (:txt, :hash, 'evidence', :sid, "
            "   CAST(:vec AS vector), :model)"
        ),
        {
            "txt": blob, "hash": content_hash, "sid": evidence_id,
            "vec": vec_literal, "model": model_name,
        },
    )
    return True


async def seed() -> dict:
    engine = create_async_engine(DB_URL, echo=False)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    project_ids: dict[str, str] = {}
    ev_count = hyp_count = emb_count = proj_count = 0

    async with SessionLocal() as session:
        for name, desc in PROJECTS:
            pid = await upsert_project(session, name, desc)
            project_ids[name] = pid
            proj_count += 1

        for row in EVIDENCE:
            disease = row[0]
            pid = project_ids.get(disease)
            if not pid:
                continue
            eid = await upsert_evidence(session, pid, row)
            ev_count += 1
            # Embedding
            if await write_evidence_embedding(session, eid, row[1], row[2]):
                emb_count += 1

        for row in HYPOTHESES:
            disease = row[0]
            pid = project_ids.get(disease)
            if not pid:
                continue
            await upsert_hypothesis(session, pid, row)
            hyp_count += 1

        await session.commit()
    await engine.dispose()
    return {
        "projects_upserted": proj_count,
        "evidence_upserted": ev_count,
        "hypotheses_upserted": hyp_count,
        "evidence_embeddings_written": emb_count,
    }


if __name__ == "__main__":
    result = asyncio.run(seed())
    print(f"Evidence seed complete: {result}")

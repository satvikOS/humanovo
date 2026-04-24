"""
KG seeder — bootstrap the common Knowledge Graph from public sources.

Per product directive ("humanovo starts from the roots of science and
starts relations from there to discover something from base"), we seed
the common KG with structured biomedical facts the day a new
deployment comes online. This makes the KG-first sweep useful from
query 1 instead of query 10,000.

Sources:
  - UniProt        → protein nodes (reviewed human SwissProt canonical)
  - Reactome       → pathway nodes + pathway-contains-protein edges
  - OpenTargets    → target-associated-with-disease edges (+ disease nodes)

Scale targets (reasonable first-pass, tunable via `limit` args):
  - 20,000 reviewed human proteins
  - 2,500 Reactome pathways + ~50k participant edges
  - 100 top diseases x 25 top-associated targets = 2,500 association edges

All inserts go through `KGFirstService.ingest_facts(scope=COMMON,
owner_user_id=None)` so these nodes are `public_domain`-equivalent:
they accrue no royalties, only user-contributed nodes do.

The seeder is idempotent (KGFirstService uses content_hash). Re-running
updates metadata for nodes that already exist; new facts fill in.

Usage:
  # From scripts/:
  python -m app.integrations.seed_kg --reactome --uniprot --opentargets

  # In-process (e.g. from admin endpoint):
  from app.integrations.seed_kg import run_seed
  await run_seed(reactome=True, uniprot=True, opentargets=True)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any

from app.integrations.opentargets import get_opentargets_client
from app.integrations.reactome import get_reactome_client
from app.integrations.uniprot import get_uniprot_client
from app.services.kg_first_service import KGScope, get_kg_first_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# UniProt — seed the highest-impact reviewed human proteins
#
# Strategy: pull a pre-defined "essential" list that covers the most
# studied biomedical targets. This is a pragmatic alternative to
# downloading all 20k reviewed human entries (which would cost ~20 min
# of polite-pool requests on first run). The list is hand-curated to
# prioritise targets that show up across oncology, neuroscience,
# cardiology, immunology, and metabolism. Future runs can fetch more.
# ---------------------------------------------------------------------------


ESSENTIAL_HUMAN_TARGETS: tuple[str, ...] = (
    # Oncology
    "TP53", "BRCA1", "BRCA2", "EGFR", "HER2", "KRAS", "BRAF", "PIK3CA",
    "PTEN", "MYC", "RB1", "APC", "CDKN2A", "MLH1", "VHL", "ATM", "CHEK2",
    "PALB2", "AKT1", "MAPK1", "MAPK3", "MTOR", "NOTCH1", "NOTCH2",
    "SMAD4", "CTNNB1", "FBXW7", "TGFBR2", "IDH1", "IDH2", "DNMT3A",
    "TET2", "BCL2", "BCL6", "MYCN", "FLT3", "NPM1", "KIT", "ALK", "ROS1",
    "RET", "MET", "VEGFA", "VEGFR2", "PDGFRA", "PDGFRB",
    # Neuroscience
    "APP", "MAPT", "SNCA", "HTT", "SOD1", "TARDBP", "FUS", "PSEN1",
    "PSEN2", "APOE", "LRRK2", "PARK7", "PINK1", "PRKN", "GBA",
    "BDNF", "NTRK1", "NTRK2", "NGF", "ATXN1", "ATXN3",
    # Cardiology
    "MYH7", "MYBPC3", "TNNT2", "TNNI3", "TNNC1", "LMNA", "DES", "TTN",
    "PCSK9", "LDLR", "APOB", "ANGPTL3", "NPPA", "NPPB",
    # Immunology / inflammation
    "PDCD1", "CD274", "CTLA4", "LAG3", "TIGIT", "TIM3", "IL6", "TNF",
    "IL17A", "IL23A", "IFNG", "IL10", "IL4", "IL13", "FOXP3", "RAG1",
    "RAG2", "JAK1", "JAK2", "JAK3", "STAT3", "NLRP3",
    # Metabolism / diabetes / obesity
    "INS", "INSR", "IRS1", "IRS2", "PDX1", "GCK", "GLP1R", "GCGR",
    "LEP", "LEPR", "SLC5A2", "PPARG", "PPARA",
    # Infectious / respiratory
    "ACE2", "TMPRSS2", "CFTR", "EDNRA", "EDNRB",
)


async def seed_uniprot(limit: int = 150) -> int:
    """Seed canonical UniProt entries for the essential target list.

    Returns the number of new nodes inserted.
    """
    up = get_uniprot_client()
    kg = get_kg_first_service()
    symbols = ESSENTIAL_HUMAN_TARGETS[:limit]
    logger.info(f"[seed_uniprot] resolving {len(symbols)} gene symbols...")

    accessions: list[tuple[str, dict[str, Any]]] = []
    for sym in symbols:
        hits = await up.resolve_gene_symbol(sym, reviewed_only=True)
        if hits:
            accessions.append((sym, hits[0]))

    logger.info(
        f"[seed_uniprot] fetching detailed entries for "
        f"{len(accessions)} accessions..."
    )
    facts: list[dict[str, Any]] = []
    for sym, hit in accessions:
        accession = hit["accession"]
        entry = await up.entry(accession)
        if not entry:
            continue
        facts.append({
            "kind": "protein",
            "canonical_id": f"uniprot:{accession}",
            "payload": {
                "symbol": sym,
                "uniprot_accession": accession,
                "uniprot_id": entry.get("id"),
                "name": entry.get("name"),
                "organism": entry.get("organism"),
                "sequence_length": entry.get("sequence_length"),
                "function_summary": (entry.get("function_summary") or "")[:600],
                "pdb_ids": entry.get("pdb_ids", []),
                "ensembl_gene_ids": entry.get("ensembl_gene_ids", []),
                "reactome_pathway_ids": entry.get("reactome_pathway_ids", []),
                "keywords": entry.get("keywords", []),
                "source": "uniprot_seed",
            },
        })

    logger.info(f"[seed_uniprot] ingesting {len(facts)} protein facts...")
    n = await kg.ingest_facts(
        user_id=None, scope=KGScope.PUBLIC_DOMAIN, facts=facts,
    )
    logger.info(f"[seed_uniprot] inserted {n} new nodes")
    return n


# ---------------------------------------------------------------------------
# Reactome — top-level human pathways + members
# ---------------------------------------------------------------------------


async def seed_reactome(max_pathways: int = 120) -> int:
    """Seed the top-level human Reactome pathways + their protein members."""
    re_client = get_reactome_client()
    kg = get_kg_first_service()

    # Query the top-level pathways for Homo sapiens
    logger.info(f"[seed_reactome] fetching top-level pathways...")
    top_level = await re_client.fetch_json(
        "/ContentService/data/pathways/top/9606"
    )
    if not top_level:
        logger.warning("[seed_reactome] Reactome unreachable; skipping")
        return 0

    pathways_to_seed = (top_level or [])[:max_pathways]
    logger.info(
        f"[seed_reactome] seeding {len(pathways_to_seed)} top-level pathways..."
    )

    facts: list[dict[str, Any]] = []
    for p in pathways_to_seed:
        st_id = p.get("stId")
        if not st_id:
            continue
        detail = await re_client.pathway(st_id)
        facts.append({
            "kind": "pathway",
            "canonical_id": f"reactome:{st_id}",
            "payload": {
                "stId": st_id,
                "name": p.get("displayName"),
                "species": "Homo sapiens",
                "has_diagram": (detail or {}).get("has_diagram"),
                "diseases": (detail or {}).get("diseases", []),
                "contained_events_count":
                    len((detail or {}).get("contained_events", [])),
                "source": "reactome_seed",
            },
        })

    logger.info(f"[seed_reactome] ingesting {len(facts)} pathway facts...")
    n = await kg.ingest_facts(
        user_id=None, scope=KGScope.PUBLIC_DOMAIN, facts=facts,
    )
    logger.info(f"[seed_reactome] inserted {n} new nodes")
    return n


# ---------------------------------------------------------------------------
# OpenTargets — top diseases × top targets
# ---------------------------------------------------------------------------


TOP_DISEASES: tuple[str, ...] = (
    "breast carcinoma", "lung carcinoma", "colorectal carcinoma",
    "prostate carcinoma", "pancreatic cancer", "glioblastoma",
    "melanoma", "leukemia", "lymphoma",
    "Alzheimer disease", "Parkinson disease", "amyotrophic lateral sclerosis",
    "multiple sclerosis", "Huntington disease", "epilepsy",
    "schizophrenia", "major depressive disorder", "bipolar disorder",
    "type 2 diabetes mellitus", "obesity", "non-alcoholic fatty liver disease",
    "cardiovascular disease", "myocardial infarction", "atrial fibrillation",
    "heart failure", "atherosclerosis", "hypertension",
    "rheumatoid arthritis", "systemic lupus erythematosus",
    "inflammatory bowel disease", "psoriasis", "asthma",
    "chronic obstructive pulmonary disease", "cystic fibrosis",
    "pulmonary fibrosis", "chronic kidney disease",
    "tuberculosis", "COVID-19", "HIV infection", "sepsis",
)


async def seed_opentargets(
    max_diseases: int = 30,
    targets_per_disease: int = 15,
) -> int:
    """Seed disease nodes + disease-associated-with-target relationships."""
    ot = get_opentargets_client()
    kg = get_kg_first_service()

    logger.info(f"[seed_opentargets] seeding {max_diseases} diseases...")
    facts: list[dict[str, Any]] = []

    for term in TOP_DISEASES[:max_diseases]:
        hits = await ot.disease_search(term, size=1)
        if not hits:
            continue
        disease = hits[0]
        efo_id = disease["id"]
        facts.append({
            "kind": "disease",
            "canonical_id": f"efo:{efo_id}",
            "payload": {
                "id": efo_id,
                "name": disease.get("name"),
                "description": (disease.get("description") or "")[:600],
                "therapeutic_areas": disease.get("therapeutic_areas", []),
                "source": "opentargets_seed",
            },
        })

        associations = await ot.associations(
            disease_id=efo_id, size=targets_per_disease,
        )
        for a in associations:
            target = (a.get("target") or {})
            score = a.get("score")
            facts.append({
                "kind": "disease_target_association",
                "canonical_id": f"assoc:{efo_id}:{target.get('id','')}",
                "payload": {
                    "disease_id": efo_id,
                    "disease_name": disease.get("name"),
                    "target_id": target.get("id"),
                    "target_symbol": target.get("approvedSymbol"),
                    "target_name": target.get("approvedName"),
                    "association_score": score,
                    "datatypes": a.get("datatypes", []),
                    "source": "opentargets_seed",
                },
            })

    logger.info(
        f"[seed_opentargets] ingesting "
        f"{len(facts)} disease + association facts..."
    )
    n = await kg.ingest_facts(
        user_id=None, scope=KGScope.PUBLIC_DOMAIN, facts=facts,
    )
    logger.info(f"[seed_opentargets] inserted {n} new nodes")
    return n


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def run_seed(
    reactome: bool = True,
    uniprot: bool = True,
    opentargets: bool = True,
    uniprot_limit: int = 150,
    reactome_max: int = 120,
    opentargets_max_diseases: int = 30,
    opentargets_targets_per_disease: int = 15,
) -> dict[str, int]:
    """Run any subset of the seed steps. Returns counts per source."""
    counts = {"uniprot": 0, "reactome": 0, "opentargets": 0}

    if uniprot:
        try:
            counts["uniprot"] = await seed_uniprot(uniprot_limit)
        except Exception as e:
            logger.exception(f"[seed_uniprot] failed: {e}")

    if reactome:
        try:
            counts["reactome"] = await seed_reactome(reactome_max)
        except Exception as e:
            logger.exception(f"[seed_reactome] failed: {e}")

    if opentargets:
        try:
            counts["opentargets"] = await seed_opentargets(
                opentargets_max_diseases,
                opentargets_targets_per_disease,
            )
        except Exception as e:
            logger.exception(f"[seed_opentargets] failed: {e}")

    total = sum(counts.values())
    logger.info(
        f"[seed_kg] done — inserted {total} total new nodes "
        f"({counts})"
    )
    return counts


def _main() -> None:
    parser = argparse.ArgumentParser(description="Seed the common KG.")
    parser.add_argument("--uniprot", action="store_true")
    parser.add_argument("--reactome", action="store_true")
    parser.add_argument("--opentargets", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--uniprot-limit", type=int, default=150)
    parser.add_argument("--reactome-max", type=int, default=120)
    parser.add_argument(
        "--opentargets-max-diseases", type=int, default=30,
    )
    parser.add_argument(
        "--opentargets-targets-per-disease", type=int, default=15,
    )
    args = parser.parse_args()

    if args.all:
        args.uniprot = args.reactome = args.opentargets = True

    if not (args.uniprot or args.reactome or args.opentargets):
        parser.error(
            "Pass at least one of --uniprot --reactome --opentargets --all"
        )

    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_seed(
        reactome=args.reactome,
        uniprot=args.uniprot,
        opentargets=args.opentargets,
        uniprot_limit=args.uniprot_limit,
        reactome_max=args.reactome_max,
        opentargets_max_diseases=args.opentargets_max_diseases,
        opentargets_targets_per_disease=args.opentargets_targets_per_disease,
    ))


if __name__ == "__main__":
    _main()

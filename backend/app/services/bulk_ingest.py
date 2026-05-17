"""Bulk ingestion of real literature into the Evidence corpus + common KG.

This is the Lambda-native driver for populating the global Evidence
section and the common Knowledge Graph from the real 62-source
registry. It is invoked out-of-band via the Lambda handler with
`{"action": "ingest", "topics": [...]}` — the same pattern as the
migration runner — because the regular ingestion endpoints schedule
work as FastAPI BackgroundTasks, which don't survive on Lambda (the
container freezes once the HTTP response is returned).

Per topic it queries the three literature sources (PubMed, Europe PMC,
ClinicalTrials.gov), writes deduplicated `Evidence` rows with no
`project_id` (the shared global corpus), runs a dependency-free regex
entity extractor over each title, and upserts the extracted concepts
plus a per-paper `Publication` node into the common KG
(`knowledge_graph_nodes` / `_edges`, `owner_id` NULL = common).

LLM-free: entity extraction is regex + a curated gene list, so this
runs without Bedrock/Azure credentials. Embeddings are intentionally
left unset here — a later pass wires real Bedrock embeddings.
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import text

from app.core.database import async_session_factory
from app.models.evidence import Evidence, EvidenceSource
from app.services.data_sources import (
    ClinicalTrialsSource,
    EuropePMCSource,
    PubMedSource,
)

logger = logging.getLogger(__name__)

# ─── Regex entity extractor (LLM-free) ────────────────────────────────
# Real gene symbols frequently carry a digit (TP53, IL6, CD8, BRCA1).
# Pure-letter acronyms are too noisy to accept blindly, so a letters-
# only candidate is only kept when it is in this curated set of common
# human genes. Tokens with a digit are accepted on the pattern alone.
_KNOWN_GENES = {
    "TP53", "EGFR", "KRAS", "BRAF", "BRCA", "MYC", "PTEN", "RB", "APC",
    "VHL", "MLH1", "MSH2", "ALK", "ROS", "MET", "RET", "ERBB2", "HER2",
    "PIK3CA", "AKT", "MTOR", "NRAS", "HRAS", "JAK2", "STAT3", "NOTCH1",
    "CTNNB1", "SMAD4", "CDKN2A", "IDH1", "IDH2", "FLT3", "NPM1", "DNMT3A",
    "TET2", "ASXL1", "RUNX1", "GATA3", "FOXP3", "MYD88", "CARD11", "BCL2",
    "BCL6", "CCND1", "CDK4", "CDK6", "ESR1", "AR", "VEGFA", "VEGFR",
    "PDGFRA", "KIT", "ABL1", "BCR", "PML", "RARA", "WT1", "NF1", "NF2",
    "TSC1", "TSC2", "STK11", "KEAP1", "ATM", "ATR", "CHEK2", "PALB2",
    "RAD51", "FANCA", "ERCC1", "POLE", "MSH6", "PMS2", "SMARCB1", "ARID1A",
    "EZH2", "KMT2D", "CREBBP", "EP300", "SETD2", "BAP1", "PBRM1",
    "GNAS", "GNAQ", "GNA11", "SF3B1", "U2AF1", "SRSF2", "CALR", "MPL",
    "CSF3R", "SETBP1", "PHF6", "IKZF1", "PAX5", "CRLF2", "JAK1", "JAK3",
    "IL6", "IL2", "IL10", "TNF", "IFNG", "CD4", "CD8", "CD19", "CD20",
    "CD28", "CTLA4", "PDCD1", "CD274", "LAG3", "TIGIT", "FOXO1", "HIF1A",
    "TGFB1", "WNT", "SHH", "GLI1", "NOTCH2", "DLL3", "JAG1", "APOE",
    "SNCA", "MAPT", "PSEN1", "PSEN2", "APP", "LRRK2", "PARK7", "PINK1",
    "HTT", "SOD1", "TARDBP", "FUS", "C9orf72", "GBA", "ABCA7", "TREM2",
    "INS", "INSR", "LEP", "PPARG", "SLC2A4", "ADIPOQ", "TCF7L2", "HNF1A",
    "CFTR", "DMD", "F8", "F9", "HBB", "HBA1", "G6PD", "PAH", "LDLR",
    "PCSK9", "APOB", "MYH7", "MYBPC3", "TTN", "LMNA", "SCN5A", "KCNQ1",
}

_GENE_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,6})\b")
_DRUG_RE = re.compile(
    r"\b([A-Z][a-z]{2,}(?:ib|mab|nib|parib|ciclib|lisib|afil|prazole|"
    r"statin|mycin|cycline|azole|vir|caine|sartan|pril|olol|profen|"
    r"dipine|tide|cept|zumab|ximab))\b"
)
_DISEASE_PHRASE_RE = re.compile(
    r"\b([A-Z][a-zA-Z]+(?:[ -][a-zA-Z]+){0,3}[ -]"
    r"(?:[Cc]ancer|[Cc]arcinoma|[Tt]umou?r|[Dd]isease|[Ss]yndrome|"
    r"[Dd]isorder|[Ff]ibrosis|[Ss]clerosis|[Ll]eukaemia|[Ll]eukemia|"
    r"[Ll]ymphoma))\b"
)
_DISEASE_SUFFIX_RE = re.compile(
    r"\b([A-Z]?[a-z]{4,}(?:itis|osis|aemia|emia|opathy|pathy))\b"
)
_PATHWAY_RE = re.compile(
    r"\b([A-Za-z][A-Za-z0-9/-]+(?:[ ][A-Za-z0-9/-]+){0,2}[ ]"
    r"(?:[Pp]athway|[Ss]ignal?ling|[Cc]ascade))\b"
)
# Common all-caps tokens that match the gene pattern but are not genes.
_GENE_STOPWORDS = {
    "DNA", "RNA", "PCR", "USA", "UK", "EU", "US", "HIV", "AIDS", "COVID",
    "MRI", "CT", "PET", "ICU", "FDA", "WHO", "NIH", "ATP", "ADP", "GDP",
    "GTP", "NAD", "ROS", "UV", "IV", "II", "III", "IV", "OR", "AND",
}


def extract_entities(text_value: str) -> list[tuple[str, str]]:
    """Extract (name, type) entity tuples from a text string.

    Deterministic and dependency-free. Types: gene / drug / disease /
    pathway. De-duplicates within the call.
    """
    if not text_value:
        return []
    found: dict[str, str] = {}
    for m in _DISEASE_PHRASE_RE.finditer(text_value):
        found.setdefault(m.group(1).strip().title(), "disease")
    for m in _DISEASE_SUFFIX_RE.finditer(text_value):
        name = m.group(1).strip()
        if len(name) >= 6:
            found.setdefault(name.title(), "disease")
    for m in _PATHWAY_RE.finditer(text_value):
        found.setdefault(m.group(1).strip(), "pathway")
    for m in _DRUG_RE.finditer(text_value):
        found.setdefault(m.group(1).strip(), "drug")
    for m in _GENE_RE.finditer(text_value):
        tok = m.group(1)
        if tok in _GENE_STOPWORDS:
            continue
        if tok in _KNOWN_GENES or any(c.isdigit() for c in tok):
            found.setdefault(tok, "gene")
    # Cap per-document entities so one pathological title can't blow up
    # the edge fan-out.
    return list(found.items())[:12]


# ─── Source → Evidence mapping ────────────────────────────────────────

def _parse_pub_date(raw: str) -> datetime | None:
    """Best-effort parse of the varied date strings the sources emit
    (e.g. '2021 Mar 14', '2021', '2021-03')."""
    if not raw:
        return None
    raw = str(raw).strip()
    for fmt in ("%Y %b %d", "%Y %b", "%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(raw[:len(fmt) + 4], fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    m = re.match(r"(\d{4})", raw)
    if m:
        try:
            return datetime(int(m.group(1)), 1, 1, tzinfo=UTC)
        except ValueError:
            return None
    return None


def _records_from_pubmed(res) -> list[dict]:
    out = []
    for r in res.results:
        doi = (r.get("doi") or "").strip()
        out.append({
            "source_type": EvidenceSource.PUBMED,
            "source_id": str(r.get("id") or "").strip() or None,
            "source_url": r.get("url"),
            "title": (r.get("title") or "").strip(),
            "authors": r.get("authors") or [],
            "journal": (r.get("journal") or "").strip() or None,
            "doi": doi or None,
            "publication_date": _parse_pub_date(r.get("pub_date", "")),
        })
    return out


def _records_from_europepmc(res) -> list[dict]:
    out = []
    for r in res.results:
        doi = (r.get("doi") or "").strip()
        authors = r.get("authors")
        author_list = (
            [a.strip() for a in authors.split(",") if a.strip()]
            if isinstance(authors, str) else (authors or [])
        )
        out.append({
            "source_type": EvidenceSource.PUBMED,
            "source_id": (str(r.get("pmid") or r.get("id") or "").strip() or None),
            "source_url": r.get("url"),
            "title": (r.get("title") or "").strip(),
            "authors": author_list,
            "journal": (r.get("journal") or "").strip() or None,
            "doi": doi or None,
            "publication_date": _parse_pub_date(str(r.get("pub_year", ""))),
        })
    return out


def _records_from_clinicaltrials(res) -> list[dict]:
    out = []
    for r in res.results:
        conds = r.get("conditions") or []
        out.append({
            "source_type": EvidenceSource.CLINICAL_TRIAL,
            "source_id": str(r.get("id") or "").strip() or None,
            "source_url": r.get("url"),
            "title": (r.get("title") or "").strip(),
            "authors": [],
            "journal": "ClinicalTrials.gov",
            "doi": None,
            "publication_date": None,
            # conditions feed entity extraction in addition to the title
            "extra_text": " ".join(conds) if conds else "",
        })
    return out


# ─── KG upsert helpers (common graph, owner_id NULL) ──────────────────

async def _node_id_cache(session, names: list[str]) -> dict[str, str]:
    """Preload existing common-KG node ids for a batch of names so the
    per-entity path doesn't issue one SELECT per entity."""
    if not names:
        return {}
    rows = (await session.execute(
        text(
            "SELECT id, name FROM knowledge_graph_nodes "
            "WHERE owner_id IS NULL AND name = ANY(:names)"
        ),
        {"names": list(set(names))},
    )).all()
    return {r[1]: str(r[0]) for r in rows}


async def _upsert_node(session, cache: dict[str, str], name: str,
                       node_type: str, description: str = "") -> str:
    """Insert-or-reuse a common KG node. `cache` is mutated in place."""
    if name in cache:
        return cache[name]
    node_id = str(uuid4())
    await session.execute(
        text(
            "INSERT INTO knowledge_graph_nodes "
            "  (id, name, type, description, properties, owner_id, "
            "   created_at, updated_at) "
            "VALUES (:id, :n, :t, :d, '{}'::jsonb, NULL, now(), now())"
        ),
        {"id": node_id, "n": name[:255], "t": node_type, "d": description[:2000]},
    )
    cache[name] = node_id
    return node_id


async def _insert_edge(session, src_id: str, tgt_id: str, src_name: str,
                       tgt_name: str, rel: str, strength: float,
                       evidence: str) -> None:
    await session.execute(
        text(
            "INSERT INTO knowledge_graph_edges "
            "  (id, source_id, target_id, source_name, target_name, "
            "   relationship, strength, evidence, owner_id, "
            "   created_at, updated_at) "
            "VALUES (:id, :s, :t, :sn, :tn, :r, :str, :ev, NULL, "
            "        now(), now())"
        ),
        {
            "id": str(uuid4()), "s": src_id, "t": tgt_id,
            "sn": src_name[:255], "tn": tgt_name[:255],
            "r": rel, "str": strength, "ev": evidence[:500],
        },
    )


# ─── Main entry point ─────────────────────────────────────────────────

async def run_ingest(topics: list[str], max_per_source: int = 100) -> dict:
    """Ingest real literature for each topic into the global Evidence
    corpus + common KG. Returns aggregate counts.

    Resilient per topic: a failing topic is recorded and skipped, the
    rest of the batch still commits.
    """
    pubmed = PubMedSource()
    europepmc = EuropePMCSource()
    clinicaltrials = ClinicalTrialsSource()

    totals = {
        "topics_done": 0, "topics_failed": 0,
        "evidence_added": 0, "evidence_skipped": 0,
        "kg_nodes_added": 0, "kg_edges_added": 0,
        "errors": [],
    }
    try:
        for topic in topics:
            try:
                added = await _ingest_one_topic(
                    topic, max_per_source, pubmed, europepmc,
                    clinicaltrials, totals,
                )
                totals["topics_done"] += 1
                logger.info("bulk_ingest topic done topic=%s added=%s",
                            topic, added)
            except Exception as e:  # noqa: BLE001 - isolate per topic
                totals["topics_failed"] += 1
                totals["errors"].append(f"{topic}: {type(e).__name__}: {e}")
                logger.exception("bulk_ingest topic failed: %s", topic)
    finally:
        for src in (pubmed, europepmc, clinicaltrials):
            try:
                await src.close()
            except Exception:  # noqa: BLE001
                pass
    totals["errors"] = totals["errors"][:20]
    return {"ok": totals["topics_failed"] < len(topics), **totals}


async def _ingest_one_topic(topic, max_per_source, pubmed, europepmc,
                            clinicaltrials, totals) -> int:
    """Fetch + persist one topic. Each topic commits in its own
    transaction so a later failure can't roll back earlier topics."""
    records: list[dict] = []
    for src, mapper in (
        (pubmed, _records_from_pubmed),
        (europepmc, _records_from_europepmc),
        (clinicaltrials, _records_from_clinicaltrials),
    ):
        try:
            res = await src._safe_search(topic, max_results=max_per_source)
            if res.success:
                records.extend(mapper(res))
        except Exception:  # noqa: BLE001 - one source down != topic down
            logger.exception("source failed for topic=%s", topic)

    records = [r for r in records if r["title"] and r["source_id"]]
    if not records:
        return 0

    added = 0
    async with async_session_factory() as session:
        # Dedup against rows already in the corpus — by source_id AND by
        # doi. `evidence.doi` is UNIQUE, and PubMed + Europe PMC routinely
        # return the same paper, so a same-batch doi collision would fail
        # the whole topic commit if not caught here.
        sids = [r["source_id"] for r in records]
        dois = [r["doi"] for r in records if r["doi"]]
        seen = {row[0] for row in (await session.execute(
            text("SELECT source_id FROM evidence WHERE source_id = ANY(:s)"),
            {"s": sids},
        )).all()}
        seen_dois = {row[0] for row in (await session.execute(
            text("SELECT doi FROM evidence WHERE doi = ANY(:d)"),
            {"d": dois},
        )).all()} if dois else set()

        # Preload KG node ids for every entity name in this batch.
        all_names: list[str] = []
        for r in records:
            ents = extract_entities(
                r["title"] + " " + r.get("extra_text", ""))
            r["_entities"] = ents
            all_names.extend(n for n, _ in ents)
        node_cache = await _node_id_cache(session, all_names)

        for r in records:
            if r["source_id"] in seen or (r["doi"] and r["doi"] in seen_dois):
                totals["evidence_skipped"] += 1
                continue
            seen.add(r["source_id"])
            if r["doi"]:
                seen_dois.add(r["doi"])

            ev = Evidence(
                id=uuid4(),
                project_id=None,  # global shared corpus
                title=r["title"][:500],
                source_type=r["source_type"],
                source_id=r["source_id"],
                source_url=(r["source_url"] or None),
                abstract=None,
                authors=r["authors"][:50] if r["authors"] else [],
                journal=r["journal"],
                doi=r["doi"],
                publication_date=r["publication_date"],
                entities=[f"{t}:{n}" for n, t in r["_entities"]],
                tags=[],
                status="pending",
                ingested_by="bulk_ingest",
            )
            session.add(ev)
            added += 1

            # KG: a Publication node for the paper + concept nodes +
            # "mentions" edges + intra-title co-occurrence edges. The
            # paper is new (evidence dedup above already skipped seen
            # source_ids), so its Publication node is always fresh.
            pub_key = (
                f"PMID:{r['source_id']}"
                if r["source_type"] == EvidenceSource.PUBMED
                else f"TRIAL:{r['source_id']}"
            )
            pub_node = await _upsert_node(
                session, node_cache, pub_key, "publication", r["title"])
            totals["kg_nodes_added"] += 1
            ent_ids = []
            for name, etype in r["_entities"]:
                before = name in node_cache
                nid = await _upsert_node(session, node_cache, name, etype)
                if not before:
                    totals["kg_nodes_added"] += 1
                ent_ids.append((nid, name))
                await _insert_edge(
                    session, pub_node, nid, r["title"][:120], name,
                    "mentions", 0.7, f"title: {r['title'][:200]}")
                totals["kg_edges_added"] += 1
            # co-occurrence edges between concepts in the same title
            for i in range(len(ent_ids)):
                for j in range(i + 1, len(ent_ids)):
                    await _insert_edge(
                        session, ent_ids[i][0], ent_ids[j][0],
                        ent_ids[i][1], ent_ids[j][1], "co_occurs_with",
                        0.4, f"co-mentioned: {r['title'][:180]}")
                    totals["kg_edges_added"] += 1

        await session.commit()
    totals["evidence_added"] += added
    return added

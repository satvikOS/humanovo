"""
Knowledge-Graph seed script.

Populates the knowledge_graph_nodes + knowledge_graph_edges Postgres
tables with a curated biomedical slice so the frontend KG / Workbench
/ HumanAnatomy pages render populated state immediately.

Run:
    cd backend
    DATABASE_URL=postgresql+asyncpg://humanovo:humanovo@localhost:5432/humanovo \
        python -m scripts.seed_kg

The canonical long-term source will be OpenAlex + PubTator3 + HGNC +
UniProt + MeSH via ingestion pipelines (backend/app/ingestion/), but
those require external network access that isn't available in every
CI/sandbox environment. This script stays useful as a deterministic
test fixture even after live ingestion is wired up.

Idempotent: re-running updates existing rows by (name, type).
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
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "neo4jpassword")
# Embedding fixture mode — the real ingestion uses Bedrock Cohere Embed
# v3 (1024d) + Azure text-embedding-3-large (1536d). In the sandbox,
# substitute a deterministic 1024d hash-derived vector so shape + search
# semantics work. Swap SEED_EMBED_MODE=real once credentials + network
# are available.
SEED_EMBED_MODE = os.environ.get("SEED_EMBED_MODE", "fixture")


# ─── Proxy embedding (biologically-sensible clustering, offline) ──
# The real ingestion uses Bedrock Cohere Embed v3 (1024d) + Azure
# text-embedding-3-large (1536d). While that network path is closed
# (no egress in the sandbox), we substitute a deterministic token-
# -frequency pseudo-embedding that actually clusters related text:
#
#   * Text → lowercase token bag (letters only, length ≥ 3).
#   * Each token → hashed to a single dim in [0, dim).
#   * Frequency count → that dim's component.
#   * L2-normalize so cosine == dot product downstream.
#
# This means "Parkinson dopamine neuron" and "Dopaminergic neuron,
# Parkinson's Disease substantia nigra" share tokens (Parkinson,
# dopamin*, neuron) and end up with cosine similarity well above the
# random baseline. Not as good as Cohere Embed — no subword tokenisation,
# no semantic grouping across paraphrase — but good enough for the
# Demo Mode visual. Flip SEED_EMBED_MODE=real + wire Bedrock for prod.

import re as _re

_TOKEN_RE = _re.compile(r"[a-zA-Z][a-zA-Z0-9]*")


def _fixture_embedding(text_value: str, dim: int = 1024) -> list[float]:
    """Token-frequency pseudo-embedding. Deterministic, L2-norm=1.

    Count-min-sketch-style: hash each ≥3-char token with 4 independent
    hashes and accumulate weighted contributions. Reduces collision
    pressure vs the original 2-hash version — at 10K+ entities the
    1024-bin space would saturate under Birthday-paradox collisions.
    Using 4 independent hash lanes spreads the mass and keeps cosine
    discriminative even as vocabulary grows.

    Stopword filter strips common English so "the", "of", "and" don't
    dominate. Real production path: Bedrock Cohere Embed v3 (swap at
    `SEED_EMBED_MODE=real`).
    """
    vec = [0.0] * dim
    tokens = [
        t.lower() for t in _TOKEN_RE.findall(text_value)
        if len(t) >= 3 and t.lower() not in _STOPWORDS
    ]
    if not tokens:
        return vec
    # 4 independent hash lanes via different SHA-256 offsets.
    for tok in tokens:
        raw = hashlib.sha256(tok.encode("utf-8")).hexdigest()
        # Lane 1: bits 0-15 (weight 1.0)
        vec[int(raw[0:8], 16) % dim] += 1.0
        # Lane 2: bits 16-31 (weight 0.7)
        vec[int(raw[8:16], 16) % dim] += 0.7
        # Lane 3: bits 32-47 (weight 0.5)
        vec[int(raw[16:24], 16) % dim] += 0.5
        # Lane 4: bits 48-63 (weight 0.3)
        vec[int(raw[24:32], 16) % dim] += 0.3
    norm = sum(v * v for v in vec) ** 0.5
    return [v / norm for v in vec] if norm > 0 else vec


# Minimal English stopword set — enough to prevent "of/the/and" from
# dominating cosine similarity. Real tokenisers use ~300 stopwords;
# this list is the 30 most common monosyllables that would otherwise
# be the top-frequency tokens.
_STOPWORDS = frozenset({
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
    "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy",
    "its", "let", "put", "say", "she", "too", "use", "with", "from", "this",
    "that", "these", "those", "have", "been", "were", "they", "them", "than",
    "into", "also", "may", "via", "due", "such", "both", "each", "used", "use",
    "within", "across", "during", "after", "before", "while", "where", "which",
    "when",
})


# ─── Curated biomedical slice ──────────────────────────────────────
# ~120 entities across canonical categories + ~180 relations.
# Chosen to mirror what Workbench's Sapien Corridor tree used to show
# (organ systems → tissues → cell types → biomolecules → pathways) so
# the page renders a recognisable shape.

GENES = [
    ("TP53",   "Tumor protein p53 — master tumor suppressor",        "cancer, DNA damage response"),
    ("BRCA1",  "Breast cancer type 1 susceptibility protein",         "breast cancer, DNA repair"),
    ("BRCA2",  "Breast cancer type 2 susceptibility protein",         "breast/ovarian cancer"),
    ("APOE",   "Apolipoprotein E — Alzheimer's risk factor",          "neurodegeneration"),
    ("EGFR",   "Epidermal growth factor receptor",                    "NSCLC, glioblastoma"),
    ("KRAS",   "KRAS GTPase — oncogene across GI + lung cancers",     "PDAC, CRC, NSCLC"),
    ("PIK3CA", "PI3K catalytic subunit alpha",                        "breast cancer, PIK3CA-related overgrowth"),
    ("PTEN",   "Phosphatase and tensin homolog",                      "Cowden syndrome"),
    ("MYC",    "MYC proto-oncogene",                                  "Burkitt lymphoma"),
    ("RB1",    "Retinoblastoma gene",                                 "retinoblastoma, osteosarcoma"),
    ("SNCA",   "Alpha-synuclein — Parkinson's",                        "Parkinson's disease"),
    ("MAPT",   "Microtubule-associated protein tau",                  "Alzheimer's, FTD"),
    ("HTT",    "Huntingtin",                                          "Huntington's disease"),
    ("CFTR",   "Cystic fibrosis transmembrane conductance regulator", "cystic fibrosis"),
    ("DMD",    "Dystrophin",                                          "Duchenne muscular dystrophy"),
    ("HBB",    "Hemoglobin subunit beta",                             "sickle cell, beta thalassemia"),
    ("F8",     "Coagulation factor VIII",                             "hemophilia A"),
    ("LDLR",   "LDL receptor",                                        "familial hypercholesterolemia"),
    ("INS",    "Insulin",                                             "type 1 diabetes"),
    ("GBA",    "Glucocerebrosidase",                                  "Gaucher's, Parkinson's"),
]

PROTEINS = [
    ("p53",              "Tumor suppressor transcription factor"),
    ("Alpha-synuclein",  "Presynaptic protein aggregating in Lewy bodies"),
    ("Amyloid-beta",     "Aβ peptide forming senile plaques in Alzheimer's"),
    ("Tau",              "Microtubule-associated protein; neurofibrillary tangles"),
    ("Insulin",          "Pancreatic peptide hormone, glucose homeostasis"),
    ("Dopamine receptor D2", "G-protein-coupled receptor, PD + schizophrenia target"),
    ("GLP-1 receptor",   "Target of semaglutide/liraglutide"),
    ("ACE2",             "SARS-CoV-2 entry receptor, renin-angiotensin regulator"),
    ("TNF-alpha",        "Pro-inflammatory cytokine, rheumatoid arthritis target"),
    ("IL-6",             "Interleukin-6, cytokine storm driver"),
    ("PD-L1",            "Immune checkpoint, cancer immunotherapy target"),
    ("HER2",             "ERBB2 tyrosine kinase receptor, breast cancer"),
    ("JAK1",             "Janus kinase 1, baricitinib target"),
    ("JAK2",             "Janus kinase 2, myeloproliferative disorders"),
    ("Hemoglobin",       "Oxygen transport tetramer"),
    ("Dystrophin",       "Sarcolemmal structural protein"),
    ("CFTR channel",     "Chloride channel in epithelia"),
    ("Cytochrome c",     "Mitochondrial electron carrier, apoptosis trigger"),
    ("Caspase-3",        "Executioner caspase of apoptosis"),
    ("mTOR",             "Serine/threonine kinase, cell growth regulator"),
]

DISEASES = [
    ("Parkinson's Disease",   "Neurodegeneration of dopaminergic neurons in substantia nigra"),
    ("Alzheimer's Disease",   "Neurodegeneration with amyloid + tau pathology"),
    ("Breast Cancer",         "Malignancy arising from breast ductal/lobular epithelium"),
    ("Pancreatic Ductal Adenocarcinoma", "KRAS-driven pancreatic malignancy"),
    ("Type 2 Diabetes",       "Insulin resistance + β-cell dysfunction"),
    ("Type 1 Diabetes",       "Autoimmune β-cell destruction"),
    ("Huntington's Disease",  "CAG-repeat expansion in HTT causing neurodegeneration"),
    ("Cystic Fibrosis",       "CFTR mutation causing viscous mucus in airways + GI"),
    ("COVID-19",              "SARS-CoV-2 infection, entry via ACE2"),
    ("Rheumatoid Arthritis",  "Chronic autoimmune inflammatory arthropathy"),
    ("Hemophilia A",          "X-linked F8 deficiency, coagulopathy"),
    ("Sickle Cell Disease",   "HBB Glu6Val substitution causing RBC sickling"),
    ("Idiopathic Pulmonary Fibrosis", "Progressive scarring of lung parenchyma"),
    ("Amyotrophic Lateral Sclerosis", "Motor neuron degeneration"),
    ("Multiple Sclerosis",    "Autoimmune demyelination of CNS"),
]

PATHWAYS = [
    ("PI3K/AKT/mTOR signaling",    "Growth + survival signaling, oncology target"),
    ("MAPK/ERK cascade",           "Proliferation signaling, RAS-driven cancers"),
    ("Wnt/β-catenin",              "Development + stem cell maintenance"),
    ("TGF-β signaling",            "Fibrosis + cancer metastasis"),
    ("JAK-STAT",                   "Cytokine signaling, immune regulation"),
    ("NF-κB",                      "Inflammation + innate immunity master switch"),
    ("Apoptosis (intrinsic)",      "Mitochondrial cytochrome c → caspase cascade"),
    ("Autophagy",                  "Lysosomal degradation of cellular components"),
    ("Gut-brain axis",             "Vagal + humoral signalling, Parkinson's mechanism"),
    ("RAS/RAF/MEK",                "Oncogenic driver of NSCLC, melanoma, CRC"),
]

DRUGS = [
    ("Semaglutide",   "GLP-1R agonist; T2D + obesity + early Alzheimer's (EVOKE)"),
    ("Baricitinib",   "JAK1/2 inhibitor; RA, COVID-19 (FDA EUA)"),
    ("Trastuzumab",   "Anti-HER2 mAb; HER2+ breast cancer"),
    ("Pembrolizumab", "Anti-PD-1 mAb; broad oncology"),
    ("Levodopa",      "Dopamine precursor; Parkinson's disease"),
    ("Metformin",     "Biguanide; T2D first-line"),
    ("Imatinib",      "BCR-ABL inhibitor; CML"),
    ("Statins",       "HMG-CoA reductase inhibitors; hypercholesterolemia"),
    ("Insulin analogs", "Rapid/long-acting; diabetes mellitus"),
    ("Alpha-synuclein antibodies", "Passive immunotherapy (Phase 2) for PD"),
]

ORGAN_SYSTEMS = [
    ("Nervous System",    "Central + peripheral neurons + glia"),
    ("Cardiovascular System", "Heart + vasculature"),
    ("Immune System",     "Leukocytes, lymphoid organs, cytokines"),
    ("Endocrine System",  "Hormone-secreting glands"),
    ("Respiratory System", "Gas exchange, lung, airways"),
    ("Digestive System",  "GI tract + accessory organs"),
    ("Musculoskeletal System", "Bones, muscles, connective tissue"),
    ("Renal System",      "Kidneys + urinary tract"),
]

CELL_TYPES = [
    ("Dopaminergic neuron",    "Substantia nigra, PD target cell"),
    ("CD8+ T cell",            "Cytotoxic T lymphocyte, tumor immunity"),
    ("Pancreatic β-cell",      "Insulin-producing islet cell"),
    ("Cardiomyocyte",          "Striated contractile heart muscle cell"),
    ("Microglia",              "CNS resident macrophage"),
    ("Hepatocyte",             "Parenchymal liver cell"),
    ("Alveolar epithelial cell", "Type I + II pneumocytes"),
    ("Hematopoietic stem cell", "Bone marrow, all blood lineages"),
]


# Relationships: (source_name, relation, target_name, strength, evidence)
RELATIONS: list[tuple[str, str, str, float, str]] = [
    # Gene → protein (encodes)
    ("TP53",   "encodes",  "p53",              1.0, "HGNC:11998"),
    ("SNCA",   "encodes",  "Alpha-synuclein",  1.0, "HGNC:11138"),
    ("MAPT",   "encodes",  "Tau",              1.0, "HGNC:6893"),
    ("INS",    "encodes",  "Insulin",          1.0, "HGNC:6081"),
    ("DMD",    "encodes",  "Dystrophin",       1.0, "HGNC:2928"),
    ("HBB",    "encodes",  "Hemoglobin",       0.9, "HGNC:4827"),
    ("F8",     "encodes",  "Coagulation factor VIII", 1.0, "HGNC:3546"),
    ("CFTR",   "encodes",  "CFTR channel",     1.0, "HGNC:1884"),
    # Gene → disease (associated_with)
    ("TP53",   "associated_with", "Breast Cancer",                0.9, "OMIM:191170"),
    ("BRCA1",  "associated_with", "Breast Cancer",                1.0, "OMIM:113705"),
    ("BRCA2",  "associated_with", "Breast Cancer",                0.95, "OMIM:600185"),
    ("APOE",   "associated_with", "Alzheimer's Disease",          0.9, "OMIM:107741"),
    ("SNCA",   "associated_with", "Parkinson's Disease",          1.0, "OMIM:163890"),
    ("MAPT",   "associated_with", "Alzheimer's Disease",          0.8, "OMIM:157140"),
    ("HTT",    "associated_with", "Huntington's Disease",         1.0, "OMIM:143100"),
    ("CFTR",   "associated_with", "Cystic Fibrosis",              1.0, "OMIM:219700"),
    ("DMD",    "associated_with", "Amyotrophic Lateral Sclerosis", 0.3, "partial overlap"),
    ("HBB",    "associated_with", "Sickle Cell Disease",          1.0, "OMIM:603903"),
    ("F8",     "associated_with", "Hemophilia A",                 1.0, "OMIM:306700"),
    ("LDLR",   "associated_with", "Breast Cancer",                0.4, "cholesterol + cancer"),
    ("KRAS",   "associated_with", "Pancreatic Ductal Adenocarcinoma", 1.0, "90%+ PDACs"),
    ("EGFR",   "associated_with", "Breast Cancer",                0.5, "TNBC subset"),
    ("GBA",    "associated_with", "Parkinson's Disease",          0.85, "5-10% of PD cases"),
    # Drug → target (inhibits / activates)
    ("Semaglutide",   "activates", "GLP-1 receptor",     1.0, "FDA label"),
    ("Baricitinib",   "inhibits",  "JAK1",               1.0, "FDA label"),
    ("Baricitinib",   "inhibits",  "JAK2",               1.0, "FDA label"),
    ("Trastuzumab",   "binds",     "HER2",               1.0, "FDA label"),
    ("Pembrolizumab", "binds",     "PD-L1",              0.95, "inhibits PD-1/PD-L1 axis"),
    ("Levodopa",      "precursor", "Dopamine receptor D2", 0.9, "converted to dopamine"),
    ("Imatinib",      "inhibits",  "BCR-ABL",            1.0, "FDA label"),  # BCR-ABL not in node list — will be skipped
    ("Alpha-synuclein antibodies", "binds", "Alpha-synuclein", 0.8, "Prasinezumab Phase 2"),
    # Pathway → disease
    ("PI3K/AKT/mTOR signaling", "drives",     "Breast Cancer", 0.85, "Vogelstein"),
    ("MAPK/ERK cascade",        "drives",     "Pancreatic Ductal Adenocarcinoma", 0.9, "KRAS downstream"),
    ("JAK-STAT",                "drives",     "Rheumatoid Arthritis", 0.8, "cytokine signaling"),
    ("NF-κB",                   "drives",     "Rheumatoid Arthritis", 0.85, "TNF signaling"),
    ("Gut-brain axis",          "drives",     "Parkinson's Disease", 0.7, "Braak hypothesis"),
    ("TGF-β signaling",         "drives",     "Idiopathic Pulmonary Fibrosis", 0.9, "fibrogenesis"),
    ("Apoptosis (intrinsic)",   "protects_against", "Breast Cancer", 0.7, "p53 axis"),
    # Organ system → cell type
    ("Nervous System",          "contains", "Dopaminergic neuron", 1.0, "substantia nigra"),
    ("Nervous System",          "contains", "Microglia",           1.0, "CNS macrophages"),
    ("Cardiovascular System",   "contains", "Cardiomyocyte",       1.0, "myocardium"),
    ("Digestive System",        "contains", "Hepatocyte",          1.0, "liver parenchyma"),
    ("Endocrine System",        "contains", "Pancreatic β-cell",   1.0, "pancreatic islets"),
    ("Respiratory System",      "contains", "Alveolar epithelial cell", 1.0, "alveoli"),
    ("Immune System",           "contains", "CD8+ T cell",         1.0, "adaptive immunity"),
    ("Musculoskeletal System",  "contains", "Hematopoietic stem cell", 0.7, "bone marrow"),
    # Cell type → disease
    ("Dopaminergic neuron",    "affected_in", "Parkinson's Disease",  1.0, "primary site"),
    ("Microglia",              "affected_in", "Alzheimer's Disease",  0.85, "neuroinflammation"),
    ("Pancreatic β-cell",      "affected_in", "Type 1 Diabetes",      1.0, "autoimmune destruction"),
    ("Pancreatic β-cell",      "affected_in", "Type 2 Diabetes",      0.8, "β-cell exhaustion"),
    ("Alveolar epithelial cell", "affected_in", "Idiopathic Pulmonary Fibrosis", 0.9, "AEC2 dysfunction"),
    ("Alveolar epithelial cell", "affected_in", "COVID-19",           1.0, "ACE2-mediated entry"),
]


# ─── Seeding logic ────────────────────────────────────────────────

async def upsert_node(
    session: AsyncSession, name: str, node_type: str, description: str = "",
) -> str:
    """Insert-or-update a knowledge_graph_node. Returns the id."""
    existing = (
        await session.execute(
            text(
                "SELECT id FROM knowledge_graph_nodes "
                "WHERE name = :n AND (type = :t OR type IS NULL) LIMIT 1"
            ),
            {"n": name, "t": node_type},
        )
    ).first()
    if existing:
        return str(existing[0])
    node_id = str(uuid4())
    await session.execute(
        text(
            "INSERT INTO knowledge_graph_nodes "
            "  (id, name, type, description, properties, created_at, updated_at) "
            "VALUES (:id, :n, :t, :d, '{}'::jsonb, now(), now())"
        ),
        {"id": node_id, "n": name, "t": node_type, "d": description},
    )
    return node_id


async def upsert_edge(
    session: AsyncSession,
    source_id: str,
    target_id: str,
    relationship: str,
    strength: float,
    evidence: str,
) -> None:
    """Insert-or-update a knowledge_graph_edge."""
    existing = (
        await session.execute(
            text(
                "SELECT id FROM knowledge_graph_edges "
                "WHERE source_id = :s AND target_id = :t AND relationship = :r LIMIT 1"
            ),
            {"s": source_id, "t": target_id, "r": relationship},
        )
    ).first()
    if existing:
        return
    await session.execute(
        text(
            "INSERT INTO knowledge_graph_edges "
            "  (id, source_id, target_id, source_name, target_name, relationship, "
            "   strength, evidence, created_at, updated_at) "
            "VALUES (:id, :s, :t, :sn, :tn, :r, :str, :ev, now(), now())"
        ),
        {
            "id": str(uuid4()),
            "s": source_id, "t": target_id,
            "sn": None, "tn": None,
            "r": relationship, "str": strength, "ev": evidence,
        },
    )


async def _write_embeddings(
    session: AsyncSession, items: list[tuple[str, str, str]],
) -> int:
    """Embed + upsert every (entity_id, name, description) into
    vector_embeddings. Returns count written."""
    if not items:
        return 0
    # Target the real vector_embeddings table shape (from migration 003).
    written = 0
    for entity_id, name, description in items:
        blob = f"{name}. {description}".strip()
        vec = _fixture_embedding(blob, dim=1024)
        vec_literal = "[" + ",".join(f"{v:.7f}" for v in vec) + "]"
        content_hash = hashlib.sha256(blob.encode("utf-8")).hexdigest()
        model_name = f"humanovo.seed.fixture-{SEED_EMBED_MODE}.v1"
        # Skip if an embedding with the same (source_type, source_id,
        # embedding_model_biomedical) already exists — idempotent.
        existing = (
            await session.execute(
                text(
                    "SELECT id FROM vector_embeddings "
                    "WHERE source_type = 'kg_entity' AND source_id = :sid "
                    "AND embedding_model_biomedical = :model LIMIT 1"
                ),
                {"sid": str(entity_id), "model": model_name},
            )
        ).first()
        if existing:
            await session.execute(
                text(
                    "UPDATE vector_embeddings "
                    "SET content = :txt, content_hash = :hash, "
                    "embedding_biomedical = CAST(:vec AS vector), "
                    "updated_at = NOW() "
                    "WHERE id = :id"
                ),
                {"txt": blob, "hash": content_hash, "vec": vec_literal, "id": existing[0]},
            )
        else:
            await session.execute(
                text(
                    "INSERT INTO vector_embeddings "
                    "  (content, content_hash, source_type, source_id, "
                    "   embedding_biomedical, embedding_model_biomedical) "
                    "VALUES (:txt, :hash, 'kg_entity', :sid, "
                    "   CAST(:vec AS vector), :model)"
                ),
                {
                    "txt": blob, "hash": content_hash,
                    "sid": str(entity_id), "vec": vec_literal, "model": model_name,
                },
            )
        written += 1
    return written


async def _write_neo4j(
    name_to_id: dict[str, str],
    node_types: dict[str, str],
    relations: list[tuple[str, str, str, float, str]],
) -> tuple[int, int]:
    """Mirror the seeded KG into Neo4j (if reachable)."""
    try:
        from neo4j import AsyncGraphDatabase  # type: ignore
    except ImportError:
        return (0, 0)
    try:
        driver = AsyncGraphDatabase.driver(
            NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD)
        )
        async with driver.session() as sess:
            await sess.run("RETURN 1")  # probe
    except Exception:
        # Swallow — Neo4j absence isn't fatal for the Postgres-side seed.
        return (0, 0)

    nodes_written = 0
    edges_written = 0
    async with driver.session() as sess:
        # MERGE each entity by id so re-running the seed is idempotent.
        for name, entity_id in name_to_id.items():
            await sess.run(
                "MERGE (e:Entity {id: $id}) "
                "SET e.name = $name, e.type = $type, e.updated = timestamp()",
                id=entity_id, name=name, type=node_types.get(name, "unknown"),
            )
            nodes_written += 1
        for src, rel, tgt, strength, evidence in relations:
            if src not in name_to_id or tgt not in name_to_id:
                continue
            # Cypher doesn't allow parameterised relationship types;
            # sanitise rel → safe label.
            rel_label = rel.upper().replace("-", "_").replace(" ", "_")
            await sess.run(
                "MATCH (a:Entity {id: $src}), (b:Entity {id: $tgt}) "
                f"MERGE (a)-[r:{rel_label}]->(b) "
                "SET r.strength = $strength, r.evidence = $evidence",
                src=name_to_id[src], tgt=name_to_id[tgt],
                strength=strength, evidence=evidence,
            )
            edges_written += 1
    await driver.close()
    return (nodes_written, edges_written)


async def seed() -> dict[str, int]:
    engine = create_async_engine(DB_URL, echo=False)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    name_to_id: dict[str, str] = {}
    name_to_type: dict[str, str] = {}

    async with SessionLocal() as session:
        # 1. Insert every node kind.
        groups = {
            "gene":           [(n, desc, cond) for n, desc, cond in GENES],
            "protein":        [(n, desc, "") for n, desc in PROTEINS],
            "disease":        [(n, desc, "") for n, desc in DISEASES],
            "pathway":        [(n, desc, "") for n, desc in PATHWAYS],
            "drug":           [(n, desc, "") for n, desc in DRUGS],
            "organ_system":   [(n, desc, "") for n, desc in ORGAN_SYSTEMS],
            "cell_type":      [(n, desc, "") for n, desc in CELL_TYPES],
        }
        embed_items: list[tuple[str, str, str]] = []
        for node_type, rows in groups.items():
            for name, desc, _cond in rows:
                nid = await upsert_node(session, name, node_type, desc)
                name_to_id[name] = nid
                name_to_type[name] = node_type
                embed_items.append((nid, name, desc))

        # 2. Insert relations.
        edges_added = 0
        for src, rel, tgt, strength, evidence in RELATIONS:
            if src not in name_to_id or tgt not in name_to_id:
                continue
            await upsert_edge(
                session,
                source_id=name_to_id[src],
                target_id=name_to_id[tgt],
                relationship=rel,
                strength=strength,
                evidence=evidence,
            )
            edges_added += 1

        # 3. Write pgvector embeddings (enables RAG retrieval over the KG).
        embeddings_written = await _write_embeddings(session, embed_items)

        await session.commit()

    await engine.dispose()

    # 4. Mirror into Neo4j for multi-hop path queries (best-effort).
    neo4j_nodes, neo4j_edges = await _write_neo4j(
        name_to_id, name_to_type, RELATIONS,
    )

    return {
        "neo4j_nodes_mirrored": neo4j_nodes,
        "neo4j_edges_mirrored": neo4j_edges,
        "embeddings_written": embeddings_written,
        "nodes_upserted": len(name_to_id),
        "edges_upserted": edges_added,
    }


if __name__ == "__main__":
    result = asyncio.run(seed())
    print(f"Seed complete: {result}")

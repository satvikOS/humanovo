"""
Admin endpoints — dev-environment only.

Exposes the `seed_kg` script as a POST /admin/seed-kg call so the
frontend can surface a "Populate demo KG" button. Refuses to run
in production (ENVIRONMENT=production) or when a seed has already
completed unless `force=true` is passed.

These endpoints are NOT part of the public surface; they exist to
make the dev loop + sandbox demos self-service from the UI.
"""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.platform_entities import KnowledgeGraphNode, KnowledgeGraphEdge

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def admin_health(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Detailed service-liveness for the Settings → Admin panel.

    Surfaces what `/health` does plus the last-seed timestamps +
    pg/redis/neo4j connectivity + row counts grouped by domain.
    Read-only; safe to poll from the UI on open.
    """
    checks: dict[str, str] = {}
    counts: dict[str, int | None] = {}
    last_seen: dict[str, str | None] = {}

    # Postgres — lightweight SELECT on the active pool.
    try:
        await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {str(e)[:80]}"

    # pgvector extension
    try:
        r = await db.execute(
            text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
        )
        checks["pgvector"] = "ok" if r.scalar() else "missing"
    except Exception as e:
        checks["pgvector"] = f"error: {str(e)[:80]}"

    # Redis
    try:
        import redis.asyncio as _redis  # type: ignore
        r = _redis.from_url(settings.REDIS_URL)
        pong = await r.ping()
        checks["redis"] = "ok" if pong else "no-pong"
        await r.close()
    except Exception as e:
        checks["redis"] = f"error: {str(e)[:80]}"

    # Neo4j (same fallback-aware check we log at init)
    try:
        from app.knowledge.graph_store import get_graph_store
        gs = get_graph_store()
        if gs is not None and getattr(gs, "_driver", None):
            checks["neo4j"] = "connected"
        else:
            checks["neo4j"] = "not_configured"
    except Exception as e:
        checks["neo4j"] = f"error: {str(e)[:80]}"

    # Domain counts + last-seen — same source-of-truth as kg-stats.
    for label, sql in [
        ("projects", "SELECT COUNT(*), MAX(updated_at) FROM projects"),
        ("evidence", "SELECT COUNT(*), MAX(updated_at) FROM evidence"),
        ("hypotheses", "SELECT COUNT(*), MAX(updated_at) FROM hypotheses"),
        ("notebook_pages", "SELECT COUNT(*), MAX(updated_at) FROM notebook_pages"),
        ("activities", "SELECT COUNT(*), MAX(created_at) FROM activities"),
        ("discovery_runs", "SELECT COUNT(*), MAX(updated_at) FROM discovery_runs"),
        ("imaging_studies", "SELECT COUNT(*), MAX(updated_at) FROM imaging_studies"),
        ("kg_nodes", "SELECT COUNT(*), MAX(updated_at) FROM knowledge_graph_nodes"),
        ("kg_edges", "SELECT COUNT(*), MAX(updated_at) FROM knowledge_graph_edges"),
        ("vector_embeddings",
         "SELECT COUNT(*), MAX(created_at) FROM vector_embeddings"),
    ]:
        try:
            row = (await db.execute(text(sql))).first()
            counts[label] = int(row[0] or 0) if row else 0
            last_seen[label] = row[1].isoformat() if row and row[1] else None
        except Exception as e:
            counts[label] = None
            last_seen[label] = f"error: {str(e)[:80]}"

    # Embedding split + seed-state flags — lets the Admin panel drop the
    # parallel /admin/kg-stats fetch and derive everything from one call.
    embeddings: dict[str, int | None] = {}
    for label, sql in [
        ("kg_entity",
         "SELECT COUNT(*) FROM vector_embeddings WHERE source_type = 'kg_entity'"),
        ("evidence",
         "SELECT COUNT(*) FROM vector_embeddings WHERE source_type = 'evidence'"),
    ]:
        try:
            r = (await db.execute(text(sql))).scalar()
            embeddings[label] = int(r or 0)
        except Exception:
            embeddings[label] = None

    flags = {
        # Consistent with /admin/kg-stats so the two endpoints can't
        # disagree on whether the seed CTA should be offered.
        "seed_available": (counts.get("kg_nodes") or 0) < 200,
        "corpus_seeded": (
            (counts.get("evidence") or 0) >= 10
            and (counts.get("hypotheses") or 0) >= 2
        ),
    }

    overall = (
        "healthy"
        if checks.get("postgres") == "ok" and checks.get("pgvector") == "ok"
        else "degraded"
    )

    return {
        "status": overall,
        "environment": settings.ENVIRONMENT,
        "version": settings.VERSION,
        "checks": checks,
        "counts": counts,
        "last_seen": last_seen,
        "embeddings": embeddings,
        "flags": flags,
    }





class SeedResponse(BaseModel):
    ok: bool
    environment: str
    nodes_before: int
    nodes_after: int
    edges_before: int
    edges_after: int
    embeddings_written: int
    neo4j_nodes: int
    neo4j_edges: int
    message: str


@router.get("/kg-stats")
async def get_kg_stats(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Live KG + corpus stats — used by the frontend admin panel + the
    Dashboard differentiator strip to decide whether to offer the
    'Seed demo' CTA and to show live counts without per-page joins."""
    node_count = (await db.execute(select(func.count(KnowledgeGraphNode.id)))).scalar() or 0
    edge_count = (await db.execute(select(func.count(KnowledgeGraphEdge.id)))).scalar() or 0
    emb_kg = (
        await db.execute(
            text("SELECT COUNT(*) FROM vector_embeddings WHERE source_type = 'kg_entity'")
        )
    ).scalar() or 0
    emb_ev = (
        await db.execute(
            text("SELECT COUNT(*) FROM vector_embeddings WHERE source_type = 'evidence'")
        )
    ).scalar() or 0
    # Also include the downstream corpus counts so the Dashboard knows
    # whether to offer the full-seed CTA.
    ev_count = (
        await db.execute(text("SELECT COUNT(*) FROM evidence"))
    ).scalar() or 0
    hyp_count = (
        await db.execute(text("SELECT COUNT(*) FROM hypotheses"))
    ).scalar() or 0
    project_count = (
        await db.execute(text("SELECT COUNT(*) FROM projects"))
    ).scalar() or 0
    return {
        "environment": settings.ENVIRONMENT,
        "node_count": node_count,
        "edge_count": edge_count,
        "embedding_count": emb_kg,
        "evidence_count": ev_count,
        "evidence_embedding_count": emb_ev,
        "hypothesis_count": hyp_count,
        "project_count": project_count,
        "seed_available": node_count < 200,
        "corpus_seeded": ev_count >= 10 and hyp_count >= 2,
    }


@router.post("/seed-corpus", response_model=dict)
async def seed_evidence_corpus(
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Run the evidence/hypothesis seed — fills the Evidence page +
    Hypothesis list with KG-linked demo data. Idempotent."""
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=403,
            detail="Seed refuses to run in production. Use the ingestion pipeline.",
        )
    before_ev = (await db.execute(text("SELECT COUNT(*) FROM evidence"))).scalar() or 0
    if before_ev >= 10 and not force:
        return {
            "ok": True,
            "message": f"Evidence corpus already has {before_ev} rows; pass ?force=true to reseed.",
            "evidence_count": before_ev,
        }
    from scripts.seed_evidence import seed as seed_corpus
    result = await seed_corpus()
    after_ev = (await db.execute(text("SELECT COUNT(*) FROM evidence"))).scalar() or 0
    return {
        "ok": True,
        "environment": settings.ENVIRONMENT,
        **result,
        "evidence_count_after": after_ev,
        "message": f"Seeded {result.get('evidence_upserted', 0)} evidence + "
                   f"{result.get('hypotheses_upserted', 0)} hypotheses + "
                   f"{result.get('projects_upserted', 0)} projects.",
    }


@router.post("/seed-kg", response_model=SeedResponse)
async def seed_knowledge_graph(
    force: bool = Query(False, description="Re-run seed even if KG already populated"),
    db: AsyncSession = Depends(get_db),
) -> SeedResponse:
    """Populate the KG with a curated biomedical slice.

    Idempotent: re-runs upsert by (name, type). If the KG already has
    at least 50 nodes and `force=false`, returns early without work.
    Gated to non-production environments.
    """
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=403,
            detail="Seed refuses to run in production. Use an ingestion pipeline instead.",
        )

    before_nodes = (await db.execute(select(func.count(KnowledgeGraphNode.id)))).scalar() or 0
    before_edges = (await db.execute(select(func.count(KnowledgeGraphEdge.id)))).scalar() or 0

    if before_nodes >= 50 and not force:
        return SeedResponse(
            ok=True,
            environment=settings.ENVIRONMENT,
            nodes_before=before_nodes,
            nodes_after=before_nodes,
            edges_before=before_edges,
            edges_after=before_edges,
            embeddings_written=0,
            neo4j_nodes=0,
            neo4j_edges=0,
            message=(
                f"KG already has {before_nodes} nodes; skipping seed. "
                "Pass ?force=true to reseed."
            ),
        )

    # Run the seed script's seed() in-process.
    from scripts.seed_kg import seed

    result = await seed()

    after_nodes = (await db.execute(select(func.count(KnowledgeGraphNode.id)))).scalar() or 0
    after_edges = (await db.execute(select(func.count(KnowledgeGraphEdge.id)))).scalar() or 0

    return SeedResponse(
        ok=True,
        environment=settings.ENVIRONMENT,
        nodes_before=before_nodes,
        nodes_after=after_nodes,
        edges_before=before_edges,
        edges_after=after_edges,
        embeddings_written=result.get("embeddings_written", 0),
        neo4j_nodes=result.get("neo4j_nodes_mirrored", 0),
        neo4j_edges=result.get("neo4j_edges_mirrored", 0),
        message=(
            f"Seeded: {after_nodes - before_nodes} new nodes, "
            f"{after_edges - before_edges} new edges, "
            f"{result.get('embeddings_written', 0)} embeddings, "
            f"Neo4j {result.get('neo4j_nodes_mirrored', 0)} nodes / "
            f"{result.get('neo4j_edges_mirrored', 0)} edges."
        ),
    )


# ═══════════════════════════════════════════════════════════════════════
# Common KG seeder (new) — from the 9 no-auth biomedical integrations.
#
# This seeds kg_nodes (scope=public_domain) rather than the legacy
# knowledge_graph_nodes table. The KG-first sweep in the discovery
# orchestrator queries kg_nodes first; seeding kg_nodes is what lifts
# the hit rate on day one.
# ═══════════════════════════════════════════════════════════════════════


class SeedCommonKGRequest(BaseModel):
    uniprot: bool = Field(default=True, description="Seed UniProt canonical human targets")
    reactome: bool = Field(default=True, description="Seed Reactome top-level human pathways")
    opentargets: bool = Field(default=True, description="Seed OpenTargets disease-target associations")
    uniprot_limit: int = Field(default=150, ge=1, le=500)
    reactome_max: int = Field(default=120, ge=1, le=500)
    opentargets_max_diseases: int = Field(default=30, ge=1, le=100)
    opentargets_targets_per_disease: int = Field(default=15, ge=1, le=50)


class SeedCommonKGResponse(BaseModel):
    ok: bool
    environment: str
    inserted_uniprot: int
    inserted_reactome: int
    inserted_opentargets: int
    total_inserted: int
    message: str


@router.post("/seed-common-kg", response_model=SeedCommonKGResponse)
async def seed_common_kg(
    payload: SeedCommonKGRequest,
) -> SeedCommonKGResponse:
    """Seed the common Knowledge Graph (kg_nodes / kg_edges) from the
    9 no-auth biomedical integrations: UniProt, Reactome, OpenTargets.

    This is what makes the KG-first sweep useful from query 1. Safe to
    re-run — the underlying KGFirstService.ingest_facts dedupes by
    content_hash. Gated out of production (use a scheduled job there).
    """
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=403,
            detail="seed-common-kg refuses to run in production. Use a scheduled job.",
        )

    from app.integrations.seed_kg import run_seed

    counts = await run_seed(
        reactome=payload.reactome,
        uniprot=payload.uniprot,
        opentargets=payload.opentargets,
        uniprot_limit=payload.uniprot_limit,
        reactome_max=payload.reactome_max,
        opentargets_max_diseases=payload.opentargets_max_diseases,
        opentargets_targets_per_disease=payload.opentargets_targets_per_disease,
    )
    total = sum(counts.values())
    return SeedCommonKGResponse(
        ok=True,
        environment=settings.ENVIRONMENT,
        inserted_uniprot=counts["uniprot"],
        inserted_reactome=counts["reactome"],
        inserted_opentargets=counts["opentargets"],
        total_inserted=total,
        message=(
            f"Seeded {total} new kg_nodes — UniProt {counts['uniprot']}, "
            f"Reactome {counts['reactome']}, "
            f"OpenTargets {counts['opentargets']}"
        ),
    )

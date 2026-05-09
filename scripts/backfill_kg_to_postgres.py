#!/usr/bin/env python3
"""Backfill the Neo4j knowledge graph into Postgres.

A3 Phase 2 (see docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md). Reads
every node and edge from Neo4j and inserts them into the
`knowledge_graph_nodes` / `knowledge_graph_edges` Postgres tables via
`PostgresGraphStore`. Idempotent — re-runs are safe because the
PostgresGraphStore writes use `ON CONFLICT (id) DO UPDATE` and the
node / edge ids are derived from the upstream Neo4j ids via UUID5
when they're not already valid UUIDs (so the same Neo4j row always
maps to the same Postgres row).

Why a script and not a migration: the working set may be tens of
millions of edges; running this inside `alembic upgrade` would block
schema migrations behind a long IO pass. The script is meant to run
as a one-shot ECS task on the AWS side, with `--page-size` tuning
the per-batch SELECT.

Usage:

    python -m scripts.backfill_kg_to_postgres
    python -m scripts.backfill_kg_to_postgres --page-size 5000
    python -m scripts.backfill_kg_to_postgres --dry-run

The `--dry-run` flag walks Neo4j and counts but does not write to
Postgres — useful as a smoke test before the real ingest.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

# Add the repo root to sys.path so `app.*` imports resolve when this
# script is invoked directly (`python scripts/backfill_...`) instead
# of as a module (`python -m scripts.backfill_...`).
import os
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_REPO, "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


from app.core.config import settings  # noqa: E402
from app.core.logging import get_logger  # noqa: E402
from app.knowledge.graph_store import Entity, Relation  # noqa: E402
from app.knowledge.postgres_graph_store import (  # noqa: E402
    get_postgres_graph_store,
)


logger = get_logger(__name__)


async def _open_neo4j_driver() -> Any:
    """Open a Neo4j async driver. Imports lazily so the rest of the
    script runs even on machines without the driver installed (the
    --dry-run + --help flows shouldn't require it)."""
    try:
        from neo4j import AsyncGraphDatabase
    except ImportError as exc:
        raise RuntimeError(
            "neo4j driver not installed; install backend/requirements.txt "
            "or run --help only"
        ) from exc
    return AsyncGraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USER, settings.neo4j_password_value),
    )


def _node_record_to_entity(record: dict[str, Any]) -> Entity:
    """Map a Neo4j node record to the shared Pydantic Entity. The
    Neo4j schema in this repo stores entity fields directly on the
    node and JSON-serialises a few dict-shaped values into strings;
    this reconstructs them with safe fallbacks for legacy rows."""
    n = record["n"]
    # Neo4j returns Node objects with .get(...) semantics.
    raw = dict(n)
    aliases = raw.get("aliases", []) or []
    if isinstance(aliases, str):
        # Some legacy rows store aliases as a comma-separated string.
        aliases = [a.strip() for a in aliases.split(",") if a.strip()]
    external_ids: dict[str, str] = {}
    eid_raw = raw.get("external_ids")
    if isinstance(eid_raw, dict):
        external_ids = {str(k): str(v) for k, v in eid_raw.items()}
    elif isinstance(eid_raw, str) and eid_raw.startswith("{"):
        try:
            import ast as _ast
            parsed = _ast.literal_eval(eid_raw)
            if isinstance(parsed, dict):
                external_ids = {str(k): str(v) for k, v in parsed.items()}
        except (ValueError, SyntaxError):
            pass

    properties: dict[str, Any] = {}
    p_raw = raw.get("properties")
    if isinstance(p_raw, dict):
        properties = dict(p_raw)
    elif isinstance(p_raw, str) and p_raw.startswith("{"):
        try:
            import ast as _ast
            parsed = _ast.literal_eval(p_raw)
            if isinstance(parsed, dict):
                properties = parsed
        except (ValueError, SyntaxError):
            pass

    return Entity(
        id=str(raw.get("id") or raw.get("entity_id") or ""),
        name=str(raw.get("name", "")),
        entity_type=str(
            raw.get("entity_type") or raw.get("type") or "unknown"
        ),
        aliases=list(aliases),
        description=raw.get("description"),
        external_ids=external_ids,
        properties=properties,
        source_count=int(raw.get("source_count", 0) or 0),
    )


def _edge_record_to_relation(record: dict[str, Any]) -> Relation:
    """Map a Neo4j edge record to the shared Pydantic Relation.

    The Cypher in `walk_edges` returns the relationship object plus
    its source / target node ids so we can hydrate the FK without a
    second round-trip."""
    r = record["r"]
    raw = dict(r)
    return Relation(
        id=str(raw.get("id") or record.get("rid") or ""),
        source_id=str(record["source_id"]),
        source_name=str(record.get("source_name", "")),
        source_type="",
        target_id=str(record["target_id"]),
        target_name=str(record.get("target_name", "")),
        target_type="",
        relation_type=str(record.get("rel_type") or raw.get("type") or "associated_with"),
        confidence=float(raw.get("confidence", 0.5) or 0.5),
        evidence_count=int(raw.get("evidence_count", 0) or 0),
        source_references=list(raw.get("source_references", []) or []),
    )


async def walk_nodes(driver: Any, page_size: int) -> Any:
    """Async generator over every Neo4j node, yielding one Entity per
    iteration. Pages with SKIP/LIMIT so the working set fits in
    memory regardless of total count."""
    skip = 0
    while True:
        async with driver.session() as session:
            result = await session.run(
                "MATCH (n) RETURN n SKIP $skip LIMIT $limit",
                skip=skip,
                limit=page_size,
            )
            count = 0
            async for record in result:
                yield _node_record_to_entity(dict(record))
                count += 1
        if count < page_size:
            return
        skip += page_size


async def walk_edges(driver: Any, page_size: int) -> Any:
    """Async generator over every Neo4j relationship, yielding one
    Relation per iteration. Cypher returns the source / target node
    ids alongside the relationship so we can populate the FK
    (knowledge_graph_edges.source_id / target_id) directly."""
    skip = 0
    while True:
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (a)-[r]->(b)
                RETURN
                    r,
                    elementId(r) AS rid,
                    type(r) AS rel_type,
                    coalesce(a.id, a.entity_id, elementId(a)) AS source_id,
                    coalesce(a.name, '') AS source_name,
                    coalesce(b.id, b.entity_id, elementId(b)) AS target_id,
                    coalesce(b.name, '') AS target_name
                SKIP $skip LIMIT $limit
                """,
                skip=skip,
                limit=page_size,
            )
            count = 0
            async for record in result:
                yield _edge_record_to_relation(dict(record))
                count += 1
        if count < page_size:
            return
        skip += page_size


async def run(
    *,
    page_size: int,
    dry_run: bool,
) -> dict[str, int]:
    counts = {"nodes_seen": 0, "nodes_written": 0, "edges_seen": 0, "edges_written": 0}
    driver = await _open_neo4j_driver()
    try:
        store = get_postgres_graph_store()
        await store.initialize()

        # Nodes first, then edges — edges have FKs into nodes.
        async for entity in walk_nodes(driver, page_size):
            counts["nodes_seen"] += 1
            if not dry_run:
                try:
                    await store.add_entity(entity)
                    counts["nodes_written"] += 1
                except Exception as exc:
                    logger.warning(
                        "kg_backfill.node_failed",
                        extra={
                            "event": "kg_backfill.node_failed",
                            "entity_id": entity.id,
                            "error": str(exc),
                        },
                    )
            if counts["nodes_seen"] % 1000 == 0:
                logger.info(
                    "kg_backfill.nodes_progress",
                    extra={
                        "event": "kg_backfill.nodes_progress",
                        "nodes_seen": counts["nodes_seen"],
                        "nodes_written": counts["nodes_written"],
                    },
                )

        async for relation in walk_edges(driver, page_size):
            counts["edges_seen"] += 1
            if not dry_run:
                try:
                    await store.add_relation(relation)
                    counts["edges_written"] += 1
                except Exception as exc:
                    logger.warning(
                        "kg_backfill.edge_failed",
                        extra={
                            "event": "kg_backfill.edge_failed",
                            "source_id": relation.source_id,
                            "target_id": relation.target_id,
                            "error": str(exc),
                        },
                    )
            if counts["edges_seen"] % 1000 == 0:
                logger.info(
                    "kg_backfill.edges_progress",
                    extra={
                        "event": "kg_backfill.edges_progress",
                        "edges_seen": counts["edges_seen"],
                        "edges_written": counts["edges_written"],
                    },
                )
    finally:
        await driver.close()

    logger.info(
        "kg_backfill.complete",
        extra={"event": "kg_backfill.complete", **counts, "dry_run": dry_run},
    )
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--page-size",
        type=int,
        default=2000,
        help="SKIP/LIMIT page size for the Neo4j walk (default 2000).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk Neo4j and count but do not write to Postgres.",
    )
    args = parser.parse_args()

    counts = asyncio.run(
        run(page_size=args.page_size, dry_run=args.dry_run)
    )
    print(
        f"nodes: seen={counts['nodes_seen']}, written={counts['nodes_written']} | "
        f"edges: seen={counts['edges_seen']}, written={counts['edges_written']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

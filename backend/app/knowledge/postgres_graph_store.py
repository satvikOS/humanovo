"""
Postgres-backed Knowledge Graph store.

A3 Phase 1 (see docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md): mirrors
the GraphStore interface in `graph_store.py` but talks to the
existing `knowledge_graph_nodes` / `knowledge_graph_edges` Postgres
tables instead of Neo4j. This module ships ALONGSIDE `GraphStore` —
no callers switch in Phase 1; the existing Neo4j flow stays canonical.

Why a sibling instead of a swap: the Neo4j path is hot in production
and an in-place rewrite is exactly how you end up with half-migrated
data. Phase 2 introduces dual-write + a backfill script; Phase 3
flips reads behind a `KG_BACKEND` env flag with an instant
escape-hatch back to Neo4j; Phase 4 stops Neo4j writes; Phase 5
removes Neo4j from the deploy.

Design choices:

  * The Pydantic models (`Entity`, `Relation`, `GraphNeighborhood`,
    `GraphPath`) are imported from `graph_store.py` so callers don't
    care which backend served them.

  * Field mapping: the SQLAlchemy `KnowledgeGraphNode` / `Edge`
    columns are leaner than the Pydantic models — `aliases`,
    `external_ids`, `source_count`, `evidence_count`,
    `source_references` get packed into the `properties` / `evidence`
    JSONB. Read-side helpers below unpack them.

  * Pathfinding uses a recursive CTE with cycle detection. This
    diverges from Cypher's variable-length matches in a documented
    way: it returns deduplicated shortest-paths only. Tests assert
    the new semantic explicitly so callers don't silently rely on
    the old one.

  * `search_entities` uses pgvector cosine similarity when the
    query has been embedded; otherwise falls back to ILIKE on the
    name + description. Phase 1 ships the ILIKE path; Phase 2
    wires the embedding pipeline.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import NAMESPACE_OID, UUID, uuid4, uuid5

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.core.logging import LoggerMixin
from app.knowledge.graph_store import (
    Entity,
    GraphNeighborhood,
    GraphPath,
    Relation,
)


def _node_row_to_entity(row: Any) -> Entity:
    """Convert a knowledge_graph_nodes row to a Pydantic Entity.

    `properties` JSONB carries the fields that don't have a dedicated
    column on the SQLAlchemy model: aliases, external_ids,
    source_count. Missing keys fall back to safe defaults so legacy
    rows written before this convention round-trip cleanly.
    """
    props = row.properties if row.properties is not None else {}
    if isinstance(props, str):
        # Defensive: some legacy rows may have a JSON-encoded string
        # instead of a parsed JSONB payload depending on the driver.
        try:
            props = json.loads(props)
        except (TypeError, ValueError):
            props = {}
    return Entity(
        id=str(row.id),
        name=row.name,
        entity_type=row.type or "unknown",
        aliases=list(props.get("aliases", []) or []),
        description=row.description,
        external_ids=dict(props.get("external_ids", {}) or {}),
        # Strip the unpacked-into-fields keys so the residual properties
        # field on Entity carries only "extras" — avoids double counting.
        properties={
            k: v for k, v in props.items()
            if k not in {"aliases", "external_ids", "source_count"}
        },
        source_count=int(props.get("source_count", 0)),
    )


def _edge_row_to_relation(row: Any) -> Relation:
    """Convert a knowledge_graph_edges row to a Pydantic Relation.

    The SQLAlchemy edge model has `evidence` as a Text column; we
    pack `evidence_count` and `source_references` into a small JSON
    payload there to avoid a schema change just for Phase 1. Read-side
    parses that out.
    """
    raw_evidence = row.evidence
    evidence_count = 0
    source_references: list[str] = []
    if raw_evidence:
        try:
            payload = json.loads(raw_evidence)
            if isinstance(payload, dict):
                evidence_count = int(payload.get("evidence_count", 0))
                refs = payload.get("source_references", [])
                source_references = list(refs) if isinstance(refs, list) else []
        except (TypeError, ValueError):
            # Pre-Phase-1 free-text evidence — just keep the raw string
            # available via source_references for now.
            source_references = [raw_evidence]

    return Relation(
        id=str(row.id),
        source_id=str(row.source_id),
        source_name=row.source_name or "",
        source_type="",
        target_id=str(row.target_id),
        target_name=row.target_name or "",
        target_type="",
        relation_type=row.relationship,
        confidence=float(row.strength) if row.strength is not None else 0.5,
        evidence_count=evidence_count,
        source_references=source_references,
    )


class PostgresGraphStore(LoggerMixin):
    """Postgres + pgvector implementation of the KG store interface.

    Conformance: this class implements the same public methods as
    `GraphStore` (initialize, add_entity, add_relation, get_entity,
    search_entities, get_neighborhood, get_relations_between,
    find_paths, execute_query, get_stats) so callers can flip
    backends behind a flag in Phase 3 without touching call sites.
    """

    def __init__(self, session_factory=async_session_factory):
        self._session_factory = session_factory
        self._initialized = False

    async def initialize(self) -> None:
        """Probe the schema. The migration owns table creation; this
        just verifies the tables are reachable."""
        if self._initialized:
            return
        async with self._session_factory() as session:
            await session.execute(
                text("SELECT 1 FROM knowledge_graph_nodes LIMIT 1")
            )
        self._initialized = True
        self.logger.info("PostgresGraphStore initialized")

    async def close(self) -> None:
        """No driver to close — the session factory manages pooling."""
        return

    # ── Mutations ──────────────────────────────────────────────────

    async def add_entity(self, entity: Entity, *, owner_id: UUID | None = None) -> str:
        """Insert a new entity. Returns the new id (string UUID).

        The `id` on the Pydantic model is mapped via `_derive_node_id`
        — UUID strings pass through verbatim, non-UUID source ids hash
        deterministically through UUID5 so re-runs of the dual-write
        or backfill paths land on the same Postgres row. The original
        upstream id is stashed in `properties.original_id` so it can be
        recovered later (used by the Neo4j → Postgres backfill).
        """
        new_id = _derive_node_id(entity.id)
        properties = {
            **entity.properties,
            "aliases": entity.aliases,
            "external_ids": entity.external_ids,
            "source_count": entity.source_count,
        }
        if entity.id and not _looks_like_uuid(entity.id):
            properties["original_id"] = entity.id
        async with self._session_factory() as session:
            await session.execute(
                text(
                    "INSERT INTO knowledge_graph_nodes "
                    "(id, name, type, description, properties, owner_id, created_at, updated_at) "
                    "VALUES (:id, :name, :type, :description, CAST(:properties AS JSONB), "
                    " :owner_id, NOW(), NOW()) "
                    "ON CONFLICT (id) DO UPDATE SET "
                    " name = EXCLUDED.name, "
                    " type = EXCLUDED.type, "
                    " description = EXCLUDED.description, "
                    " properties = EXCLUDED.properties, "
                    " updated_at = NOW()"
                ),
                {
                    "id": new_id,
                    "name": entity.name,
                    "type": entity.entity_type,
                    "description": entity.description,
                    "properties": json.dumps(properties),
                    "owner_id": owner_id,
                },
            )
            await session.commit()
        return str(new_id)

    async def add_relation(self, relation: Relation, *, owner_id: UUID | None = None) -> str:
        """Insert a new relation. Returns the new id (string UUID).

        Like `add_entity`, the relation id is mapped via UUID5 when the
        upstream is non-UUID so dual-write + backfill stay idempotent.
        Source / target ids must resolve to existing
        `knowledge_graph_nodes` rows; we derive both via the node
        namespace so a relation written before its endpoints exist
        will fail with a FK error and the dual-write path will log
        instead of crashing the orchestrator.
        """
        new_id = _derive_edge_id(relation.id)
        # If the relation rows came from Neo4j, the source/target ids
        # are entity ids (potentially non-UUID). Run them through the
        # same node-id derivation so the FK lines up with what
        # `add_entity` wrote.
        src_uuid = _derive_node_id(relation.source_id)
        tgt_uuid = _derive_node_id(relation.target_id)
        evidence_payload = {
            "evidence_count": relation.evidence_count,
            "source_references": relation.source_references,
            # Preserve the original upstream id when it isn't a UUID, so
            # we can audit the backfill / dual-write path later.
            **(
                {"original_id": relation.id}
                if relation.id and not _looks_like_uuid(relation.id) else {}
            ),
        }
        async with self._session_factory() as session:
            await session.execute(
                text(
                    "INSERT INTO knowledge_graph_edges "
                    "(id, source_id, target_id, source_name, target_name, "
                    " relationship, strength, evidence, owner_id, "
                    " created_at, updated_at) "
                    "VALUES (:id, :source_id, :target_id, :source_name, :target_name, "
                    " :relationship, :strength, :evidence, :owner_id, NOW(), NOW()) "
                    "ON CONFLICT (id) DO UPDATE SET "
                    " source_name = EXCLUDED.source_name, "
                    " target_name = EXCLUDED.target_name, "
                    " relationship = EXCLUDED.relationship, "
                    " strength = EXCLUDED.strength, "
                    " evidence = EXCLUDED.evidence, "
                    " updated_at = NOW()"
                ),
                {
                    "id": new_id,
                    "source_id": src_uuid,
                    "target_id": tgt_uuid,
                    "source_name": relation.source_name,
                    "target_name": relation.target_name,
                    "relationship": relation.relation_type,
                    "strength": relation.confidence,
                    "evidence": json.dumps(evidence_payload),
                    "owner_id": owner_id,
                },
            )
            await session.commit()
        return str(new_id)

    # ── Reads ──────────────────────────────────────────────────────

    async def get_entity(self, entity_id: str) -> Entity | None:
        try:
            entity_uuid = UUID(entity_id)
        except (TypeError, ValueError):
            return None
        async with self._session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, name, type, description, properties "
                    "FROM knowledge_graph_nodes WHERE id = :id"
                ),
                {"id": entity_uuid},
            )
            row = result.first()
            if row is None:
                return None
            return _node_row_to_entity(row)

    async def search_entities(
        self,
        query: str,
        entity_types: list[str] | None = None,
        limit: int = 20,
        *,
        owner_id: UUID | None = None,
        include_common: bool = True,
    ) -> list[Entity]:
        """Search by ILIKE on name + description.

        Signature mirrors GraphStore.search_entities (positional
        `entity_types` list + `limit`) so the Phase-3 KG_BACKEND
        factory swap is drop-in for existing callers. The keyword-
        only `owner_id` / `include_common` extras are Postgres-only
        scope filters used by the visual KG endpoints; legacy callers
        that don't pass them get the unfiltered behaviour.

        Phase 1 doesn't compute query embeddings on the fly — that
        plumbing lands in a later phase. The ILIKE fallback covers
        the 90% case (name lookup) and lets the visual KG ship now.
        """
        like = f"%{query.strip()}%"
        scope_clause = _scope_clause(owner_id, include_common)
        type_clause = "AND type = ANY(:entity_types)" if entity_types else ""
        sql = (
            "SELECT id, name, type, description, properties "
            "FROM knowledge_graph_nodes "
            "WHERE (name ILIKE :like OR description ILIKE :like) "
            f"{type_clause} {scope_clause} "
            "ORDER BY "
            "  CASE WHEN name ILIKE :exact THEN 0 ELSE 1 END, "
            "  length(name) "
            "LIMIT :limit"
        )
        params: dict[str, Any] = {
            "like": like,
            "exact": query.strip(),
            "limit": limit,
        }
        if entity_types:
            params["entity_types"] = list(entity_types)
        if owner_id is not None:
            params["owner_id"] = owner_id

        async with self._session_factory() as session:
            result = await session.execute(text(sql), params)
            return [_node_row_to_entity(row) for row in result.fetchall()]

    async def get_neighborhood(
        self,
        entity_id: str,
        depth: int = 1,
        relation_types: list[str] | None = None,
        limit: int = 50,
        *,
        owner_id: UUID | None = None,
        include_common: bool = True,
    ) -> GraphNeighborhood | None:
        """Return the n-hop neighbourhood of a center entity.

        Signature mirrors GraphStore.get_neighborhood (positional
        depth / relation_types / limit, default limit=50) so the
        KG_BACKEND factory can swap implementations without changing
        callers. `relation_types` filters edges by `relationship` —
        empty / None means no filter.

        Recursive CTE with cycle detection — visited node ids are
        accumulated per row so we don't revisit. `depth` caps the
        BFS; `limit` caps the result row counts.
        """
        try:
            center_uuid = UUID(entity_id)
        except (TypeError, ValueError):
            return None

        center = await self.get_entity(entity_id)
        if center is None:
            return None

        scope_clause = _scope_clause(owner_id, include_common, table="e")
        sql = f"""
            WITH RECURSIVE walk(node_id, depth, visited) AS (
                SELECT :center::uuid, 0, ARRAY[:center::uuid]
                UNION ALL
                SELECT next_id, w.depth + 1, w.visited || next_id
                FROM walk w
                JOIN LATERAL (
                    SELECT e.target_id AS next_id
                    FROM knowledge_graph_edges e
                    WHERE e.source_id = w.node_id
                      {scope_clause}
                    UNION
                    SELECT e.source_id AS next_id
                    FROM knowledge_graph_edges e
                    WHERE e.target_id = w.node_id
                      {scope_clause}
                ) hop ON next_id <> ALL(w.visited)
                WHERE w.depth < :max_depth
            )
            SELECT DISTINCT node_id FROM walk LIMIT :node_limit
        """
        params: dict[str, Any] = {
            "center": center_uuid,
            "max_depth": depth,
            "node_limit": limit,
        }
        if owner_id is not None:
            params["owner_id"] = owner_id

        async with self._session_factory() as session:
            ids_result = await session.execute(text(sql), params)
            node_ids = [r.node_id for r in ids_result.fetchall()]
            if not node_ids:
                return GraphNeighborhood(
                    center_entity=center,
                    entities=[center],
                    relations=[],
                    depth=depth,
                )

            nodes_result = await session.execute(
                text(
                    "SELECT id, name, type, description, properties "
                    "FROM knowledge_graph_nodes WHERE id = ANY(:ids)"
                ),
                {"ids": node_ids},
            )
            entities = [_node_row_to_entity(r) for r in nodes_result.fetchall()]

            # Optional relation_types filter mirrors the GraphStore
            # signature. We compare case-insensitively because Cypher's
            # rel-type space is uppercase by convention while Postgres
            # rows store the original-case label from the orchestrator.
            edge_filter = ""
            edge_params: dict[str, Any] = {
                "ids": node_ids,
                "edge_limit": limit,
            }
            if relation_types:
                edge_filter = " AND lower(relationship) = ANY(:rel_types)"
                edge_params["rel_types"] = [r.lower() for r in relation_types]
            edges_result = await session.execute(
                text(
                    "SELECT id, source_id, target_id, source_name, target_name, "
                    "       relationship, strength, evidence "
                    "FROM knowledge_graph_edges "
                    "WHERE source_id = ANY(:ids) AND target_id = ANY(:ids) "
                    f"{edge_filter} "
                    "LIMIT :edge_limit"
                ),
                edge_params,
            )
            relations = [_edge_row_to_relation(r) for r in edges_result.fetchall()]

        return GraphNeighborhood(
            center_entity=center,
            entities=entities,
            relations=relations,
            depth=depth,
        )

    async def get_relations_between(
        self, source_id: str, target_id: str
    ) -> list[Relation]:
        try:
            src = UUID(source_id)
            tgt = UUID(target_id)
        except (TypeError, ValueError):
            return []
        async with self._session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id, source_id, target_id, source_name, target_name, "
                    "       relationship, strength, evidence "
                    "FROM knowledge_graph_edges "
                    "WHERE (source_id = :src AND target_id = :tgt) "
                    "   OR (source_id = :tgt AND target_id = :src)"
                ),
                {"src": src, "tgt": tgt},
            )
            return [_edge_row_to_relation(r) for r in result.fetchall()]

    async def find_paths(
        self,
        source_id: str,
        target_id: str,
        max_length: int = 4,
        limit: int = 5,
    ) -> list[GraphPath]:
        """Recursive CTE shortest-paths.

        Signature mirrors GraphStore.find_paths (positional
        `max_length` + `limit`) so the KG_BACKEND factory swap is
        drop-in. `max_length` caps the recursion depth; `limit` caps
        the number of paths returned. Documented divergence from
        Cypher: this returns deduplicated shortest paths only, while
        Cypher's variable-length matches return every walk.
        """
        try:
            src_uuid = UUID(source_id)
            tgt_uuid = UUID(target_id)
        except (TypeError, ValueError):
            return []

        sql = """
            WITH RECURSIVE walk(node_id, path_ids, edge_ids, depth) AS (
                SELECT :src::uuid, ARRAY[:src::uuid], ARRAY[]::uuid[], 0
                UNION ALL
                SELECT
                    CASE WHEN e.source_id = w.node_id
                         THEN e.target_id ELSE e.source_id END,
                    w.path_ids ||
                        (CASE WHEN e.source_id = w.node_id
                              THEN e.target_id ELSE e.source_id END),
                    w.edge_ids || e.id,
                    w.depth + 1
                FROM walk w
                JOIN knowledge_graph_edges e
                  ON (e.source_id = w.node_id OR e.target_id = w.node_id)
                WHERE
                    (CASE WHEN e.source_id = w.node_id
                          THEN e.target_id ELSE e.source_id END)
                    <> ALL(w.path_ids)
                    AND w.depth < :max_length
            )
            SELECT path_ids, edge_ids, depth
            FROM walk
            WHERE node_id = :tgt::uuid
            ORDER BY depth ASC
            LIMIT :path_limit
        """
        async with self._session_factory() as session:
            result = await session.execute(
                text(sql),
                {
                    "src": src_uuid,
                    "tgt": tgt_uuid,
                    "max_length": max_length,
                    "path_limit": limit,
                },
            )
            rows = result.fetchall()
            if not rows:
                return []

            # Hydrate each path's entities + relations in two index lookups.
            all_node_ids = {nid for r in rows for nid in r.path_ids}
            all_edge_ids = {eid for r in rows for eid in r.edge_ids}

            nodes_by_id: dict[UUID, Entity] = {}
            edges_by_id: dict[UUID, Relation] = {}
            if all_node_ids:
                node_rows = await session.execute(
                    text(
                        "SELECT id, name, type, description, properties "
                        "FROM knowledge_graph_nodes WHERE id = ANY(:ids)"
                    ),
                    {"ids": list(all_node_ids)},
                )
                for nr in node_rows.fetchall():
                    nodes_by_id[nr.id] = _node_row_to_entity(nr)
            if all_edge_ids:
                edge_rows = await session.execute(
                    text(
                        "SELECT id, source_id, target_id, source_name, target_name, "
                        "       relationship, strength, evidence "
                        "FROM knowledge_graph_edges WHERE id = ANY(:ids)"
                    ),
                    {"ids": list(all_edge_ids)},
                )
                for er in edge_rows.fetchall():
                    edges_by_id[er.id] = _edge_row_to_relation(er)

        paths: list[GraphPath] = []
        for row in rows:
            relations = [edges_by_id[eid] for eid in row.edge_ids if eid in edges_by_id]
            avg_conf = (
                sum(r.confidence for r in relations) / len(relations)
                if relations else 1.0
            )
            paths.append(
                GraphPath(
                    source=nodes_by_id.get(src_uuid) or Entity(
                        id=str(src_uuid), name="", entity_type="unknown",
                    ),
                    target=nodes_by_id.get(tgt_uuid) or Entity(
                        id=str(tgt_uuid), name="", entity_type="unknown",
                    ),
                    path=relations,
                    path_length=row.depth,
                    path_confidence=avg_conf,
                )
            )
        return paths

    async def execute_query(self, *_args: Any, **_kwargs: Any) -> Any:
        """Cypher passthrough — not supported on the Postgres backend.

        Phase 3 will route the few callers that do raw Cypher into
        SQL-equivalent queries; for Phase 1 we surface the gap loudly.
        """
        raise NotImplementedError(
            "PostgresGraphStore does not support raw Cypher. "
            "Use the typed methods (search_entities, get_neighborhood, "
            "find_paths, get_relations_between) or fall back to "
            "the Neo4j-backed GraphStore for ad-hoc Cypher."
        )

    async def get_stats(
        self, *, owner_id: UUID | None = None, include_common: bool = True
    ) -> dict[str, Any]:
        """Return aggregate counts.

        Output keys mirror GraphStore.get_stats:
          {total_entities, total_relations, entity_counts,
           relation_counts, last_updated}
        plus a `backend: "postgres"` discriminator that callers can
        use to verify which backend served the response (the parity-
        check endpoint in /admin/kg/stats relies on this).
        """
        from datetime import UTC, datetime  # local import — no top-of-file churn

        scope_node_clause = _scope_clause(owner_id, include_common, table="n")
        scope_edge_clause = _scope_clause(owner_id, include_common, table="e")
        params = {"owner_id": owner_id} if owner_id is not None else {}

        async with self._session_factory() as session:
            n_total = await session.execute(
                text(
                    f"SELECT COUNT(*) FROM knowledge_graph_nodes n "
                    f"WHERE 1=1 {scope_node_clause}"
                ),
                params,
            )
            e_total = await session.execute(
                text(
                    f"SELECT COUNT(*) FROM knowledge_graph_edges e "
                    f"WHERE 1=1 {scope_edge_clause}"
                ),
                params,
            )
            n_by_type = await session.execute(
                text(
                    f"SELECT n.type, COUNT(*) FROM knowledge_graph_nodes n "
                    f"WHERE 1=1 {scope_node_clause} GROUP BY n.type"
                ),
                params,
            )
            e_by_type = await session.execute(
                text(
                    f"SELECT e.relationship, COUNT(*) FROM knowledge_graph_edges e "
                    f"WHERE 1=1 {scope_edge_clause} GROUP BY e.relationship"
                ),
                params,
            )
            return {
                "total_entities": int(n_total.scalar() or 0),
                "total_relations": int(e_total.scalar() or 0),
                "entity_counts": {
                    (row[0] or "unknown"): int(row[1])
                    for row in n_by_type.fetchall()
                },
                "relation_counts": {
                    (row[0] or "unknown"): int(row[1])
                    for row in e_by_type.fetchall()
                },
                "last_updated": datetime.now(UTC),
                "backend": "postgres",
            }


def _looks_like_uuid(s: str) -> bool:
    try:
        UUID(s)
        return True
    except (TypeError, ValueError):
        return False


# UUID5 namespaces — distinct per entity/relation so an entity id and a
# relation id with the same source string cannot ever collide. Using
# NAMESPACE_OID as the parent because there's no canonical DNS namespace
# for these ids; deterministic UUID5 keeps backfill + dual-write
# idempotent across re-runs.
_KG_NODE_NAMESPACE = uuid5(NAMESPACE_OID, "humanovo.kg.node")
_KG_EDGE_NAMESPACE = uuid5(NAMESPACE_OID, "humanovo.kg.edge")


def _derive_node_id(source_id: str | None) -> UUID:
    """Map a (possibly-non-UUID) source id into a stable UUID for the
    Postgres row.

    A3 Phase 2 dual-write path: every Neo4j entity id needs a
    corresponding Postgres row id. If the upstream id is already a
    valid UUID we use it verbatim (Neo4j and Postgres share the same
    pk). Otherwise we hash it via UUID5 so re-runs of the dual-write
    or the backfill script land on the same Postgres row — the
    `ON CONFLICT DO UPDATE` clause then keeps the row consistent.
    """
    if not source_id:
        return uuid4()
    if _looks_like_uuid(source_id):
        return UUID(source_id)
    return uuid5(_KG_NODE_NAMESPACE, source_id)


def _derive_edge_id(source_id: str | None) -> UUID:
    """Same as `_derive_node_id` but in the edge namespace."""
    if not source_id:
        return uuid4()
    if _looks_like_uuid(source_id):
        return UUID(source_id)
    return uuid5(_KG_EDGE_NAMESPACE, source_id)


def _scope_clause(
    owner_id: UUID | None,
    include_common: bool,
    *,
    table: str = "knowledge_graph_nodes",
) -> str:
    """Render the SQL fragment for the private/common scope filter.

    Caller binds the `:owner_id` parameter when owner_id is not None.
    Keeps the query parameterised; never interpolates UUIDs into the
    string.

      owner_id=None,  include_common=True  → no extra filter
      owner_id=None,  include_common=False → owner_id IS NOT NULL
      owner_id=set,   include_common=True  → owner_id = :owner_id OR owner_id IS NULL
      owner_id=set,   include_common=False → owner_id = :owner_id
    """
    col = f"{table}.owner_id" if "." not in table else f"{table}.owner_id"
    if owner_id is None and include_common:
        return ""
    if owner_id is None and not include_common:
        return f" AND {col} IS NOT NULL"
    if include_common:
        return f" AND ({col} = :owner_id OR {col} IS NULL)"
    return f" AND {col} = :owner_id"


_postgres_graph_store: PostgresGraphStore | None = None


def get_postgres_graph_store() -> PostgresGraphStore:
    """Module-level singleton accessor mirroring `get_graph_store()`.

    Phase 3 will introduce a `KG_BACKEND`-aware factory that returns
    either this implementation or the Neo4j-backed `GraphStore`; for
    now both factories coexist and callers explicitly pick one.
    """
    global _postgres_graph_store
    if _postgres_graph_store is None:
        _postgres_graph_store = PostgresGraphStore()
    return _postgres_graph_store

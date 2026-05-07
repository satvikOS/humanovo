"""
Knowledge-Graph-First Tool Orderer

Per product directive:
  - "each time AI is used in any manner, it deposits the data into user
    specific and common Knowledge graph which keeps on growing and
    Agents go through the KGs first so AI cost goes down everytime"
  - "full 3d KG for both User and common. Docs uploaded by users need
    permission by users to keep it private or common use (common can
    lead to royalties for unique work)"

This service enforces the KG-first protocol for every agentic tool call:

  1. Query USER's private KG first.
  2. Query the COMMON KG second.
  3. Only if neither satisfies the query (insufficient coverage), call
     the external 60+ data sources.
  4. Every result from an external source is ingested into BOTH the
     user's private KG (full provenance) AND the common KG (if the
     user opted in OR the source is public domain).
  5. Royalty accrual: every time a query hits a node that originated
     from a specific user's CONTRIBUTED work (uploaded doc, validated
     hypothesis, etc.), a royalty event is recorded. Payouts are
     computed by the billing system.

Tables:
  kg_nodes                  (id, kind, canonical_id, scope: private|common,
                             owner_user_id, embedding, payload, created_at)
  kg_edges                  (id, from_node, to_node, relation, scope,
                             owner_user_id, payload, created_at)
  kg_access_permissions     (user_id, doc_id, scope, granted_at)
  kg_royalty_events         (id, contributor_user_id, consumer_user_id,
                             node_id, event_kind, multiplier, created_at)
  kg_query_log              (id, user_id, query_embedding, hit_scope,
                             hit_count, tokens_saved, at)

Contract:
  - Scope enum: private | common | public_domain (common = user-shared
    contributions; public_domain = facts without individual ownership).
  - Royalty-bearing hits: only "common" scope nodes tied to a specific
    contributor_user_id accrue royalties. "public_domain" nodes do not.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from sqlalchemy import text

from app.core.database import async_session_factory

logger = logging.getLogger(__name__)


class KGScope(str, Enum):
    PRIVATE = "private"                # visible only to owner
    COMMON = "common"                  # shared, contributor tracked
    PUBLIC_DOMAIN = "public_domain"    # free of individual ownership


class UploadPermission(str, Enum):
    PRIVATE = "private"
    COMMON = "common"


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class KGHit:
    node_id: str
    scope: KGScope
    canonical_id: str | None
    kind: str
    payload: dict[str, Any]
    similarity: float
    owner_user_id: str | None
    tokens_estimated: int = 0


@dataclass
class KGQueryResult:
    query_text: str
    user_id: str | None
    private_hits: list[KGHit] = field(default_factory=list)
    common_hits: list[KGHit] = field(default_factory=list)
    sufficient: bool = False
    total_hits: int = 0
    tokens_saved_vs_external: int = 0
    royalty_events: list[dict[str, Any]] = field(default_factory=list)


# Thresholds
SUFFICIENCY_MIN_HITS = 3          # need at least N KG hits to avoid external
SUFFICIENCY_MIN_SIMILARITY = 0.72  # strong match
EXTERNAL_TOKEN_BUDGET_EQUIV = 4000  # estimated tokens per external source query


# ---------------------------------------------------------------------------
# Schema bootstrap
# ---------------------------------------------------------------------------


KG_DDL = """
CREATE TABLE IF NOT EXISTS kg_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,
    canonical_id TEXT,
    scope TEXT NOT NULL DEFAULT 'private',
    owner_user_id TEXT,
    project_id TEXT,
    payload JSONB NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    embedding_large JSONB,
    embedding_small JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kg_nodes ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS kg_nodes_scope_owner_idx
  ON kg_nodes(scope, owner_user_id);
CREATE INDEX IF NOT EXISTS kg_nodes_kind_idx ON kg_nodes(kind);
CREATE INDEX IF NOT EXISTS kg_nodes_canonical_idx ON kg_nodes(canonical_id);
CREATE INDEX IF NOT EXISTS kg_nodes_project_idx ON kg_nodes(project_id);

CREATE TABLE IF NOT EXISTS kg_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_node UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    to_node   UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'private',
    owner_user_id TEXT,
    project_id TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS kg_edges_from_idx ON kg_edges(from_node);
CREATE INDEX IF NOT EXISTS kg_edges_to_idx   ON kg_edges(to_node);
CREATE INDEX IF NOT EXISTS kg_edges_project_idx ON kg_edges(project_id);

CREATE TABLE IF NOT EXISTS kg_document_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    permission TEXT NOT NULL DEFAULT 'private',
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    UNIQUE (user_id, document_id)
);

CREATE TABLE IF NOT EXISTS kg_royalty_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contributor_user_id TEXT NOT NULL,
    consumer_user_id TEXT,
    node_id UUID REFERENCES kg_nodes(id) ON DELETE SET NULL,
    event_kind TEXT NOT NULL,   -- hit | citation | derivation
    multiplier REAL NOT NULL DEFAULT 1.0,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kg_royalty_contributor_idx
  ON kg_royalty_events(contributor_user_id);

CREATE TABLE IF NOT EXISTS kg_query_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    query_text TEXT NOT NULL,
    hit_scope TEXT,
    hit_count INT NOT NULL DEFAULT 0,
    tokens_saved INT NOT NULL DEFAULT 0,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


class KGFirstService:
    """KG-first query orderer + ingest writer + royalty recorder."""

    def __init__(self, session_factory=None):
        self._session_factory = session_factory or async_session_factory
        self._schema_ready = False

    async def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._session_factory() as session:
            async with session.begin():
                # Run each statement separately so partial failures don't abort.
                for stmt in [s.strip() for s in KG_DDL.split(";") if s.strip()]:
                    try:
                        await session.execute(text(stmt))
                    except Exception as e:
                        logger.debug(f"kg_ddl stmt skipped: {e}")
        self._schema_ready = True

    # ------------------------------------------------------------------
    # Public query interface (the "KG-first" wedge)
    # ------------------------------------------------------------------

    async def query(
        self,
        *,
        query_text: str,
        user_id: str | None,
        top_k: int = 8,
        kind: str | None = None,
    ) -> KGQueryResult:
        """Query the user's private KG first, then the common KG.

        Returns a KGQueryResult with `sufficient=True` when the KG covers
        the query (so the agent can skip external data sources). Tokens
        saved are estimated based on how many external sources are
        implicitly avoided.
        """
        await self.ensure_schema()

        embedding = await self._embed(query_text)

        private_hits: list[KGHit] = []
        common_hits: list[KGHit] = []

        async with self._session_factory() as session:
            # Private KG (only for the requesting user)
            if user_id:
                private_hits = await self._search(
                    session, embedding=embedding, scope=KGScope.PRIVATE,
                    owner_user_id=user_id, top_k=top_k, kind=kind,
                )

            # Common KG (shared + public domain)
            common_hits = await self._search(
                session, embedding=embedding, scope=KGScope.COMMON,
                owner_user_id=None, top_k=top_k, kind=kind,
            )
            public_hits = await self._search(
                session, embedding=embedding, scope=KGScope.PUBLIC_DOMAIN,
                owner_user_id=None, top_k=top_k, kind=kind,
            )
            # Merge common + public into common_hits for the agent view
            seen = {h.node_id for h in common_hits}
            for h in public_hits:
                if h.node_id not in seen:
                    common_hits.append(h)

        total = len(private_hits) + len(common_hits)
        strong = [h for h in private_hits + common_hits
                  if h.similarity >= SUFFICIENCY_MIN_SIMILARITY]
        sufficient = len(strong) >= SUFFICIENCY_MIN_HITS
        tokens_saved = EXTERNAL_TOKEN_BUDGET_EQUIV * min(6, total) if sufficient else 0

        # Royalty events for common-scope hits tied to a contributor
        royalty_events: list[dict[str, Any]] = []
        for h in common_hits:
            if h.scope == KGScope.COMMON and h.owner_user_id and h.owner_user_id != user_id:
                royalty_events.append({
                    "contributor_user_id": h.owner_user_id,
                    "consumer_user_id": user_id,
                    "node_id": h.node_id,
                    "event_kind": "hit",
                    "multiplier": 1.0,
                })

        # Log + record royalties
        await self._record_query(query_text, user_id, total, tokens_saved,
                                 sufficient, royalty_events)

        return KGQueryResult(
            query_text=query_text,
            user_id=user_id,
            private_hits=private_hits,
            common_hits=common_hits,
            sufficient=sufficient,
            total_hits=total,
            tokens_saved_vs_external=tokens_saved,
            royalty_events=royalty_events,
        )

    # ------------------------------------------------------------------
    # Ingest — writes new facts to KG with scope and provenance
    # ------------------------------------------------------------------

    async def ingest_facts(
        self,
        *,
        user_id: str | None,
        scope: KGScope,
        facts: list[dict[str, Any]],
        project_id: str | None = None,
        edges: list[dict[str, Any]] | None = None,
    ) -> int:
        """Ingest a batch of facts (optionally with edges) into the KG.

        Each fact:
            {'kind': 'gene'|'pathway'|'claim'|..., 'canonical_id': str,
             'payload': {...}, 'content_hash': optional}

        Each edge (optional):
            {'from_canonical_id': str, 'to_canonical_id': str,
             'relation': str, 'confidence': float, 'payload': {...}}

        When `project_id` is provided, nodes and edges are scoped to that
        project so the project KG view can render a focused subgraph.
        A node that already exists (same content_hash) is NOT re-scoped —
        its project_id stays as-first-insert. For that reason, facts
        emitted during a discovery run get `project_id` written; seed
        nodes get `project_id=None` so they read as "public domain".

        Returns number of new nodes inserted (duplicates skipped via hash).
        """
        await self.ensure_schema()
        inserted = 0
        # map canonical_id -> kg_node UUID for this batch, so the edges
        # section below can resolve endpoints without a second query
        canonical_to_uuid: dict[str, str] = {}

        async with self._session_factory() as session:
            async with session.begin():
                for fact in facts:
                    payload = fact.get("payload") or {}
                    content_hash = fact.get("content_hash") or _hash(
                        f"{fact.get('kind','')}|{fact.get('canonical_id','')}|"
                        f"{json.dumps(payload, sort_keys=True, default=str)}"
                    )
                    try:
                        embedding_large = await self._embed(
                            str(payload.get("text") or payload.get("description") or fact.get("canonical_id") or "")
                        )
                    except Exception:
                        embedding_large = []
                    try:
                        res = await session.execute(
                            text("""
                                INSERT INTO kg_nodes (
                                    kind, canonical_id, scope, owner_user_id,
                                    project_id, payload, content_hash,
                                    embedding_large
                                ) VALUES (
                                    :kind, :cid, :scope, :uid, :pid,
                                    :payload::jsonb, :hash, :emb_large::jsonb
                                )
                                ON CONFLICT (content_hash) DO UPDATE
                                  SET updated_at = NOW()
                                RETURNING id, (xmax = 0) AS inserted
                            """),
                            {
                                "kind": fact.get("kind", "fact"),
                                "cid": fact.get("canonical_id"),
                                "scope": scope.value,
                                "uid": user_id if scope != KGScope.PUBLIC_DOMAIN else None,
                                "pid": project_id,
                                "payload": json.dumps(payload, default=str),
                                "hash": content_hash,
                                "emb_large": json.dumps(embedding_large),
                            },
                        )
                        row = res.fetchone()
                        if row is not None:
                            node_uuid = str(row[0])
                            cid = fact.get("canonical_id")
                            if cid:
                                canonical_to_uuid[cid] = node_uuid
                            if row[1]:  # xmax=0 → was a fresh insert
                                inserted += 1
                    except Exception as e:
                        logger.debug(f"kg ingest failed for one fact: {e}")

                # Edges --------------------------------------------------
                for edge in (edges or []):
                    from_cid = edge.get("from_canonical_id")
                    to_cid = edge.get("to_canonical_id")
                    if not (from_cid and to_cid):
                        continue
                    # Resolve endpoints. In-batch lookup first, else DB.
                    from_uuid = canonical_to_uuid.get(from_cid)
                    to_uuid = canonical_to_uuid.get(to_cid)
                    try:
                        if not from_uuid:
                            r = await session.execute(
                                text("SELECT id FROM kg_nodes WHERE canonical_id = :c LIMIT 1"),
                                {"c": from_cid},
                            )
                            row = r.fetchone()
                            if row:
                                from_uuid = str(row[0])
                        if not to_uuid:
                            r = await session.execute(
                                text("SELECT id FROM kg_nodes WHERE canonical_id = :c LIMIT 1"),
                                {"c": to_cid},
                            )
                            row = r.fetchone()
                            if row:
                                to_uuid = str(row[0])
                        if not (from_uuid and to_uuid):
                            continue
                        await session.execute(
                            text("""
                                INSERT INTO kg_edges (
                                    from_node, to_node, relation, scope,
                                    owner_user_id, project_id, confidence,
                                    payload
                                ) VALUES (
                                    :f::uuid, :t::uuid, :rel, :scope,
                                    :uid, :pid, :conf, :payload::jsonb
                                )
                            """),
                            {
                                "f": from_uuid, "t": to_uuid,
                                "rel": edge.get("relation", "related_to"),
                                "scope": scope.value,
                                "uid": user_id if scope != KGScope.PUBLIC_DOMAIN else None,
                                "pid": project_id,
                                "conf": float(edge.get("confidence") or 0.5),
                                "payload": json.dumps(
                                    edge.get("payload") or {}, default=str,
                                ),
                            },
                        )
                    except Exception as e:
                        logger.debug(f"kg edge ingest failed: {e}")

        return inserted

    # ------------------------------------------------------------------
    # Document upload permissions (private/common with royalty opt-in)
    # ------------------------------------------------------------------

    async def record_document_permission(
        self,
        *,
        user_id: str,
        document_id: str,
        permission: UploadPermission,
    ) -> None:
        await self.ensure_schema()
        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(
                    text("""
                        INSERT INTO kg_document_permissions (
                            user_id, document_id, permission, decided_at
                        ) VALUES (:uid, :did, :perm, NOW())
                        ON CONFLICT (user_id, document_id)
                        DO UPDATE SET permission = EXCLUDED.permission,
                                      decided_at = NOW()
                    """),
                    {"uid": user_id, "did": document_id, "perm": permission.value},
                )

    async def get_document_permission(
        self, *, user_id: str, document_id: str,
    ) -> UploadPermission | None:
        await self.ensure_schema()
        async with self._session_factory() as session:
            row = await session.execute(
                text("""
                    SELECT permission FROM kg_document_permissions
                    WHERE user_id = :uid AND document_id = :did
                """),
                {"uid": user_id, "did": document_id},
            )
            r = row.fetchone()
            if r is None:
                return None
            return UploadPermission(r[0])

    # ------------------------------------------------------------------
    # Royalty summary (for billing & contributor dashboards)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Project subgraph — feeds the 3D KG viewer on the project page
    # ------------------------------------------------------------------

    async def project_subgraph(
        self,
        *,
        project_id: str,
        user_id: str | None = None,
        include_ancestors: bool = True,
        max_nodes: int = 500,
    ) -> dict[str, Any]:
        """Return the subgraph used during discovery for a specific project.

        Nodes returned:
          1. Every node with project_id = project_id
          2. Every node connected by an edge whose project_id = project_id
             (so public_domain seeded ancestors like Reactome pathways
              get pulled into the view when a project's private nodes
              link to them)
          3. Optionally, when include_ancestors=True, public_domain nodes
             that the project's private nodes reference via canonical_id
             patterns (UniProt xrefs, Reactome xrefs, etc.)

        Output shape is 3D-renderable (nodes + links) and shares schema
        with `react-force-graph-3d`:
          {
            nodes: [{id, name, kind, scope, group, color, size, payload}, ...],
            links: [{source, target, relation, confidence, color}, ...],
            stats: { nodes, edges, project_private, project_common, public_domain }
          }
        """
        await self.ensure_schema()
        async with self._session_factory() as session:
            # 1. Nodes directly scoped to project, plus their linked
            # endpoints regardless of scope
            rows = await session.execute(text("""
                WITH project_nodes AS (
                    SELECT DISTINCT n.id
                    FROM kg_nodes n
                    WHERE n.project_id = :pid
                       OR n.id IN (
                         SELECT from_node FROM kg_edges
                          WHERE project_id = :pid
                       )
                       OR n.id IN (
                         SELECT to_node FROM kg_edges
                          WHERE project_id = :pid
                       )
                )
                SELECT id, kind, canonical_id, scope, owner_user_id,
                       project_id, payload, created_at
                FROM kg_nodes
                WHERE id IN (SELECT id FROM project_nodes)
                   OR (project_id = :pid)
                LIMIT :limit
            """), {"pid": project_id, "limit": max_nodes})
            nodes_raw = rows.mappings().fetchall()

            node_ids = [str(r["id"]) for r in nodes_raw]
            if not node_ids:
                return {
                    "nodes": [], "links": [],
                    "stats": {
                        "nodes": 0, "edges": 0,
                        "project_private": 0, "project_common": 0,
                        "public_domain": 0,
                    },
                }

            erows = await session.execute(text("""
                SELECT id, from_node, to_node, relation, scope,
                       owner_user_id, project_id, confidence, payload
                FROM kg_edges
                WHERE (project_id = :pid)
                   OR (from_node = ANY(:ids)
                       AND to_node = ANY(:ids))
            """), {
                "pid": project_id,
                "ids": [str(r["id"]) for r in nodes_raw],
            })
            edges_raw = erows.mappings().fetchall()

        # Build viz-ready output
        kind_colors = {
            "hypothesis_mechanism":  "#E69F00",
            "hypothesis_title":      "#E69F00",
            "hypothesis_description":"#E69F00",
            "entity":                "#0072B2",
            "pathway":               "#009E73",
            "protein":               "#56B4E9",
            "disease":               "#CC79A7",
            "disease_target_association": "#8B5CF6",
            "drug":                  "#F0E442",
            "variant":               "#D55E00",
            "fact":                  "#888888",
        }
        scope_shape = {
            "private":       "sphere",
            "common":        "octahedron",
            "public_domain": "cube",
        }
        stats_counts = {
            "project_private": 0, "project_common": 0, "public_domain": 0,
        }

        nodes: list[dict[str, Any]] = []
        for r in nodes_raw:
            pl = r["payload"] if isinstance(r["payload"], dict) else {}
            name = (pl.get("name") or pl.get("symbol") or pl.get("title")
                    or r.get("canonical_id") or str(r["id"])[:8])
            kind = r["kind"]
            scope_val = r["scope"]
            if scope_val == "public_domain":
                stats_counts["public_domain"] += 1
            elif scope_val == "common":
                stats_counts["project_common"] += 1
            else:
                stats_counts["project_private"] += 1

            nodes.append({
                "id": str(r["id"]),
                "name": str(name)[:80],
                "kind": kind,
                "scope": scope_val,
                "group": kind,
                "color": kind_colors.get(kind, "#999999"),
                "shape": scope_shape.get(scope_val, "sphere"),
                "size": 6 if scope_val == "private" else 4,
                "canonical_id": r["canonical_id"],
                "payload": {
                    k: v for k, v in pl.items()
                    if k not in ("embedding_large", "embedding_small")
                },
            })

        relation_colors = {
            "treats":      "#10B981",
            "inhibits":    "#EF4444",
            "activates":   "#3B82F6",
            "related_to":  "#9CA3AF",
            "participates_in": "#6366F1",
            "associated_with": "#F59E0B",
        }
        links = []
        for r in edges_raw:
            links.append({
                "source": str(r["from_node"]),
                "target": str(r["to_node"]),
                "relation": r["relation"],
                "confidence": float(r["confidence"]) if r["confidence"] is not None else 0.5,
                "color": relation_colors.get(r["relation"], "#9CA3AF"),
                "scope": r["scope"],
            })

        return {
            "nodes": nodes,
            "links": links,
            "stats": {
                "nodes": len(nodes),
                "edges": len(links),
                **stats_counts,
            },
        }

    async def royalty_summary(self, *, user_id: str, days: int = 30) -> dict[str, Any]:
        await self.ensure_schema()
        async with self._session_factory() as session:
            rows = await session.execute(
                text("""
                    SELECT event_kind, COUNT(*) AS n,
                           COALESCE(SUM(multiplier), 0) AS weight
                    FROM kg_royalty_events
                    WHERE contributor_user_id = :uid
                      AND created_at >= NOW() - (:days || ' days')::interval
                    GROUP BY event_kind
                """),
                {"uid": user_id, "days": days},
            )
            by_kind = [dict(r) for r in rows.mappings().fetchall()]
        total_weight = sum(float(r.get("weight") or 0) for r in by_kind)
        return {
            "user_id": user_id,
            "window_days": days,
            "by_kind": by_kind,
            "total_weight": round(total_weight, 4),
            # Dollar conversion is handled by billing_service using its own
            # tiering; we only return the unit "weight" here.
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _search(
        self,
        session,
        *,
        embedding: list[float],
        scope: KGScope,
        owner_user_id: str | None,
        top_k: int,
        kind: str | None,
    ) -> list[KGHit]:
        """In-Python cosine search since pgvector may or may not be available
        on the kg_nodes.embedding_large JSONB column. When pgvector IS
        available on a sibling column, the retriever service uses that."""
        try:
            # Load a bounded candidate set from the scope and filter by kind.
            clauses = ["scope = :scope"]
            params: dict[str, Any] = {"scope": scope.value, "limit": 200}
            if owner_user_id:
                clauses.append("owner_user_id = :uid")
                params["uid"] = owner_user_id
            elif scope == KGScope.COMMON:
                clauses.append("owner_user_id IS NOT NULL")
            if kind:
                clauses.append("kind = :kind")
                params["kind"] = kind

            where = " AND ".join(clauses)
            sql = text(f"""
                SELECT id, kind, canonical_id, scope, owner_user_id,
                       payload, embedding_large
                FROM kg_nodes
                WHERE {where}
                ORDER BY updated_at DESC
                LIMIT :limit
            """)
            rows = await session.execute(sql, params)
        except Exception as e:
            logger.debug(f"kg search falling back to empty (reason: {e})")
            return []

        out: list[KGHit] = []
        for r in rows.mappings().fetchall():
            cand_emb = r.get("embedding_large")
            if isinstance(cand_emb, str):
                try:
                    cand_emb = json.loads(cand_emb)
                except json.JSONDecodeError:
                    cand_emb = []
            sim = _cosine(embedding, cand_emb or [])
            if sim <= 0:
                continue
            out.append(KGHit(
                node_id=str(r["id"]),
                scope=KGScope(r["scope"]),
                canonical_id=r.get("canonical_id"),
                kind=r["kind"],
                payload=r.get("payload") or {},
                similarity=sim,
                owner_user_id=r.get("owner_user_id"),
                tokens_estimated=_estimate_tokens(r.get("payload") or {}),
            ))
        out.sort(key=lambda h: h.similarity, reverse=True)
        return out[:top_k]

    async def _embed(self, text_input: str) -> list[float]:
        """Reuse the dual-embedding grounding engine."""
        try:
            from app.rag.grounding import get_grounding_engine
            engine = get_grounding_engine()
            await engine.initialize()
            return await engine.embed(text_input)
        except Exception:
            return []

    async def _record_query(
        self,
        query_text: str,
        user_id: str | None,
        hit_count: int,
        tokens_saved: int,
        sufficient: bool,
        royalty_events: list[dict[str, Any]],
    ) -> None:
        try:
            async with self._session_factory() as session:
                async with session.begin():
                    await session.execute(
                        text("""
                            INSERT INTO kg_query_log
                                (user_id, query_text, hit_scope, hit_count, tokens_saved)
                            VALUES (:uid, :q, :scope, :n, :saved)
                        """),
                        {
                            "uid": user_id, "q": query_text[:2000],
                            "scope": "sufficient" if sufficient else "partial",
                            "n": hit_count, "saved": tokens_saved,
                        },
                    )
                    for ev in royalty_events:
                        await session.execute(
                            text("""
                                INSERT INTO kg_royalty_events (
                                    contributor_user_id, consumer_user_id,
                                    node_id, event_kind, multiplier
                                ) VALUES (
                                    :c, :u, :nid, :k, :m
                                )
                            """),
                            {
                                "c": ev["contributor_user_id"],
                                "u": ev.get("consumer_user_id"),
                                "nid": ev["node_id"],
                                "k": ev["event_kind"],
                                "m": ev.get("multiplier", 1.0),
                            },
                        )
        except Exception as e:
            logger.debug(f"kg_query_log write failed (non-fatal): {e}")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _estimate_tokens(payload: dict[str, Any]) -> int:
    if not payload:
        return 0
    return max(50, len(json.dumps(payload, default=str)) // 4)


# ---------------------------------------------------------------------------
# Module singleton
# ---------------------------------------------------------------------------


_instance: KGFirstService | None = None


def get_kg_first_service() -> KGFirstService:
    global _instance
    if _instance is None:
        _instance = KGFirstService()
    return _instance

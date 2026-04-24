"""
Apache AGE Graph Store — PostgreSQL-Native Graph Backend

Per product directive: "tech should be from Apache AGE, but humanovo
specific UIUX". This module provides a graph store compatible with the
Neo4j-backed implementation in app/knowledge/graph_store.py so the
discovery pipeline can switch between Neo4j (production) and AGE
(bootstrap) via a single settings flag:

    settings.KG_GRAPH_BACKEND = "neo4j"  |  "apache_age"

Apache AGE runs inside PostgreSQL as an extension (CREATE EXTENSION age)
and supports Cypher via `cypher()` table functions. It offers:
  - ~95% of Neo4j's query expressiveness
  - zero additional infrastructure (same Postgres)
  - pgvector interop (embeddings + graph in one DB)
  - lower operational cost ($0 vs $185-500/mo Neo4j Aura)

Public API mirrors graph_store.py:

    store = AGEGraphStore(graph_name="humanovo_kg")
    await store.ensure_schema()
    await store.upsert_node(...)
    await store.upsert_edge(...)
    await store.neighbors(node_id, depth=2)
    await store.shortest_path(a_id, b_id)
    await store.query(cypher, params)

The front-end Knowledge Graph page reads from this store through the same
/v1/knowledge-graph endpoints — no frontend change required.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import text

from app.core.database import async_session_factory

logger = logging.getLogger(__name__)


@dataclass
class AGENode:
    id: str
    label: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class AGEEdge:
    from_id: str
    to_id: str
    relation: str
    properties: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Schema bootstrap
# ---------------------------------------------------------------------------


AGE_SETUP_SQL = """
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT create_graph(:graph_name)
  WHERE NOT EXISTS (SELECT 1 FROM ag_graph WHERE name = :graph_name);
"""


class AGEGraphStore:
    """Apache AGE graph store. Same interface as the Neo4j store."""

    def __init__(self, graph_name: str = "humanovo_kg", session_factory=None):
        self.graph_name = graph_name
        self._session_factory = session_factory or async_session_factory
        self._ready = False

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    async def ensure_schema(self) -> None:
        """Create the AGE extension and named graph if missing.

        If the AGE extension is not installed on the Postgres server this
        method logs a warning and returns; the caller can then fall back
        to the Neo4j store.
        """
        if self._ready:
            return
        async with self._session_factory() as session:
            async with session.begin():
                try:
                    await session.execute(text("CREATE EXTENSION IF NOT EXISTS age"))
                    # Older AGE releases expose create_graph via ag_catalog;
                    # newer via the public schema. We try both.
                    try:
                        await session.execute(
                            text(f"SELECT create_graph('{self.graph_name}')"),
                        )
                    except Exception:
                        await session.execute(
                            text(f"SELECT ag_catalog.create_graph('{self.graph_name}')"),
                        )
                    self._ready = True
                    logger.info(f"Apache AGE graph '{self.graph_name}' ready")
                except Exception as e:
                    logger.warning(
                        f"Apache AGE not available on this Postgres instance: {e}. "
                        "Falling back to Neo4j or in-memory graph store."
                    )

    @property
    def available(self) -> bool:
        return self._ready

    # ------------------------------------------------------------------
    # Node / edge upsert
    # ------------------------------------------------------------------

    async def upsert_node(
        self,
        *,
        node_id: str,
        label: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        await self.ensure_schema()
        if not self._ready:
            return
        properties = properties or {}
        props_cy = _cypher_props({**properties, "id": node_id})
        cypher = (
            f"MERGE (n:{_safe_label(label)} {{id: '{_esc(node_id)}'}}) "
            f"SET n += {props_cy}"
        )
        await self._run_cypher(cypher)

    async def upsert_edge(
        self,
        *,
        from_id: str,
        to_id: str,
        relation: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        await self.ensure_schema()
        if not self._ready:
            return
        properties = properties or {}
        props_cy = _cypher_props(properties)
        cypher = (
            f"MATCH (a {{id:'{_esc(from_id)}'}}), (b {{id:'{_esc(to_id)}'}}) "
            f"MERGE (a)-[r:{_safe_label(relation)}]->(b) "
            f"SET r += {props_cy}"
        )
        await self._run_cypher(cypher)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def neighbors(
        self, node_id: str, *, depth: int = 1, limit: int = 25,
    ) -> list[dict[str, Any]]:
        await self.ensure_schema()
        if not self._ready:
            return []
        cypher = (
            f"MATCH (n {{id:'{_esc(node_id)}'}})-[*1..{int(depth)}]-(m) "
            f"RETURN DISTINCT m LIMIT {int(limit)}"
        )
        return await self._run_cypher(cypher, return_type="agtype")

    async def shortest_path(
        self, a_id: str, b_id: str, *, max_depth: int = 6,
    ) -> list[dict[str, Any]]:
        await self.ensure_schema()
        if not self._ready:
            return []
        cypher = (
            f"MATCH p = shortestPath("
            f"(a {{id:'{_esc(a_id)}'}})-[*..{int(max_depth)}]-"
            f"(b {{id:'{_esc(b_id)}'}})) RETURN p"
        )
        return await self._run_cypher(cypher, return_type="agtype")

    async def query(
        self, cypher: str, params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        await self.ensure_schema()
        if not self._ready:
            return []
        return await self._run_cypher(cypher, params=params)

    async def count(self) -> dict[str, int]:
        """Return node + edge counts for the current graph."""
        await self.ensure_schema()
        if not self._ready:
            return {"nodes": 0, "edges": 0}
        async with self._session_factory() as session:
            try:
                n = await session.execute(text(
                    f"SELECT count(*) FROM cypher('{self.graph_name}', "
                    f"$$ MATCH (n) RETURN n $$) AS (n agtype)"
                ))
                e = await session.execute(text(
                    f"SELECT count(*) FROM cypher('{self.graph_name}', "
                    f"$$ MATCH ()-[r]->() RETURN r $$) AS (r agtype)"
                ))
                return {
                    "nodes": int(n.scalar() or 0),
                    "edges": int(e.scalar() or 0),
                }
            except Exception as ex:
                logger.debug(f"AGE count failed: {ex}")
                return {"nodes": 0, "edges": 0}

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _run_cypher(
        self,
        cypher: str,
        params: dict[str, Any] | None = None,
        return_type: str = "agtype",
    ) -> list[dict[str, Any]]:
        async with self._session_factory() as session:
            try:
                sql = text(
                    f"SELECT * FROM cypher('{self.graph_name}', $$ {cypher} $$) "
                    f"AS (result {return_type})"
                )
                res = await session.execute(sql, params or {})
                rows = res.fetchall()
                return [_parse_agtype(r[0]) for r in rows]
            except Exception as e:
                logger.debug(f"AGE cypher failed: {e}; cypher={cypher[:200]}")
                return []


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _esc(s: str) -> str:
    return str(s).replace("'", "\\'")


def _safe_label(s: str) -> str:
    import re
    return re.sub(r"[^A-Za-z0-9_]", "_", str(s))[:64] or "Node"


def _cypher_props(d: dict[str, Any]) -> str:
    parts = []
    for k, v in d.items():
        key = _safe_label(k)
        if isinstance(v, str):
            parts.append(f"{key}: '{_esc(v)}'")
        elif isinstance(v, bool):
            parts.append(f"{key}: {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            parts.append(f"{key}: {v}")
        elif v is None:
            continue
        else:
            parts.append(f"{key}: '{_esc(json.dumps(v, default=str))}'")
    return "{" + ", ".join(parts) + "}"


def _parse_agtype(raw: Any) -> dict[str, Any]:
    """Parse an agtype result into a Python dict. AGE returns JSON-like
    strings; we handle both the string and dict forms."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (list, tuple)):
        return {"elements": list(raw)}
    s = str(raw)
    # Strip trailing type tag like "::vertex"
    if "::" in s:
        s = s.rsplit("::", 1)[0]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return {"raw": s}


# ---------------------------------------------------------------------------
# Backend selector
# ---------------------------------------------------------------------------


_age_singleton: AGEGraphStore | None = None


def get_age_graph_store(graph_name: str = "humanovo_kg") -> AGEGraphStore:
    global _age_singleton
    if _age_singleton is None:
        _age_singleton = AGEGraphStore(graph_name=graph_name)
    return _age_singleton


async def get_graph_store(backend: Optional[str] = None):
    """Return the configured graph store — Apache AGE or Neo4j — based on
    settings.KG_GRAPH_BACKEND (default: auto-detect, preferring AGE when
    the extension is installed, else falling back to Neo4j).

    Unified interface: returned object has .ensure_schema(), .upsert_node(),
    .upsert_edge(), .neighbors(), .shortest_path(), .query().
    """
    from app.core.config import settings
    chosen = backend or getattr(settings, "KG_GRAPH_BACKEND", "auto")

    if chosen in ("apache_age", "age", "auto"):
        store = get_age_graph_store()
        await store.ensure_schema()
        if store.available:
            return store
        if chosen != "auto":
            logger.warning(
                "KG_GRAPH_BACKEND=apache_age requested but extension not "
                "installed. Falling back to Neo4j."
            )

    # Fall through to Neo4j
    try:
        from app.knowledge.graph_store import get_graph_store as get_neo4j
        return get_neo4j()
    except Exception as e:
        logger.warning(f"Neo4j store unavailable: {e}")
        return get_age_graph_store()  # will be a no-op store

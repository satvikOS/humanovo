# A3 — Neo4j → Postgres + pgvector migration plan

**Status:** drafted 2026-05-08, ready for execution. **Estimated effort:** 3 days
across 5 phases. **Owner:** next session.

This is the execution plan for the A3 item in `NEXT_SESSION.md`. The
goal is to remove Neo4j from the deploy entirely; embeddings already
live in pgvector and the relational graph fits cleanly into two
Postgres tables we already have.

The plan is structured so every phase ships independently and is
reversible — no flag-day cutover, no half-migrated state if an attempt
gets interrupted.

---

## Why this is feasible without a long migration window

The Postgres-side schema is **already done**. `app/models/platform_entities.py`
defines `KnowledgeGraphNode` (line 303) and `KnowledgeGraphEdge` (line 314)
with the right columns:

```
knowledge_graph_nodes(id UUID, name, type, description, properties JSONB, ...)
knowledge_graph_edges(id UUID, source_id FK, target_id FK,
                     source_name, target_name, relationship,
                     strength FLOAT, evidence)
```

These mirror the Neo4j entity / relation shape. The real work is on the
service side — swapping Cypher queries for SQLAlchemy / pgvector queries.

## Surface to migrate

| File | Lines | Role |
|------|------:|------|
| `app/knowledge/graph_store.py` | 649 | Entity-centric API: `add_entity`, `search_entities`, `get_neighborhood`, `find_paths` (Cypher pathfinding), `execute_query`, `get_stats` |
| `app/services/kg_first_service.py` | 835 | Provenance-aware semantic search + ingest. Methods: `query`, `ingest_facts`, `project_subgraph`, document-permission CRUD, royalty summary |
| `app/services/neo4j_population_service.py` | 1560 | Bulk-ingest pipeline that pulls ETL output into the graph |

Plus ~10 callers across `api/v1/endpoints/*` and `agents/*` that use the
two services through their public APIs.

## Phased plan

Each phase is one PR / commit that ships independently. The next phase
can start once the previous one is green in CI.

### Phase 1 — Add the Postgres-backed service alongside Neo4j *(~1 day)*

Goal: introduce a `PostgresGraphStore` that implements the same public
interface as `GraphStore`, talking to the existing `knowledge_graph_*`
tables. Don't switch any callers yet — `GraphStore` remains canonical;
`PostgresGraphStore` is a sibling.

Files to create:

- `app/knowledge/postgres_graph_store.py` — new module mirroring
  `graph_store.py`'s public surface (`Entity`, `Relation`,
  `GraphNeighborhood`, `GraphPath` already importable from there).
  Methods to implement:
  - `add_entity(entity) -> str` — INSERT into `knowledge_graph_nodes`,
    return id.
  - `add_relation(relation) -> str` — INSERT into `knowledge_graph_edges`.
  - `get_entity(id)` — SELECT by PK.
  - `search_entities(query, limit, type_filter)` — pgvector cosine
    similarity on a name+description embedding column (NOTE: needs a
    new column `embedding VECTOR(1024)` on `knowledge_graph_nodes`;
    Phase 1 includes the migration). For now fall back to ILIKE on
    `name` / `description` when no embedding is present, so the
    interface compiles before the embedding pipeline lands in Phase 2.
  - `get_neighborhood(entity_id, depth, limit)` — recursive CTE
    over `knowledge_graph_edges` for n-hop expansion.
  - `get_relations_between(source_id, target_id)` — direct SELECT.
  - `find_paths(source_id, target_id, max_depth)` — recursive CTE
    with cycle detection. SQL is uglier than Cypher but the pattern
    is well-known (`WITH RECURSIVE path(...)`).
  - `get_stats()` — `SELECT COUNT(*)` on both tables.

Files to add:

- `backend/migrations/versions/023_kg_node_embedding.py` — adds
  `embedding VECTOR(1024)` column on `knowledge_graph_nodes` (NULLABLE
  so existing rows don't need backfill). Adds an HNSW index on
  `(embedding vector_cosine_ops)`.

- `backend/tests/test_postgres_graph_store.py` — unit tests for each
  method using `pytest_asyncio` against the existing pgvector test
  fixture. Assert parity with `GraphStore` for `add_entity`, `get_entity`,
  `search_entities`, `get_neighborhood`. Skip `find_paths` parity
  (recursive CTE behaviour intentionally diverges from Cypher's
  variable-length paths — it returns deduplicated shortest paths).

What ships: PostgresGraphStore is callable but unused by app code.
Risk surface: zero — Neo4j flow is untouched.

### Phase 2 — Backfill + dual-write *(~1 day)*

Goal: keep Neo4j authoritative for reads, but write every new entity /
relation to BOTH stores so Postgres catches up. Add a backfill script
that copies the existing Neo4j graph into Postgres.

Files to touch:

- `app/knowledge/graph_store.py` — wrap the four mutating methods
  (`add_entity`, `add_relation`, plus the populate paths in
  `neo4j_population_service.py`) so each Neo4j success is followed by
  a Postgres write. Failure of the Postgres side logs but does not
  fail the request — Neo4j is still authoritative.

- `scripts/backfill_kg_to_postgres.py` — reads the entire Neo4j graph
  via `MATCH (n) RETURN n` + `MATCH (a)-[r]->(b)` and bulk-INSERTs into
  Postgres. Idempotent via `ON CONFLICT (id) DO NOTHING` so re-runs
  are safe.

- `app/services/neo4j_population_service.py` — add a `dual_write=True`
  flag so the bulk-ingest path also writes Postgres. Default `True` in
  this phase.

- New env var `KG_DUAL_WRITE: bool = True` so we can disable the
  Postgres write on a hot-path issue without deploying.

What ships: every new fact lands in both stores. Old facts are
migrated by the backfill script. Reads still go to Neo4j.

Risk surface: low — Neo4j path unchanged; Postgres writes are
fire-and-forget on failure.

### Phase 3 — Switch reads to Postgres behind a flag *(~½ day)*

Goal: flip the read path to `PostgresGraphStore` for all callers, with
an env-var escape hatch back to Neo4j if something regresses.

Files to touch:

- `app/knowledge/graph_store.py` — module-level `get_graph_store()`
  factory consults `settings.KG_BACKEND` (`postgres` | `neo4j`,
  default `postgres`) and returns the appropriate implementation.
  Both implementations conform to the same protocol, so call sites
  don't change.

- `app/services/kg_first_service.py` — same pattern. Its semantic
  search hot path already sits on top of pgvector for embeddings;
  the relational lookups switch from Neo4j to Postgres.

- `app/api/v1/endpoints/admin.py` — the existing `/admin/kg/stats`
  endpoint should expose both backends' counts so the user can verify
  parity post-flip.

- `tests/test_knowledge_graph_*.py` — re-run the existing KG tests
  with `KG_BACKEND=postgres`. Anything that asserted Cypher-specific
  results (variable-length paths) gets updated to assert the
  Postgres-equivalent semantics.

What ships: production reads from Postgres. Neo4j writes still happen
(safety net) but reads are short-circuited.

Risk surface: medium — first phase where a Postgres bug surfaces in
prod. The escape hatch (`KG_BACKEND=neo4j`) reverts in seconds without
a deploy.

### Phase 4 — Stop writing to Neo4j *(~½ day)*

Goal: Postgres becomes authoritative for both reads and writes. Neo4j
container still runs but receives no traffic.

Files to touch:

- `app/knowledge/graph_store.py` — make Neo4j writes a no-op when
  `KG_BACKEND=postgres` (the default). Helper now returns the Postgres
  implementation everywhere.

- `app/services/neo4j_population_service.py` — same; flip
  `dual_write` default to `False`.

- Operational note in `CHANGELOG.md` — the Neo4j container is still
  in `docker-compose.yml` but nothing touches it. Removal is Phase 5.

What ships: a Postgres-only KG. Neo4j sits idle for one full prod
window so we can roll back if a latent bug surfaces.

Risk surface: low — the "rollback" is `KG_BACKEND=neo4j` + a backfill
of any Postgres-only writes. The window we hold Neo4j idle bounds the
backfill scope.

### Phase 5 — Remove Neo4j from deploy *(~½ day)*

Goal: delete the container, the driver, the config, the test fixture.

Files to touch:

- `docker-compose.yml`, `docker-compose.dev.yml` — drop the `neo4j`
  service. Leave a comment with the date and a link to this plan
  pointing at the migration commit.
- `backend/requirements.txt` — drop `neo4j` driver.
- `infrastructure/` (Terraform) — remove the Neo4j resources. Likely
  AuraDB; cancel the subscription in the AWS / Aura console
  separately.
- `app/core/config.py` — drop `NEO4J_URI`, `NEO4J_USER`,
  `NEO4J_PASSWORD`, `neo4j_password_value` property. Leaves only the
  Postgres + pgvector path.
- `app/knowledge/graph_store.py` — delete the Neo4j branch entirely;
  rename `PostgresGraphStore` → `GraphStore`.
- `app/services/neo4j_population_service.py` → rename to
  `kg_population_service.py`; rip out the Neo4j ingest path.
- `tests/conftest.py` — drop the Neo4j fixture.

What ships: a deploy that doesn't include Neo4j. The on-disk Neo4j
data volume is preserved one more deploy (per the rollback discipline)
and deleted on the next.

Risk surface: structural — once Phase 5 lands you can't roll back to
Neo4j without restoring from a Phase 4 snapshot. Hold for one
production-stable week after Phase 4 before merging Phase 5.

---

## Risks + mitigations

1. **Recursive CTE pathfinding diverges from Cypher.** Cypher's
   variable-length matches collect every path; recursive CTEs
   typically dedupe to shortest. Phase 1 tests assert the new
   semantic explicitly so callers don't rely on the old one
   silently.

2. **HNSW index on `knowledge_graph_nodes.embedding` adds write cost.**
   Roughly 2-3× INSERT latency vs. no index. The bulk ingest path is
   already async with batching; should not regress live ingest. If it
   does, the fallback is `lists=100` IVFFLAT instead.

3. **Backfill script timeout.** If the existing Neo4j graph is
   already large (tens of millions of edges) the single-process
   script may take hours. Mitigation: run inside a long-lived ECS
   task, not a CI step. The `ON CONFLICT DO NOTHING` clause makes
   resumption safe.

4. **Phase 3 read-flip surfaces silent semantic drift.** The
   existing KG tests cover the obvious shapes; the unknowns are
   query patterns the agents use that the test suite doesn't
   exercise. Mitigation: ship Phase 3 behind a 5% canary by setting
   `KG_BACKEND=postgres` in a single deploy cell first.

## Test strategy per phase

| Phase | New tests | Re-run |
|-------|-----------|--------|
| 1 | `test_postgres_graph_store.py` (unit) | full suite |
| 2 | `test_kg_dual_write.py` (asserts both stores see every write); `test_backfill_script.py` | full suite |
| 3 | `KG_BACKEND=postgres` env-var run of every existing KG test | full suite, both backends, in CI matrix |
| 4 | none new — Phase 3 tests are the gate | full suite |
| 5 | none new — green CI is the gate | full suite |

## Success criteria

- `docker-compose ps` post-Phase 5 shows no `neo4j` service.
- `grep -r 'from neo4j' backend/` returns zero hits.
- All KG endpoint runtime tests (Tier-3 C1) pass.
- p99 latency of `/api/v1/knowledge-graph/*` reads no worse than
  Neo4j baseline +20%.

## Out of scope

- Migrating the embedding model itself. Embeddings already live in
  pgvector; A3 doesn't touch how they're computed, just where node /
  edge metadata is stored.
- Knowledge-graph UI changes. The frontend talks to the API, not the
  store, so it doesn't notice the swap.

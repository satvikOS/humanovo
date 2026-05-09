"""KG: add embedding (VECTOR 1024) + owner_id to nodes & edges

Two changes prep'd for A3 Phase 1 (Neo4j → Postgres + pgvector
migration; see docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md):

1. `knowledge_graph_nodes.embedding VECTOR(1024)` — Cohere Embed
   English v3 dimensionality, matches GROUNDING_EMBEDDING_PRIMARY.
   NULLABLE so existing rows don't need a backfill before the new
   PostgresGraphStore goes live. HNSW index with cosine ops for fast
   ANN search.

2. `owner_id UUID` on BOTH `knowledge_graph_nodes` and
   `knowledge_graph_edges`. NULL means community/common (visible to
   every authenticated user); set means private to that user. The
   visual-KG integration (private/common toggle, hypothesis/paper
   subgraphs) needs this filter to render the right scope. ON DELETE
   SET NULL so deleting a user orphans their KG entries instead of
   cascade-deleting them — same policy as platform_entities migration
   021 used for tenant isolation.

Idempotence: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
CREATE EXTENSION IF NOT EXISTS vector. Re-runnable after partial
application.

Revision ID: 023_kg_node_embedding_and_owner
Revises: 022_user_has_completed_onboarding
Create Date: 2026-05-08
"""
from __future__ import annotations

from alembic import op


revision = "023_kg_node_embedding_and_owner"
down_revision = "022_user_has_completed_onboarding"
branch_labels = None
depends_on = None


KG_TABLES = ("knowledge_graph_nodes", "knowledge_graph_edges")


def upgrade() -> None:
    # pgvector is already installed by migration 003 for grounding,
    # but double-check — this migration is independently useful and
    # may run on a fresh DB before the grounding pipeline lands.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── 1. embedding column on nodes ──────────────────────────────
    op.execute(
        "ALTER TABLE knowledge_graph_nodes "
        "ADD COLUMN IF NOT EXISTS embedding VECTOR(1024)"
    )
    # HNSW with cosine — same recipe as migration 003. m=16, ef=64 are
    # pgvector's reasonable defaults; tune later when we have real
    # query-pattern data.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_kg_nodes_embedding_hnsw "
        "ON knowledge_graph_nodes "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # ── 2. owner_id on both tables ────────────────────────────────
    for tbl in KG_TABLES:
        op.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS owner_id UUID")
        # FK with ON DELETE SET NULL so deleting a user orphans their
        # KG entries (community-scoped, visible to all) rather than
        # cascade-deleting them.
        op.execute(
            f"DO $$ BEGIN "
            f"IF NOT EXISTS ("
            f"  SELECT 1 FROM pg_constraint "
            f"  WHERE conname = 'fk_{tbl}_owner_id_users'"
            f") THEN "
            f"ALTER TABLE {tbl} "
            f"ADD CONSTRAINT fk_{tbl}_owner_id_users "
            f"FOREIGN KEY (owner_id) REFERENCES users(id) "
            f"ON DELETE SET NULL; "
            f"END IF; "
            f"END $$;"
        )
        # Index for the per-user scope filter; the IS NULL community
        # filter still benefits from the same index in practice.
        op.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{tbl}_owner_id "
            f"ON {tbl} (owner_id)"
        )


def downgrade() -> None:
    for tbl in KG_TABLES:
        op.execute(f"DROP INDEX IF EXISTS idx_{tbl}_owner_id")
        op.execute(
            f"ALTER TABLE {tbl} "
            f"DROP CONSTRAINT IF EXISTS fk_{tbl}_owner_id_users"
        )
        op.execute(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS owner_id")

    op.execute("DROP INDEX IF EXISTS idx_kg_nodes_embedding_hnsw")
    op.execute("ALTER TABLE knowledge_graph_nodes DROP COLUMN IF EXISTS embedding")

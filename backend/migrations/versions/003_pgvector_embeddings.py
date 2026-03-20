"""Add pgvector extension and vector_embeddings table

Replaces ChromaDB with PostgreSQL-native vector search via pgvector.
Stores dual embeddings: biomedical (1024d Cohere) + general (1536d Azure).

Revision ID: 003_pgvector
Revises: 002_pipeline_intelligence
Create Date: 2026-03-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


# revision identifiers
revision = "003_pgvector"
down_revision = "002_pipeline_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Create vector_embeddings table with raw SQL for pgvector column types
    op.execute("""
        CREATE TABLE IF NOT EXISTS vector_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content TEXT NOT NULL,
            content_hash VARCHAR(64),
            embedding_biomedical vector(1024),
            embedding_general vector(1536),
            metadata JSONB DEFAULT '{}'::jsonb,
            source_type VARCHAR(100),
            source_id VARCHAR(255),
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            embedding_model_biomedical VARCHAR(100),
            embedding_model_general VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # Indexes for lookups
    op.execute("CREATE INDEX IF NOT EXISTS ix_vector_embeddings_content_hash ON vector_embeddings (content_hash)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_vector_embeddings_source_type ON vector_embeddings (source_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_vector_embeddings_source_id ON vector_embeddings (source_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_vector_embeddings_project_id ON vector_embeddings (project_id)")

    # HNSW indexes for fast approximate nearest neighbor search (cosine similarity)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_vector_embeddings_biomedical_cosine
        ON vector_embeddings
        USING hnsw (embedding_biomedical vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_vector_embeddings_general_cosine
        ON vector_embeddings
        USING hnsw (embedding_general vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)

    # Add vector_embedding_id FK to evidence table
    op.execute("""
        ALTER TABLE evidence
        ADD COLUMN IF NOT EXISTS vector_embedding_id UUID REFERENCES vector_embeddings(id) ON DELETE SET NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_evidence_vector_embedding_id ON evidence (vector_embedding_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_evidence_vector_embedding_id")
    op.execute("ALTER TABLE evidence DROP COLUMN IF EXISTS vector_embedding_id")
    op.execute("DROP INDEX IF EXISTS ix_vector_embeddings_general_cosine")
    op.execute("DROP INDEX IF EXISTS ix_vector_embeddings_biomedical_cosine")
    op.execute("DROP INDEX IF EXISTS ix_vector_embeddings_project_id")
    op.execute("DROP INDEX IF EXISTS ix_vector_embeddings_source_id")
    op.execute("DROP INDEX IF EXISTS ix_vector_embeddings_source_type")
    op.execute("DROP INDEX IF EXISTS ix_vector_embeddings_content_hash")
    op.execute("DROP TABLE IF EXISTS vector_embeddings")
    op.execute("DROP EXTENSION IF EXISTS vector")

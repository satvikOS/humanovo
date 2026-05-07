"""
Activity Model

Tracks user activities across the platform for timeline display.
"""

from sqlalchemy import Column, ForeignKey, String, Text, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from app.models.base import BaseModel


class Activity(BaseModel):
    __tablename__ = "activities"

    # Owner — see migration 016_owner_id_on_notebook_activity_ingestion.
    owner_id = Column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    type = Column(
        SAEnum(
            "project", "hypothesis", "evidence", "simulation",
            "notebook", "discovery",
            name="activity_type",
        ),
        nullable=False,
    )
    action = Column(
        SAEnum(
            "created", "updated", "completed", "validated",
            "rejected", "imported", "started", "deleted",
            name="activity_action",
        ),
        nullable=False,
    )
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    entity_id = Column(String(100), nullable=True)
    entity_type = Column(String(50), nullable=True)
    project_name = Column(String(200), nullable=True)
    extra_metadata = Column("metadata", JSONB, nullable=True, default={})
    annotation = Column(Text, nullable=True)

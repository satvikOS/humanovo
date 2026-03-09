"""
Activity Model

Tracks user activities across the platform for timeline display.
"""

from sqlalchemy import Column, String, Text, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB

from app.models.base import BaseModel


class Activity(BaseModel):
    __tablename__ = "activities"

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
    metadata = Column(JSONB, nullable=True, default={})
    annotation = Column(Text, nullable=True)

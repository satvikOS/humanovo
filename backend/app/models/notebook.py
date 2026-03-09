"""
Notebook Page Model

Stores researcher notebook pages with versioning support.
"""

from sqlalchemy import Column, String, Text, Integer, Enum as SAEnum
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from app.models.base import BaseModel


class NotebookPage(BaseModel):
    __tablename__ = "notebook_pages"

    title = Column(String(500), nullable=False, default="Untitled Page")
    content = Column(Text, nullable=False, default="")
    content_type = Column(
        SAEnum("markdown", "rich_text", "canvas", name="notebook_content_type"),
        nullable=False,
        default="markdown",
    )
    tags = Column(ARRAY(String), nullable=False, default=[])
    version = Column(Integer, nullable=False, default=1)
    versions = Column(JSONB, nullable=False, default=[])

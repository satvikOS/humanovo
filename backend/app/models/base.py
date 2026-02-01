"""
Base Model Classes

Provides base classes and mixins for all ORM models.
"""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import declarative_base, declared_attr

Base = declarative_base()


class TimestampMixin:
    """Mixin that adds created_at and updated_at columns."""

    @declared_attr
    def created_at(cls):
        return Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
        )

    @declared_attr
    def updated_at(cls):
        return Column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        )


class UUIDMixin:
    """Mixin that adds a UUID primary key."""

    @declared_attr
    def id(cls):
        return Column(
            PGUUID(as_uuid=True),
            primary_key=True,
            default=uuid4,
            nullable=False,
        )


class BaseModel(Base, UUIDMixin, TimestampMixin):
    """Abstract base model with UUID and timestamps."""

    __abstract__ = True

    def to_dict(self) -> dict[str, Any]:
        """Convert model to dictionary."""
        result = {}
        for column in self.__table__.columns:
            value = getattr(self, column.name)
            if isinstance(value, datetime):
                value = value.isoformat()
            elif isinstance(value, UUID):
                value = str(value)
            result[column.name] = value
        return result

    def update_from_dict(self, data: dict[str, Any]) -> None:
        """Update model from dictionary."""
        for key, value in data.items():
            if hasattr(self, key) and key not in ("id", "created_at"):
                setattr(self, key, value)

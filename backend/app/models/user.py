"""
User Model

User authentication and authorization model.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class UserRole(str, PyEnum):
    """User role enum."""

    ADMIN = "admin"
    RESEARCHER = "researcher"
    VIEWER = "viewer"


class User(BaseModel):
    """User model for authentication and authorization."""

    __tablename__ = "users"

    # Authentication fields
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)

    # Profile fields
    full_name = Column(String(255), nullable=True)
    organization = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)

    # Role and permissions
    role = Column(
        Enum(UserRole, name="user_role", values_callable=lambda x: [e.value for e in x]),
        default=UserRole.RESEARCHER,
        nullable=False,
    )
    permissions = Column(ARRAY(String), default=list, nullable=False)

    # Account status
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)

    # Security
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)

    # API access
    api_key_hash = Column(String(255), nullable=True, unique=True)
    api_key_created_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    projects = relationship("Project", back_populates="owner", lazy="dynamic")

    def __repr__(self) -> str:
        return f"<User {self.email}>"

    def has_permission(self, permission: str) -> bool:
        """Check if user has a specific permission."""
        if self.role == UserRole.ADMIN:
            return True
        return permission in self.permissions

    def is_locked(self) -> bool:
        """Check if account is locked."""
        if self.locked_until is None:
            return False
        return datetime.utcnow() < self.locked_until

    def can_access_project(self, project_id: UUID) -> bool:
        """Check if user can access a project."""
        if self.role == UserRole.ADMIN:
            return True
        return any(p.id == project_id for p in self.projects)

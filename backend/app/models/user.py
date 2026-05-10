"""
User Model

User authentication and authorization model.
"""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

from app.models.base import BaseModel


class UserRole(StrEnum):
    """User role enum."""

    ADMIN = "admin"
    RESEARCHER = "researcher"
    VIEWER = "viewer"


class UserTier(StrEnum):
    """Pricing-tier enum. Authoritative cap mapping lives in
    `app.services.budget_enforcer_service.TIER_MONTHLY_CAP_CENTS`;
    this enum names the rows. Migration 014_user_pricing_tier creates
    the matching Postgres type."""

    TRIAL = "trial"
    RESEARCHER = "researcher"
    LAB = "lab"
    INSTITUTION = "institution"


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

    # Pricing tier — drives the budget enforcer's per-month cap. See
    # AWS_INFRASTRUCTURE_PLAN.md §2.3 for the cap math.
    tier = Column(
        Enum(UserTier, name="user_tier", values_callable=lambda x: [e.value for e in x]),
        default=UserTier.TRIAL,
        nullable=False,
        index=True,
    )

    # Account status
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)

    # GDPR Art. 17 (right to erasure). When the user clicks
    # "Delete my account" we populate delete_requested_at + flip
    # is_active=False. A daily cron picks up rows where
    # delete_requested_at < now() - 30 days and hard-deletes
    # cascading user data; deleted_at then records when the
    # hard-delete actually fired. See migration 024_user_soft_delete.
    delete_requested_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    # First-run onboarding wizard gate. New signups land at FALSE so
    # the wizard fires once; the wizard's "skip" / "finish" handlers
    # PATCH this to TRUE. See migration 022 for the column-level
    # default (TRUE for existing rows so we don't dunk them into a
    # wizard unprompted post-deploy).
    has_completed_onboarding = Column(Boolean, default=False, nullable=False)

    # Security
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)

    # API access
    api_key_hash = Column(String(255), nullable=True, unique=True)
    api_key_created_at = Column(DateTime(timezone=True), nullable=True)

    # Stripe billing — see migration 017_stripe_customer_subscription.
    # `tier` (above) is humanovo's authoritative tier; these three
    # columns are Stripe's view of the same subscription, kept in sync
    # by the webhook handler in app.services.stripe_service. A user
    # with `tier=trial` and NULL stripe_subscription_id is the normal
    # free state; admin-comp'd accounts are `tier=lab/institution`
    # with NULL stripe_subscription_id (no Stripe record).
    stripe_customer_id = Column(String(64), nullable=True, unique=True)
    stripe_subscription_id = Column(String(64), nullable=True, index=True)
    stripe_subscription_status = Column(String(32), nullable=True)

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
        return datetime.now(UTC) < self.locked_until

    def can_access_project(self, project_id: UUID) -> bool:
        """Check if user can access a project."""
        if self.role == UserRole.ADMIN:
            return True
        return any(p.id == project_id for p in self.projects)

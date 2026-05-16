"""
Authentication Module

JWT-based authentication for humanovo.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.user import User, UserRole

logger = get_logger(__name__)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES

# Security scheme
security = HTTPBearer(auto_error=False)


class Token(BaseModel):
    """Token response model."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenData(BaseModel):
    """Token payload data."""
    user_id: UUID
    email: str
    role: str
    exp: datetime


class UserCreate(BaseModel):
    """User registration schema."""
    email: str
    password: str
    full_name: str | None = None


class UserLogin(BaseModel):
    """User login schema."""
    email: str
    password: str


class UserResponse(BaseModel):
    """User response schema."""
    id: UUID
    email: str
    full_name: str | None
    role: str
    is_active: bool
    is_verified: bool
    has_completed_onboarding: bool = False
    created_at: datetime
    # Surfaced so the frontend can render the trial-countdown banner
    # and the upgrade-flow current-tier badge without a second API
    # round-trip. `tier` defaults to 'trial' for legacy rows missing
    # the column; `trial_ends_at` is null when the user has already
    # converted or never had a trial set.
    tier: str = "trial"
    trial_ends_at: datetime | None = None

    model_config = {"from_attributes": True}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)


def create_access_token(user: User, expires_delta: timedelta | None = None) -> str:
    """Create a JWT access token."""
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value if isinstance(user.role, UserRole) else user.role,
        "exp": expire,
    }

    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY.get_secret_value(),
        algorithm=ALGORITHM,
    )
    return encoded_jwt


def decode_token(token: str) -> TokenData | None:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY.get_secret_value(),
            algorithms=[ALGORITHM],
        )
        user_id = payload.get("sub")
        email = payload.get("email")
        role = payload.get("role")
        exp = payload.get("exp")

        if user_id is None or email is None:
            return None

        return TokenData(
            user_id=UUID(user_id),
            email=email,
            role=role,
            exp=datetime.fromtimestamp(exp),
        )
    except JWTError:
        return None


async def get_current_user(
    # Annotated as bare `Request` (not `Request | None`) so FastAPI
    # special-cases it as an injected param. A `Request | None` union
    # makes FastAPI 0.136+ try to build a Pydantic field from it and
    # raise FastAPIError at app import. The `= None` default keeps the
    # function directly callable outside an HTTP cycle (ws + tests).
    request: Request = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Get the current authenticated user.

    Two paths:

      1. JWT bearer (interactive login). Grants ALL scopes the user's
         role implies; `request.state.granted_scopes` is set to None
         (meaning "no scope restriction").

      2. API key bearer (`apikey_*` token, Phase 2.1). Verifies
         against user_api_keys, returns the owning user, and stashes
         the granted scopes on `request.state.granted_scopes`. Routes
         that need a specific scope use `require_scope("name")` to
         check.

    The token discriminator is the literal `apikey_` prefix — JWTs
    don't start with that, so the branch is unambiguous."""
    if not credentials:
        return None

    raw = credentials.credentials
    # ─── API key path ────────────────────────────────────────
    if raw.startswith("apikey_"):
        # Local import — avoids a circular at module load (auth ←
        # api_key_service imports nothing from auth, but the import
        # graph during FastAPI startup is fragile).
        from app.services.api_key_service import verify_and_get_user_with_scopes

        verification = await verify_and_get_user_with_scopes(db, raw_token=raw)
        if verification is None:
            return None
        result = await db.execute(select(User).where(User.id == verification.user_id))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            return None
        # Stash the granted scopes so require_scope() can read them.
        # `request` is None when the dependency is invoked outside an
        # HTTP cycle (rare; only ws + tests). Use a getattr-guarded
        # access so the stash is best-effort.
        if request is not None:
            try:
                request.state.granted_scopes = verification.scopes
                request.state.api_key_id = verification.key_id
            except Exception:
                pass
        return user

    # ─── JWT path ────────────────────────────────────────────
    token_data = decode_token(raw)
    if not token_data:
        return None
    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    # JWT carries full session powers — no scope restriction.
    if request is not None:
        try:
            request.state.granted_scopes = None
            request.state.api_key_id = None
        except Exception:
            pass
    return user


async def get_current_active_user(
    current_user: User | None = Depends(get_current_user),
) -> User:
    """Get current active user or raise exception."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """Get current admin user or raise exception."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


# ─── Router-level dependency lists ────────────────────────────────
#
# Apply at router construction time:
#
#     router = APIRouter(prefix="/projects", dependencies=AUTH_REQUIRED)
#
# rather than decorating each endpoint individually. This pattern is
# the source of truth for "this whole module requires auth" and makes
# the no-unauthenticated-endpoints CI guard trivial to enforce.
#
# Rules:
#   - AUTH_REQUIRED: any signed-in active user passes.
#   - ADMIN_REQUIRED: only role=ADMIN passes (returns 403 for non-admins,
#     401 for unauthenticated).
#
# Module-level constants (not list literals at the call site) so that
# the CI guard can identify routers that consume them by AST inspection.

AUTH_REQUIRED = [Depends(get_current_active_user)]
ADMIN_REQUIRED = [Depends(get_current_admin_user)]


def require_scope(scope: str):
    """Factory: returns a FastAPI dependency that enforces an API-key
    scope. JWT-authenticated callers bypass the check (a logged-in
    user already has full session powers).

    Usage:
        @router.post("/discovery/start", dependencies=[Depends(require_scope("discovery:write"))])

    The dependency reads `request.state.granted_scopes` populated by
    `get_current_user`. None there means JWT (no restriction); a list
    means API-key auth — the scope must be in that list."""
    async def _check(
        request: Request,
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        granted = getattr(request.state, "granted_scopes", None)
        if granted is None:
            # JWT session — full powers.
            return current_user
        if scope not in granted:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"API key missing required scope '{scope}'. "
                    f"Granted: {granted}."
                ),
            )
        return current_user

    return _check


# ─── WebSocket authentication ─────────────────────────────────────
#
# WebSocket handshakes can't carry custom Authorization headers from a
# browser, so the convention is `?token=<jwt>` in the connect URL. The
# helper below validates the token and resolves the User row before any
# `await websocket.accept()` lands. On failure it closes the socket
# with RFC 6455 code 1008 (Policy Violation) and returns None — the
# handler can early-return without further work.
#
# Frontend pairing:  see `frontend/src/services/auth.ts::wsUrl(path)`

from fastapi import WebSocket  # noqa: E402  (kept here for cohesion)


async def authenticate_websocket(
    websocket: WebSocket,
    db: AsyncSession,
) -> User | None:
    """Validate a WS connection's `?token=` query param. Closes the
    socket and returns None on any failure (missing/invalid token,
    inactive/missing user). Caller pattern:

        user = await authenticate_websocket(websocket, db)
        if user is None:
            return  # socket already closed
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="missing token")
        return None

    token_data = decode_token(token)
    if token_data is None:
        await websocket.close(code=1008, reason="invalid token")
        return None

    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        await websocket.close(code=1008, reason="user inactive")
        return None

    return user


async def authenticate_user(
    email: str,
    password: str,
    db: AsyncSession,
) -> User | None:
    """Authenticate a user by email and password."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        return None

    if not verify_password(password, user.hashed_password):
        return None

    return user


async def create_user(
    user_data: UserCreate,
    db: AsyncSession,
    role: UserRole = UserRole.RESEARCHER,
    *,
    trial_days: int = 14,
) -> User:
    """Create a new user.

    Starts a `trial_days` free trial by default (14 days). The
    trial-expiry cron (Phase 2.7) fires day-3 warning + day-of
    downgrade emails from this timestamp. A successful Stripe
    checkout clears trial_ends_at (Phase 2.8) so the user drops
    out of the cron's queue immediately on conversion.

    Pass `trial_days=0` for admin-created accounts that shouldn't
    start a trial (e.g. comp'd institutional accounts).
    """
    from datetime import UTC, datetime, timedelta

    # Check if user exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    existing = result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    hashed_password = get_password_hash(user_data.password)

    trial_ends_at = (
        datetime.now(UTC) + timedelta(days=trial_days)
        if trial_days > 0 else None
    )

    user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        full_name=user_data.full_name,
        role=role,
        is_active=True,
        is_verified=False,
        trial_ends_at=trial_ends_at,
    )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    logger.info(
        "User created", user_id=str(user.id), email=user.email,
        trial_ends_at=trial_ends_at.isoformat() if trial_ends_at else None,
    )
    return user

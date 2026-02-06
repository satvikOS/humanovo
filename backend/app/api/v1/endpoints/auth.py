"""
Authentication API Endpoints

Login, registration, and user management.
"""

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    Token,
    UserCreate,
    UserLogin,
    UserResponse,
    authenticate_user,
    create_access_token,
    create_user,
    get_current_active_user,
    get_current_admin_user,
    get_password_hash,
)
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.user import User, UserRole

logger = get_logger(__name__)
router = APIRouter()


class RegisterRequest(BaseModel):
    """Registration request schema."""
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class LoginRequest(BaseModel):
    """Login request schema."""
    email: EmailStr
    password: str


class PasswordChangeRequest(BaseModel):
    """Password change request."""
    current_password: str
    new_password: str


class UserUpdateRequest(BaseModel):
    """User update request."""
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """
    Register a new user.

    Creates a new user account with researcher role.
    """
    try:
        user = await create_user(
            UserCreate(
                email=request.email,
                password=request.password,
                full_name=request.full_name,
            ),
            db,
            role=UserRole.RESEARCHER,
        )

        return UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role.value,
            is_active=user.is_active,
            is_verified=user.is_verified,
            created_at=user.created_at,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Registration failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed",
        )


@router.post("/login", response_model=Token)
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Token:
    """
    Login and get access token.

    Returns a JWT token for authenticated API access.
    """
    user = await authenticate_user(request.email, request.password, db)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    access_token = create_access_token(
        user,
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    logger.info("User logged in", user_id=str(user.id))

    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
) -> UserResponse:
    """
    Get current user information.

    Returns the authenticated user's profile.
    """
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role.value if isinstance(current_user.role, UserRole) else current_user.role,
        is_active=current_user.is_active,
        is_verified=current_user.is_verified,
        created_at=current_user.created_at,
    )


@router.patch("/me", response_model=UserResponse)
async def update_current_user(
    request: UserUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """
    Update current user profile.
    """
    update_data = request.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(current_user, key, value)

    await db.commit()
    await db.refresh(current_user)

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role.value if isinstance(current_user.role, UserRole) else current_user.role,
        is_active=current_user.is_active,
        is_verified=current_user.is_verified,
        created_at=current_user.created_at,
    )


@router.post("/change-password")
async def change_password(
    request: PasswordChangeRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Change current user's password.
    """
    from app.core.auth import verify_password

    if not verify_password(request.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    current_user.hashed_password = get_password_hash(request.new_password)
    await db.commit()

    logger.info("Password changed", user_id=str(current_user.id))

    return {"message": "Password changed successfully"}


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """
    Logout (client should discard token).

    Note: JWT tokens can't be invalidated server-side without
    a token blacklist. The client should discard the token.
    """
    logger.info("User logged out", user_id=str(current_user.id))
    return {"message": "Logged out successfully"}


# Admin endpoints
@router.get("/users", response_model=list[UserResponse])
async def list_users(
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserResponse]:
    """
    List all users (admin only).
    """
    from sqlalchemy import select

    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()

    return [
        UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role.value if isinstance(user.role, UserRole) else user.role,
            is_active=user.is_active,
            is_verified=user.is_verified,
            created_at=user.created_at,
        )
        for user in users
    ]

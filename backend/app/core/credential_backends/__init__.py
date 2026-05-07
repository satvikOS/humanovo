"""Credential backends — pluggable storage for the CredentialPool."""

from app.core.credential_backends.secrets_manager import (
    PromptSecretsManagerBackend,
    SecretsManagerCredentialBackend,
)

__all__ = [
    "PromptSecretsManagerBackend",
    "SecretsManagerCredentialBackend",
]

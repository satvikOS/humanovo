"""Tests for app.core.credential_backends.secrets_manager.

Uses moto to mock AWS Secrets Manager so the round-trip is exercised
without a real AWS account.
"""

from __future__ import annotations

import boto3
import pytest

# moto 5.x renamed mock_aws into the top-level package.
try:  # pragma: no cover
    from moto import mock_aws
except ImportError:  # moto < 5
    from moto import mock_secretsmanager as mock_aws  # type: ignore

from app.agents.prompt_loader import PromptBackendError
from app.core.credential_backends.secrets_manager import (
    PromptSecretsManagerBackend,
    SecretsManagerCredentialBackend,
)

REGION = "us-east-1"


# ---------------------------------------------------------------------------
# PromptSecretsManagerBackend
# ---------------------------------------------------------------------------


@mock_aws
def test_prompt_backend_round_trip():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/prompts/stage.seed",
        SecretString="seed prompt v1",
    )
    backend = PromptSecretsManagerBackend(REGION, client=sm)
    assert backend.get("stage.seed", "v1") == "seed prompt v1"


@mock_aws
def test_prompt_backend_unknown_id_raises():
    sm = boto3.client("secretsmanager", region_name=REGION)
    backend = PromptSecretsManagerBackend(REGION, client=sm)
    with pytest.raises(PromptBackendError):
        backend.get("nonexistent.prompt", "v1")


@mock_aws
def test_prompt_backend_missing_secret_raises():
    sm = boto3.client("secretsmanager", region_name=REGION)
    backend = PromptSecretsManagerBackend(REGION, client=sm)
    with pytest.raises(PromptBackendError):
        # stage.seed is a known prompt_id but the secret doesn't exist
        backend.get("stage.seed", "v1")


@mock_aws
def test_prompt_backend_falls_back_to_awscurrent():
    """When the requested version stage isn't present, fall back to AWSCURRENT."""
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/prompts/stage.expand",
        SecretString="expand v0",
    )
    backend = PromptSecretsManagerBackend(REGION, client=sm)
    # Request "v3" — moto won't have that version stage, so AWSCURRENT should win.
    assert backend.get("stage.expand", "v3") == "expand v0"


@mock_aws
def test_prompt_backend_custom_prefix():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="custom/p/stage.score",
        SecretString="score-text",
    )
    backend = PromptSecretsManagerBackend(REGION, prefix="custom/p", client=sm)
    assert backend.get("stage.score", "v1") == "score-text"


# ---------------------------------------------------------------------------
# SecretsManagerCredentialBackend
# ---------------------------------------------------------------------------


@mock_aws
def test_credential_backend_lists_active_keys():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/bedrock/k1",
        SecretString="secret-1",
        Tags=[{"Key": "status", "Value": "active"}, {"Key": "rpm_limit", "Value": "200"}],
    )
    sm.create_secret(
        Name="humanovo/keys/bedrock/k2",
        SecretString="secret-2",
        Tags=[{"Key": "status", "Value": "active"}, {"Key": "rpm_limit", "Value": "100"}],
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("bedrock")
    assert len(keys) == 2
    by_id = {k.key_id: k for k in keys}
    assert by_id["k1"].api_key == "secret-1"
    assert by_id["k1"].status == "active"
    assert by_id["k1"].rpm_limit == 200
    assert by_id["k2"].rpm_limit == 100


@mock_aws
def test_credential_backend_returns_empty_when_pool_unpopulated():
    sm = boto3.client("secretsmanager", region_name=REGION)
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    assert backend.list_keys("never-created") == []


@mock_aws
def test_credential_backend_default_status_is_active_when_tag_missing():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/azure-gpt4/k1",
        SecretString="x",
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("azure-gpt4")
    assert len(keys) == 1
    assert keys[0].status == "active"


@mock_aws
def test_credential_backend_parses_status_tag():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/bedrock/k1",
        SecretString="x",
        Tags=[{"Key": "status", "Value": "draining"}],
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("bedrock")
    assert len(keys) == 1
    assert keys[0].status == "draining"


@mock_aws
def test_credential_backend_parses_expiry_tag():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/bedrock/k1",
        SecretString="x",
        Tags=[
            {"Key": "status", "Value": "active"},
            {"Key": "expires_at", "Value": "2026-08-04T00:00:00Z"},
        ],
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("bedrock")
    assert len(keys) == 1
    assert keys[0].expires_at is not None
    # Parsed timestamp should be roughly Aug 4 2026 → ~1.78e9 seconds.
    assert 1_780_000_000 < keys[0].expires_at < 1_790_000_000


@mock_aws
def test_credential_backend_emergency_revoke():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/bedrock/k1",
        SecretString="x",
        Tags=[{"Key": "status", "Value": "active"}, {"Key": "rpm_limit", "Value": "200"}],
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    backend.emergency_revoke("bedrock", "k1")

    keys = backend.list_keys("bedrock")
    assert len(keys) == 1
    assert keys[0].status == "revoked"
    # Other tags are preserved.
    assert keys[0].rpm_limit == 200


@mock_aws
def test_credential_backend_emergency_revoke_missing_secret_is_noop():
    sm = boto3.client("secretsmanager", region_name=REGION)
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    # Should not raise.
    backend.emergency_revoke("bedrock", "ghost-key")


@mock_aws
def test_credential_backend_invalid_expiry_tag_falls_back_to_none():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/bedrock/k1",
        SecretString="x",
        Tags=[{"Key": "status", "Value": "active"}, {"Key": "expires_at", "Value": "not-a-date"}],
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("bedrock")
    assert len(keys) == 1
    assert keys[0].expires_at is None


@mock_aws
def test_credential_backend_invalid_rpm_tag_uses_default():
    sm = boto3.client("secretsmanager", region_name=REGION)
    sm.create_secret(
        Name="humanovo/keys/bedrock/k1",
        SecretString="x",
        Tags=[{"Key": "status", "Value": "active"}, {"Key": "rpm_limit", "Value": "not-an-int"}],
    )
    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("bedrock")
    assert keys[0].rpm_limit == 1_000  # default


@mock_aws
def test_credential_backend_only_returns_keys_under_prefix():
    sm = boto3.client("secretsmanager", region_name=REGION)
    # Pool we're listing
    sm.create_secret(Name="humanovo/keys/bedrock/k1", SecretString="x")
    # Different pool — must not appear
    sm.create_secret(Name="humanovo/keys/azure/k1", SecretString="y")
    # Different prefix entirely
    sm.create_secret(Name="humanovo/prompts/stage.seed", SecretString="z")

    backend = SecretsManagerCredentialBackend(REGION, client=sm)
    keys = backend.list_keys("bedrock")
    assert [k.key_id for k in keys] == ["k1"]
    assert keys[0].api_key == "x"

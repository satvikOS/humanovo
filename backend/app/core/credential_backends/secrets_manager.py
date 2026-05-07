"""
AWS Secrets Manager backends for the PromptLoader and CredentialPool.

Two backends share the same underlying boto3 client wiring:

  - ``PromptSecretsManagerBackend`` — implements ``PromptBackend`` for
    serving prompt text from Secrets Manager. Lands in
    Sprint 1 / Day 2-3 once the AWS sandbox account is provisioned.
    Until then, the in-memory ``MockBackend`` from ``prompt_loader``
    is the test-time substitute.

  - ``SecretsManagerCredentialBackend`` — implements
    ``CredentialBackend`` for serving the upstream API-key pools. Lands
    in Sprint 2 / D9-12 when the rotation Lambda is wired.

Both backends use boto3's ``secretsmanager`` client lazily so importing
this module does not touch AWS — that matters for the dep-completeness
guard test which imports every module on a fresh interpreter without
credentials.

Naming convention (matches the rotation Lambda we ship in Sprint 2):

  Prompts:      humanovo/prompts/{prompt_id}                 → SecretString
                                                               (one secret per prompt;
                                                                versioning via Secrets
                                                                Manager's native VersionStage
                                                                so we can pin v1 / v2 cleanly)

  Credentials:  humanovo/keys/{pool_name}/{key_id}           → SecretString
                                                               (one secret per key in the
                                                                pool; tags on the secret
                                                                hold the per-key state:
                                                                status=active|draining|revoked,
                                                                expires_at=ISO8601)

Tests cover the round trip against a moto-mocked Secrets Manager so the
module is exercise-tested before the real AWS account exists.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from app.agents.prompt_loader import PromptBackend, PromptBackendError, PROMPT_IDS
from app.core.credential_pool import CredentialBackend, KeySpec
from app.core.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover
    pass

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _import_boto3():
    """Defer the boto3 import so this module loads without aws creds."""
    import boto3  # type: ignore

    return boto3


def _build_client(region_name: str):
    """Construct a boto3 secretsmanager client. Tests patch the factory."""
    return _import_boto3().client("secretsmanager", region_name=region_name)


# ---------------------------------------------------------------------------
# PromptBackend implementation
# ---------------------------------------------------------------------------


class PromptSecretsManagerBackend(PromptBackend):
    """Resolves prompts from AWS Secrets Manager.

    Layout: ``{prefix}/{prompt_id}`` with version stages mapping to the
    caller's ``version`` argument (e.g. "v1", "v2") plus the standard
    ``AWSCURRENT``. Falls back to the ``AWSCURRENT`` value when the
    requested version stage is not present so callers don't have to
    pre-populate every prompt at every version.
    """

    def __init__(
        self,
        region_name: str,
        prefix: str = "humanovo/prompts",
        client=None,
    ):
        self._region = region_name
        self._prefix = prefix
        self._client = client  # injectable for tests

    def _client_lazy(self):
        if self._client is None:
            self._client = _build_client(self._region)
        return self._client

    def _secret_name(self, prompt_id: str) -> str:
        return f"{self._prefix}/{prompt_id}"

    def get(self, prompt_id: str, version: str) -> str:
        if prompt_id not in PROMPT_IDS:
            raise PromptBackendError(f"unknown prompt_id: {prompt_id}")

        client = self._client_lazy()
        name = self._secret_name(prompt_id)

        # Try the exact version stage first; fall back to AWSCURRENT.
        for stage in (version, "AWSCURRENT"):
            try:
                resp = client.get_secret_value(SecretId=name, VersionStage=stage)
            except client.exceptions.ResourceNotFoundException as exc:
                logger.warning(
                    "secret not found",
                    secret_name=name,
                    version_stage=stage,
                    error=str(exc),
                )
                # Try next stage
                continue
            except client.exceptions.InvalidRequestException:
                # Stage doesn't exist for this secret; try next.
                continue
            secret_string = resp.get("SecretString")
            if secret_string is None:
                continue
            return secret_string

        raise PromptBackendError(
            f"prompt unavailable in Secrets Manager: {prompt_id}@{version}"
        )


# ---------------------------------------------------------------------------
# CredentialBackend implementation
# ---------------------------------------------------------------------------


class SecretsManagerCredentialBackend(CredentialBackend):
    """Resolves credential pools from AWS Secrets Manager.

    A "pool" is materialized as one secret per key, all under the
    prefix ``{prefix}/{pool_name}/``. Per-key state (status / expiry /
    rate-limit hints) lives in the secret's tags so the rotation
    Lambda can update them without re-writing the secret value.

    Tags read on each call (tag keys are case-insensitive in AWS; we
    standardize on snake_case):

      - status           : "active" | "draining" | "revoked"
      - expires_at       : ISO8601 timestamp (optional; missing = no expiry)
      - rpm_limit        : integer (optional; default 1000)
      - tpm_limit        : integer (optional; default 1_000_000)

    Secrets without a status tag default to ``active`` so a freshly
    created secret works immediately.
    """

    def __init__(
        self,
        region_name: str,
        prefix: str = "humanovo/keys",
        client=None,
    ):
        self._region = region_name
        self._prefix = prefix
        self._client = client  # injectable for tests

    def _client_lazy(self):
        if self._client is None:
            self._client = _build_client(self._region)
        return self._client

    def _pool_prefix(self, pool_name: str) -> str:
        return f"{self._prefix}/{pool_name}/"

    def list_keys(self, pool_name: str) -> list[KeySpec]:
        client = self._client_lazy()
        prefix = self._pool_prefix(pool_name)

        # list_secrets paginates; collect everything under the prefix.
        secrets: list[dict] = []
        next_token: Optional[str] = None
        while True:
            kwargs = {
                "Filters": [
                    {"Key": "name", "Values": [prefix]},
                ],
                "MaxResults": 100,
            }
            if next_token:
                kwargs["NextToken"] = next_token
            resp = client.list_secrets(**kwargs)
            secrets.extend(resp.get("SecretList", []) or [])
            next_token = resp.get("NextToken")
            if not next_token:
                break

        result: list[KeySpec] = []
        for s in secrets:
            name = s.get("Name") or ""
            if not name.startswith(prefix):
                continue  # defensive — list_secrets prefix filter is "starts-with"
            key_id = name[len(prefix):]
            tags = {t["Key"]: t["Value"] for t in (s.get("Tags") or [])}
            status = tags.get("status", "active").lower()
            expires_at = _parse_iso8601(tags.get("expires_at"))
            rpm_limit = _parse_int(tags.get("rpm_limit"), default=1_000)
            tpm_limit = _parse_int(tags.get("tpm_limit"), default=1_000_000)

            try:
                value_resp = client.get_secret_value(SecretId=name)
            except client.exceptions.ResourceNotFoundException:
                # Listed but already gone — race with the rotation Lambda.
                continue
            secret_string = value_resp.get("SecretString")
            if not secret_string:
                continue

            result.append(
                KeySpec(
                    key_id=key_id,
                    api_key=secret_string,
                    status=status,
                    rpm_limit=rpm_limit,
                    tpm_limit=tpm_limit,
                    expires_at=expires_at,
                )
            )
        return result

    def emergency_revoke(self, pool_name: str, key_id: str) -> None:
        client = self._client_lazy()
        secret_name = f"{self._pool_prefix(pool_name)}{key_id}"
        try:
            existing = client.describe_secret(SecretId=secret_name)
        except client.exceptions.ResourceNotFoundException:
            logger.warning(
                "emergency_revoke: secret not found",
                pool_name=pool_name,
                key_id=key_id,
            )
            return
        # Replace the status tag without disturbing the others.
        old_tags = {t["Key"]: t["Value"] for t in (existing.get("Tags") or [])}
        old_tags["status"] = "revoked"
        client.tag_resource(
            SecretId=secret_name,
            Tags=[{"Key": k, "Value": v} for k, v in old_tags.items()],
        )
        logger.warning(
            "emergency_revoke applied",
            pool_name=pool_name,
            key_id=key_id,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_iso8601(value: Optional[str]) -> Optional[float]:
    """Parse an ISO8601 timestamp tag value to epoch seconds; None on failure."""
    if not value:
        return None
    try:
        # Python's datetime.fromisoformat supports many common shapes.
        # Accept "Z" suffix by translating to +00:00.
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        return dt.timestamp()
    except ValueError:
        logger.warning("could not parse expires_at tag", value=value)
        return None


def _parse_int(value: Optional[str], default: int) -> int:
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default

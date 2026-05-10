"""
Humanovo Configuration Module

Centralized configuration management using Pydantic Settings.
Supports environment variables, .env files, and AWS Secrets Manager.
"""

import json
import logging
import os
from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_ENVIRONMENTS = {"development", "dev", "test", "testing", "local"}
_INSECURE_SECRET_KEYS = {
    "",
    "change-this-in-production",
    "change-this-to-a-random-64-char-string",
    "dev-secret-key-do-not-use-in-prod-32chars-long-please",
}
_PLACEHOLDER_PUBMED_EMAILS = {
    "",
    "humanovo@example.com",
    "your-email@institution.edu",
    "your-email@example.com",
}

logger = logging.getLogger(__name__)


# ─── AWS Secrets Manager loader ─────────────────────────────────────
#
# When the Lambda is provisioned (see infrastructure/terraform/backend),
# Terraform sets SECRETS_MANAGER_NAME=humanovo/prod/app on the function.
# At cold-start we fetch that JSON blob once and merge the keys into
# the process environment BEFORE pydantic-settings reads them, so the
# existing field names (STRIPE_SECRET_KEY, etc.) keep working without
# a separate "secrets" namespace.
#
# Local dev never sets SECRETS_MANAGER_NAME, so the .env-based loader
# remains the default — boto3 isn't even imported.

_SECRETS_FETCHED: dict[str, str] | None = None


def _fetch_secret_json(secret_name: str) -> dict[str, str]:
    """Fetch a JSON blob from AWS Secrets Manager. Returns {} on failure.

    Cold-start cost only — the result is module-level cached via the
    `_SECRETS_FETCHED` sentinel so warm Lambda invocations don't re-call
    Secrets Manager. Failures degrade silently to {} so a misconfigured
    permission can't take the whole app down at import time; the error
    is logged and individual settings will fall back to env defaults.
    """
    try:
        import boto3  # local import: avoid the dependency in dev when unused
    except ImportError:
        logger.warning(
            "SECRETS_MANAGER_NAME=%s set but boto3 not installed — skipping",
            secret_name,
        )
        return {}

    try:
        client = boto3.client(
            "secretsmanager",
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
        resp = client.get_secret_value(SecretId=secret_name)
        raw = resp.get("SecretString", "{}")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            logger.warning("Secret %s is not a JSON object — skipping", secret_name)
            return {}
        # Coerce all values to strings so they're env-var safe. Empty
        # placeholders ("REPLACE_ME", "") get filtered so they don't
        # override real values from .env in mixed-mode setups.
        return {str(k): str(v) for k, v in parsed.items() if v not in (None, "")}
    except Exception as exc:  # noqa: BLE001 — we genuinely want to swallow
        logger.error(
            "Failed to fetch secret %s from Secrets Manager: %s",
            secret_name,
            exc,
        )
        return {}


def _load_aws_secrets_into_env() -> None:
    """Populate os.environ from Secrets Manager (one-shot, idempotent).

    Mapped keys follow the convention used by the Terraform stack
    (`infrastructure/terraform/backend/main.tf`): the JSON blob in
    `humanovo/prod/app` carries lowercase keys (`jwt_secret_key`,
    `stripe_secret_key`, etc.) which we map to the uppercase Settings
    field names.
    """
    global _SECRETS_FETCHED
    if _SECRETS_FETCHED is not None:
        return  # already loaded

    secret_name = os.environ.get("SECRETS_MANAGER_NAME")
    if not secret_name:
        _SECRETS_FETCHED = {}
        return

    blob = _fetch_secret_json(secret_name)

    # Map the canonical lowercase keys in the secret blob to the
    # uppercase env-var names pydantic-settings reads. Everything in
    # `extra_keys` is also passed through verbatim (uppercased) so a
    # forward-compatible secret schema doesn't require a code change.
    canonical_map: dict[str, str] = {
        "jwt_secret_key": "SECRET_KEY",
        "stripe_secret_key": "STRIPE_SECRET_KEY",
        "anthropic_api_key": "ANTHROPIC_API_KEY",
        "openai_api_key": "OPENAI_API_KEY",
        "auth0_domain": "AUTH0_DOMAIN",
        "auth0_client_id": "AUTH0_CLIENT_ID",
        "auth0_client_secret": "AUTH0_CLIENT_SECRET",
    }

    for raw_key, value in blob.items():
        target = canonical_map.get(raw_key, raw_key.upper())
        # Don't clobber an explicitly-set env var (e.g. operator override
        # for incident response). Secrets Manager is the default source,
        # not the override.
        if target not in os.environ:
            os.environ[target] = value

    # Optionally also fetch the DB + Redis secrets so the URLs can be
    # assembled from secret material instead of raw env vars. Both are
    # always-required in the Lambda environment, so a missing one is
    # logged but not fatal.
    db_secret_name = os.environ.get("DB_SECRET_NAME")
    if db_secret_name:
        db_blob = _fetch_secret_json(db_secret_name)
        if db_blob and "DATABASE_URL" not in os.environ:
            host = os.environ.get("RDS_PROXY_HOST") or db_blob.get("host", "")
            user = db_blob.get("username", "humanovo")
            pwd = db_blob.get("password", "")
            dbname = db_blob.get("dbname", "humanovo")
            port = db_blob.get("port", "5432")
            if host and pwd:
                os.environ["DATABASE_URL"] = (
                    f"postgresql+asyncpg://{user}:{pwd}@{host}:{port}/{dbname}"
                )

    redis_secret_name = os.environ.get("REDIS_SECRET_NAME")
    if redis_secret_name:
        redis_blob = _fetch_secret_json(redis_secret_name)
        if redis_blob and "REDIS_URL" not in os.environ:
            host = os.environ.get("REDIS_HOST") or redis_blob.get("host", "")
            token = redis_blob.get("auth_token", "")
            if host and token:
                # ElastiCache Serverless requires TLS — `rediss://`.
                os.environ["REDIS_URL"] = f"rediss://default:{token}@{host}:6379/0"

    _SECRETS_FETCHED = blob


# Run the loader at module import so pydantic-settings sees the merged
# environment when Settings() is instantiated below. Safe in dev: with
# SECRETS_MANAGER_NAME unset this is a single dict.get() that returns
# immediately.
_load_aws_secrets_into_env()


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "humanovo"
    VERSION: str = "0.1.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS
    CORS_ORIGINS: list[str] = Field(default=["http://localhost:3000", "http://localhost:5173"])

    # Database (PostgreSQL)
    DATABASE_URL: str = "postgresql+asyncpg://humanovo:humanovo@localhost:5432/humanovo"
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Neo4j (Graph Database)
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: SecretStr = SecretStr("neo4jpassword")

    # Vector Store (pgvector — PostgreSQL native)
    PGVECTOR_EMBEDDING_DIM_BIOMEDICAL: int = 1024   # Bedrock Cohere Embed v3
    PGVECTOR_EMBEDDING_DIM_GENERAL: int = 1536      # Azure text-embedding-3-large (spec: 1536d)
    PGVECTOR_SEARCH_WEIGHT_BIOMEDICAL: float = 0.6  # Weight for biomedical embedding in hybrid search
    PGVECTOR_SEARCH_WEIGHT_GENERAL: float = 0.4     # Weight for general embedding in hybrid search
    PGVECTOR_DEFAULT_SEARCH_LIMIT: int = 20
    PGVECTOR_INDEX_TYPE: str = "ivfflat"             # ivfflat or hnsw
    PGVECTOR_INDEX_LISTS: int = 100                  # Number of lists for IVFFlat index
    PGVECTOR_HNSW_M: int = 16                        # HNSW M parameter
    PGVECTOR_HNSW_EF_CONSTRUCTION: int = 64          # HNSW ef_construction

    # Azure OpenAI — legacy config (kept for backward compatibility)
    AZURE_OPENAI_API_KEY: SecretStr | None = None
    AZURE_OPENAI_ENDPOINT: str = ""  # e.g. https://<resource>.openai.azure.com
    AZURE_OPENAI_API_VERSION: str = "2024-12-01-preview"
    AZURE_OPENAI_DEPLOYMENT_O3_DEEP_RESEARCH: str = "o3-deep-research"
    AZURE_OPENAI_DEPLOYMENT_O1: str = "o1"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: str = "text-embedding-3-small"

    # Azure AI — model-specific endpoints (direct, no Foundry routing layer)
    # Each model deployed separately with its own endpoint URL + API key
    AZURE_MISTRAL_ENDPOINT: str = ""    # Full base_url from Azure
    AZURE_MISTRAL_KEY: SecretStr | None = None
    AZURE_MISTRAL_MODEL: str = "Mistral-Large-3"

    # Azure OpenAI — GPT-4o (dedicated Azure OpenAI resource)
    AZURE_GPT4O_ENDPOINT: str = ""     # Azure OpenAI resource URL (e.g. https://humanovo-gpt4o.openai.azure.com)
    AZURE_GPT4O_KEY: SecretStr | None = None
    AZURE_GPT4O_DEPLOYMENT: str = "gpt-4o"
    AZURE_GPT4O_API_VERSION: str = "2024-11-20"

    # Azure OpenAI — Cohere Command A (same resource, deployment-based routing)
    AZURE_COHERE_ENDPOINT: str = ""    # Azure OpenAI resource URL (e.g. https://humanovo-openai.cognitiveservices.azure.com)
    AZURE_COHERE_KEY: SecretStr | None = None
    AZURE_COHERE_DEPLOYMENT: str = "cohere-command-a"
    AZURE_COHERE_API_VERSION: str = "2024-05-01-preview"

    # Azure OpenAI — o3-mini (2.5M TPM / 250 RPM, reasoning model)
    AZURE_O3MINI_ENDPOINT: str = ""    # Azure OpenAI resource URL (e.g. https://humanovo-openai.cognitiveservices.azure.com)
    AZURE_O3MINI_KEY: SecretStr | None = None
    AZURE_O3MINI_DEPLOYMENT: str = "o3-mini"
    AZURE_O3MINI_API_VERSION: str = "2024-05-01-preview"

    # Azure OpenAI — GPT-4.1 (50K TPM / 50 RPM, latest GPT model)
    AZURE_GPT41_ENDPOINT: str = ""     # Azure OpenAI resource URL (e.g. https://humanovo-openai.cognitiveservices.azure.com)
    AZURE_GPT41_KEY: SecretStr | None = None
    AZURE_GPT41_DEPLOYMENT: str = "gpt-4.1"
    AZURE_GPT41_API_VERSION: str = "2024-05-01-preview"

    # Azure AI — Grok-4-1-fast-reasoning (Azure AI Foundry shared endpoint)
    AZURE_GROK_ENDPOINT: str = ""      # Azure AI Foundry URL (e.g. https://humanovo-openai.services.ai.azure.com)
    AZURE_GROK_KEY: SecretStr | None = None
    AZURE_GROK_MODEL: str = "grok-4-1-fast-reasoning"

    # Azure AI Foundry — unified single-project pattern (May 2026 onwards).
    # All deployments live under a single Foundry project; one key auths
    # all of them; deployment routing happens by deployment name. The
    # GitHub-secret names map directly to these envs:
    #   AZURE_AI_KEY               → AZURE_AI_FOUNDRY_KEY
    #   AZURE_AI_OPENAI_ENDPOINT   → AZURE_AI_FOUNDRY_OPENAI_ENDPOINT
    #   AZURE_AI_PROJECT_ENDPOINT  → AZURE_AI_FOUNDRY_PROJECT_ENDPOINT
    # When the Foundry project is configured, the per-deployment fields
    # above (AZURE_GPT4O_*, AZURE_O3MINI_*, etc.) are used as fallbacks
    # only — the orchestrator prefers the Foundry endpoint.
    AZURE_AI_FOUNDRY_KEY: SecretStr | None = None
    AZURE_AI_FOUNDRY_OPENAI_ENDPOINT: str = ""    # OpenAI-style chat/completions endpoint (e.g. https://<resource>.openai.azure.com)
    AZURE_AI_FOUNDRY_PROJECT_ENDPOINT: str = ""   # Project-level endpoint (e.g. https://<project>.services.ai.azure.com)
    AZURE_AI_FOUNDRY_API_VERSION: str = "2024-12-01-preview"

    # Foundry deployments — verified reachable via the Responses API
    # (`<base>/openai/v1/responses`) on 2026-05-10 by the AI integration
    # smoke. Pinned here so application code (agent orchestrator,
    # embeddings client) doesn't have to re-discover names at runtime.
    # These are deployment NAMES, not model IDs — Foundry routes by
    # the deployment-name segment in the Target URI.
    AZURE_FOUNDRY_DEPLOYMENT_GPT4O: str = "gpt-4o"
    AZURE_FOUNDRY_DEPLOYMENT_O4_MINI: str = "o4-mini"
    AZURE_FOUNDRY_DEPLOYMENT_EMBED_LARGE: str = "text-embedding-3-large"  # 3072 dims
    AZURE_FOUNDRY_DEPLOYMENT_EMBED_SMALL: str = "text-embedding-3-small"  # 1536 dims
    # Image-gen — different surface (no /openai/v1/responses), reserved
    # for the figure-generation pipeline; not invoked by the agent layer.
    AZURE_FOUNDRY_DEPLOYMENT_FLUX: str = "FLUX.2-pro"

    # AWS Bedrock (IAM user: humanovo-admin)
    AWS_ACCESS_KEY_ID: SecretStr | None = None
    AWS_SECRET_ACCESS_KEY: SecretStr | None = None
    AWS_REGION: str = "us-east-1"

    # Bedrock Model IDs — pinned to the highest version verified
    # working against the humanovo AWS account by the AI integration
    # smoke (see swarm_smoke._pick_bedrock_alias and ai_integration_smoke.py).
    # Auto-cycler in the smoke tries 4.6 first; if Bedrock account
    # access for 4.6 is enabled later, swap these to the 4.6 IDs.
    # As of 2026-05-10:
    #   • Opus: 4.6 not enabled on this account → 4.1 stays
    #   • Sonnet: 4.5 verified working (upgrade from 4.0)
    BEDROCK_MODEL_CLAUDE_OPUS: str = "us.anthropic.claude-opus-4-1-20250805-v1:0"
    BEDROCK_MODEL_CLAUDE_SONNET: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

    # Discovery Service Configuration
    DISCOVERY_LLM_PROVIDER: str = "azure_ai"  # azure_ai (primary), bedrock, azure (legacy)
    DISCOVERY_MAX_EVIDENCE_CHUNKS: int = 50
    DISCOVERY_MAX_GRAPH_PATHS: int = 100
    DISCOVERY_MIN_CONFIDENCE: float = 0.3

    # Parallel Token Pool Management
    TOKEN_POOL_MAX_CONCURRENT_REQUESTS: int = 200  # per model
    TOKEN_POOL_MAX_TOKENS_PER_MINUTE: int = 2_000_000  # total across all models
    TOKEN_POOL_RETRY_BACKOFF_BASE: float = 1.5
    TOKEN_POOL_RETRY_MAX_ATTEMPTS: int = 5
    TOKEN_POOL_AGENT_BATCH_SIZE: int = 50  # agents per dispatch batch

    # Sub-agent swarm — every one of the 12 discovery-pipeline stages
    # fans out to this many parallel sub-agents (each with a different
    # persona suffix on the system prompt) before aggregating into one
    # answer. Per-stage cost scales linearly with N.
    #
    # Default 25: empirically gives strong persona diversification at
    # ~1/12th the cost of N=300. Operators can raise to the
    # user-directed target of 300 by setting SUB_AGENTS_PER_STAGE in
    # the running env once budget gates + cost estimator are in place
    # and a few real runs at 25 have validated quality.
    #   • CI smoke: HUMANOVO_SUBAGENTS=4 in workflow env
    #   • Operator override: SUB_AGENTS_PER_STAGE=N or HUMANOVO_SUBAGENTS=N
    # max_concurrent caps RPM — Foundry o4-mini = 500 RPM = ~8 concurrent
    # comfortably; the 16 default leaves headroom for other concurrent
    # stages.
    SUB_AGENTS_PER_STAGE: int = 25
    SUB_AGENTS_MAX_CONCURRENT: int = 16

    # Per-run budget cap — the swarm checks this between stages and
    # aborts cleanly if the running cost would exceed the cap. Default
    # 200 cents ($2.00) per hypothesis is well above a measured N=25
    # run and well below a runaway N=300 run, so it acts as a circuit
    # breaker without choking normal traffic. Set to 0 to disable.
    BUDGET_PER_RUN_CENTS: int = 200
    # Soft warning threshold — log a warning when a running cost
    # exceeds this fraction of the cap. Doesn't abort.
    BUDGET_WARN_AT: float = 0.8

    # Parallel MCP (Model Context Protocol) Configuration
    # Distributes context windows across models to overcome per-model token limits
    MCP_ENABLED: bool = True
    MCP_MAX_CONTEXT_PER_MODEL: int = 128_000  # max tokens per model context window
    MCP_CONTEXT_OVERLAP: int = 2_000  # overlap tokens between model context shards
    MCP_PARALLEL_SHARDS: int = 4  # number of parallel context shards (one per model)
    MCP_SYNTHESIS_MODEL: str = "us.anthropic.claude-opus-4-6-v1:0"  # Claude Opus via Bedrock for final synthesis (200K context)
    MCP_CHUNK_STRATEGY: str = "semantic"  # semantic | fixed | sliding_window

    # Web-search backends (Google, Brave) were removed for v1. The
    # discovery pipeline grounds exclusively in open biomedical sources.
    # See docs/planning/SOURCES_ROADMAP.md for the v1 source set + the
    # roadmap toward 60+ open sources.

    # Knowledge-graph backend selector. Per product directive: "tech should
    # be from Apache AGE, but humanovo specific UIUX." When set to
    # 'apache_age' we use the AGEGraphStore (PostgreSQL-native, $0 infra);
    # 'neo4j' uses the existing Neo4j driver; 'auto' prefers AGE when the
    # extension is installed and transparently falls back to Neo4j.
    KG_GRAPH_BACKEND: str = "auto"   # auto | apache_age | neo4j

    # A3 Phase 2 — dual-write toggle. When True, every Neo4j write in
    # GraphStore + neo4j_population_service is mirrored to the
    # Postgres-backed PostgresGraphStore. Postgres failures log but do
    # not fail the request; Neo4j stays authoritative for reads until
    # Phase 3 flips KG_BACKEND. Set False to disable mirroring on a
    # hot-path issue without redeploying.
    KG_DUAL_WRITE: bool = True

    # A3 Phase 3 hook — `KG_BACKEND` will route reads to either the
    # Neo4j-backed GraphStore or the Postgres-backed PostgresGraphStore.
    # Phase 2 doesn't read this; the setting lives here so the value can
    # be flipped and observed (via the admin /kg/stats endpoint) before
    # Phase 3 wires the factory in.
    KG_BACKEND: str = "neo4j"  # neo4j | postgres

    # PubMed / Data Sources — NCBI requires a real contact email per
    # E-utilities ToU. Default is intentionally empty so dev callers get
    # a fail-fast when the env var isn't set; production environments are
    # blocked at startup by the validator below.
    PUBMED_EMAIL: str = ""
    PUBMED_API_KEY: SecretStr | None = None
    PUBMED_RATE_LIMIT: int = 10  # requests per second; PubMed allows
    # 3/s without an API key, 10/s with one — the RateLimiter still
    # protects us when the key isn't set because the source-side rate
    # limiter is more permissive than NCBI's, not less.

    # Europe PMC — polite-pool guidance is 10 req/s; no API key
    # required. We respect the same ceiling as PubMed by default so a
    # single env var change can dial both literature sources back if
    # we get rate-limited.
    EUROPEPMC_RATE_LIMIT: int = 10

    # Elsevier Scopus / ScienceDirect API
    ELSEVIER_API_KEY: str = ""  # Set via ELSEVIER_API_KEY env var or GitHub Actions secret

    # HCA (Human Cell Atlas) — public Azul service, no auth needed
    HCA_CLIENT_ID: str = ""  # Optional, for future OAuth; public access used by default

    # Embedding Grounding Configuration
    # Dual-model: Bedrock Cohere (biomedical) + Azure text-embedding-3-large (general)
    GROUNDING_EMBEDDING_PRIMARY: str = "cohere.embed-english-v3"  # Bedrock Cohere Embed v3 (1024d)
    GROUNDING_EMBEDDING_SECONDARY: str = "azure-text-embedding-3-large"  # Azure OpenAI (1536d)
    GROUNDING_SIMILARITY_THRESHOLD: float = 0.4  # Min cosine similarity for claim grounding
    GROUNDING_RAG_TOP_K: int = 8  # Top-K chunks retrieved per stage
    GROUNDING_GATE_ENABLED: bool = True  # Enable semantic similarity gating between stages
    # Per product directive ("every stage should be grounded 100% so that
    # relations are not hallucinated"), we run grounding on EVERY stage
    # (generative + analytical). STRICT mode rejects a stage output when
    # its grounding ratio falls below the threshold and forces the
    # pipeline to retry with a stricter "ground every claim" instruction.
    GROUNDING_STRICT_MODE: bool = True
    GROUNDING_STRICT_RATIO_MIN: float = 0.60  # stage fails if <60% claims grounded
    GROUNDING_STRICT_MAX_RETRIES: int = 2

    # Azure OpenAI Embedding — dedicated endpoint on cognitiveservices resource
    # Deployment: text-embedding-3-large (150K TPM, 900 RPM)
    # Resource: humanovo-openai.cognitiveservices.azure.com
    AZURE_EMBEDDING_ENDPOINT: str = ""  # e.g. https://humanovo-openai.cognitiveservices.azure.com
    AZURE_EMBEDDING_KEY: SecretStr | None = None
    AZURE_EMBEDDING_API_VERSION: str = "2023-05-15"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE: str = "text-embedding-3-large"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT_SMALL: str = "text-embedding-3-small"

    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Simulation
    SIMULATION_MAX_ITERATIONS: int = 10000
    SIMULATION_DEFAULT_ITERATIONS: int = 1000
    SIMULATION_TIMEOUT_SECONDS: int = 300

    # Agent Configuration
    AGENT_MAX_ITERATIONS: int = 20
    AGENT_TIMEOUT_SECONDS: int = 120
    AGENT_MAX_PARALLEL_SEARCHES: int = 5

    # Paper Generation Configuration
    PAPER_GENERATION_TIMEOUT_SECONDS: int = 1800  # 30 minutes hard limit
    PAPER_MIN_HYPOTHESES: int = 20  # Minimum hypotheses for rich paper
    PAPER_HYPOTHESIS_DIVERSITY: bool = True  # Ensure diverse complexity levels

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"

    # Security — see _validate_security_secrets() below; non-dev envs
    # block startup if SECRET_KEY is left at the placeholder.
    SECRET_KEY: SecretStr = SecretStr("change-this-in-production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # ─── Stripe billing ─────────────────────────────────────────────
    # All five values come from the Stripe dashboard. STRIPE_SECRET_KEY
    # is `sk_live_...` (or `sk_test_...` in dev); STRIPE_WEBHOOK_SECRET
    # is `whsec_...` from the webhook endpoint settings. The three
    # PRICE_* values are the IDs of the *recurring monthly* prices on
    # the Researcher / Lab / Institution products. Trial tier has no
    # Stripe price (free).
    #
    # When any of these are unset the billing endpoints return 503 with
    # a clear message — useful in local dev where you don't want to
    # touch Stripe at all.
    STRIPE_SECRET_KEY: SecretStr | None = None
    STRIPE_WEBHOOK_SECRET: SecretStr | None = None
    STRIPE_PRICE_RESEARCHER_MONTHLY: str | None = None
    STRIPE_PRICE_LAB_MONTHLY: str | None = None
    STRIPE_PRICE_INSTITUTION_MONTHLY: str | None = None
    STRIPE_CHECKOUT_SUCCESS_URL: str = "humanovo://billing/success"
    STRIPE_CHECKOUT_CANCEL_URL: str = "humanovo://billing/cancel"
    STRIPE_PORTAL_RETURN_URL: str = "humanovo://billing/portal"

    @property
    def neo4j_password_value(self) -> str:
        """Get Neo4j password value."""
        return self.NEO4J_PASSWORD.get_secret_value()

    @property
    def azure_openai_api_key_value(self) -> str | None:
        """Get Azure OpenAI API key value."""
        return self.AZURE_OPENAI_API_KEY.get_secret_value() if self.AZURE_OPENAI_API_KEY else None

    @property
    def aws_access_key_value(self) -> str | None:
        """Get AWS access key value."""
        return self.AWS_ACCESS_KEY_ID.get_secret_value() if self.AWS_ACCESS_KEY_ID else None

    @property
    def aws_secret_key_value(self) -> str | None:
        """Get AWS secret key value."""
        return self.AWS_SECRET_ACCESS_KEY.get_secret_value() if self.AWS_SECRET_ACCESS_KEY else None

    @property
    def azure_mistral_key_value(self) -> str | None:
        """Azure Mistral model-specific API key."""
        return self.AZURE_MISTRAL_KEY.get_secret_value() if self.AZURE_MISTRAL_KEY else None

    @property
    def azure_gpt4o_key_value(self) -> str | None:
        """Azure GPT-4o API key."""
        return self.AZURE_GPT4O_KEY.get_secret_value() if self.AZURE_GPT4O_KEY else None

    @property
    def azure_cohere_key_value(self) -> str | None:
        """Azure Cohere Command A API key."""
        return self.AZURE_COHERE_KEY.get_secret_value() if self.AZURE_COHERE_KEY else None

    @property
    def azure_o3mini_key_value(self) -> str | None:
        """Azure o3-mini API key."""
        return self.AZURE_O3MINI_KEY.get_secret_value() if self.AZURE_O3MINI_KEY else None

    @property
    def azure_gpt41_key_value(self) -> str | None:
        """Azure GPT-4.1 API key."""
        return self.AZURE_GPT41_KEY.get_secret_value() if self.AZURE_GPT41_KEY else None

    @property
    def azure_grok_key_value(self) -> str | None:
        """Azure Grok API key."""
        return self.AZURE_GROK_KEY.get_secret_value() if self.AZURE_GROK_KEY else None

    @property
    def azure_ai_foundry_key_value(self) -> str | None:
        """Azure AI Foundry unified-project key (replaces per-deployment keys)."""
        return self.AZURE_AI_FOUNDRY_KEY.get_secret_value() if self.AZURE_AI_FOUNDRY_KEY else None

    @property
    def azure_embedding_key_value(self) -> str | None:
        """Azure Embedding API key."""
        return self.AZURE_EMBEDDING_KEY.get_secret_value() if self.AZURE_EMBEDDING_KEY else None

    @model_validator(mode="after")
    def _validate_security_secrets(self) -> "Settings":
        """Block startup if production-bound secrets are still placeholders.

        Dev environments (development / dev / test / testing / local) get
        a soft warning. Anything else (production / staging / prod) fails
        loud — a misconfigured Lambda is better caught at cold-start than
        after it's been signing JWTs with `change-this-in-production` for
        a week.
        """
        env = (self.ENVIRONMENT or "").lower()
        is_dev = env in _DEV_ENVIRONMENTS

        secret_value = self.SECRET_KEY.get_secret_value() if self.SECRET_KEY else ""
        if secret_value in _INSECURE_SECRET_KEYS:
            msg = (
                f"SECRET_KEY is set to a known-insecure placeholder "
                f"({secret_value!r}). Generate a strong random value "
                f"(>= 32 chars) and set SECRET_KEY in the environment."
            )
            if is_dev:
                logger.warning("[config] %s", msg)
            else:
                raise ValueError(msg)

        if self.PUBMED_EMAIL in _PLACEHOLDER_PUBMED_EMAILS:
            msg = (
                f"PUBMED_EMAIL is empty or a placeholder "
                f"({self.PUBMED_EMAIL!r}). NCBI E-utilities requires a "
                f"real contact email; set PUBMED_EMAIL in the environment."
            )
            if is_dev:
                logger.warning("[config] %s", msg)
            else:
                raise ValueError(msg)

        return self


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

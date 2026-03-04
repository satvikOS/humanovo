"""
Humanovo Configuration Module

Centralized configuration management using Pydantic Settings.
Supports environment variables and .env files.
"""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Vector Store (ChromaDB)
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8000
    CHROMA_PERSIST_DIRECTORY: str = "./data/chroma"
    VECTOR_EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

    # Azure OpenAI — legacy config (kept for backward compatibility)
    AZURE_OPENAI_API_KEY: SecretStr | None = None
    AZURE_OPENAI_ENDPOINT: str = ""  # e.g. https://<resource>.openai.azure.com
    AZURE_OPENAI_API_VERSION: str = "2024-12-01-preview"
    AZURE_OPENAI_DEPLOYMENT_O3_DEEP_RESEARCH: str = "o3-deep-research"
    AZURE_OPENAI_DEPLOYMENT_O1: str = "o1"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: str = "text-embedding-3-small"

    # Azure AI — model-specific endpoints (direct, no Foundry routing layer)
    # Each model deployed separately with its own endpoint URL + API key
    AZURE_DEEPSEEK_ENDPOINT: str = ""   # Full base_url from Azure (e.g. https://humanovo-openai.services.ai.azure.com/openai/v1/)
    AZURE_DEEPSEEK_KEY: SecretStr | None = None
    AZURE_DEEPSEEK_MODEL: str = "DeepSeek-R1-0528"

    AZURE_MISTRAL_ENDPOINT: str = ""    # Full base_url from Azure (can be same as DeepSeek if shared endpoint)
    AZURE_MISTRAL_KEY: SecretStr | None = None
    AZURE_MISTRAL_MODEL: str = "Mistral-Large-3"

    # Azure OpenAI — GPT-4o (dedicated Azure OpenAI resource)
    AZURE_GPT4O_ENDPOINT: str = ""     # Azure OpenAI resource URL (e.g. https://humanovo-gpt4o.openai.azure.com)
    AZURE_GPT4O_KEY: SecretStr | None = None
    AZURE_GPT4O_DEPLOYMENT: str = "gpt-4o"
    AZURE_GPT4O_API_VERSION: str = "2024-11-20"

    # Azure AI — Cohere Command A (direct endpoint, 256K context, RAG-optimized)
    AZURE_COHERE_ENDPOINT: str = ""    # Full base_url from Azure
    AZURE_COHERE_KEY: SecretStr | None = None
    AZURE_COHERE_MODEL: str = "cohere-command-a"

    # Azure AI — Phi-4-reasoning (Microsoft, 32K input / 4K output, QA/validation)
    AZURE_PHI4_ENDPOINT: str = ""      # Full base_url from Azure
    AZURE_PHI4_KEY: SecretStr | None = None
    AZURE_PHI4_MODEL: str = "Phi-4-reasoning"

    # AWS Bedrock (IAM user: humanovo-admin)
    AWS_ACCESS_KEY_ID: SecretStr | None = None
    AWS_SECRET_ACCESS_KEY: SecretStr | None = None
    AWS_REGION: str = "us-east-1"

    # Bedrock Model IDs — Claude Opus 4.6 serves as Explorer + Synthesizer
    BEDROCK_MODEL_DEEPSEEK: str = "us.deepseek.r1-v1:0"
    BEDROCK_MODEL_CLAUDE_OPUS: str = "us.anthropic.claude-opus-4-6-v1:0"

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

    # Parallel MCP (Model Context Protocol) Configuration
    # Distributes context windows across models to overcome per-model token limits
    MCP_ENABLED: bool = True
    MCP_MAX_CONTEXT_PER_MODEL: int = 128_000  # max tokens per model context window
    MCP_CONTEXT_OVERLAP: int = 2_000  # overlap tokens between model context shards
    MCP_PARALLEL_SHARDS: int = 4  # number of parallel context shards (one per model)
    MCP_SYNTHESIS_MODEL: str = "us.anthropic.claude-opus-4-6-v1:0"  # Claude Opus via Bedrock for final synthesis (200K context)
    MCP_CHUNK_STRATEGY: str = "semantic"  # semantic | fixed | sliding_window

    # Search APIs
    GOOGLE_API_KEY: SecretStr | None = None
    GOOGLE_CSE_ID: str | None = None
    BRAVE_API_KEY: SecretStr | None = None

    # PubMed / Data Sources
    PUBMED_EMAIL: str = "humanovo@example.com"
    PUBMED_API_KEY: SecretStr | None = None
    PUBMED_RATE_LIMIT: int = 10  # requests per second

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

    # Security
    SECRET_KEY: SecretStr = SecretStr("change-this-in-production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    @property
    def neo4j_password_value(self) -> str:
        """Get Neo4j password value."""
        return self.NEO4J_PASSWORD.get_secret_value()

    @property
    def azure_openai_api_key_value(self) -> str | None:
        """Get Azure OpenAI API key value."""
        return self.AZURE_OPENAI_API_KEY.get_secret_value() if self.AZURE_OPENAI_API_KEY else None

    @property
    def brave_api_key_value(self) -> str | None:
        """Get Brave API key value."""
        return self.BRAVE_API_KEY.get_secret_value() if self.BRAVE_API_KEY else None

    @property
    def aws_access_key_value(self) -> str | None:
        """Get AWS access key value."""
        return self.AWS_ACCESS_KEY_ID.get_secret_value() if self.AWS_ACCESS_KEY_ID else None

    @property
    def aws_secret_key_value(self) -> str | None:
        """Get AWS secret key value."""
        return self.AWS_SECRET_ACCESS_KEY.get_secret_value() if self.AWS_SECRET_ACCESS_KEY else None

    @property
    def azure_deepseek_key_value(self) -> str | None:
        """Azure DeepSeek model-specific API key."""
        return self.AZURE_DEEPSEEK_KEY.get_secret_value() if self.AZURE_DEEPSEEK_KEY else None

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
    def azure_phi4_key_value(self) -> str | None:
        """Azure Phi-4-reasoning API key."""
        return self.AZURE_PHI4_KEY.get_secret_value() if self.AZURE_PHI4_KEY else None


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

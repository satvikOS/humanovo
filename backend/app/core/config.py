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
    APP_NAME: str = "Humanovo"
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

    # OpenAI / LLM
    OPENAI_API_KEY: SecretStr | None = None
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # Anthropic Claude
    ANTHROPIC_API_KEY: SecretStr | None = None
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    # Together AI (for open-source models like Llama)
    TOGETHER_API_KEY: SecretStr | None = None
    TOGETHER_MODEL: str = "meta-llama/Llama-3.3-70B-Instruct-Turbo"

    # Groq (fast inference for open-source models)
    GROQ_API_KEY: SecretStr | None = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # AWS Bedrock (for Llama Maverick and other models)
    AWS_ACCESS_KEY_ID: SecretStr | None = None
    AWS_SECRET_ACCESS_KEY: SecretStr | None = None
    AWS_REGION: str = "us-east-1"
    BEDROCK_MODEL: str = "meta.llama3-3-70b-instruct-v1:0"

    # Kimi 2.5 (Moonshot AI)
    KIMI_API_KEY: SecretStr | None = None
    KIMI_BASE_URL: str = "https://api.moonshot.cn/v1"
    KIMI_MODEL: str = "kimi-2.5"

    # GPT OSS 120B (open-source GPT via Together)
    GPT_OSS_API_KEY: SecretStr | None = None
    GPT_OSS_BASE_URL: str = "https://api.together.xyz/v1"
    GPT_OSS_MODEL: str = "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF"

    # Discovery Service Configuration
    DISCOVERY_LLM_PROVIDER: str = "bedrock"  # openai, anthropic, together, groq, bedrock, kimi, gpt_oss
    DISCOVERY_MAX_EVIDENCE_CHUNKS: int = 50
    DISCOVERY_MAX_GRAPH_PATHS: int = 100
    DISCOVERY_MIN_CONFIDENCE: float = 0.3

    # Parallel Token Pool Management
    TOKEN_POOL_MAX_CONCURRENT_REQUESTS: int = 200  # per model
    TOKEN_POOL_MAX_TOKENS_PER_MINUTE: int = 2_000_000  # total across all models
    TOKEN_POOL_RETRY_BACKOFF_BASE: float = 1.5
    TOKEN_POOL_RETRY_MAX_ATTEMPTS: int = 5
    TOKEN_POOL_AGENT_BATCH_SIZE: int = 50  # agents per dispatch batch

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
    def openai_api_key_value(self) -> str | None:
        """Get OpenAI API key value."""
        return self.OPENAI_API_KEY.get_secret_value() if self.OPENAI_API_KEY else None

    @property
    def anthropic_api_key_value(self) -> str | None:
        """Get Anthropic API key value."""
        return self.ANTHROPIC_API_KEY.get_secret_value() if self.ANTHROPIC_API_KEY else None

    @property
    def together_api_key_value(self) -> str | None:
        """Get Together API key value."""
        return self.TOGETHER_API_KEY.get_secret_value() if self.TOGETHER_API_KEY else None

    @property
    def groq_api_key_value(self) -> str | None:
        """Get Groq API key value."""
        return self.GROQ_API_KEY.get_secret_value() if self.GROQ_API_KEY else None

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
    def kimi_api_key_value(self) -> str | None:
        """Get Kimi API key value."""
        return self.KIMI_API_KEY.get_secret_value() if self.KIMI_API_KEY else None

    @property
    def gpt_oss_api_key_value(self) -> str | None:
        """Get GPT OSS API key value."""
        return self.GPT_OSS_API_KEY.get_secret_value() if self.GPT_OSS_API_KEY else None


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

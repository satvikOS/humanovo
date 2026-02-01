"""
GenUp Configuration Module

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
    APP_NAME: str = "GenUp"
    VERSION: str = "0.1.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS
    CORS_ORIGINS: list[str] = Field(default=["http://localhost:3000", "http://localhost:5173"])

    # Database (PostgreSQL)
    DATABASE_URL: str = "postgresql+asyncpg://genup:genup@localhost:5432/genup"
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

    # Search APIs
    GOOGLE_API_KEY: SecretStr | None = None
    GOOGLE_CSE_ID: str | None = None
    BRAVE_API_KEY: SecretStr | None = None

    # PubMed / Data Sources
    PUBMED_EMAIL: str = "genup@example.com"
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


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

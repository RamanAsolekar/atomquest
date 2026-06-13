"""Centralised, typed settings loaded from the environment."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    env: str = "development"
    api_port: int = 4000
    api_global_prefix: str = "api"
    cors_origin: str = "http://localhost:3000,http://localhost"
    public_host: str = "localhost"
    web_url: str = "http://localhost:3000"

    # auth / security
    jwt_access_secret: str = "dev_access_secret"
    jwt_refresh_secret: str = "dev_refresh_secret"
    jwt_access_ttl: int = 900
    jwt_refresh_ttl: int = 604800
    invite_token_secret: str = "dev_invite_secret"
    invite_token_ttl: int = 86400
    bcrypt_rounds: int = 12
    cookie_secret: str = "dev_cookie_secret"
    rate_limit_ttl: int = 60
    rate_limit_max: int = 120

    # postgres
    database_url: str = "postgresql+asyncpg://atom:atom_dev_password@localhost:5432/atom_support"

    # redis
    redis_url: str = "redis://localhost:6379"

    # S3 / MinIO
    s3_endpoint: str = "http://localhost:9000"
    s3_public_endpoint: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = "atom_minio"
    s3_secret_key: str = "atom_minio_secret"
    s3_bucket_recordings: str = "atom-recordings"
    s3_bucket_files: str = "atom-files"
    s3_force_path_style: bool = True

    # media server
    media_internal_url: str = "http://localhost:5000"

    # AI
    ai_assistant_enabled: bool = True
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-8"

    # observability
    otel_exporter_otlp_endpoint: str = ""
    otel_service_namespace: str = "atom"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origin.split(",") if o.strip()]

    @property
    def sync_database_url(self) -> str:
        """Alembic uses a sync driver."""
        return self.database_url.replace("+asyncpg", "+psycopg2").replace(
            "postgresql+asyncpg", "postgresql"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

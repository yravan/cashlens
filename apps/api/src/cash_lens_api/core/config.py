from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SQLITE_PATH = Path(__file__).resolve().parents[3] / "cashlens.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Cash Lens API"
    environment: str = "development"
    database_url: str = f"sqlite:///{DEFAULT_SQLITE_PATH}"
    app_base_url: str = "http://localhost:3000"
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    app_encryption_key: str = "cash-lens-demo-encryption-key"
    clerk_jwt_key: str | None = None

    demo_mode: bool = True
    seed_demo_data: bool = True
    default_demo_user_email: str = "demo@cashlens.local"
    default_demo_user_name: str = "Cash Lens Demo"

    plaid_env: str = "sandbox"
    plaid_client_id: str | None = None
    plaid_secret: str | None = None
    plaid_webhook_url: str | None = None
    verify_plaid_webhooks: bool = True

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def clerk_authorized_parties(self) -> list[str]:
        values = {origin for origin in self.cors_origins}
        values.add(self.app_base_url)
        return sorted(origin for origin in values if origin)

    @property
    def plaid_live_enabled(self) -> bool:
        return bool(self.plaid_client_id and self.plaid_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()

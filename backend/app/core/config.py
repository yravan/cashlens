from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://cashlens:cashlens@localhost:5432/cashlens"

    # Clerk
    clerk_secret_key: str = ""
    clerk_jwks_url: str = ""

    # URLs
    frontend_url: str = "http://localhost:3000"
    api_base_url: str = "http://localhost:8000"

    # Gmail OAuth
    gmail_client_id: str = ""
    gmail_client_secret: str = ""

    # SimpleFIN
    simplefin_access_url: str = ""

    # Teller
    teller_application_id: str = ""
    teller_environment: str = "sandbox"
    teller_cert_path: str = "./certs/teller/certificate.pem"
    teller_key_path: str = "./certs/teller/private_key.pem"

    # Plaid
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"

    # Gmail
    gmail_credentials_path: str = "./creds/gmail_credentials.json"
    gmail_token_path: str = "./creds/gmail_token.pickle"

    # OpenRouter (LLM)
    openrouter_api_key: str = ""

    # VAPID (push notifications)
    vapid_private_key: str = ""
    vapid_public_key: str = ""

    # Encryption key for bank tokens at rest
    encryption_key: str = ""

    model_config = {"env_file": ".env"}


settings = Settings()

from cash_lens_api.core.config import get_settings
from cash_lens_api.main import create_app


def test_healthcheck(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_demo_dashboard_returns_seeded_workspace(client):
    response = client.get("/dashboard")

    assert response.status_code == 200
    payload = response.json()

    assert payload["accounts"]
    assert payload["plaid_items"]
    assert payload["recent_transactions"]
    assert payload["recent_notifications"]
    assert payload["summary"]["latest_sync_status"]


def test_create_app_hides_docs_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()

    app = create_app()

    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None

    monkeypatch.setenv("ENVIRONMENT", "development")
    get_settings.cache_clear()

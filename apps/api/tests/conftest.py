from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEMP_DIR = tempfile.mkdtemp(prefix="cashlens-api-tests-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(_TEMP_DIR) / 'cashlens-test.db'}")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("SEED_DEMO_DATA", "true")
os.environ.setdefault("VERIFY_PLAID_WEBHOOKS", "false")
os.environ.setdefault("APP_ENCRYPTION_KEY", "cash-lens-test-encryption-key")
os.environ.setdefault("APP_BASE_URL", "http://localhost:3000")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")

import pytest
from fastapi.testclient import TestClient

from cash_lens_api.core.config import get_settings
from cash_lens_api.db import Base, engine
from cash_lens_api.main import create_app


@pytest.fixture(autouse=True)
def reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client

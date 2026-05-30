from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from cash_lens_api.core.config import Settings
from cash_lens_api.core.security import get_bearer_token, verify_clerk_session_token


def _build_settings(public_jwk: dict[str, str]) -> Settings:
    return Settings(
        _env_file=None,
        clerk_jwt_key=json.dumps({"keys": [public_jwk]}),
        app_base_url="https://cashlens.example",
        allowed_origins="https://cashlens.example,https://preview.cashlens.example",
    )


def _issue_token(*, azp: str = "https://cashlens.example", sts: str | None = None) -> tuple[str, Settings]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk["kid"] = "test-key"
    settings = _build_settings(public_jwk)

    now = datetime.now(UTC)
    claims = {
        "sub": "user_123",
        "azp": azp,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    if sts is not None:
        claims["sts"] = sts

    token = jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-key"})
    return token, settings


def test_get_bearer_token_requires_header():
    with pytest.raises(HTTPException) as exc_info:
        get_bearer_token(None)

    assert exc_info.value.status_code == 401


def test_get_bearer_token_requires_bearer_scheme():
    with pytest.raises(HTTPException) as exc_info:
        get_bearer_token("Basic secret")

    assert exc_info.value.status_code == 401


def test_verify_clerk_session_token_accepts_valid_token():
    token, settings = _issue_token()

    claims = verify_clerk_session_token(token, settings)

    assert claims["sub"] == "user_123"


def test_verify_clerk_session_token_rejects_unauthorized_origin():
    token, settings = _issue_token(azp="https://evil.example")

    with pytest.raises(HTTPException) as exc_info:
        verify_clerk_session_token(token, settings)

    assert exc_info.value.status_code == 401


def test_verify_clerk_session_token_rejects_pending_session():
    token, settings = _issue_token(sts="pending")

    with pytest.raises(HTTPException) as exc_info:
        verify_clerk_session_token(token, settings)

    assert exc_info.value.status_code == 403

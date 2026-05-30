from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from functools import lru_cache

import jwt
from fastapi import HTTPException
from jwt import InvalidTokenError

from cash_lens_api.core.config import Settings


def get_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authorization header must use the Bearer scheme.")
    return token


def verify_clerk_session_token(token: str, settings: Settings) -> dict:
    if not settings.clerk_jwt_key:
        raise HTTPException(status_code=500, detail="Clerk JWT verification key is not configured.")

    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid Clerk session token header.") from exc

    try:
        claims = jwt.decode(
            token,
            _clerk_verification_key(settings.clerk_jwt_key, header.get("kid")),
            algorithms=["RS256"],
            options={"require": ["sub", "exp", "iat", "nbf"]},
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid Clerk session token.") from exc

    azp = claims.get("azp")
    if azp and azp not in settings.clerk_authorized_parties:
        raise HTTPException(status_code=401, detail="Token was issued for an unauthorized origin.")

    if claims.get("sts") == "pending":
        raise HTTPException(status_code=403, detail="Clerk session is not fully active.")

    return claims


def verify_plaid_webhook(raw_body: bytes, verification_token: str | None, settings: Settings) -> None:
    if not settings.verify_plaid_webhooks or not settings.plaid_live_enabled:
        return

    if not verification_token:
        raise HTTPException(status_code=401, detail="Plaid webhook signature missing.")

    try:
        header = jwt.get_unverified_header(verification_token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid Plaid webhook signature header.") from exc

    if header.get("alg") != "ES256":
        raise HTTPException(status_code=401, detail="Unexpected Plaid webhook signature algorithm.")

    key_id = header.get("kid")
    if not key_id:
        raise HTTPException(status_code=401, detail="Plaid webhook signature is missing a key id.")

    key = _plaid_verification_key(
        key_id,
        settings.plaid_client_id or "",
        settings.plaid_secret or "",
        settings.plaid_env,
    )

    try:
        claims = jwt.decode(
            verification_token,
            jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(key)),
            algorithms=["ES256"],
            options={"verify_exp": False, "verify_iat": False, "verify_nbf": False},
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Plaid webhook signature verification failed.") from exc

    issued_at = claims.get("iat")
    if not isinstance(issued_at, (int, float)):
        raise HTTPException(status_code=401, detail="Plaid webhook signature is missing iat.")

    age_seconds = abs(datetime.now(UTC).timestamp() - issued_at)
    if age_seconds > 300:
        raise HTTPException(status_code=401, detail="Plaid webhook signature is too old.")

    expected_hash = claims.get("request_body_sha256")
    body_hash = hashlib.sha256(raw_body).hexdigest()
    if not isinstance(expected_hash, str) or not hmac.compare_digest(body_hash, expected_hash):
        raise HTTPException(status_code=401, detail="Plaid webhook body hash mismatch.")


@lru_cache(maxsize=8)
def _clerk_verification_key(raw_key: str, key_id: str | None):
    normalized = raw_key.strip()
    if normalized.startswith("{"):
        payload = json.loads(normalized)
        if "keys" in payload:
            for candidate in payload["keys"]:
                if candidate.get("kid") == key_id:
                    return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(candidate))
            if payload["keys"]:
                return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(payload["keys"][0]))
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(payload))
    return normalized


@lru_cache(maxsize=32)
def _plaid_verification_key(
    key_id: str,
    client_id: str,
    secret: str,
    plaid_env: str,
) -> dict:
    import plaid
    from plaid.api import plaid_api
    from plaid.configuration import Environment
    from plaid.model.webhook_verification_key_get_request import WebhookVerificationKeyGetRequest

    configuration = plaid.Configuration(
        host=Environment.Sandbox if plaid_env == "sandbox" else Environment.Production,
        api_key={
            "clientId": client_id,
            "secret": secret,
        },
    )
    client = plaid_api.PlaidApi(plaid.ApiClient(configuration))
    response = client.webhook_verification_key_get(WebhookVerificationKeyGetRequest(key_id=key_id))
    return response.to_dict()["key"]

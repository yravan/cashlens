from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from cash_lens_api.core.config import Settings, get_settings
from cash_lens_api.core.security import get_bearer_token, verify_clerk_session_token
from cash_lens_api.db import get_db
from cash_lens_api.models import User
from cash_lens_api.services.demo_seed import ensure_seeded_user


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header(alias="authorization")] = None,
    x_demo_user_email: Annotated[str | None, Header(alias="x-demo-user-email")] = None,
) -> User:
    if settings.demo_mode:
        email = x_demo_user_email or settings.default_demo_user_email
        return ensure_seeded_user(db, email=email, full_name=settings.default_demo_user_name)

    claims = verify_clerk_session_token(get_bearer_token(authorization), settings)
    external_auth_user_id = claims["sub"]

    user = db.scalar(select(User).where(User.external_auth_user_id == external_auth_user_id))
    if user:
        return user

    email = f"{external_auth_user_id}@cashlens.local"
    user = User(
        external_auth_user_id=external_auth_user_id,
        email=email,
        full_name=email.split("@")[0].replace(".", " ").replace("_", " ").title(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from cash_lens_api.core.config import Settings, get_settings
from cash_lens_api.db import get_db
from cash_lens_api.models import User
from cash_lens_api.services.demo_seed import ensure_seeded_user


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    x_demo_user_email: Annotated[str | None, Header(alias="x-demo-user-email")] = None,
    x_user_email: Annotated[str | None, Header(alias="x-user-email")] = None,
    x_external_auth_user_id: Annotated[str | None, Header(alias="x-external-auth-user-id")] = None,
) -> User:
    if settings.demo_mode:
        email = x_demo_user_email or x_user_email or settings.default_demo_user_email
        return ensure_seeded_user(db, email=email, full_name=settings.default_demo_user_name)

    if not x_external_auth_user_id:
        raise HTTPException(status_code=401, detail="Authentication headers were not provided.")

    user = db.scalar(select(User).where(User.external_auth_user_id == x_external_auth_user_id))
    if user:
        return user

    email = x_user_email or f"{x_external_auth_user_id}@cashlens.local"
    user = User(
        external_auth_user_id=x_external_auth_user_id,
        email=email,
        full_name=email.split("@")[0].replace(".", " ").replace("_", " ").title(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

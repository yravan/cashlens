from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from cash_lens_api.core.auth import get_current_user
from cash_lens_api.db import get_db
from cash_lens_api.models import User
from cash_lens_api.schemas import DashboardRead
from cash_lens_api.services.dashboard import build_dashboard

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardRead)
def get_dashboard(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> DashboardRead:
    return build_dashboard(db, user)

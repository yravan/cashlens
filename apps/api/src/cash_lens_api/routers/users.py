from typing import Annotated

from fastapi import APIRouter, Depends

from cash_lens_api.core.auth import get_current_user
from cash_lens_api.models import User
from cash_lens_api.schemas import UserRead

router = APIRouter(tags=["users"])


@router.get("/me", response_model=UserRead)
def get_me(user: Annotated[User, Depends(get_current_user)]) -> UserRead:
    return UserRead.model_validate(user)

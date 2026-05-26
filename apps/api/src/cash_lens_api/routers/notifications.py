from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from cash_lens_api.core.auth import get_current_user
from cash_lens_api.db import get_db, utc_now
from cash_lens_api.models import NotificationEvent, User
from cash_lens_api.schemas import MessageResponse, NotificationRead

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationRead])
def list_notifications(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[NotificationRead]:
    events = db.scalars(
        select(NotificationEvent)
        .where(NotificationEvent.user_id == user.id)
        .order_by(desc(NotificationEvent.created_at))
    ).all()
    return [NotificationRead.model_validate(event) for event in events]


@router.patch("/notifications/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationRead:
    event = db.scalar(
        select(NotificationEvent).where(
            NotificationEvent.id == notification_id,
            NotificationEvent.user_id == user.id,
        )
    )
    if not event:
        raise HTTPException(status_code=404, detail="Notification not found.")
    event.read_at = utc_now()
    db.commit()
    db.refresh(event)
    return NotificationRead.model_validate(event)


@router.patch("/notifications/read-all", response_model=MessageResponse)
def mark_all_notifications_read(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    events = db.scalars(
        select(NotificationEvent).where(
            NotificationEvent.user_id == user.id,
            NotificationEvent.read_at.is_(None),
        )
    ).all()
    for event in events:
        event.read_at = utc_now()
    db.commit()
    return MessageResponse(status="ok", message=f"Marked {len(events)} notifications as read.")

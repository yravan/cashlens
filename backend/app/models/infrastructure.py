"""Infrastructure models: bank_connections, processed_emails, system_events, contacts."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, gen_uuid


class BankConnection(TimestampMixin, Base):
    __tablename__ = "bank_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)  # plaid, simplefin, teller
    encrypted_access_token: Mapped[str] = mapped_column(Text, nullable=False)
    institution_name: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    plaid_item_id: Mapped[Optional[str]] = mapped_column(Text)
    plaid_cursor: Mapped[Optional[str]] = mapped_column(Text)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column()


class ProcessedEmail(Base):
    __tablename__ = "processed_emails"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    gmail_message_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    gmail_thread_id: Mapped[Optional[str]] = mapped_column(Text)
    subject: Mapped[Optional[str]] = mapped_column(Text)
    from_address: Mapped[Optional[str]] = mapped_column(Text)
    received_at: Mapped[Optional[datetime]] = mapped_column()
    processed_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    processing_result: Mapped[str] = mapped_column(Text, nullable=False)
    receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("receipts.id"), nullable=True
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text)


class SystemEvent(Base):
    __tablename__ = "system_events"
    __table_args__ = (
        Index("ix_system_events_table_record", "table_name", "record_id"),
        Index("ix_system_events_created_at", "created_at"),
        Index("ix_system_events_event_type", "event_type"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[str]] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    change_source: Mapped[str] = mapped_column(Text, nullable=False)  # user, llm, sync, system, rule
    table_name: Mapped[Optional[str]] = mapped_column(Text)
    record_id: Mapped[Optional[str]] = mapped_column(Text)
    old_values: Mapped[Optional[dict]] = mapped_column(JSONB)
    new_values: Mapped[Optional[dict]] = mapped_column(JSONB)
    changed_fields: Mapped[Optional[list[str]]] = mapped_column(ARRAY(Text))
    affected_transaction_ids: Mapped[Optional[list[uuid.UUID]]] = mapped_column(ARRAY(UUID(as_uuid=True)))
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSONB)
    ip_address: Mapped[Optional[str]] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=datetime.utcnow)


class Contact(TimestampMixin, Base):
    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    payment_patterns: Mapped[Optional[dict]] = mapped_column(JSONB)
    default_category_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True
    )
    last_transaction_at: Mapped[Optional[datetime]] = mapped_column()

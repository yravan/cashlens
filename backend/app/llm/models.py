"""Pydantic models for LLM-structured extraction.

Used with Instructor to get typed responses from OpenRouter.
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class ReceiptLineItem(BaseModel):
    description: str
    quantity: int = 1
    unit_price: Decimal
    total: Decimal


class ReceiptData(BaseModel):
    """Structured data extracted from a camera receipt image."""

    merchant_name: str
    merchant_address: Optional[str] = None
    date: Optional[date] = None
    subtotal: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    tip: Optional[Decimal] = None
    total: Decimal
    currency: str = "USD"
    payment_method: Optional[str] = None
    items: list[ReceiptLineItem] = []


class EmailReceiptResult(BaseModel):
    """Structured data extracted from an email receipt."""

    merchant_name: str
    date: Optional[date] = None
    total: Decimal
    currency: str = "USD"
    order_id: Optional[str] = None
    items: list[ReceiptLineItem] = []
    is_receipt: bool = True  # False if email doesn't contain a receipt

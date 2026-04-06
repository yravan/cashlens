"""All models — import here so Alembic discovers them."""

from app.models.base import Base  # noqa: F401
from app.models.financial import (  # noqa: F401
    Account,
    Category,
    RecurringTransaction,
    Tag,
    Transaction,
    TransactionSplit,
    TransactionTag,
)
from app.models.infrastructure import (  # noqa: F401
    BankConnection,
    Contact,
    ProcessedEmail,
    SystemEvent,
)
from app.models.llm import ChatMessage, LLMUsageLog, MerchantCategoryCache  # noqa: F401
from app.models.receipts import Receipt, ReceiptLineItem  # noqa: F401

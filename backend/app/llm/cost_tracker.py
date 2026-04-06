"""LLM usage cost tracking.

Logs token usage and costs from OpenRouter responses.
Every response includes resp.usage with token counts.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class LLMUsageEntry:
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    purpose: str  # "receipt_scan", "email_parse", "categorize"
    timestamp: datetime = field(default_factory=datetime.utcnow)


# In-memory log; will be persisted to DB once models are built
_usage_log: list[LLMUsageEntry] = []


def log_usage(response, purpose: str) -> LLMUsageEntry | None:
    """Extract and log usage from an OpenAI-compatible response."""
    usage = getattr(response, "usage", None)
    if not usage:
        return None

    entry = LLMUsageEntry(
        model=getattr(response, "model", "unknown"),
        prompt_tokens=getattr(usage, "prompt_tokens", 0),
        completion_tokens=getattr(usage, "completion_tokens", 0),
        total_tokens=getattr(usage, "total_tokens", 0),
        cost_usd=getattr(usage, "cost", 0.0) or 0.0,
        purpose=purpose,
    )
    _usage_log.append(entry)
    logger.info(
        "LLM usage: model=%s tokens=%d cost=$%.6f purpose=%s",
        entry.model,
        entry.total_tokens,
        entry.cost_usd,
        entry.purpose,
    )
    return entry


def get_usage_log() -> list[LLMUsageEntry]:
    return list(_usage_log)


def get_total_cost() -> float:
    return sum(e.cost_usd for e in _usage_log)

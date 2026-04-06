"""OpenRouter LLM client setup.

Uses openai SDK (OpenAI-compatible) pointed at OpenRouter.
Instructor wraps it for structured Pydantic output.
Model fallback via OpenRouter's native routing.
"""

import os

import instructor
from openai import AsyncOpenAI

_openrouter_client: AsyncOpenAI | None = None
_instructor_client = None


def get_openrouter_client() -> AsyncOpenAI:
    global _openrouter_client
    if _openrouter_client is None:
        _openrouter_client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ.get("OPENROUTER_API_KEY", ""),
            default_headers={
                "HTTP-Referer": "https://cashlens.app",
                "X-OpenRouter-Title": "CashLens",
            },
        )
    return _openrouter_client


def get_instructor_client():
    """Get an Instructor-wrapped OpenRouter client for structured output."""
    global _instructor_client
    if _instructor_client is None:
        _instructor_client = instructor.from_openai(
            get_openrouter_client(), mode=instructor.Mode.JSON
        )
    return _instructor_client


# Default model with fallback chain
DEFAULT_MODEL = "google/gemini-2.5-flash-lite"
VISION_MODEL = "google/gemini-2.5-flash-lite"

MODEL_FALLBACK_EXTRA = {
    "models": [
        "google/gemini-2.5-flash-lite",
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
    ],
    "route": "fallback",
    "provider": {"require_parameters": True},
}

"""Gmail receipt parsing provider.

OAuth Desktop credential flow → Gmail API → email body extraction → LLM parsing.
Incremental sync via historyId. Schema.org JSON-LD checked first.
HTML truncated to ~8000 chars to control LLM token costs.
"""

import base64
import json
import logging
import os
import pickle
from typing import Optional

from app.llm.client import DEFAULT_MODEL, MODEL_FALLBACK_EXTRA, get_instructor_client
from app.llm.cost_tracker import log_usage
from app.llm.models import EmailReceiptResult

logger = logging.getLogger(__name__)


def _get_gmail_service(credentials_path: str, token_path: str):
    """Build Gmail API service with cached OAuth token."""
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
    creds = None

    if os.path.exists(token_path):
        with open(token_path, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "wb") as f:
            pickle.dump(creds, f)

    return build("gmail", "v1", credentials=creds)


def _decode_body(payload: dict) -> str:
    """Extract text/html or text/plain from Gmail message payload."""
    if payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")

    parts = payload.get("parts", [])
    html_body = ""
    text_body = ""
    for part in parts:
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data", "")
        if not data:
            # Check nested parts
            sub = _decode_body(part)
            if sub:
                if "html" in mime:
                    html_body = sub
                else:
                    text_body = sub
            continue
        decoded = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        if "html" in mime:
            html_body = decoded
        elif "plain" in mime:
            text_body = decoded

    return html_body or text_body


def _extract_jsonld(html: str) -> Optional[dict]:
    """Check for Schema.org JSON-LD structured order data."""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for script in soup.find_all("script", type="application/ld+json"):
            data = json.loads(script.string)
            if isinstance(data, dict) and data.get("@type") in (
                "Order",
                "Invoice",
                "Receipt",
            ):
                return data
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("@type") in (
                        "Order",
                        "Invoice",
                        "Receipt",
                    ):
                        return item
    except Exception:
        pass
    return None


async def parse_email_receipt(html: str) -> EmailReceiptResult | None:
    """Send email HTML to LLM for structured receipt extraction."""
    # Truncate to control token costs
    truncated = html[:8000]

    client = get_instructor_client()
    try:
        result = await client.chat.completions.create(
            model=DEFAULT_MODEL,
            response_model=EmailReceiptResult,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract receipt/order data from this email HTML. "
                        "If the email is not a receipt or order confirmation, "
                        "set is_receipt=false and return zeroed fields."
                    ),
                },
                {"role": "user", "content": truncated},
            ],
            extra_body=MODEL_FALLBACK_EXTRA,
        )
        return result if result.is_receipt else None
    except Exception:
        logger.exception("Failed to parse email receipt")
        return None


async def fetch_receipt_emails(
    credentials_path: str,
    token_path: str,
    history_id: Optional[str] = None,
    max_results: int = 50,
) -> tuple[list[dict], Optional[str]]:
    """Fetch receipt-like emails from Gmail.

    Returns (messages, new_history_id) for incremental sync.
    """
    service = _get_gmail_service(credentials_path, token_path)

    # Three-layer approach:
    # 1. Gmail's ML classification (purchases + finance)
    # 2. Known financial senders
    # 3. Subject keyword fallback
    query = " OR ".join([
        # Gmail auto-categories
        "{category:purchases}",
        "{category:finance}",
        # Known financial senders
        "from:(paypal.com OR venmo.com OR zelle OR square.com OR stripe.com "
        "OR cash.app OR wise.com)",
        # Subject keywords
        "subject:(receipt OR invoice OR \"order confirmation\" OR \"payment received\" "
        "OR \"your order\" OR \"your receipt\" OR \"your purchase\" "
        "OR \"payment successful\" OR \"you paid\" OR \"charged\" "
        "OR \"billing statement\" OR \"subscription\")",
        # Dollar amounts in subject (catches "$12.99" style)
        "subject:$",
    ])

    if history_id:
        try:
            results = (
                service.users()
                .history()
                .list(userId="me", startHistoryId=history_id, historyTypes=["messageAdded"])
                .execute()
            )
            message_ids = []
            for record in results.get("history", []):
                for msg in record.get("messagesAdded", []):
                    message_ids.append(msg["message"]["id"])
            new_history_id = results.get("historyId")

            messages = []
            for mid in message_ids[:max_results]:
                msg = (
                    service.users()
                    .messages()
                    .get(userId="me", id=mid, format="full")
                    .execute()
                )
                messages.append(msg)
            return messages, new_history_id
        except Exception:
            logger.warning("historyId expired, falling back to full search")

    # Full search fallback
    results = (
        service.users()
        .messages()
        .list(userId="me", q=query, maxResults=max_results)
        .execute()
    )
    new_history_id = None
    messages = []
    for item in results.get("messages", []):
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=item["id"], format="full")
            .execute()
        )
        messages.append(msg)
        if not new_history_id:
            new_history_id = msg.get("historyId")

    return messages, new_history_id

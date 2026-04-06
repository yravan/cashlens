"""Test Gmail receipt fetching — no LLM, just OAuth + search.

First run opens browser for authorization. Token cached in pickle for subsequent runs.
"""

import os
import pickle
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def get_service(credentials_path: str, token_path: str):
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
        print(f"Token saved to {token_path}")

    return build("gmail", "v1", credentials=creds)


def main():
    from app.core.config import settings

    creds_path = settings.gmail_credentials_path
    token_path = settings.gmail_token_path

    print(f"Credentials: {creds_path}")
    print(f"Token cache: {token_path}")
    print()

    service = get_service(creds_path, token_path)

    # Search for receipt-like emails
    query = " OR ".join([
        "{category:purchases}",
        "{category:finance}",
        "from:(paypal.com OR venmo.com OR zelle OR square.com OR stripe.com "
        "OR cash.app OR wise.com)",
        "subject:(receipt OR invoice OR \"order confirmation\" OR \"payment received\" "
        "OR \"your order\" OR \"your receipt\" OR \"your purchase\" "
        "OR \"payment successful\" OR \"you paid\" OR \"charged\" "
        "OR \"billing statement\" OR \"subscription renewed\")",
        "subject:$",
    ])
    print(f"Searching: {query}")
    print("=" * 60)

    results = service.users().messages().list(
        userId="me", q=query, maxResults=20
    ).execute()

    messages = results.get("messages", [])
    print(f"Found {len(messages)} emails\n")

    for msg_meta in messages:
        msg = service.users().messages().get(
            userId="me", id=msg_meta["id"], format="metadata",
            metadataHeaders=["From", "Subject", "Date"],
        ).execute()

        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        print(f"  {headers.get('Date', '?')[:25]}")
        print(f"    From:    {headers.get('From', '?')[:60]}")
        print(f"    Subject: {headers.get('Subject', '?')[:70]}")
        print(f"    ID:      {msg['id']}")
        print()


if __name__ == "__main__":
    main()

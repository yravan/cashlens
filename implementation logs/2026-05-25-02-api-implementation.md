# Implementation Log 02: API Implementation

## Objective

Stand up a FastAPI backend that already behaves like the product, even without vendor credentials.

## Main backend modules added

- `core/config.py`
- `core/auth.py`
- `db.py`
- `models.py`
- `schemas.py`
- `services/demo_seed.py`
- `services/dashboard.py`
- `services/plaid.py`
- `routers/*`
- `main.py`

## Data model decisions

The API uses separate tables for:

- users
- plaid items
- financial accounts
- raw transactions
- ledger events
- notifications
- sync runs

This preserves the “source truth vs app projection” split from the research document.

## Auth design

The API is built around a server-side proxy model.

- Demo mode:
  - uses `x-demo-user-email`
  - auto-seeds a single-user workspace
- Non-demo mode:
  - accepts `x-external-auth-user-id`
  - optionally accepts `x-user-email`
  - creates a local user record if missing

This avoids exposing raw vendor credentials to the browser and keeps the backend usable behind a Next.js BFF proxy.

## Demo mode strategy

Because real Plaid and Clerk secrets were not available in the repo, the backend needed to be immediately usable without faking the entire product manually in the UI.

The seed layer therefore creates:

- one demo user
- one connected demo institution
- three seeded accounts
- realistic inflow, outflow, refund, transfer, and card-payment events
- notifications
- sync runs

## Ledger normalization decisions

- `RawTransaction.amount` preserves Plaid-like signed semantics.
- `LedgerEvent.amount` is normalized from the user perspective:
  - positive = inflow
  - negative = outflow
- `true_spend` excludes:
  - transfers
  - card payments
  - anything explicitly marked `exclude_from_spend`

## Plaid layer design

`services/plaid.py` supports two modes:

1. Demo mode
   - returns fake link tokens
   - creates synthetic connected institutions
   - creates new transactions on manual sync
2. Live mode
   - uses the installed Plaid SDK
   - creates link tokens
   - exchanges public tokens
   - fetches accounts
   - uses `/transactions/sync`

## Verification performed

- imported `cash_lens_api.main:app`
- exercised `/health`
- exercised `/dashboard`
- exercised `/transactions`
- corrected a true-spend bug where income was incorrectly offsetting spending

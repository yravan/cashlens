# MVP Product Spec Snapshot

Source:

- `/Users/yajvanravan/Downloads/cash_lens_mvp_spec.md`

## Goal

Build a personal finance dashboard that connects to Plaid, syncs accounts and transactions, normalizes them into a shared per-user ledger, and shows accounts, transaction history, settings, and in-app notifications.

## Included MVP features

- Web dashboard
- User authentication
- Accounts page
- Transaction history page
- Profile/settings page
- Plaid connection flow
- Initial backfill
- Ongoing sync
- Ledger table per user
- In-app notifications
- Python backend
- Postgres-compatible schema
- Background work support

## Core API surface

- `GET /me`
- `POST /plaid/create-link-token`
- `POST /plaid/exchange-public-token`
- `POST /plaid/webhook`
- `POST /plaid/sync-item/{plaid_item_id}`
- `GET /accounts`
- `GET /accounts/{account_id}`
- `GET /transactions`
- `GET /transactions/{transaction_id}`
- `PATCH /transactions/{transaction_id}`
- `GET /notifications`
- `PATCH /notifications/{notification_id}/read`
- `PATCH /notifications/read-all`

## Core database tables

- `users`
- `plaid_items`
- `financial_accounts`
- `raw_transactions`
- `ledger_events`
- `notification_events`
- `sync_runs`

## MVP ledger behavior

- Outflows: purchases, fees, payments leaving owned accounts
- Inflows: income, refunds, reimbursements, deposits
- Transfers and card payments: excluded from true spend

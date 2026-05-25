# Implemented MVP Contract

This file records the version of the spec that the code in this repository currently satisfies.

## Implemented now

- Monorepo shape with `apps/web`, `apps/api`, `packages/api-types`
- FastAPI backend managed with `uv`
- SQLAlchemy data model and seeded demo workspace
- Dashboard, accounts, transactions, and settings screens
- Notification flows and read-all action
- Manual sync action
- Plaid connect abstraction with demo mode now and live mode hook points
- Optional Clerk-ready server-side proxy shape
- Transaction review editor for category, subcategory, event type, and true-spend exclusion

## Intentionally deferred from the roadmap

- Gmail receipt ingestion
- reimbursement claims UI
- return intent tracking UI
- recurring stream detector UI
- mobile app
- LLM classification
- bill calendar

## Reason for the current boundary

The repository now contains a deployable, inspectable MVP that demonstrates the ledger-first architecture and the main money-flow interfaces without forcing paid vendor credentials during initial development.

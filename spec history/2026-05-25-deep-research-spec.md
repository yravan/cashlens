# Deep Research Spec Snapshot

Source:

- `/Users/yajvanravan/Downloads/deep-research-report.md`

## Architecture decisions captured

- Frontend: Next.js App Router on Vercel
- Backend: FastAPI on Cloud Run
- Database: Neon Postgres
- Auth: Clerk
- Financial ingestion: Plaid Transactions only
- Async work: Cloud Tasks plus Cloud Scheduler instead of always-on Celery + Redis
- Notification delivery: in-app polling, not websockets

## Key modeling rules

- Treat source ingestion separately from UI projection
- Preserve raw Plaid transaction state
- Build a normalized ledger for display, rules, and downstream review
- Exclude transfers and card payments from true spend
- Keep Plaid access tokens encrypted at rest

## Product scope preserved for MVP

- Dashboard
- Accounts
- Transactions
- Settings/profile
- Plaid connect flow
- Initial and incremental sync
- In-app notifications
- True-spend calculations
- Subscription candidate review support

## Cost-sensitive choices preserved

- Demo-ready local mode without paid services
- Plaid Transactions only, no Auth or Recurring Transactions product required
- Cached balances from `/accounts/get`
- Serverless-first hosting posture

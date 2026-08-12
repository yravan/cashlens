# Cash Lens — Vision

## Goal

See my net inflow and outflow — where, and why — and smartly categorize my spending. Every dollar in or out is accounted for, tagged with a reason, deduplicated, and enriched. A single source of truth for my financials, beyond what Monarch-style apps report.

## North-star questions

- Where did my money go?
- Where did money come from?
- What is my true spending?
- What do I owe, and what am I owed?
- What changed unexpectedly?
- What is my financial state right now?

## The ledger-first thesis

Cash Lens is a personal financial operating system, not a transaction category viewer. The core primitive is one normalized, per-user ledger that everything else enriches: receipts, line items, reimbursements, returns, claims, recurring obligations, predictions, and reviewable intelligence.

## The transaction model

- Nearly every transaction ultimately clears through a bank account or card — but the full story usually lives elsewhere.
- Receipts are itemized; the fundamental quantity is a single product or service.
- Matching bank entries against receipts, Venmo/PayPal activity, and other account data is what lets us enrich, split, and deduplicate transactions.

## What this unlocks

- **True spend** — transfers, card payments, and reimbursed amounts never distort the numbers.
- **Money owed to me** — fronted group expenses (paid for everyone, getting venmoed back), planned returns, expected refunds.
- **Detailed understanding** — groceries vs supermarkets, glasses vs derm vs psych, what "bill pay" actually is.
- **Balances everywhere** — cash, credit owed, bills due, and fragmented money: 401k, Fidelity, Robinhood, Kalshi.
- **Smart LLM categorization** that learns from corrections.
- **Catching and predicting charges** I didn't know were happening — forgotten billing, overcharges.
- **Taxes** — payments, surpluses, deficits.
- **Invoices** arriving in Gmail, tracked from arrival to resolution.

## Sources of truth

Gmail (receipts, invoices) · text messages (receipts) · Plaid (banks, cards) · Venmo · PayPal · Fidelity and other institutions · manual entry and statement files.

## The wedge

Not "prettier Monarch." The differentiators: true spend, reimbursements, returns, receipts, the review queue, and learn-from-corrections behavior.

## Platforms & experience

Website first, then an iOS app. Sign in with Google (managed auth, e.g. Clerk). Push notifications. A fast, tinder-style review flow for categorizing, correcting, and annotating. Proper user registration and onboarding.

## MVP

An app that tracks expenses, transactions, recurring expenses, upcoming expenses, and cash flow. Nothing more. The 19-leaf path is in [FEATURES.md](../FEATURES.md).

## Phase guidance

- **Phase 0** — product skeleton and schema *(the only phase the original roadmap spells out; later phases are derived)*
- **Phase 1** — Plaid sandbox → real sync
- **Phase 2** — manual categorization and rules
- **Phase 3** — reimbursements, returns, and true spend
- **Phase 4+** — receipts, smarter categorization, recurring detection, mobile, broader import coverage

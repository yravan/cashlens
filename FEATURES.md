# Cash Lens — Feature Tree

**North star:** see every dollar in and out, know where and why, trust the categories, and know what's coming — a single source of truth for personal finances.

**The wedge** (why this beats a prettier Monarch): true spend, reimbursements, returns, receipts, a review queue, and learning from corrections.

## How to read this tree

- Every node is an idea in under 50 words — no implementation details.
- **Leaves are agent-sized:** each should land in 1–3 PRs, roughly ≤500 lines, reviewable in one sitting.
- Priorities: `[MVP]` build first · `[P1]` good to have — makes it a daily driver · `[P2]` nice to have · `[P3]` someday.
- A branch's tag is the earliest tag inside it.
- To extend: add leaves under the branch they belong to; keep them atomic.

## MVP path — 19 leaves, in build order

The MVP: track expenses, transactions, recurring and upcoming charges, and cash flow, on the web.

1. **1.1.1** Google sign-in
2. **1.1.2** User identity & data scoping
3. **1.2.1** App shell & navigation
4. **3.1.1** Ledger data model
5. **1.3** Production deployment
6. **2.1.2** Connection credential storage
7. **2.1.1** Plaid connect flow
8. **2.1.3** Initial history backfill
9. **2.1.4** Continuous sync
10. **2.1.5** Connection management
11. **6.3.1** Accounts overview page
12. **3.6.1** Transaction history page
13. **4.1.1** Category taxonomy & manual assignment
14. **4.2.1** LLM auto-categorization
15. **3.3.1** Internal transfer matching
16. **6.1.1** Cash-flow summary (true spend)
17. **6.2.1** Spending by category
18. **6.4.1** Recurring charge detection
19. **6.4.2** Upcoming expenses view

---

## 1. Platform & Identity

*Everything a signed-in person needs to use the product on the web.*

- **1.1 Authentication & users** `[MVP]`
  - **1.1.1 Google sign-in** `[MVP]` — Sign in and sign up with Google through a managed auth provider. Signed-out visitors land on a login page; sessions persist across visits.
  - **1.1.2 User identity & data scoping** `[MVP]` — First sign-in creates the user record. Every piece of financial data belongs to exactly one user and is invisible to everyone else.
  - **1.1.3 Account deletion** `[P2]` — Permanently delete an account: all financial data erased, all provider access revoked.
- **1.2 Web app shell** `[MVP]`
  - **1.2.1 App shell & navigation** `[MVP]` — Signed-in layout with navigation between Dashboard, Transactions, and Accounts, plus sign-out. Responsive enough to use from a phone browser.
  - **1.2.2 Settings & profile page** `[P1]` — See who you are, sign out, manage preferences, and jump to connection management.
  - **1.2.3 Onboarding flow** `[P1]` — First-run walkthrough: connect a first account and watch data appear. Sets expectations while backfill runs.
  - **1.2.4 Empty, loading & error states** `[P2]` — Every page communicates clearly when data is missing, loading, or failed.
- **1.3 Production deployment** `[MVP]` — The app and its database run at a stable public URL; changes ship to it automatically.

## 2. Account Connections

*Every place money data lives: connect it, keep it flowing, repair it when it breaks.*

- **2.1 Banks & cards via Plaid** `[MVP]`
  - **2.1.1 Connect flow** `[MVP]` — From the app, link a bank or card through Plaid and land back with the institution and its accounts registered.
  - **2.1.2 Connection credential storage** `[MVP]` — Per-user connection secrets stored server-side, encrypted, never exposed to the browser, and removable on disconnect.
  - **2.1.3 Initial history backfill** `[MVP]` — On connect, pull all available past transactions and balances so history is populated from day one.
  - **2.1.4 Continuous sync** `[MVP]` — New, changed, and removed transactions plus fresh balances flow in automatically, shortly after they happen.
  - **2.1.5 Connection management** `[MVP]` — See each connection's status; repair broken logins by re-authenticating; disconnect and optionally purge imported data. Buttons for all of it.
  - **2.1.6 Connection health & history** `[P2]` — Per-institution last-sync time, error timeline, and a manual "sync now".
- **2.2 Manual & file input** `[P1]`
  - **2.2.1 Manual transactions** `[P1]` — Add, edit, and delete transactions by hand — cash spending and anything no feed can see.
  - **2.2.2 Statement file import** `[P1]` — Upload CSV or statement exports to backfill accounts a connection can't reach; rows land in the ledger like any other source.
  - **2.2.3 Offline accounts** `[P1]` — Track accounts with no feed — cash, prepaid balances, niche platforms like Kalshi — by periodically updating a balance.
- **2.3 Gmail ingestion** `[P1]`
  - **2.3.1 Gmail connect** `[P1]` — Authorize read access to the inbox, scoped to finding financial mail; disconnectable like any other source.
  - **2.3.2 Receipt & invoice detection** `[P1]` — Continuously identify emails that are receipts, invoices, bills, or payment confirmations, and store them as documents with merchant, date, and amount.
  - **2.3.3 Receipt parsing & line items** `[P1]` — Extract structured line items from receipt emails: products, prices, tax, tip.
  - **2.3.4 Inbox backfill** `[P1]` — Scan historical email for past receipts and invoices, so old transactions get explained too.
  - **2.3.5 Invoice & bill tracking** `[P2]` — Invoices found in email become trackable obligations: due date, amount, paid or unpaid, matched to the eventual payment.
- **2.4 Peer-to-peer platforms** `[P1]`
  - **2.4.1 Venmo activity** `[P1]` — Bring Venmo payments and receipts — with notes and counterparties — into the ledger for matching against bank entries.
  - **2.4.2 PayPal activity** `[P2]` — The same, for PayPal.
- **2.5 Investment accounts** `[P2]` — Connect brokerage and retirement accounts (Fidelity, Robinhood, a 401k) for balances and holdings, so fragmented money and net worth are complete.
- **2.6 Text-message receipts** `[P3]` — Ingest receipts and alerts that arrive by SMS.

## 3. Ledger Core

*One canonical, per-user record of financial truth that every feature reads and writes.*

- **3.1 Canonical model** `[MVP]`
  - **3.1.1 Ledger data model** `[MVP]` — Accounts, balances, and transactions with amount, date, merchant, source, and status — plus room for enrichment. The single source of truth for everything downstream.
  - **3.1.2 Balance history** `[P1]` — Daily balance snapshots per account, enabling trends and net worth over time.
- **3.2 Transaction lifecycle** `[P1]`
  - **3.2.1 Pending-to-posted reconciliation** `[P1]` — A pending charge and its posted version resolve to one transaction, never duplicates.
  - **3.2.2 Edits & annotations** `[P1]` — Rename merchants, add notes, hide or ignore transactions; user edits survive re-syncs.
  - **3.2.3 Document attachments** `[P2]` — Any file — a photo, a PDF — can be attached to a transaction by hand and appears on its detail view.
- **3.3 Deduplication & matching** `[MVP]`

  *One real-world event appears exactly once, enriched by every source that saw it.*
  - **3.3.1 Internal transfer matching** `[MVP]` — Pair moves between your own accounts — credit-card payments, savings transfers — so flow numbers never double-count them.
  - **3.3.2 Cross-source duplicate merge** `[P1]` — The same purchase seen by two sources (bank and Venmo, two feeds) merges into one enriched transaction.
  - **3.3.3 Receipt-to-transaction matching** `[P1]` — Parsed receipts attach to the card transaction they explain, by amount, date, and merchant similarity; itemization travels with the match.
- **3.4 Shared money & true spend** `[P1]`
  - **3.4.1 Transaction splitting** `[P1]` — Split one transaction into parts with independent categories and amounts — one payment covering rent plus utilities, a group dinner, or a receipt's individual items. The ledger's decomposition primitive.
  - **3.4.2 Reimbursement tracking** `[P1]` — Mark amounts others owe you; incoming Venmo or payments settle them; spending totals reflect only your true share.
  - **3.4.3 Returns tracking** `[P1]` — Flag purchases you intend to return, match the refund when it lands, and surface refunds that never arrive.
  - **3.4.4 Owed-money view** `[P2]` — A standing answer to "who owes me what, and what am I expecting back?"
- **3.5 Expected & future transactions** `[P1]`
  - **3.5.1 Scheduled obligations** `[P1]` — Record known future charges — rent, insurance, tuition — so they appear in upcoming views before any bank sees them.
  - **3.5.2 Expectation matching** `[P2]` — When a scheduled charge arrives, link it to its obligation automatically; alert when it's overdue or the amount is wrong.
- **3.6 Ledger views** `[MVP]`
  - **3.6.1 Transaction history page** `[MVP]` — Chronological, searchable list of all transactions; filter by account, category, date, and amount; shows each transaction's source and status.
  - **3.6.2 Transaction detail view** `[P1]` — Everything about one transaction: source data, category and why, splits, matches, attachments, edit history.
  - **3.6.3 Global search** `[P2]` — Find anything — merchant, note, line item, amount — from one search box.

## 4. Categorization & Enrichment

*Every transaction gets a correct, explainable category with minimal user effort.*

- **4.1 Category system** `[MVP]`
  - **4.1.1 Category taxonomy & manual assignment** `[MVP]` — A sensible default category tree, granular enough to separate groceries from supermarkets or glasses from derm from psych. Any transaction's category can be set from the UI.
  - **4.1.2 Custom taxonomy editing** `[P1]` — Add, rename, nest, and retire categories so the tree matches how you actually think.
  - **4.1.3 Tags** `[P1]` — Free-form labels that cut across categories: a trip, reimbursable, tax-related.
- **4.2 Automatic categorization** `[MVP]`
  - **4.2.1 LLM auto-categorization** `[MVP]` — Every uncategorized transaction — new or backfilled — gets a category, a confidence, and a one-line reason from an LLM. Low-confidence results are flagged for review.
  - **4.2.2 Rules** `[P1]` — User-defined rules (merchant or amount patterns → category, tag, or ignore) that run deterministically before the LLM.
  - **4.2.3 Learning from corrections** `[P1]` — Corrections become durable knowledge: the same merchant never needs correcting twice.
  - **4.2.4 Re-categorization runs** `[P2]` — Re-run categorization over history after taxonomy or rule changes, with a preview of what would change.
- **4.3 Line-item categorization** `[P1]` — Receipt line items get their own categories, so one Costco run truthfully splits into groceries versus household. Aggregations use items when present.
- **4.4 Merchant enrichment** `[P1]` — Cryptic bank strings resolve to clean merchant names and logos, shared across a merchant's transactions — so "BILL PAY" and processor prefixes finally say who was paid.

## 5. Review & Data Quality

*Human-in-the-loop curation with minimal effort — the data stays trustworthy.*

- **5.1 Review queue** `[P1]` — One inbox for everything needing attention: low-confidence categories, suspected duplicates, unmatched refunds. Badge shows the count; clearing it feels good.
- **5.2 Rapid review UI** `[P1]` — Tinder-style flow: one transaction at a time, swipe or keystroke to accept, recategorize, split, or annotate. Built to clear hundreds fast.
- **5.3 Bulk editing** `[P2]` — Select many transactions and recategorize, tag, or hide them in one action.
- **5.4 Merge review** `[P2]` — Approve or reject suggested duplicate merges and receipt matches.
- **5.5 Backfill review campaign** `[P2]` — A guided, chunked pass over years of history until the whole ledger is trusted.

## 6. Insights & Reporting

*The answers: where money goes, what's truly mine, and what's next.*

- **6.1 Cash flow** `[MVP]`
  - **6.1.1 Cash-flow summary** `[MVP]` — Dashboard of money in, money out, and net by month — with true spend: transfers and card payments never double-count.
  - **6.1.2 Flow drill-down** `[P1]` — Click any number or month to see exactly the transactions behind it.
  - **6.1.3 Income view** `[P2]` — Paychecks, refunds, reimbursements, and other inflows, separated and trended.
- **6.2 Spending breakdowns** `[MVP]`
  - **6.2.1 Spending by category** `[MVP]` — Totals per category for any period, drillable to the underlying transactions — the "understand groceries and health in detail" view.
  - **6.2.2 Merchant breakdown** `[P1]` — Top merchants, and per-merchant totals and history.
  - **6.2.3 Trends & comparisons** `[P1]` — Category spending across months; this month versus typical.
- **6.3 Balances & net worth** `[MVP]`
  - **6.3.1 Accounts overview page** `[MVP]` — Every account with its live balance, grouped by type, with totals for cash on hand and credit owed — how much money is where, right now.
  - **6.3.2 Net worth over time** `[P1]` — Assets minus liabilities, trended from balance history.
- **6.4 Recurring & upcoming** `[MVP]`
  - **6.4.1 Recurring charge detection** `[MVP]` — Repeating charges — subscriptions, bills, paychecks — detected with cadence and typical amount, listed for confirmation.
  - **6.4.2 Upcoming expenses view** `[MVP]` — Calendar and list of predicted next charges from recurring patterns, with the expected total still to leave this month.
  - **6.4.3 Subscription manager** `[P1]` — All recurring items with annual cost; confirm, dismiss, or mark canceled; price increases highlighted.
- **6.5 Surprises & anomalies** `[P1]`
  - **6.5.1 Unexpected charge detection** `[P1]` — First-time merchants, resumed subscriptions, off-schedule or duplicate charges flagged as they arrive.
  - **6.5.2 Amount anomalies** `[P1]` — Charges that deviate from their own history — the UPS overcharge — flagged with the comparison.
- **6.6 Budgets & targets** `[P2]`
  - **6.6.1 Category targets** `[P2]` — Monthly targets per category with progress, informed by actual history — the "adjust macro percentages" loop.
- **6.7 Taxes** `[P2]`
  - **6.7.1 Tax payments view** `[P2]` — Every tax payment and refund across accounts in one place, with year totals and surplus or deficit.
  - **6.7.2 Deductible flagging** `[P3]` — Tag potentially deductible spending all year; export a year-end summary.
- **6.8 Data export** `[P3]` — Full transactions, categories, and balances out as CSV or JSON; the source of truth is never locked in.

## 7. Notifications & Alerts

*The app reaches out when something happens — never noisily.*

- **7.1 In-app notification feed** `[P1]` — Notification center with an unread badge: new transactions and connection problems. Mark read, or read all.
- **7.2 Notification preferences** `[P1]` — Choose which events notify, through which channel, and how often. Quiet by default.
- **7.3 Web push** `[P2]` — Browser push for chosen events when the app is closed.
- **7.4 Email notifications** `[P2]` — Chosen events, plus weekly or monthly digests of flows, anomalies, and upcoming bills — by email.
- **7.5 Smart alerts** `[P2]` — Anomalies, due bills, broken connections, and overdue refunds become actionable notifications, routed by preference.

## 8. iOS App

*Native companion — the web ships first.* `[P2]`

- **8.1 App shell & sign-in** `[P2]` — Native iOS app with Google sign-in against the same account and data.
- **8.2 Core views** `[P2]` — Dashboard, accounts, and transactions on the phone; read-first parity with the web.
- **8.3 Review on the go** `[P2]` — The rapid-review flow built for thumbs — the killer phone use case.
- **8.4 Push notifications** `[P2]` — Device registration and delivery for chosen alerts.
- **8.5 Store release** `[P3]` — Ship via TestFlight, then the App Store.

## 9. Trust & Operations

*It keeps working, and you can tell.*

- **9.1 Sync reliability** `[P2]` — Failed syncs retry themselves; persistent failures surface to the user instead of rotting silently.
- **9.2 Data correctness audits** `[P3]` — Periodic self-checks that balances and flows reconcile against sources, with discrepancies flagged.

---

## Assumptions made while organizing (flag anything wrong)

- **Settings page is P1, not MVP** — the Phase 0 sketch listed it, but the <20-leaf budget won; MVP connection controls live on the Accounts page.
- **Notifications are P1, not MVP** — Phase 0 listed them, but the stated MVP (expenses, transactions, recurring, upcoming, cash flow) doesn't include them. The in-app feed leads the P1 wave; push (web and iOS) stays P2.
- **Internal transfer matching is MVP** — it took notifications' slot in the 19-leaf budget: cash flow that double-counts card payments and transfers isn't cash flow.
- **iOS is a P2 branch** — "website and iOS app" is the vision, but the web alone delivers the MVP.
- **The wedge features are all P1** — manual entry, Gmail receipts (including inbox backfill), Venmo, splits, reimbursements, returns, the review queue, learning from corrections, line-item categories, merchant enrichment, and anomaly detection: the first wave after MVP, in roughly the order listed.
- **Merchant enrichment is P1, not P2** — "understand what my bill pay is" is an explicit vision goal, and it lives or dies on decoding cryptic bank strings.
- Naming Plaid, Gmail, Venmo, and Google is treated as product scope, not implementation detail.

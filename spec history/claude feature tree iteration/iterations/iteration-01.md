# Iteration 01 (v1)

**Author:** Claude (refinement pass 1 of 8) · **Date:** 2026-05-29

## Summary

First holistic refinement pass. Closed the baseline's biggest gap by adding a one-line `_accept:_` acceptance criterion and a `_test:_` layer to **every** leaf (100% coverage), grounded data-touching leaves in the real `models.py`/`schemas.py`/`api-types`, broadened dependency edges (142 distinct, internally consistent — no dangling/self/cycles), audited sizing so **no leaf exceeds `M`** (all `L` leaves split or descoped), and added cross-cutting (`_xc:_`) + `_risk:_` annotations. Added coverage for the baseline's named gaps: budgets/overspend alerts, household/multi-user, goals/savings, transaction notes/tags/attachments, backup/restore, and cash reconciliation.

## Stats

- Leaves: **295 → 332** (+37)
- Epics: 17 (unchanged) · Feature groups: 85 → 89 (+4: AUT-5 Household, NAV-5 Notes/Tags/Attachments, RPT-7 Goals & savings, RPT-8 Saved & export split off old RPT-7)
- Size distribution now: **S 91 · M 241 · L 0** (was: many `L`). Nothing exceeds `M`.
- Status (preserved from repo truth): built 27 · partial 38 · new 267.
- `_accept:_` coverage: **332/332** · `_test:_` coverage: **332/332**.

## What changed per epic (terse)

- **PLT** — Grounded migration leaves in the 7 real tables; added OIDC-secured task handler, DLQ, metrics from `sync_runs`; acceptance/tests on all 29.
- **SEC** — Split account-deletion (see below); added cascade-delete migration, backup/restore drill + import-restore; tightened authz/crypto/`_risk:_` on tokens & rate-limit shared-store note.
- **AUT** — Grounded user provisioning on `external_auth_user_id` upsert; **added AUT-5 Household/shared-access group** (spike + model + invite + household row-scoping).
- **ONB** — Added deps to AUT/CAT/NTF/SRC; demo→real migration made idempotent + demo-only.
- **SRC** — Split provider interface + Gmail fetch + file import (below); grounded `plaid_items`→`connections` migration with FK/type deltas; Venmo/PayPal/investments/Gmail risks documented.
- **ING** — Grounded cursor/pending-posted/removed handling in real columns; added partial-failure isolation acceptance; idempotency everywhere.
- **LDG** — Split transfer detection + money migration (below); **added LDG-3.5/3.6 balance reconciliation + manual cash reconcile**; ordered money migration (4.3 schema/backfill → 4.4 cutover → 4.1 multi-currency → 4.2 FX).
- **ENR** — Split matching framework, dedup, splitting into candidate-gen + scoring/apply (below); grounded `match_links`/`purchase_groups`/`transaction_splits` with sum invariants.
- **RCP** — Split HTML parser + OCR (below); descoped RCP-2.3/4.2 L→M; added sum-invariant tests for line-item extraction; `_risk:_` on OCR cost + LLM hallucination.
- **CAT** — Resized LLM service L→M; CAT-4.4 reclaimed as the prompt/taxonomy-grounding leaf (constrains 4.1 to valid enum); learning loop grounded in `category_corrections`.
- **OWE** — Grounded receivables/returns/bills/scheduled in integer-money tables with sum invariants; Venmo-back + refund matching tied to ENR scoring.
- **INT** — Split recurring/forecast/anomaly into algorithm + model/API halves (below); all intelligence leaves now `M`.
- **RPT** — Split widget dashboard + Sankey (below); **added RPT-2.4 aggregation API** (powers all charts), **RPT-6.4 overspend alerts**, **RPT-7.3/7.4 savings goals**; moved Saved/Export to new RPT-8 (IDs RPT-7.1/7.2 preserved).
- **REV** — Split swipe UI into gesture component + screen wiring (below); grounded queue in low-confidence/uncategorized `ledger_events`.
- **NAV** — Split filters into API + UI (below); **added NAV-5 group: tags model, notes, persistence API, attachments** (closes notes/tags/attachments gap); FTS via Postgres trigram.
- **NTF** — Split web-push into SW/subscribe + storage + send (below); grounded in-app center on real `/notifications` endpoints.
- **IOS** — Split shell + txn list + made review/offline `M` (below); added shared design-system leaf; every screen tied to a web parity dep.

## Leaves split (original ID kept; new sibling = next free number)

| Original `L` | Kept | New sibling |
|---|---|---|
| SRC-1.1 Provider abstraction | SRC-1.1 (interface contract) | **SRC-1.6** (Plaid adapter conformance) |
| SRC-6.3 Gmail search+fetch | SRC-6.3 (query builder) | **SRC-6.5** (fetch + raw store) |
| SRC-8.1 CSV/OFX/QFX | SRC-8.1 (CSV) | **SRC-8.4** (OFX/QFX) |
| SEC-3.1 Account deletion | SEC-3.1 (orchestration) | **SEC-3.5** (cascade-delete migration) |
| LDG-2.2 Transfer detection | LDG-2.2 (candidate pairing) | **LDG-2.6** (confirmation + flag) |
| LDG-4.3 Money migration | LDG-4.3 (schema+backfill) | **LDG-4.4** (read/write cutover) |
| ENR-2.1 Matching framework | ENR-2.1 (candidate gen) | **ENR-2.6** (scoring + link model) |
| ENR-3.1 Dedup rules | ENR-3.1 (canonical model) | **ENR-3.4** (apply to totals) |
| ENR-4.1 Split into line items | ENR-4.1 (split model) | **ENR-4.4** (split editor UI) |
| RCP-1.4 Email HTML parser | RCP-1.4 (header parse) | **RCP-1.5** (line-item parse) |
| RCP-2.2 OCR→fields | RCP-2.2 (text extraction) | **RCP-2.5** (text→structured fields) |
| INT-1.1 Recurring detection | INT-1.1 (grouping) | **INT-1.5** (cadence inference) |
| INT-3.1 Cash-flow forecast | INT-3.1 (forecast engine) | **INT-3.4** (horizons API) |
| INT-4.1 Anomaly detection | INT-4.1 (baseline+scoring) | **INT-4.5** (surfacing + dismiss) |
| RPT-1.2 Widget dashboard | RPT-1.2 (framework) | **RPT-1.5** (drag-reorder/visibility) |
| RPT-2.2 Sankey | RPT-2.2 (data builder) | **RPT-2.5** (visualization) |
| REV-2.1 Swipe card UI | REV-2.1 (gesture component) | **REV-2.5** (screen + queue wiring) |
| NAV-3.1 Transaction filters | NAV-3.1 (filter API) | **NAV-3.4** (filter UI) |
| NTF-3.1 Web push subscription | NTF-3.1 (SW + subscribe) | **NTF-3.3** (subscription storage) |
| IOS-1.2 Shell + nav | IOS-1.2 (tab nav) | **IOS-1.5** (design system) |
| IOS-2.2 Txn list + detail | IOS-2.2 (virtualized list) | **IOS-2.6** (detail + edit) |

**Descoped `L`→`M` (not split):** RCP-2.3, RCP-4.2, IOS-2.3, IOS-3.4 — tightened scope to fit `M`.

## New coverage-gap leaves (net adds beyond splits)

- **Budgets/alerts:** RPT-6.4 (overspend alerts).
- **Household/multi-user:** AUT-5.1 spike, AUT-5.2 model, AUT-5.3 invite, AUT-5.4 household row-scoping.
- **Goals/savings:** RPT-7.3 goal model, RPT-7.4 progress view.
- **Notes/tags/attachments:** NAV-5.1 tags, NAV-5.2 notes, NAV-5.3 persistence API, NAV-5.4 attach file.
- **Backup/restore:** SEC-3.6 backup+restore drill, SEC-3.7 import-from-export.
- **Cash reconciliation:** LDG-3.5 derived-vs-reported reconciliation, LDG-3.6 manual cash adjustment.
- **Reporting backbone:** RPT-2.4 aggregation query API (shared by all charts/reports).

## Merges / ID handling

- **No deletions, no renumbering.** All baseline IDs preserved.
- `CAT-4.4` (baseline "Prompt + taxonomy grounding") was **kept at its original ID** — when resizing CAT-4.1 I briefly drafted a `CAT-4.6` for grounding, then corrected it back to the existing `CAT-4.4` to honor the stable-ID invariant. CAT-4.1 was therefore **resized L→M**, not split.
- Old group "RPT-7 Saved & export" renamed to **RPT-8** to make room for "RPT-7 Goals & savings", but leaf IDs `RPT-7.1`/`RPT-7.2` were left unchanged (group heading is cosmetic; IDs are the contract).

## Decisions

- **Money ordering:** integer-minor-units migration is split into schema+backfill (LDG-4.3) → app/API cutover (LDG-4.4), and every money leaf carries `_xc: money`. Many ledger/matching/split leaves now `deps: LDG-4.3` so amount comparisons are exact.
- **Matching as 2 stages:** candidate generation (cheap blocking) vs scoring/linking, so per-source matchers (Venmo/PayPal/receipt) depend only on the scoring layer.
- **Dedup vs duplicate-charge** explicitly separated (ENR-3 = one purchase across N sources; INT-4.2 = a genuine double charge) to avoid the classic false-positive.
- **LLM safety:** CAT-4.1 constrained to taxonomy enum; RCP-2.3 validates a sum invariant; SEC-5.2 pins a no-train provider — all flagged `_risk:_`.
- **Provider neutrality first:** SRC-1.2 (`plaid_items`→`connections`) is on the critical path before per-provider matchers, so Venmo/PayPal/CSV land as `provider=` rows in one raw store.
- **Starter slice + phase rollup** added to the tree header to make build order explicit.

## Open questions (seed iteration 2)

1. **Household model (AUT-5.1):** household-tenant vs per-resource sharing changes the row-scoping story for *every* data leaf. Resolve early; today scoping is `user_id`-only.
2. **Bank provider (SRC-1.5):** project memory says Teller-default but the repo is Plaid-only. Need a real cost/coverage decision; it changes investment + identity coverage.
3. **Vendor feasibility unverified:** Venmo (no consumer API), PayPal Transaction Search window/scopes, Plaid Investments broker coverage (Kalshi/Robinhood gaps), and Google restricted-scope (CASA) timeline for Gmail are still `research` spikes — none web-verified this pass.

## Self-critique (what's still weakest → iteration 2)

1. **Test specificity:** `_test:_` names a layer but rarely the concrete fixture/invariant. Iteration 2 should make high-value data leaves (matching, dedup, money migration, true-spend) cite the exact golden dataset / invariant asserted.
2. **Dependency completeness vs minimality:** 142 edges resolve cleanly, but some are likely over- or under-specified. Build a phase/critical-path diagram and prune redundant transitive deps; confirm acyclicity programmatically each pass.
3. **Spikes lack cost/timebox:** research leaves have `_risk:_` but no `_accept:_`-style decision deadline or $ estimate (esp. LLM/OCR spend, vendor access). Add a one-line decision-by + rough cost.
4. **Cross-cutting still uneven:** `_xc:_` added broadly but `obs`/`rate`/`a11y` are probably missing on some leaves that need them (e.g., every LLM/OCR call should be `rate`+`obs`; every interactive screen `a11y`). Audit systematically.
5. **`_data:_` granularity:** several leaves name a table but not the column types / index / unique constraints. Iteration 2 should specify unique keys + indexes where idempotency or query performance depends on them.
6. **iOS parity tests are all `manual`:** acceptable for now, but consider Detox/XCUITest leaves or explicit "manual test script" artifacts so iOS isn't a verification black hole.
7. **No data-volume/perf leaves:** nothing covers pagination limits, large-account backfill performance, or report query cost at 100k+ transactions. Consider a perf/scale group.

## Invariants honored

IDs stable; no leaf deleted; coverage grew (+37); server-verified identity reinforced (SEC-1.1/1.2, AUT-3.1); encrypted tokens (SEC-1.3); migration-safe + idempotent data leaves tagged `_xc: idem`; money never on floats post-LDG-4.3/4.4 (`_xc: money`). Verified: 332 leaves, 0 duplicates, 0 dangling deps, 0 leaves above `M`, 100% `_accept:_`/`_test:_`.

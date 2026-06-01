# Iteration 02 (v2)

**Author:** Claude (refinement pass 2 of 8) · **Date:** 2026-05-29

## Summary

Second holistic pass focused on the iteration-01 self-critique. Defined a shared **golden-fixture corpus** (`GF-DEDUP/TRANSFER/CARDPAY/TRUESPEND/RECURRING/SPLIT/MONEY/REPLAY`) once in the header and wired the wedge leaves' `_test:_` to cite a named fixture + invariant; added `_cost:_` + `_decide-by:_` (with web-verified vendor grounding) to **all 11** `research` spikes; **broke the one dependency cycle** (`SEC-5.2 ↔ CAT-4.1`), pruned **11** redundant transitive `_deps:_` edges, and added a critical-path view; systematically closed `obs`/`rate`/`a11y` gaps; and added a new **PLT-8 Performance & scale** group plus sharper `_data:_` (unique keys/indexes) on idempotency-critical leaves. Sharpened the household-model and provider-choice open questions into concrete decisions.

## Stats

- Leaves: **332 → 336** (+4; new group PLT-8 only — all other improvements were in-place edits)
- Epics: 17 (unchanged) · Feature groups: 89 → 90 (+1: PLT-8 Performance & scale)
- Dependency graph (verified programmatically): **336 nodes, 0 dangling, 0 self-loops, 0 cycles, 0 redundant transitive edges** (was: 1 cycle + 11 redundant in v1).
- `research` spikes with `_cost:_` + `_decide-by:_`: **11/11**.
- All **332 v1 IDs preserved**; 4 net-new IDs (PLT-8.1–8.4). No deletions, no renumbering.

## What changed per epic (terse)

- **PLT** — Added **PLT-8** group: keyset pagination (8.1), large-backfill perf budget (8.2), report-aggregation query budget+indexes (8.3), load/scale seed harness (8.4) — closes v1's "no perf/scale leaves" gap. Tightened PLT-2.3 to cite `GF-REPLAY`.
- **SEC** — **Fixed cycle**: removed `SEC-5.2 → CAT-4.1` (policy precedes implementation; CAT-4.1 still depends on SEC-5.2). Added cost/decide-by to SEC-2.3/5.1/5.2; append-only index on `audit_log` (4.1); deletion/export tests now assert row-count parity.
- **AUT** — **Resolved household open question** (AUT-5.1): lean = reserve nullable `household_id` now so AUT-5.4 is an additive scoping-widen, not a re-scoping migration; documented the authz predicate. Added a11y to interactive web leaves (1.2/2.2/4.1/4.2/5.3); AUT-3.1 cites `GF-REPLAY` + the real `unique` constraint.
- **ONB** — No structural change (already well-covered); inherits sharper upstream deps.
- **SRC** — **Sharpened provider spike (1.5)** with web-grounded pricing (Plaid per-call vs Teller/SimpleFIN flat) + cost-per-active-user exit criterion. Venmo spike (3.1) grounded: Developer/Payouts API retired to new devs → CSV-only. Cost/decide-by on 1.5/3.1/4.1/5.1/6.1/7.1. Named dedup keys on 3.3/8.1; FK list on 1.2 migration.
- **ING** — Idempotency leaves (1.1/2.3/4.1/4.2) now cite `GF-REPLAY`/concrete pending-vs-posted fixtures + real unique constraints.
- **LDG** — Wedge `_test:_` rewritten to cite golden fixtures: transfers (2.2/2.6 = `GF-TRANSFER`), card-pay (2.3 = `GF-CARDPAY`), true-spend (2.4 = `GF-TRUESPEND`), money migration (4.3 = `GF-MONEY`+`GF-REPLAY`, with per-currency exponent + balance_minor columns). Balance history unique `(account_id, as_of)`. a11y on 2.5/3.6.
- **ENR** — Matching/dedup/split `_test:_` now cite `GF-DEDUP`/`GF-SPLIT` with the "2 sources → exactly 1 ledger truth; replay no-op" invariant and `match_links`/`purchase_groups` uniqueness + precedence rules.
- **RCP** — OCR spike (2.1) grounded with measured costs (Textract ~$0.01/page; GPT-4o vision ~$0.01–0.03/receipt) + <$5 benchmark budget; LLM leaves (2.3/2.5) gained `rate`+`obs`; sum-invariant + hallucination-rejection tests.
- **CAT** — CAT-4.4 gained `rate`; taxonomy unique `(group_id, name)`; learning-loop tests now concrete (3 corrections → 1 rule suggestion; remembered-category pre-fill). Pruned CAT-3.1→PLT-2.1 (transitive via CAT-1.1).
- **OWE** — Sum-invariant tests via `GF-SPLIT` (1.3/2.1); pruned 4× redundant `PLT-2.1` edges + OWE-1.2→OWE-1.1; added per-table indexes.
- **INT** — Recurring/anomaly/price-change tests cite `GF-RECURRING`; INT-4.2 uses `GF-DEDUP` as a **negative control** (multi-source single purchase must NOT be flagged as a double charge); anomalies unique `(user_id, event_id)`.
- **RPT** — Aggregation backbone (2.4) cites `GF-TRUESPEND` reconciliation; a11y on export/saved-view (7.1/7.2); pruned RPT-7.3→PLT-2.1.
- **REV** — Queue builder (1.1) concrete fixture; a11y on bulk-review (4.1).
- **NAV** — Pruned NAV-3.4→NAV-3.1 (transitive via 3.2); named filter indexes (3.1); a11y on saved views (3.2).
- **NTF** — `push_subscriptions` unique `endpoint` + 410-prune test; trigger dedup (`GF-REPLAY`); digest/send gained `rate`.
- **IOS** — Stack spike (1.1) gained $99/yr + automated UI-test exit criterion (addresses "iOS is a manual verification black hole"); `manual` tests on user-facing leaves upgraded to `manual + UI-test`; a11y on native screens/capabilities (1.3/2.3/3.1–3.4).

## Splits / merges (old → new IDs)

- **No splits this pass** (all v1 `L`→`M` work was completed in v1; nothing exceeded `M`).
- **New leaves (net adds):** PLT-8.1, PLT-8.2, PLT-8.3, PLT-8.4 (Performance & scale group).
- **No merges, no deletions, no renumbering.**

## Pruned dependency edges (redundant transitive — 11)

`CAT-3.1→PLT-2.1` · `CAT-4.1→CAT-1.1` (already via SEC-5.2 chain) · `NAV-3.4→NAV-3.1` · `OWE-1.1→PLT-2.1` · `OWE-1.2→OWE-1.1` · `OWE-3.1→PLT-2.1` · `OWE-4.1→PLT-2.1` · `OWE-5.1→PLT-2.1` · `RCP-3.1→PLT-2.1` · `RCP-4.1→PLT-2.1` · `RPT-7.3→PLT-2.1`. Each target stays reachable via a retained edge (e.g. `→LDG-4.3→PLT-2.1` or `→CAT-1.1→PLT-2.1`); the direct edge was noise.

## Cycle fix

- v1 had **`SEC-5.2 → CAT-4.1 → SEC-5.2`**. Resolved by removing SEC-5.2's dep on CAT-4.1: the LLM data-handling **policy** spike must precede the **implementation**, and CAT-4.1 already (correctly) depends on SEC-5.2. Graph now acyclic (verified).

## Decisions

- **Household model:** reserve a **nullable `household_id`** on owned tables now (default null = personal); scoping predicate becomes `user_id == me OR household_id ∈ my_households`. Makes AUT-5.4 an additive widen, avoiding a painful re-scope. (Recorded on AUT-5.1/5.2/5.4.)
- **Bank provider:** kept open but **grounded** — Plaid is per-successful-call + monthly minimums; Teller/SimpleFIN are flat per-account/mo with different coverage. Decision criterion = cost-per-active-user at 100 & 1k users + investment coverage. Provider-neutral SRC-1.1/1.2 keep the choice swappable.
- **Venmo:** confirmed no sanctioned consumer/auto-sync API for new developers → CSV statement import is the only path (no auto-sync promised).
- **OCR/LLM cost:** cheap OCR (Textract/Tesseract) first for header fields, escalate to vision-LLM only on low confidence; every model-call leaf is `rate`+`obs` and validates a sum/enum invariant.
- **Golden fixtures** are now a first-class shared artifact (header block) so wedge correctness is tested against one canonical corpus instead of ad-hoc per-leaf data.

## Open questions (seed iteration 3)

1. **Provider decision still un-finalized** (SRC-1.5): grounded with pricing shape but needs real vendor quotes + the actual expected-user-count to pick a default; gates SRC-5 investment coverage and SRC-1.6 hardening.
2. **Gmail restricted-scope (CASA) timeline + recurring cost** (SRC-6.1): blocks production Gmail receipt auto-import; the SRC-7.2 forward-to-email fallback should likely ship first — confirm sequencing.
3. **Real-time vs polling for notifications/unread** (NTF-1.4 polls): at scale, is web-push (NTF-3) + SSE/WebSocket worth it, or is polling sufficient? Affects PLT-8 budgets and NTF architecture.

## Self-critique (what's still weakest → iteration 3)

1. **`_test:_` golden-fixture coverage is now strong on the wedge but uneven elsewhere** — reports (RPT-3/4/6), OWE returns (3.3), and forecasting (INT-3) still name a layer without a concrete fixture. Iteration 3 should extend the `GF-*` corpus (e.g. `GF-BUDGET`, `GF-FORECAST`) and wire those leaves.
2. **Indexes named on ~12 leaves but not comprehensively** — many `_data:_` lines still omit the unique key / index that idempotency or query perf depends on. Finish the audit (esp. ENR/CAT/INT model leaves).
3. **PLT-8 perf budgets are qualitative** ("documented budget") — iteration 3 should attach concrete numeric targets (e.g. aggregate p95 < 300ms @ 100k events; backfill < X MB peak) so they're testable, not aspirational.
4. **Observability still lacks a unifying spec** — many leaves carry `obs` but there's no leaf defining the canonical metric/trace names + dashboards beyond PLT-4.5. Consider an "obs contract" leaf so `obs` tags map to named signals.
5. **iOS verification** improved to `manual + UI-test` but the UI-test framework is still gated on the IOS-1.1 spike; until decided these remain effectively manual. Consider a concrete Detox/XCUITest harness leaf once the stack is chosen.
6. **Rate-limiting depends on a shared store** (SEC-4.2 notes Redis) but no leaf provisions it — Cloud Run multi-instance counters need a real backing store; iteration 3 should add/confirm a Redis (or equivalent) provisioning leaf that `rate` leaves depend on.
7. **Cross-source matching thresholds are unspecified numbers** (ENR-2.6 "high/mid/low") — iteration 3 should pin the score bands (or make them a tuned config leaf) so the `GF-DEDUP` assertions are deterministic.

## Invariants honored

IDs stable; **no leaf deleted**; coverage grew (+4 → 336); server-verified identity reinforced (SEC-1.1/1.2, AUT-3.1); encrypted tokens (SEC-1.3); migration-safe + idempotent data leaves tagged `_xc: idem` and now cite `GF-REPLAY`; money on integer minor units post-LDG-4.3/4.4 (`_xc: money`, `GF-MONEY`). **Verified programmatically: 336 leaves, 0 duplicate IDs, 0 dangling deps, 0 cycles, 0 redundant transitive edges, 0 leaves above `M`, 11/11 spikes carry cost+decide-by, all 332 v1 IDs present.**

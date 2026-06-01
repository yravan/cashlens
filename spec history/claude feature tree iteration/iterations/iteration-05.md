# Iteration 05 (v5)

**Author:** Claude (refinement pass 5 of 8) · **Date:** 2026-05-30

## Summary

Fifth holistic pass, driven by iteration-04's self-critique while touching the whole tree. **Added the write-path performance tier** (iteration-04 self-critique #4) — a new `ING-6.1` budgets the full ingest→normalize→match→dedup write chain (≥2,000 txns/min end-to-end, per-100 batch p95 <800ms, bounded match comparisons, never O(n²)), and the three main PATCH leaves (`LDG-2.5` exclude toggle, `CAT-2.1` inline category edit, `CAT-2.2` bulk categorize) now carry explicit write p95 budgets that assert cache-invalidation cost and lazy (not synchronous) recompute. **Made the SimpleFIN fallback actionable** (iteration-04 self-critique #6) — `SRC-1.7` is a new deferred, flag-gated SimpleFIN adapter conforming to the `SRC-1.1` Provider interface (setup-token→claim→access-URL→`/accounts` poll, transactions+balances only, no investments/webhooks), so the documented SRC-1.5 fallback is coded behind `PLT-5.3`, mirroring SRC-1.6 for Plaid. **Added combination-branch golden fixtures** (iteration-04 self-critique #3) — `GF-COMBO-SRR` (one $120 parent that is split + partly reimbursable + partly a return) and `GF-COMBO-DUPXFER` (a true double-charge that superficially looks like a transfer pair / dedup candidate), wired into ENR-4.3/3.1, LDG-2.2/2.4, and INT-4.2 to prove the wedge detectors stay mutually exclusive on colliding inputs. **Finished the `_files:_` audit** (iteration-04 self-critique #1): 140 → **333/345** — completed the priority RCP receipt/OCR services + RPT chart components, then swept every remaining non-research leaf (CAT, ENR, LDG, ING, REV, NAV, NTF, ONB, SRC, AUT, SEC, PLT, IOS). Only the 12 research spikes (doc deliverables) lack `_files:_` by design. **Disambiguated the overloaded `obs:request_id`** (iteration-04 self-critique #2) — durable-data/error-scrub leaves now tag `obs:request_id(durable)`; only PLT-4.1 (which defines the id) keeps the bare tag. **Resolved two carried open questions:** PLT-8.3 now explicitly picks **cache-first, materialized-rollup deferred** (open Q #2); ENR-2.7 explicitly keeps the match-config override **global-only** with the `scope` column reserved for future per-user/household rows (open Q #3).

## Stats

- Leaves: **343 → 345** (+2: `SRC-1.7`, `ING-6.1`). Epics: 17 (unchanged). Feature groups: 90 → **91** (new `ING-6 Write-path performance`).
- Dependency graph (verified programmatically): **345 nodes, 353 edges, 0 dangling, 0 self-loops, 0 cycles.**
- Size distribution: **S 95 · M 250 · L 0** — nothing exceeds `M`.
- `_files:_` coverage: **140 → 333/345** (+193). All non-research leaves now carry `_files:_`; the only 12 without are `research` spikes (deliverable = doc/decision).
- `_perf:_` numeric targets: **9 → 14** (+5: `ING-6.1` write chain, `CAT-2.1`/`LDG-2.5` PATCH p95, `CAT-2.2` bulk PATCH p95; the read tier from v4 retained).
- Golden fixtures: 16 → **18** (added `GF-COMBO-SRR`, `GF-COMBO-DUPXFER`).
- `research` spikes with `_cost:_` + `_decide-by:_`: **12/12** preserved.
- All **343 v4 IDs preserved** (verified); 2 net-new IDs. No deletions, no renumbering.
- File length: 983 → **990 lines** (audit kept inline/compact rather than ballooning).

## What changed per epic (terse)

- **PLT** — `PLT-8.3` resolved to **cache-first** (materialized rollup explicitly deferred to a future leaf). `PLT-4.2/4.3/5.1` retagged `obs:request_id(durable)`. `_files:_` added to all 27 PLT leaves missing them (Makefile/docker-compose/`.github/workflows/`/`core/*`/alembic).
- **SEC** — `SEC-4.1` audit + `SEC-4.4` redaction retagged `obs:request_id(durable)` and given `_files:_` (`core/audit.py`, `core/redaction.py`). `_files:_` added to every non-research SEC leaf (`core/crypto.py`, `services/account_deletion.py`, `services/data_export.py`, runbook docs).
- **AUT/ONB** — `_files:_` added to every non-research leaf, grounded in real `core/auth.py`/`core/scoping.py` (api) and `apps/web/lib/session.ts`/`middleware.ts`/`sign-in/...` (web) + forward-looking `apps/web/app/(app)/onboarding/`.
- **SRC** — **Added `SRC-1.7`** (deferred flag-gated SimpleFIN adapter, web-verified protocol: setup-token→claim→access-URL→`/accounts`, txns+balances only, no investments/webhooks). `_files:_` added to SRC-6.1/6.5. SRC-1.5 decision prose updated to point at SRC-1.7 as the now-actionable fallback.
- **ING** — **Added `ING-6` group + `ING-6.1`** write-chain budget (≥2,000 txns/min, bounded match fan-out, emits `sync.duration`+`match.links`). `_files:_` added to all 16 remaining ING leaves.
- **LDG** — `LDG-2.5` PATCH p95 budget added. `LDG-2.2` transfer-pairing + `LDG-2.4` true-spend wired to the new combo fixtures (same-direction rows aren't a transfer pair; split+reimbursable+return nets correctly). `_files:_` added to all 10 remaining LDG leaves.
- **ENR** — `ENR-2.7` open-Q #3 resolved (override stays global; `scope` reserved). `ENR-4.3`+`ENR-3.1` wired to `GF-COMBO-SRR`/`GF-COMBO-DUPXFER`. `_files:_` added to all 9 remaining ENR leaves.
- **RCP** — **Priority audit done:** `_files:_` added to all 15 RCP leaves missing them — receipt/OCR services grounded as `services/receipts.py`, `services/ocr.py`, `services/receipts/html_parsers/`, `services/invoices.py`, plus `apps/web/components/receipt-*.tsx`.
- **CAT** — `CAT-2.1`/`CAT-2.2` write-path p95 budgets added (single + bulk PATCH, single cache-invalidation). `_files:_` added to all 11 remaining CAT leaves (`services/rules.py`, `services/categorize.py`, `category-picker.tsx`).
- **OWE/INT** — already fully filed in v4; INT-4.2 duplicate-charge wired to `GF-COMBO-DUPXFER` (three detectors mutually exclusive).
- **RPT** — **Priority audit done:** `_files:_` added to all 18 RPT leaves missing them — chart components grounded as `apps/web/components/charts/{cash-flow-bars,sankey,category-donut,net-worth-line,trend-line,income-expense,merchant-leaderboard,macro-split}.tsx` + `apps/web/components/dashboard/*`.
- **REV/NAV/NTF** — `_files:_` added to all remaining web/api leaves (`components/review/*`, `command-palette.tsx`, `filter-panel.tsx`, `notification-center.tsx`, `services/push.py`, `lib/push.ts`).
- **IOS** — `_files:_` added to all 12 remaining non-research IOS leaves (`apps/ios/src/{screens,navigation,components,push,auth}/`, `fastlane/`, `ShareExtension/`).

## Splits / merges (old → new IDs)

- **No splits, no merges, no deletions, no renumbering.**
- **New leaves (net add, +2):**
  - **`SRC-1.7`** — SimpleFIN adapter (deferred fallback provider, flag-gated). Joins existing `SRC-1 Provider-agnostic framework` (placed after SRC-1.6 Plaid adapter).
  - **`ING-6.1`** — Ingest→normalize→match→dedup write-chain budget. Joins a **new feature group `ING-6 Write-path performance`** (the write-path counterpart to PLT-8 read perf).

## New / extended golden fixtures (header block)

- `GF-COMBO-SRR` — one $120 parent split 4×$30, 2 shares reimbursable + 1 share to-return. All three states coexist without cross-wiring: splits sum exactly; true-spend = payer's net (=$30 while return open, $0 after refund); settling a Venmo closes one receivable (not the return); a −$30 refund closes the return (not a receivable); replay-stable. (Wired: ENR-4.3, LDG-2.4.)
- `GF-COMBO-DUPXFER` — a genuine same-merchant same-account double −$60 charge that superficially resembles a transfer pair / dedup candidate. Invariants: NOT a transfer pair (needs opposite direction), NOT a dedup group (needs distinct sources), but IS flagged by duplicate-charge detection — the three detectors stay mutually exclusive. (Wired: LDG-2.2, ENR-3.1, INT-4.2.)

## Decisions

- **Write-path perf is now budgeted** (`ING-6.1` + PATCH p95 on LDG-2.5/CAT-2.1/CAT-2.2). Key invariant captured: writes flip flags + bump the PLT-9.2 cache version; expensive totals recompute **lazily on the next read**, never synchronously on the write. Matching fan-out per new event is bounded by the ENR-2.7 blocking key (no O(n²) cross-join on ingest).
- **SimpleFIN fallback is implementable, not just documented** (`SRC-1.7`). It is DEFERRED behind a `PLT-5.3` flag (default off) and only promoted if an SRC-1.5 re-decide trigger fires; capabilities correctly advertise no-investments so SRC-5 stays Plaid-only.
- **PLT-8.3: cache-first wins; materialized rollup deferred** (open Q #2). Covering index + PLT-9.2 cache meets the budget without the write-amplification/refresh-idempotency burden of a materialized table; revisit only if warm-cache miss rate proves too high.
- **ENR-2.7 match-config stays global-only** (open Q #3). The manual-confirm UI (ENR-2.5) covers per-link overrides; per-user/household band tuning isn't worth the scoping+test surface. `scope` column reserved so a future per-user row is additive.
- **`obs:request_id` overload removed** (self-critique #2). `(durable)` qualifier marks id-carriers whose deliverable is durable data / a log scrub; only PLT-4.1 keeps the bare tag (it defines the id).

## Open questions (seed iteration 6)

1. **Gmail restricted-scope (CASA) timeline + recurring cost** (`SRC-6.1`): still the top *external* unknown — blocks prod Gmail receipt auto-import; SRC-7.2 forward-to-email fallback ships first (encoded via deps). Carried from v2–v4; this tree can't supply the real-world CASA lead-time/cost.
2. **Write-path budgets are single-leaf; the *combined* sync burst is unmodeled.** ING-6.1 budgets the chain per batch, but a webhook storm (many items' `SYNC_UPDATES_AVAILABLE` at once) fans out across Cloud Run instances + the shared rate limiter (ING-5.2) + the match write-amplification simultaneously. Iteration 6 should add a concurrency/back-pressure budget (max in-flight sync jobs per instance, queue depth) so the write tier holds under burst, not just per-batch.
3. **Teller paid pricing is still UNVERIFIED** (`SRC-1.5`): the decision is sound (Plaid default, SimpleFIN coded fallback), but if a future re-decide trigger fires on cost, the Teller comparison still needs a sales-contact number. Low priority while Plaid is the default, but it's the one remaining hole in the provider cost matrix.

## Self-critique (what's still weakest → iteration 6)

1. **Combination fixtures cover two collisions but not three-way / fixture-on-fixture interactions.** `GF-COMBO-SRR` doesn't add a *deduped multi-source* leg to the split (e.g. the parent itself is bank+receipt deduped before splitting); `GF-COMBO-DUPXFER` doesn't combine with FX (two £-charges needing triangulation). Iteration 6 could add one deeper "stack three branches" fixture rather than more pairwise ones.
2. **Write-path p95 numbers are plausible but ungrounded by a real benchmark.** The ≥2,000 txns/min / <800ms / <200ms targets are reasoned from the read tier + batch sizes, not measured. They're testable (PLT-8.4 generator), but iteration 6 should flag which are *hypotheses to validate in the first perf run* vs hard SLOs, so an implementer doesn't treat a guess as a contract.
3. **`SRC-1.7` adds a 2nd provider but no cross-provider dedup fixture.** If a user runs Plaid AND SimpleFIN over overlapping institutions, the same transaction could arrive from both — that's exactly the cross-source dedup case, but no `GF` exercises Plaid-vs-SimpleFIN specifically. Iteration 6 should either confirm `GF-DEDUP` generalizes or add a provider-overlap variant.
4. **`_files:_` is now ~96% but several inferred paths are forward-looking guesses** (`services/ocr.py`, `services/rules.py`, `apps/web/components/charts/*`, `apps/ios/...`). They're grounded in the real layout conventions but the dirs don't exist yet; that's acceptable per the legend ("guidance, not a contract") but iteration 6 could mark which `_files:_` are verified-real vs conventional-inferred so an agent knows when it's creating a new file vs editing.
5. **The write-tier and read-tier perf leaves don't share one budget table.** PLT-8 (read) and ING-6 (write) + the scattered PATCH `_perf:_` lines are now spread across the file. A single "performance budget index" block (like the golden-fixtures and obs-contract blocks) would make the SLOs scannable in one place. Deferred to keep this pass focused.
6. **No leaf yet owns "feature-flag registry" as data** the way ENR-2.7 owns match-config. `SRC-1.7`, and several deferred features, now depend on `PLT-5.3` flags, but the set of flag *keys* (`provider.simplefin`, `gmail`, etc.) isn't enumerated anywhere. Iteration 6 could add a small flag-catalog (names + default + owning leaf) so flags don't sprawl.

## Invariants honored

IDs stable; **no leaf deleted**; coverage grew (+2 → 345); server-verified identity reinforced (SEC-1.1/1.2, AUT-3.1; AUT-5.4 widen is additive); encrypted tokens (SEC-1.3, SRC-1.7 reuses it) + Redis TLS/auth (PLT-9.1); migration-safe + idempotent data leaves tagged `_xc: idem` citing `GF-REPLAY` (SRC-1.7 re-sync = 0 new rows); money on integer minor units (`_xc: money`, `GF-MONEY`); staging/prod separation untouched; provider-abstraction (SRC-1.1/1.6/1.7) kept intact and the SRC-1.5 default stays swappable. **Verified programmatically: 345 leaves, 0 duplicate IDs, 0 dangling deps, 0 cycles, 0 self-loops, 0 leaves above `M`, 12/12 spikes carry cost+decide-by, all 343 v4 IDs present, every in-line `obs:<signal>` ∈ the PLT-4.6 contract (including the new `obs:request_id(durable)` convention).**

# Iteration 03 (v3)

**Author:** Claude (refinement pass 3 of 8) · **Date:** 2026-05-29

## Summary

Third holistic pass driven by iteration-02's self-critique while touching the whole tree. **Extended the golden-fixture corpus** to reports/forecast/budgets/returns/net-worth/FX (`GF-BUDGET/FORECAST/RETURN/NETWORTH/FX`) and wired the corresponding leaves' `_test:_` to cite a concrete invariant. **Pinned the cross-source match score bands** (auto-link ≥0.90 / review 0.60–0.899 / drop <0.60; weighted `0.5·amount + 0.3·date + 0.2·merchant`; ±3d window) in one header block + a referenced `match_config.py`, making `GF-DEDUP`/matching/dedup deterministic. **Added a Redis/cache provisioning leaf (PLT-9.1)** that every `rate`/cache leaf now depends on, plus a cache-invalidation leaf (PLT-9.2); rewired SEC-4.2, CAT-4.5, ING-5.2 onto it. **Attached numeric performance targets** to PLT-8 (dashboard p95 <400ms cold/<80ms warm, aggregate <300ms/<50ms, backfill ≥5k txns/min & <256MB, keyset page <150ms). **Added an observability-contract leaf (PLT-4.6)** naming the canonical signals every `obs` tag emits. **Introduced `_files:_`** (likely-touched paths inferred from the real repo layout) on 80 high-traffic leaves. Finished the unique-key/index audit on ENR/CAT/INT/OWE/RPT model leaves. Resolved two iteration-02 open questions with new spike/harness leaves (NTF-1.5 realtime-vs-polling, IOS-4.3 UI-test harness).

## Stats

- Leaves: **336 → 342** (+6). Epics: 17 (unchanged). Feature groups (`###` headings): **89 → 90** (+1: PLT-9 Caching & shared state).
- New leaves: **PLT-4.6** (obs contract), **PLT-9.1** (Redis/cache+counter store), **PLT-9.2** (cache invalidation/TTL), **PLT-8.5** (dashboard latency budget+cache), **NTF-1.5** (SPIKE realtime vs polling), **IOS-4.3** (automated UI-test harness).
- Dependency graph (verified programmatically): **342 nodes, 336 edges, 0 dangling, 0 self-loops, 0 cycles.**
- Size distribution: **S 94 · M 248 · L 0** — nothing exceeds `M`.
- Golden fixtures: 8 → **13** (added GF-BUDGET/FORECAST/RETURN/NETWORTH/FX); new fixtures wired into 13 leaf `_test:_` lines.
- `_files:_` coverage: **80 leaves** (new field this pass). `_perf:_` numeric targets: **6 leaves**.
- `research` spikes with `_cost:_` + `_decide-by:_`: **12/12** (added NTF-1.5).
- All **336 v2 IDs preserved** (verified); 6 net-new IDs. No deletions, no renumbering.

## What changed per epic (terse)

- **PLT** — Added **PLT-9** group (9.1 Redis/cache+shared-counter store, 9.2 invalidation/TTL). Added **PLT-4.6** observability contract (canonical metric/trace/log names) + wired PLT-4.5 to emit them. Added **PLT-8.5** dashboard latency budget+cache; attached concrete `_perf:_` numbers to 8.1–8.5 (p95 latencies, txns/min, peak RSS). 8.3/8.5 now depend on PLT-9.2 cache.
- **SEC** — SEC-4.2 rate limiting now `_deps: PLT-9.1_` with shared sliding-window counters (cross-instance consistency) + two-instance integration test; risk note resolved by the provisioning leaf. `_files:_` on SEC-1.1/1.2/1.3.
- **AUT** — `_files:_` on AUT-3.1 (provisioning). No structural change (household model already resolved in v2).
- **ONB** — No change (well-covered); inherits sharper upstream deps.
- **SRC** — `_files:_` + named unique constraints/indexes on SRC-1.2, SRC-3.2, SRC-8.1. Provider/Venmo/PayPal spikes unchanged (still the top open question).
- **ING** — ING-5.2 rate limiting `_deps: PLT-9.1_` (shared token bucket). `_files:_` on ING-1.1/4.1.
- **LDG** — LDG-2.2 transfer pairing references the shared **±3d** window from `match_config.py`. LDG-3.2/3.3 wired to `GF-NETWORTH`; LDG-4.2 FX wired to `GF-FX` (explicit last-known fallback, never silent 1:1). `_files:_` on 1.1/2.4/3.1/4.3/4.4. Named uniques on 3.3/4.2.
- **ENR** — **Pinned score bands** on ENR-2.1/2.6/3.1 (auto-link ≥0.90 / review 0.60–0.899 / drop <0.60) referencing `match_config.py`; `match_links` + `purchase_group(_members)` uniques/indexes named; ENR-3.1 only auto-groups score≥0.90 links. `_files:_` on 1.1/1.3/3.4/4.1.
- **RCP** — `_files:_` + index on RCP-3.1 line-item model.
- **CAT** — CAT-4.5 LLM cache `_deps: PLT-9.1_` (shared cache + spend counter, emits `llm.*`). CAT-4.3 confidence threshold pinned (auto-apply ≥0.85, queue floor 0.60 shared with REV-1.1). Named uniques on CAT-5.1/5.3. `_files:_` on 1.1/4.1.
- **OWE** — OWE-3.1/3.3 returns wired to `GF-RETURN` (exact-amount close; near-miss stays open). OWE-1.1/2.1/4.1/5.1 gained named indexes + `_files:_`.
- **INT** — INT-3.1/3.2/3.3/3.4 forecasting wired to `GF-FORECAST` (deterministic EoM = $4,285). INT-1.2 stream model + INT-4.5 anomalies gained named uniques/indexes; INT-4.1 anomaly threshold pinned (z≥3.0). `_files:_` on 1.1/1.2/4.1/4.5.
- **RPT** — Budgets (6.1/6.2/6.4) wired to `GF-BUDGET` (spent counted once, deduped, alert fires once/period). RPT-2.2/2.4/3.1/5.3/4.2 cite `GF-TRUESPEND`/`GF-NETWORTH`. RPT-6.1 unique `(user_id, category_id, period)`; RPT-7.3 indexed. `_files:_` on 1.1/2.2/2.4/3.1/4.2/5.3/6.1/6.2/6.4.
- **REV** — REV-1.1 queue threshold pinned (`confidence < 0.60`, shared with CAT-4.3). `_files:_` added.
- **NAV** — NAV-5.1 tags gained explicit uniques `(user_id, name)` + `(event_id, tag_id)`. `_files:_` on 3.1/5.1.
- **NTF** — Added **NTF-1.5** SPIKE (realtime push/SSE vs polling). NTF-5.3 emits `notif.sent`; NTF-3.3 `_files:_`. Resolves iteration-02 open question #3.
- **IOS** — Added **IOS-4.3** automated UI-test harness (Detox/XCUITest per IOS-1.1); rewired IOS-1.3/2.3/3.4 `manual + UI-test` leaves to depend on it (addresses the "iOS verification black hole"). `_files:_` on those leaves.

## Splits / merges (old → new IDs)

- **No splits, no merges, no deletions, no renumbering.**
- **New leaves (net adds):** PLT-4.6, PLT-8.5, PLT-9.1, PLT-9.2, NTF-1.5, IOS-4.3.

## New / extended golden fixtures (header block)

- `GF-BUDGET` — Groceries $600/mo vs $640 actual (incl. 1 deduped multi-source purchase + 1 mis-tagged transfer) → spent counted once, over by $40, alert fires exactly once per period crossing.
- `GF-FORECAST` — start $3,000 + recurring out ($15, $1,200) + scheduled in ($2,500) over 30d → EoM $4,285 deterministic; forecast-vs-actual error computed on realization.
- `GF-RETURN` — $80 "to return" → 1 open return; −$80 refund closes it; −$79 does not (stays open, flagged).
- `GF-NETWORTH` — $5,000 + $10,000 + $500 − $2,000 = $13,500; 1 snapshot/day (replay = 1 row).
- `GF-FX` — €100 @1.10 → 10000 EUR-minor → $110 USD rollup; missing rate → last-known fallback, never silent 1:1.

## Decisions

- **Match score bands pinned** (header + `match_config.py`): score = `0.5·amount_exact + 0.3·date_proximity + 0.2·merchant_sim`; auto-link ≥0.90, review 0.60–0.899, drop <0.60; ±3d window, exact-minor amount for the blocking/auto-link key. Constants live in one module referenced by ENR-2.1/2.6/3.1 + LDG-2.2; defaults frozen so golden-fixture assertions are deterministic, tunable later via a config row.
- **Shared state = Redis (PLT-9.1)**: one managed Redis client serves cache + rate-counters + idempotency keys across Cloud Run instances; local-demo falls back to in-proc. Every `rate`/cache leaf (SEC-4.2, CAT-4.5, ING-5.2) now depends on it — closes iteration-02 self-critique #6.
- **Observability contract (PLT-4.6)**: canonical counter/histogram names + label keys in one module; a lint/test fails on any off-contract metric name. `_xc: obs` now means "emits a contract signal" — closes self-critique #4.
- **Perf budgets are now numeric** (self-critique #3): dashboard p95 <400ms cold / <80ms warm @100k; aggregate <300ms/<50ms; backfill ≥5k txns/min, <256MB peak, batch 500; keyset page <150ms.
- **Confidence thresholds unified**: LLM auto-apply ≥0.85, review-queue floor 0.60 (CAT-4.3 ⇄ REV-1.1); anomaly z≥3.0. No more unspecified θ.
- **iOS UI-test harness (IOS-4.3)** made a concrete leaf so `manual + UI-test` leaves have a real target once IOS-1.1 picks the stack.
- **Realtime vs polling (NTF-1.5)** converted from an open question into a timeboxed spike (web-push likely the realtime path, polling the fallback).

## Open questions (seed iteration 4)

1. **Bank provider still un-finalized** (SRC-1.5): grounded with pricing shape (Plaid per-call vs Teller/SimpleFIN flat) but needs real vendor quotes + the expected user count to pick a default; gates SRC-5 investment coverage + SRC-1.6 hardening. (Unchanged from v2 — needs an external input this tree can't supply.)
2. **Gmail restricted-scope (CASA) timeline + recurring cost** (SRC-6.1): blocks prod Gmail receipt auto-import; SRC-7.2 forward-to-email fallback should ship first — confirm the sequencing is encoded (it is via deps, but the CASA cost/lead-time is still a real-world unknown).
3. **Materialized rollup vs on-the-fly + cache** (PLT-8.3): the perf budget allows either a materialized monthly rollup table or covering-index + PLT-9.2 cache. Iteration 4 should pick one (materialized table adds write-amplification + a refresh/idempotency story; cache is simpler but colder on first read).

## Self-critique (what's still weakest → iteration 4)

1. **`_files:_` is on only 80/342 leaves** — high-value/critical-path leaves are covered, but most web (RPT charts, ONB, NAV) and many INT/OWE leaves still lack inferred paths. Iteration 4 should finish the audit, especially `apps/web/...` component paths.
2. **Match-config is pinned but not yet a leaf** — the thresholds live in the header + are referenced as `match_config.py`, but there's no explicit leaf that *creates* that config module + its tuning/override row. Consider an ENR-2.x (or CAT-style) "matching config + tuning" leaf so the constants have an owner and a test.
3. **Perf budgets numeric but only on PLT-8** — other hot paths (review-queue build, search/FTS NAV-3.3, Sankey RPT-2.2 at scale, batch categorize CAT-4.2 throughput) have no latency/throughput target. Extend `_perf:_` to the next tier of read/compute-heavy endpoints.
4. **Obs contract defined but per-leaf signal mapping is partial** — PLT-4.6 lists the canonical names and a handful of leaves now name the exact signal they emit (sync, llm, notif, match), but most `obs` leaves still just carry the tag. Iteration 4 should annotate each `obs` leaf with *which* contract signal(s) it emits.
5. **New fixtures cover the headline invariant but not edge cases** — e.g. GF-FORECAST has no "recurring stream paused mid-horizon" case; GF-BUDGET has no rollover/partial-month case; GF-FX has no triangulation (EUR→GBP via USD). Deepen fixtures where the leaf logic has branches.
6. **Cache invalidation correctness is under-tested** — PLT-9.2 has one write-bumps-version test, but the derived caches it protects (dashboard PLT-8.5, reports PLT-8.3) need explicit "stale-after-write returns fresh" assertions wired into *those* leaves, not just the helper.
7. **Provider spike is a recurring no-op** — SRC-1.5 has been "grounded but open" for two passes. Iteration 4 should either pick a sensible default (e.g. keep Plaid as the shipped default, document the swap cost) and mark the spike resolved-pending-scale, or explicitly defer it with a trigger condition, rather than re-listing it.

## Invariants honored

IDs stable; **no leaf deleted**; coverage grew (+6 → 342); server-verified identity reinforced (SEC-1.1/1.2, AUT-3.1); encrypted tokens (SEC-1.3) + Redis TLS/auth (PLT-9.1); migration-safe + idempotent data leaves tagged `_xc: idem` and citing `GF-REPLAY`; money on integer minor units post-LDG-4.3/4.4 (`_xc: money`, `GF-MONEY`); staging/prod separation untouched. **Verified programmatically: 342 leaves, 0 duplicate IDs, 0 dangling deps, 0 cycles, 0 self-loops, 0 leaves above `M`, 12/12 spikes carry cost+decide-by, all 336 v2 IDs present.**

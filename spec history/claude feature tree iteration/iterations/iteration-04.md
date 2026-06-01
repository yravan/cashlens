# Iteration 04 (v4)

**Author:** Claude (refinement pass 4 of 8) · **Date:** 2026-05-29

## Summary

Fourth holistic pass driven by iteration-03's self-critique while touching the whole tree. **Resolved the long-stale bank-provider spike (SRC-1.5)** into a decision-ready recommendation with verified pricing/coverage grounding — default **Plaid**, **SimpleFIN** as the documented low-cost fallback, with explicit re-decision triggers (no longer a re-listed open question). **Promoted match-config to an owned leaf (ENR-2.7)** — the score weights, band thresholds, and match window now live in one module + a tunable DB override row with its own test; ENR-2.1/2.6/3.1, LDG-2.2, and OWE-1.3/3.3 now depend on it instead of re-hardcoding constants. **Annotated every `obs`-tagged leaf with its exact PLT-4.6 contract signal** in-line (`obs:<signal>`), added two new contract counters (`rate.throttled`, `cache.ops`), and verified all referenced signals ∈ the contract. **Extended `_perf:_` to the next read-heavy tier** (full-text search, Sankey builder, batch-categorize, review-queue build). **Finished a large slice of the `_files:_` audit** (80 → 140 leaves) across the remaining web/INT/OWE/SRC leaves, grounded in the verified real `apps/web/app/(app)/...` + `apps/web/components/` + `services/sources/` layout. **Deepened the golden-fixture corpus with edge cases** (`GF-FORECAST-PAUSE`, `GF-BUDGET-ROLLOVER`, `GF-FX-TRI`) and wired them into the branching leaves (forecast pause, budget rollover, FX triangulation). **Closed the cache-correctness gap** by adding explicit stale-after-write assertions into PLT-8.3/8.5 (not just the PLT-9.2 helper).

## Stats

- Leaves: **342 → 343** (+1: ENR-2.7). Epics: 17 (unchanged). Feature groups: 90 (unchanged — ENR-2.7 joins existing ENR-2).
- Dependency graph (verified programmatically): **343 nodes, 345 edges, 0 dangling, 0 self-loops, 0 cycles.**
- Size distribution: **S 95 · M 248 · L 0** — nothing exceeds `M`.
- `_files:_` coverage: **80 → 140** leaves (+60). `_perf:_` numeric targets: **6 → 9** (+3 read-heavy: NAV-3.3 FTS, RPT-2.2 Sankey, CAT-4.2 batch; REV-1.1 queue also added).
- `obs`-tagged leaves with an explicit in-line signal: **all of them** (0 bare `obs` tags remaining; ~50 annotated this pass). New contract signals: `rate.throttled{scope}`, `cache.ops{op,result}`.
- Golden fixtures: 13 → **16** (added GF-FORECAST-PAUSE / GF-BUDGET-ROLLOVER / GF-FX-TRI).
- `research` spikes with `_cost:_` + `_decide-by:_`: **12/12** (SRC-1.5 keeps the fields, now marked `DECIDED 2026-05-29`).
- All **342 v3 IDs preserved** (verified); 1 net-new ID. No deletions, no renumbering.

## What changed per epic (terse)

- **PLT** — Annotated every `obs` leaf with its contract signal (4.1=request_id; 4.4/8.1/8.5=http.server.duration; 4.5=sync.*+jobs+llm; 8.2/8.4=backfill.txns_per_min; 8.3=report.aggregate.duration; 9.1/9.2=cache.ops; CI/deploy leaves=jobs.processed). Added `rate.throttled`/`cache.ops` to the PLT-4.6 contract. PLT-8.3/8.5 now carry explicit **stale-after-write** cache assertions (self-critique #6).
- **SEC** — SEC-4.2 emits `rate.throttled`; SEC-4.1 audit + SEC-4.4 redaction tagged `obs:request_id` (durable-data / log-scrub, not metrics); SEC-2.3 drill = jobs.processed.
- **AUT/ONB** — No structural change; inherit sharper upstream deps (ENR-2.7, SRC-1.5).
- **SRC** — **SRC-1.5 RESOLVED** (full decision below). `_files:_` added to ~25 SRC leaves (provider interface `services/sources/`, Plaid `routers/plaid.py`+`services/plaid.py`, web `plaid-connect-button.tsx`/`plaid-link-provider.tsx`, Venmo/PayPal/OFX `services/sources/*`).
- **ING** — `obs` signals: 1.2=backfill.txns_per_min; 3.2/3.3=jobs.enqueued; 5.1=sync.runs+sync.duration; 5.2=rate.throttled; 5.3=sync.runs; 5.5=notif.sent.
- **LDG** — LDG-2.2 transfer pairing now `_deps: ENR-2.7_` (reads the window from match_config); LDG-3.5 reconcile obs=http.server.duration; LDG-4.2 FX wired to **GF-FX-TRI** (triangulation, never silent 1:1).
- **ENR** — **Added ENR-2.7** (match-config module + override row + tuning test). ENR-2.1/2.6/3.1 depend on it; ENR-2.6 emits `match.links`. Score bands/window now have a single owner + test.
- **RCP** — OCR/LLM leaves (2.2/2.5/2.3) emit `llm.calls,llm.tokens`.
- **CAT** — CAT-4.1/4.4 emit llm.calls,llm.tokens; CAT-4.5 emits +cache.ops; **CAT-4.2 batch** gained a `_perf:_` (≥300 events/min, checkpoint 200) + `_deps: CAT-4.5_` so it runs through the cache.
- **OWE** — OWE-1.3/3.3 now `_deps: ENR-2.7_` (match window from config); `_files:_` added to all OWE web/api leaves; reminders (5.3) emit notif.sent.
- **INT** — INT-3.1/3.3 forecasting wired to **GF-FORECAST-PAUSE** (paused stream excluded → EoM $4,300 not $4,285); `_files:_` added to all INT leaves; INT-5.3 emits notif.sent.
- **RPT** — **RPT-2.2 Sankey** gained `_perf:_` (<350ms cold / <60ms warm) + `_deps: PLT-9.2_`; RPT-6.1 budget model gained a per-budget `rollover` flag + **GF-BUDGET-ROLLOVER**; RPT-6.4 overspend alert respects rollover-adjusted budget; alerts emit notif.sent.
- **REV** — **REV-1.1 queue build** gained `_perf:_` (<250ms via partial index); `_files:_` added to REV swipe/screen/card-action leaves.
- **NAV** — **NAV-3.3 FTS** gained `_perf:_` (<200ms, GIN trigram, EXPLAIN asserts index) + obs=http.server.duration; `_files:_` added to NAV Command-K/search/filters/theming leaves.
- **NTF** — All push/dispatch/digest/trigger leaves emit `notif.sent`.
- **IOS** — IOS-4.1/4.3 emit jobs.processed (build/UI-test pipeline outcomes).

## Splits / merges (old → new IDs)

- **No splits, no merges, no deletions, no renumbering.**
- **New leaf (net add):** **ENR-2.7** — Match-config module + tunable override row (joins the existing ENR-2 Cross-source matching group; placed before ENR-2.1 since it now precedes candidate-gen on the critical path).

## SRC-1.5 — bank provider decision (RESOLVED)

**Default = keep Plaid for v1 production. SimpleFIN = documented low-cost fallback behind the SRC-1.1 provider interface.**

Decision criteria + grounding (web-verified 2026-05-29 except where labelled UNVERIFIED):
1. **Institution coverage** — Plaid: broadest US banks + cards + identity + **first-party Investments** (gates SRC-5). SimpleFIN Bridge: broad MX-backed consumer coverage but **no investments API**, consumer-subscription model. Teller: direct-API, narrower institution list, no investments. → **Plaid wins, decisively for investments.**
2. **Cost at expected scale (verified)** — Plaid Transactions ≈ **$0.30–0.60/connection/mo** pay-as-you-go + an indicative **~$500/mo** baseline minimum (volume discounts 30–50% past ~10k MAU). SimpleFIN Bridge = **$15/yr** consumer-side (~25 institutions/subscription) — cheapest but an end-user subscription, not a B2B aggregation API. Teller = **free dev tier (100 live connections)**; paid per-connected-account rate **not publicly listed (UNVERIFIED — needs sales contact)**.
3. **Dev credentials on hand** — Plaid only (sandbox keys + `plaid_env`/`plaid_client_id`/`plaid_secret` already wired in real code). Teller/SimpleFIN = none.
4. **Data richness** — Plaid `/transactions/sync` (cursor, pending→posted, categories, counterparties) is richest. SimpleFIN = balances+transactions only. Teller = real-time balances+transactions, no enrichment.

**Re-decide trigger:** revisit if (a) Plaid spend > ~$1k/mo sustained, OR (b) >10% of target users hit institutions Plaid can't cover, OR (c) a flat-rate B2B competitor undercuts Plaid at our MAU. **Migration cost from today:** low — Plaid is already shipped; SRC-1.6 (adapter conformance) + SRC-1.1/1.2 (neutral `connections` schema) are the only prerequisites to add a 2nd provider. Provider-abstraction leaves (SRC-1.1/1.6) stay intact so the choice remains swappable.

## New / extended golden fixtures (header block)

- `GF-FORECAST-PAUSE` — paused Netflix stream's skipped charge excluded → EoM $4,300 (not $4,285); resume re-includes deterministically. (Wired: INT-3.1, INT-3.3.)
- `GF-BUDGET-ROLLOVER` — per-budget rollover flag; $640 spend is UNDER $650 (rollover on, no alert) but OVER $600 (rollover off, 1 alert). (Wired: RPT-6.1, RPT-6.4.)
- `GF-FX-TRI` — GBP→EUR→USD triangulation when no direct rate; no path → flagged unconvertible, never silent 1:1 or zeroed. (Wired: LDG-4.2.)

## Decisions

- **Bank provider = Plaid default + SimpleFIN fallback** (SRC-1.5 above) — spike closed, criteria + triggers documented; Teller paid rate left UNVERIFIED rather than invented.
- **Match-config is now an owned leaf (ENR-2.7)** — frozen defaults match the header block exactly; a single global override row re-tunes bands without code change; absent row → defaults. Every matching/dedup/window leaf depends on it (closes iteration-03 self-critique #2).
- **Obs contract extended + per-leaf mapped** — added `rate.throttled{scope}` and `cache.ops{op,result}`; every `obs` leaf names its signal in-line; durable-data/error-capture leaves use `obs:request_id` to show they carry the correlation id without inventing a metric (closes iteration-03 self-critique #4).
- **Perf budgets extended to read-heavy tier** — FTS <200ms, Sankey <350/60ms, batch-categorize ≥300/min, queue-build <250ms; each names the index/cache it relies on (closes iteration-03 self-critique #3).
- **Cache correctness now tested at the call site** — stale-after-write assertions added to PLT-8.3 (reports) and PLT-8.5 (dashboard), not just the PLT-9.2 helper (closes iteration-03 self-critique #6).
- **Fixture edge cases added** for the three branching leaves flagged in iteration-03 self-critique #5 (forecast pause, budget rollover, FX triangulation).

## Open questions (seed iteration 5)

1. **Gmail restricted-scope (CASA) timeline + recurring cost** (SRC-6.1): still the top external unknown — blocks prod Gmail receipt auto-import; SRC-7.2 forward-to-email fallback ships first (encoded via deps), but the CASA lead-time/cost is a real-world input this tree can't supply. Carried from v2/v3.
2. **Materialized rollup vs on-the-fly + cache** (PLT-8.3): v4 still allows either path. The perf budget is met by covering-index + PLT-9.2 cache today; a materialized monthly rollup table would add write-amplification + a refresh/idempotency story. Iteration 5 should pick one explicitly (recommend: cache-first now, materialized table only if the warm-cache miss rate proves too high at scale) and add a `GF`-style refresh-idempotency fixture if the table path is chosen. Carried from v3.
3. **ENR-2.7 override is global-only** — the match-config row is a single global scope; per-user (and eventually per-household, post AUT-5) band tuning is deferred. Iteration 5 should decide whether per-user match tuning is worth the added scoping + test surface, or whether global defaults + a manual-confirm UI (ENR-2.5) are sufficient.

## Self-critique (what's still weakest → iteration 5)

1. **`_files:_` audit still incomplete (140/343)** — the remaining ~200 are mostly PLT infra, SEC, AUT, RCP, CAT, and the deeper RPT/ONB web leaves. Iteration 5 should finish RCP (receipt/OCR services) and the RPT chart components (`apps/web/components/charts/*`) since those are concrete and high-traffic.
2. **`obs:request_id` is doing double duty** — I used it both for "this leaf defines/propagates the correlation id" (PLT-4.1) and for "this leaf's work is durable-data, not a metric, but its logs carry the id" (SEC-4.1, audit). That's defensible but slightly overloaded; iteration 5 could split a clearer convention (e.g. `obs:none(durable)` vs `obs:request_id`) or add a tiny legend note distinguishing metric-emitters from id-carriers.
3. **New edge-case fixtures cover one branch each but not combinations** — e.g. GF-FX-TRI doesn't combine with a missing-rate day (triangulate via a stale intermediate); GF-BUDGET-ROLLOVER doesn't combine with a deduped multi-source purchase. Deepen where two branches interact.
4. **Perf targets now span PLT-8 + 4 read-heavy leaves, but write-path latency is unbudgeted** — transaction PATCH, bulk-categorize PATCH (CAT-2.2), and the ingest→normalize→match write chain have no p95. Iteration 5 should add write-path budgets (esp. the matching/dedup write amplification on ingest).
5. ~~**ENR-2.7 migration-safety**~~ — fixed in-pass: ENR-2.7 now carries `_skill: db-evolution_` + a `GF-REPLAY` idempotent-default-seed assertion (CAT-1.2 pattern). (Listed here for traceability; resolved.)
6. **SRC-1.5 is resolved but the SimpleFIN fallback has no implementation leaf** — the decision says "ship behind SRC-1.1," but there's no `SRC-x` leaf for a SimpleFIN adapter the way SRC-1.6 exists for Plaid. If SimpleFIN is a real fallback, iteration 5 should add a (deferred/flagged) SimpleFIN-adapter leaf so the fallback is actionable, not just documented.
7. **Cost/decide-by on a resolved spike is slightly awkward** — SRC-1.5 keeps `_cost:_`/`_decide-by:_` (now "DECIDED") to preserve the spike-field invariant, but a resolved decision arguably wants a different shape. Iteration 5 could introduce a `_status: resolved_` convention for decided spikes rather than overloading decide-by.

## Invariants honored

IDs stable; **no leaf deleted**; coverage grew (+1 → 343); server-verified identity reinforced (SEC-1.1/1.2, AUT-3.1); encrypted tokens (SEC-1.3) + Redis TLS/auth (PLT-9.1); migration-safe + idempotent data leaves tagged `_xc: idem` and citing `GF-REPLAY`; money on integer minor units post-LDG-4.3/4.4 (`_xc: money`, `GF-MONEY`); staging/prod separation untouched; provider-abstraction (SRC-1.1/1.6) kept intact so the SRC-1.5 default stays swappable. **Verified programmatically: 343 leaves, 0 duplicate IDs, 0 dangling deps, 0 cycles, 0 self-loops, 0 leaves above `M`, 12/12 spikes carry cost+decide-by, all 342 v3 IDs present, every in-line `obs:<signal>` ∈ the PLT-4.6 contract.**

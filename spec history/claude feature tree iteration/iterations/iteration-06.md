# Iteration 06 (v6)

**Author:** Claude (refinement pass 6 of 8) · **Date:** 2026-05-30

## Summary

Sixth holistic pass — the **HARDENING + NAVIGABILITY** pass, driven by iteration-05's self-critique and the cross-cutting-completeness mandate. Four thrusts, all touching the whole tree:

1. **Navigability index blocks (NOT new leaves).** Added a single `## Index blocks (v6)` section near the top with four terse reference tables that collect previously-scattered numbers/keys/fixtures so a reviewer scans them in one place (each restates, never replaces, its owning leaf): **(A) Performance-budget index** — all 14 `_perf:_` targets in one table, each flagged **SLO** (contract, has an index/EXPLAIN basis) vs **HYP** (hypothesis-to-benchmark — reasoned, unmeasured, must NOT be treated as a hard gate until the first PLT-8.4 perf run; resolves iteration-05 self-critique #2 and #5). **(B) Feature-flag catalog** — every `PLT-5.3` flag key + default + owning leaf (10 flags; closes self-critique #6). **(C) Golden-fixture catalog** — terse one-line index of all 20 `GF-*` fixtures + their primary leaves. **(D) Real-vs-new file paths** — disambiguates which `_files:_` paths already EXIST (edit) vs are forward-looking NEW paths (author), closing self-critique #4.

2. **Concurrency/burst back-pressure budget** — added leaf **`ING-6.2`** (the one net-new leaf). It is the system-level counterpart to ING-6.1's per-batch budget: caps concurrent sync jobs per Cloud Run instance, sets a queue-depth ceiling, and **defers (never drops)** webhook-triggered syncs on breach so a webhook storm (N items' `SYNC_UPDATES_AVAILABLE` × Cloud Run instances × the ING-5.2 shared rate limiter × ING-6.1 match write-amplification) holds under burst. Closes iteration-05 open question #2.

3. **Two new golden fixtures** for fixture-on-fixture / multi-provider collisions: **`GF-COMBO-STACK`** — a deduped multi-source parent that is THEN split THEN partly reimbursed (stacks dedup → split → reimburse on one chain; proves no member-fan-out double counting — closes self-critique #1); **`GF-DEDUP-XPROV`** — the same bank txn arriving from Plaid AND the SRC-1.7 SimpleFIN adapter, counted once via cross-PROVIDER dedup (closes self-critique #3). Wired into ENR-2.1/3.1/4.1/4.3, RCP-3.2, LDG-2.4, SRC-1.7.

4. **Cross-cutting completeness sweep** across every relevant leaf — closed `money` gaps (OWE-3.2, RPT-3.2, RPT-3.3), `authz` gaps on user-scoped GET endpoints (PLT-8.5 `/dashboard`, INT-3.4 `/forecast`, SRC-1.3 capability API), `idem` gaps on data-writing leaves (SEC-3.3 consents, AUT-3.3 prefs, LDG-4.1 currency model), and `rate` gaps on external-call senders (NTF-3.2 web push, NTF-4.2 APNs). Documented in the `_xc:_` legend that the 6 web/iOS leaves WITHOUT `a11y` are intentionally non-interactive (middleware/client/instrumentation), so their absence is a recorded decision, not a gap.

`PLT-5.3` was upgraded to **own the flag registry** (index-block B is its seeded source of truth, mirroring how ENR-2.7 owns match-config) — added `feature_flags` + `feature_flag_overrides` schema and a fail-closed-on-unknown-key acceptance.

## Stats

- Leaves: **345 → 346** (+1: `ING-6.2`). Epics: 17 (unchanged). Feature groups: 91 (unchanged — ING-6.2 joins the existing `ING-6 Write-path performance`).
- Dependency graph (verified programmatically): **346 nodes, 358 edges, 0 dangling, 0 self-loops, 0 cycles.** (+5 edges, all from ING-6.2's 5 deps.)
- Size distribution: **S 95 · M 251 · L 0** — nothing exceeds `M`.
- Golden fixtures: 18 → **20** (added `GF-COMBO-STACK`, `GF-DEDUP-XPROV`).
- `_perf:_` numeric targets: 14 → **14 leaves** (ING-6.2 adds 1 leaf-level target; perf-index block A now classifies all 14 as SLO/HYP).
- `research` spikes with `_cost:_` + `_decide-by:_`: **12/12** preserved.
- All **345 v5 IDs preserved** (verified against the v5 snapshot); 1 net-new ID. No deletions, no renumbering, no merges.
- `_xc:_` tags added/extended: **money** ×3 (OWE-3.2, RPT-3.2, RPT-3.3), **authz** ×3 (PLT-8.5, INT-3.4, SRC-1.3), **idem** ×3 (SEC-3.3, AUT-3.3, LDG-4.1), **rate** ×2 (NTF-3.2, NTF-4.2).
- Every in-line `obs:<signal>` still ∈ the PLT-4.6 contract (ING-6.2 reuses `jobs.enqueued{outcome=deferred}` — no new metric name invented).
- File length: 990 → **1076 lines** (+86; the four index tables account for the bulk — they are terse tables, not prose, and replace the need to hunt scattered numbers).

## Index blocks added (the navigability deliverable)

| Block | Contents | Owning mechanism |
|-------|----------|------------------|
| A. Performance-budget index | 14 `_perf:_` targets, tier R/W, each tagged **SLO** vs **HYP** | restates each leaf's `_perf:_`; read-tier=SLO, write/memory/throughput=HYP until first PLT-8.4 run |
| B. Feature-flag catalog | 10 flag keys + default + owning leaf | **PLT-5.3 owns it as seeded `feature_flags` data** |
| C. Golden-fixture catalog | all 20 `GF-*` + one-line invariant + primary leaves | full defs stay in the header block |
| D. Real-vs-new file paths | which `_files:_` paths exist (edit) vs are new (author) | grounded in the verified-2026-05-29 repo layout |

## What changed per epic (terse)

- **PLT** — `PLT-5.3` now owns the flag registry (+`feature_flags`/`feature_flag_overrides` schema, fail-closed unknown key, `seed_flags.py`). `PLT-8.5` gained `authz` (`/dashboard` is user-scoped). Index blocks A–D added to the header region. Phase-rollup line notes ING-6.2.
- **SEC** — `SEC-3.3` consents gained a unique key + `idem` (re-consent = 1 row).
- **AUT** — `AUT-3.3` prefs store gained a unique key + `idem` (re-save = 1 row, latest value).
- **SRC** — `SRC-1.3` capability API gained `authz` (was empty `_xc:_`). `SRC-1.7` wired to `GF-DEDUP-XPROV` + references flag-catalog B.
- **ING** — **Added `ING-6.2`** (sync-burst concurrency + back-pressure budget): ≤8 in-flight sync jobs/instance, queue-depth ceiling 500, defer-not-drop on breach, drains a 200-webhook storm with bounded peak concurrency and zero dropped items. Numbers tagged HYP in perf-index A.
- **LDG** — `LDG-2.4` true-spend wired to `GF-COMBO-STACK` (deduped+split+reimbursed parent nets $32 once, never $288). `LDG-4.1` currency model gained `idem`.
- **ENR** — `ENR-3.1` dedup gained a **Plaid > SimpleFIN provider tie-break** for canonical selection + wired to both new fixtures. `ENR-2.1` candidate-gen, `ENR-4.1` split model, `ENR-4.3` reimburse-split all wired to the relevant new fixture (member-fan-out prevented at each stage).
- **RCP** — `RCP-3.2` line-item↔ledger linkage gained a concrete fixture (`GF-COMBO-STACK`: lines attach to the canonical member, reconcile to canonical $96).
- **OWE** — `OWE-3.2` mark-to-return gained `money` (it shows expected-refund).
- **INT** — `INT-3.4` forecast API gained `authz` (user-scoped `/forecast`).
- **RPT** — `RPT-3.2` drilldown + `RPT-3.3` health breakdown gained `money` (both display minor-unit totals).
- **NTF** — `NTF-3.2` web-push + `NTF-4.2` APNs send pipelines gained `rate` (respect push-service throttling).
- **REV/NAV/IOS** — no leaf changes; covered by the index blocks (perf, file-path convention) and the a11y-intentionality note.

## Splits / merges (old → new IDs)

- **No splits, no merges, no deletions, no renumbering.**
- **New leaf (net add, +1):**
  - **`ING-6.2`** — Sync-burst concurrency + back-pressure budget. Joins the existing `ING-6 Write-path performance` group (placed after ING-6.1).

## New / extended golden fixtures (header block)

- `GF-COMBO-STACK` — dedup → split → reimburse stacked on one $96 dinner (3 sources → 1 canonical, split 3×$32, 2 shares reimbursed). Invariants: 3 sources form 1 group; split attaches to the canonical member only; 2 reimbursable shares → exactly 2 receivables (not 6); true-spend nets $32 once (never $288 = 3 sources × 3 splits); replay-stable. (Wired: ENR-3.1/4.1/4.3, RCP-3.2, LDG-2.4.)
- `GF-DEDUP-XPROV` — the same −$73.40 bank txn ingested from Plaid AND SimpleFIN → distinct raw rows (different provider) that cross-source matching dedups to 1 canonical (Plaid wins the precedence tie-break). Stays distinct from `GF-COMBO-DUPXFER` (two SimpleFIN-only same-account charges are still a double-charge, because cross-provider dedup needs *different* providers). (Wired: ENR-2.1/3.1, SRC-1.7.)

## Decisions

- **Sync burst is now budgeted at the system level** (`ING-6.2`), not just per-batch (`ING-6.1`). Key invariant: on back-pressure breach, webhook-triggered syncs are **deferred + re-enqueued with backoff (PLT-3.5)**, never dropped or run unbounded — every item still syncs exactly once (`GF-REPLAY`). Concurrency is capped per instance (semaphore) + at the Cloud Tasks dispatch layer (`maxConcurrentDispatches`/`maxDispatchesPerSecond`) + Cloud Run container concurrency, with a shared queue-depth gauge in PLT-9.1.
- **Perf numbers are explicitly SLO vs HYP.** Read-tier budgets (keyset paging, group-by, dashboard, Sankey, queue, FTS) are **SLO** — they have an index/EXPLAIN basis verifiable at seed time. Write-tier + throughput + memory budgets (backfill rate, write-chain, PATCH p95s, batch-categorize, burst caps) are **HYP** — reasoned, not measured; an implementer records the first measured value and only then promotes to SLO. This stops a guess from being treated as a contract (iteration-05 self-critique #2).
- **Feature flags have one owner.** `PLT-5.3` owns index-block B as seeded `feature_flags` data; flag-gated leaves read a known key, unknown keys fail closed. No ad-hoc flag strings (self-critique #6). Per-user overrides via `feature_flag_overrides`.
- **`_files:_` edit-vs-author is explicit** (index-block D). Paths in the verified-real list are edits; everything else is authored. This was previously implicit in the legend ("guidance, not a contract") — now an agent knows when it is creating a new file (self-critique #4).
- **Cross-provider dedup reuses the existing matcher.** `GF-DEDUP-XPROV` proved `GF-DEDUP` generalizes — no new dedup machinery needed, only a Plaid>SimpleFIN tie-break in `ENR-3.1`'s canonical selection. The two-provider overlap is just another cross-source dedup case.
- **a11y absence on 6 web/iOS leaves is intentional, recorded.** AUT-2.3 (middleware), AUT-2.4/IOS-1.4 (API client/refresh), PLT-4.3 (Sentry instrumentation), AUT-1.4 (dev-only toggle), NTF-4.1 (APNs token registration) render no interactive UI; their `_xc:_` correctly omits `a11y`. All genuinely-interactive web/iOS leaves carry it.

## Open questions (seed iteration 7)

1. **Burst-budget numbers (ING-6.2) are HYP and the load generator is not yet burst-capable.** PLT-8.4 generates N synthetic users/txns but does not yet simulate a *simultaneous webhook storm*. Iteration 7 should either extend PLT-8.4's acceptance to include a burst mode (fan in K webhooks at once) or add a sibling perf leaf, so ING-6.2's "200-item storm drains with peak concurrency ≤ cap" is actually testable rather than asserted in prose.
2. **Gmail restricted-scope (CASA) timeline + recurring cost** (`SRC-6.1`) — still the top *external* unknown, carried v2→v6; blocks prod Gmail auto-import. The `source.gmail` flag (default OFF) + SRC-7.2 forward-to-email fallback encode the workaround, but this tree can't supply the real CASA lead-time/cost.
3. **Teller paid pricing still UNVERIFIED** (`SRC-1.5`) — the provider decision is sound (Plaid default, SimpleFIN coded fallback via SRC-1.7), but the Teller cost cell in the matrix needs a sales-contact number if a cost-based re-decide trigger ever fires. Low priority while Plaid is default.

## Self-critique (what's still weakest → iteration 7)

1. **The index blocks duplicate content that can now drift.** Perf numbers, flag keys, and fixture→leaf wiring now live BOTH in the owning leaf AND in an index table. A future pass that edits a leaf's `_perf:_` or adds a fixture must hand-update the index, or they desync. Iteration 7 could add a one-line "consistency check" note describing how to keep them in sync (or accept the index as a snapshot that's regenerated each pass, not hand-maintained between passes).
2. **`GF-COMBO-STACK` stacks three branches but still not FX.** It composes dedup+split+reimburse, but none of the combo fixtures yet stack a multi-currency leg (e.g. the deduped parent is a €-charge needing `GF-FX-TRI` triangulation before the split math). The hardest real collision — money-rounding across a triangulated FX conversion inside a split inside a dedup group — is still unmodeled. Iteration 7 could add the FX dimension to one combo rather than another pairwise fixture.
3. **`ING-6.2` budgets concurrency but not the COST of deferral.** Deferring a storm is safe but a user who connects 10 institutions then triggers a manual full re-sync (ING-5.4) of all of them could sit in a deferral backlog for minutes with no UI feedback. There is no leaf surfacing "your sync is queued, ~N min" to the user during back-pressure. Iteration 7 could add (or extend ONB-2.2 / SRC-9.2) a queued-state UI so back-pressure is visible, not just safe.
4. **Cross-cutting sweep was gap-driven, not exhaustive-matrix.** I fixed the *detected* missing tags (money/authz/idem/rate), but I did not build a full leaf×requirement matrix asserting, e.g., that every leaf touching `notification_events` carries `idem`, or every Blob-writing leaf carries `crypto`. A future pass could generate that matrix as a (5th) index block so completeness is provable, not spot-checked.
5. **HYP perf numbers have no "decide-by"/owner the way research spikes do.** A `research` spike carries `_cost:_` + `_decide-by:_`; a HYP perf budget carries neither — there's no deadline by which it must be benchmarked-and-promoted-to-SLO. Iteration 7 could add a lightweight `_benchmark-by:_` to HYP budgets (e.g. "before the load-test gate in P4") so they don't stay unvalidated guesses forever.
6. **Flag catalog lists keys but not their KILL ORDER / dependencies.** Some flags gate others implicitly (e.g. `investments` is meaningless without a provider that supports it; `notif.ios_push` needs `ios.app`). The catalog is a flat list; it doesn't note that turning on `notif.ios_push` while `ios.app` is OFF is incoherent. Iteration 7 could add a "requires" column so flag combinations are validated.

## Invariants honored

IDs stable; **no leaf deleted**; coverage grew (+1 → 346); server-verified identity reinforced (PLT-8.5/INT-3.4/SRC-1.3 GET endpoints now explicitly `authz`; SEC-1.1/1.2 untouched); encrypted tokens (SEC-1.3, SRC-1.7) + Redis TLS/auth (PLT-9.1, reused by ING-6.2); migration-safe + idempotent data leaves tagged `_xc: idem` citing `GF-REPLAY` (new SEC-3.3/AUT-3.3/LDG-4.1 idem; ING-6.2 storm = each item synced exactly once); money on integer minor units (`_xc: money`, new OWE-3.2/RPT-3.2/RPT-3.3); staging/prod separation untouched; provider-abstraction (SRC-1.1/1.6/1.7) intact and the Plaid default stays swappable; cross-provider dedup reuses the existing matcher (no new machinery). **Verified programmatically: 346 leaves, 0 duplicate IDs, 0 dangling deps, 0 cycles, 0 self-loops, 0 leaves above `M`, 12/12 spikes carry cost+decide-by, all 345 v5 IDs present, every in-line `obs:<signal>` ∈ the PLT-4.6 contract, all 14 `_perf:_` leaves present in perf-index A, all flag-catalog + fixture-catalog references resolve to real leaves.**

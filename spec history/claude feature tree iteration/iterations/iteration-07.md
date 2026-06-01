# Iteration 07 (v7)

**Author:** Claude (refinement pass 7 of 8) · **Date:** 2026-05-30

## Summary

Seventh holistic pass — the **BUILD-ORDER + RISK** pass, driven by iteration-06's self-critique and the sequencing mandate. The goal: make the tree something the user can start **handing leaves to agents in dependency order**, with every destructive/ambiguous leaf carrying an explicit risk, and every guessed perf number carrying a deadline to validate it. No leaf was added or removed (a hardening pass); all changes are in-place edits plus 2 new dependency edges and 1 new golden fixture. Five thrusts, all verified programmatically against the dependency graph:

1. **Build-order / phasing rollup made correct + dispatchable.** The v6 header had two latent sequencing bugs that this pass caught and fixed against the real graph:
   - The **first-PR slice** listed `LDG-4.3` before `PLT-2.3` (but LDG-4.3 *deps* PLT-2.3, the replay harness it needs) and `ENR-2.1` before `ENR-2.7` (but ENR-2.1 *deps* ENR-2.7, the match-config owner). Both were **scheduled before a blocker.** Corrected to a 12-PR slice that is internally dependency-consistent (verified: every item's deps are earlier in the slice or already built).
   - The **critical path** claimed `PLT-2.1 → LDG-4.3 → LDG-4.4 → ENR-2.7 → ENR-2.1 → …`, but `LDG-4.4` (the money read-cutover) is NOT on the path to dedup (ENR-2.x/3.x depend only on `LDG-4.3`, the schema+backfill), and `ENR-2.7` depends only on `PLT-2.1`, **not** on `LDG-4.4`. Corrected to the real chain `PLT-2.1 → PLT-2.3 → LDG-4.3 → ENR-2.1 → ENR-2.6 → ENR-3.1 → ENR-3.4`, with ENR-2.7 noted as the parallel prerequisite of ENR-2.1.
   - Added **index-block E (Build-order / dispatch waves)** — a 6-wave (W0–W5) table to the deduped-true-spend wedge, topo-verified so no leaf precedes a blocker, plus the flattened 12-PR linear slice. Added one real edge (`PLT-2.3 → PLT-2.1`) so the replay harness formally follows the framework it exercises and the stated critical path is a real edge chain, not just narrative ordering.

2. **Risk completeness on every destructive leaf.** v6 had 30 `_risk:_` leaves but several **destructive** ones (named by the task) lacked a risk line. Added one-line risk + mitigation to all 7: **SEC-3.1** (irreversible account erasure → step-up + export-first + single-txn cascade + audit), **SEC-3.5** (mis-scoped CASCADE widens what one DELETE destroys → enumerate each FK, assert downgrade), **ENR-3.1** (wrong auto-merge hides real spend → auto-group only ≥ band, members non-destructive + reversible), **ENR-3.3** (unmerge orphans attached splits/receivables → block/confirm when children exist), **LDG-4.4** (partial money cutover double-scales → flip serializer+formatter in one shared-type change), **ONB-4.1** (too-broad demo wipe deletes real rows → strictly `is_demo`-scoped), **CAT-1.4** (merge bulk-reassigns then drops a category → transactional reassign-then-archive, recoverable). All 12 spikes already carried `_cost:_` + `_decide-by:_` (verified intact).

3. **Made ING-6.2 testable.** v6's ING-6.2 burst/back-pressure budget asserted "a 200-item storm drains with peak concurrency ≤ cap" purely in prose — the load harness (PLT-8.4) couldn't drive it (iteration-06 open question #1). Extended **PLT-8.4** with a **burst/storm mode** (`make perf-burst K=200` fans in K simultaneous sync triggers and records peak in-flight concurrency, queue depth, deferral count, per-item exactly-once completion), and added the **`ING-6.2 → PLT-8.4`** dependency so ING-6.2's test now *uses* the harness. ING-6.2's assertion is now executable, not asserted.

4. **Added the FX combination golden fixture (`GF-COMBO-FX`).** The hardest unmodeled collision (iteration-06 self-critique #2): a **triangulated FX conversion INSIDE a split INSIDE a dedup group.** A £90 London dinner seen via 3 sources (dedup), triangulated GBP→EUR→USD (no direct rate), then split 3 ways with 2 shares reimbursable. Proves the three real hazards don't bite: (i) no member fan-out double-count, (ii) **no rounding loss** — the split sums in *native* GBP-minor (splitting the rounded $115.83 would lose a cent), conversion is display-only, and converting-then-summing vs summing-then-converting agree within ±1 minor unit with a deterministic residual owner, (iii) **no destructive currency rewrite** — the canonical keeps GBP-minor through every stage; conversion is a report-time rollup. Wired into LDG-4.1, LDG-4.2, ENR-3.1, ENR-4.1, ENR-4.3 + cataloged in block C.

5. **`_benchmark-by:_` on every HYP perf number.** A `research` spike carries `_cost:_` + `_decide-by:_`; a HYP perf budget carried neither (iteration-06 self-critique #5) — no deadline to validate the guess. Added a new legend sub-field `_benchmark-by:_` and applied it to all **8 HYP leaves** (PLT-8.2, PLT-8.4, ING-6.1, ING-6.2, LDG-2.5, CAT-2.1, CAT-2.2, CAT-4.2), each naming a concrete validation trigger (mostly the first PLT-8.4 load run at the P1 or P3→P4 boundary; CAT-4.2 the first real-LLM run). The 6 SLO leaves correctly do NOT carry it (their budget has an index/EXPLAIN basis). Added a `Bench-by` column to perf-index block A.

Also added the **index-block consistency rule** (iteration-06 self-critique #1): blocks A–E are a *regenerated snapshot, not a hand-maintained second source* — when a leaf's perf/risk/flag/fixture/deps change, regen at end-of-pass; on any table↔leaf disagreement, the **leaf wins**.

## Stats

- Leaves: **346 → 346** (no add/remove — a hardening pass). Epics: 17 (unchanged). Feature groups: 91 (unchanged).
- Size distribution: **S 95 · M 251 · L 0** — nothing exceeds `M`.
- Status mix: 27 `[built]` · 38 `[partial]` · 281 `[new]`.
- Dependency graph (verified programmatically): **346 nodes, 360 edges, 0 dangling, 0 self-loops, 0 cycles.** (+2 edges: `ING-6.2 → PLT-8.4`, `PLT-2.3 → PLT-2.1`.)
- Golden fixtures: 20 → **21** (added `GF-COMBO-FX`).
- `_risk:_` leaves: 30 → **37** (+7 destructive: SEC-3.1, SEC-3.5, ENR-3.1, ENR-3.3, LDG-4.4, ONB-4.1, CAT-1.4).
- `_benchmark-by:_` (new field): **8 leaves** (every HYP perf budget) — 0 before.
- `research` spikes with `_cost:_` + `_decide-by:_`: **12/12** preserved.
- All **346 v6 IDs preserved** (verified against the v6 snapshot); no deletions, no renumbering, no merges, no splits.
- Every in-line `obs:<signal>` still ∈ the PLT-4.6 contract (ING-6.2 still reuses `jobs.enqueued{outcome=deferred}` — no new metric name).
- File length: 1076 → **1096 lines** (+20; the new block E table + GF-COMBO-FX def account for most, offset by the in-place nature of the perf/risk edits).

## Phasing / build-order changes (the primary deliverable)

| Item | v6 | v7 |
|------|----|----|
| First-PR slice | 10 PRs, listed LDG-4.3 before its dep PLT-2.3 and ENR-2.1 before its dep ENR-2.7 | **12 PRs, dependency-consistent** (PLT-2.3 precedes LDG-4.3; ENR-2.7 precedes ENR-2.1); verified every dep is earlier or built |
| Critical path | `…LDG-4.3 → LDG-4.4 → ENR-2.7 → ENR-2.1…` (LDG-4.4 not on dedup path; ENR-2.7 doesn't dep LDG-4.4) | **`PLT-2.1 → PLT-2.3 → LDG-4.3 → ENR-2.1 → ENR-2.6 → ENR-3.1 → ENR-3.4`** — every link is a real edge; ENR-2.7 noted as parallel prereq |
| Dispatch waves | none | **index-block E: W0–W5** topo-verified waves to the wedge |
| Longest absolute chain | implicit | stated: `PLT-2.1 → ENR-2.7 → ENR-2.1 → ENR-2.6 → ENR-3.1 → ING-6.1 → ING-6.2` (length 6) |
| Phase rollup | P0–P6 | unchanged structure; annotated that HYP budgets benchmark at the P3→P4 load gate (PLT-8.4 burst mode) |

## Risk gaps closed

| Leaf | Destructive action | Mitigation added |
|------|--------------------|------------------|
| SEC-3.1 | Total account erasure (no undo) | step-up re-auth + export-first ordering + single-txn cascade + pre-delete audit row |
| SEC-3.5 | Cascade-FK migration | enumerate each child FK explicitly; assert downgrade restores NO ACTION |
| ENR-3.1 | Auto-merge collapses purchases | group only ≥ auto-link band; members kept + linked (reversible), not deleted |
| ENR-3.3 | Unmerge | block/confirm when canonical has dependent splits/receivables; assert no orphans |
| LDG-4.4 | Money read cutover | gate on backfill+reconcile; flip serializer + web formatter in one shared-type change |
| ONB-4.1 | Demo→real data wipe | strictly `is_demo`-scoped delete; test asserts a real row survives |
| CAT-1.4 | Category merge | transactional reassign-then-archive (recoverable); assert reassign count == prior event count |

## What changed per epic (terse)

- **PLT** — `PLT-2.3` gained the `PLT-2.1` dep (+v7 note). `PLT-8.4` gained **burst/storm mode** (`perf-burst K`, records peak concurrency/queue/exactly-once) + `_benchmark-by:_ self`. `PLT-8.2` gained `_benchmark-by:_`. Header: corrected first-PR slice + critical path; added index-block E; consistency rule; benchmark-by legend field; perf-index A `Bench-by` column.
- **SEC** — `SEC-3.1`, `SEC-3.5` gained `_risk:_` (destructive erasure / cascade-FK).
- **AUT/ONB** — `ONB-4.1` gained `_risk:_` (demo wipe scoping).
- **LDG** — `LDG-4.4` gained `_risk:_` (partial-cutover double-scale). `LDG-4.1`/`LDG-4.2` wired to `GF-COMBO-FX` (canonical keeps GBP-minor; triangulated rollup non-destructive). `LDG-2.5` gained `_benchmark-by:_`.
- **ENR** — `ENR-3.1` gained `_risk:_` (auto-merge collapse) + `GF-COMBO-FX` wiring. `ENR-3.3` gained `_risk:_` (unmerge orphans) + a fuller test line. `ENR-4.1`/`ENR-4.3` wired to `GF-COMBO-FX` (native-currency split; 2 GBP receivables, not 6).
- **CAT** — `CAT-1.4` gained `_risk:_` (merge reassign-then-drop). `CAT-2.1`/`CAT-2.2`/`CAT-4.2` gained `_benchmark-by:_`.
- **ING** — `ING-6.2` gained the `PLT-8.4` dep + a `_benchmark-by:_` + test now driven by the burst harness (was prose). `ING-6.1` gained `_benchmark-by:_`.
- **RCP/OWE/INT/RPT/REV/NAV/NTF/IOS** — no leaf-body changes; covered by the corrected build-order block, the consistency rule, and (for RPT/REV/NAV) the unchanged SLO perf budgets.

## Splits / merges (old → new IDs)

- **No splits, no merges, no deletions, no renumbering, no net leaf change.** All edits are in-place; the only structural deltas are 2 dependency edges and 1 golden fixture.

## New / extended golden fixtures (header block)

- `GF-COMBO-FX` (v7) — triangulated FX conversion inside a split inside a dedup group. £90 London dinner via 3 sources (dedup) → GBP→EUR→USD triangulation (no direct rate) → split 3 ways, 2 reimbursable. Invariants: 1 purchase_group; canonical stays 9000 GBP-minor (conversion is report-time, never a rewrite); split sums in native GBP-minor exactly (no cent lost to converting first); converting-then-summing == summing-then-converting within ±1 minor unit with a deterministic residual owner; exactly 2 GBP receivables (not 6); missing-rate triangulates or flags, never silent 1:1; replay-stable. (Wired: LDG-4.1, LDG-4.2, ENR-3.1, ENR-4.1, ENR-4.3.)

## Decisions

- **The stated build-order is now graph-truth, not narrative.** Both the first-PR slice and the critical path were reconciled against the actual `_deps:_` edges programmatically; the v6 versions had a leaf scheduled before its blocker in each. The new index-block E waves are topo-verified the same way. This is the deliverable that lets the user dispatch leaves in order.
- **PLT-2.3 formally follows PLT-2.1.** The migration/backfill replay harness presupposes the Alembic framework it exercises — making this a real edge (not just an ordering) was necessary for the corrected critical path to be a true edge chain.
- **HYP perf numbers now have a benchmark deadline, mirroring how spikes have a decide-by.** A guess can't stay unvalidated forever; each names where it's measured (mostly the first PLT-8.4 load run) and what promotes it to SLO. SLO numbers (read-tier, index-backed) need no such gate.
- **The FX combo is the hardest collision, so it gets a fixture, not a leaf.** The risk is rounding/representation, not missing functionality — the leaves (LDG-4.1/4.2, ENR-3.1/4.1/4.3) already exist; what was missing was a fixture proving they *compose* on a multi-currency leg. Native-currency split math + report-time conversion is the pinned design.
- **Index blocks are a regenerated snapshot.** Accepted that A–E restate leaves and can drift; the rule is regen-at-end-of-pass with the leaf as the single source of truth, rather than trying to hand-maintain two copies (iteration-06 self-critique #1).

## Open questions (seed iteration 8 — the FINAL consolidation pass)

1. **The index blocks (A–E) are now five hand-written snapshots that v8 must actually reconcile.** This pass added block E and a `Bench-by` column and a `GF-COMBO-FX` catalog row — all hand-entered. v8 (consolidation) should do a real regen-and-diff: parse every leaf's `_perf:_`/`_risk:_`/`_benchmark-by:_`/`_deps:_`/`GF-*` citations and assert each table matches, fixing any drift with the leaf winning. The consistency rule says how, but it hasn't been *executed* as a diff.
2. **Gmail restricted-scope (CASA) timeline + recurring cost** (`SRC-6.1`) — still the top *external* unknown, carried v2→v7; the `source.gmail` flag (default OFF) + SRC-7.2 forward-to-email fallback encode the workaround, but the tree can't supply the real CASA lead-time/cost. (Unchanged from iter-06; flagged again as the one thing the backlog genuinely can't resolve internally.)
3. **`GF-COMBO-FX` pins a ±1-minor-unit rounding tolerance and "last share owns the residual cent," but no leaf yet OWNS the rounding policy the way ENR-2.7 owns match-config.** The split/FX leaves each implement it; a single `money.py`/`fx.py` rounding-policy constant (largest-remainder allocation, residual owner) would prevent two leaves from rounding differently. v8 could note this as a one-line shared-policy owner rather than letting each leaf re-decide.

## Self-critique (what's still weakest → iteration 8)

1. **The build-order block E is a *starter spine*, not a full schedule.** It topo-orders the path to the wedge (W0–W5) but stops at ENR-3.4; the other ~300 leaves (RCP, OWE, INT, RPT, REV, NAV, NTF, IOS, the rest of SEC/AUT) are ordered only by their individual `_deps:_`, not placed in waves. A user dispatching past the wedge still has to read `_deps:_` per leaf. v8 could either extend the waves or explicitly state that block E is intentionally wedge-only and downstream is `_deps:_`-driven (it currently says the latter in one line — could be clearer).
2. **`_benchmark-by:_` deadlines are phrased as phase boundaries ("P3→P4 load gate"), not enforceable gates.** Unlike a `research` spike's `_decide-by:_` (which has a crisp exit criterion), a benchmark-by says *when* to measure but not *what CI check fails* if a HYP number is shipped as a contract without measurement. v8 could tie each to a PLT-8.4 assertion that fails if a HYP budget is referenced as SLO before its measured value is recorded — making the promotion auditable.
3. **The 2 new edges nudged the graph but I did not re-examine whether other "narrative orderings" in the header are real edges.** I fixed the first-PR slice and critical path, but the header also asserts an "auth chain SEC-1.1 → SEC-1.2 → AUT-3.1" and "parallel foundation PLT-2.1 → SEC-3.5/SRC-1.2" — I spot-checked these hold, but did not exhaustively prove every ordering claim in the header maps to a real edge the way I did for the two I fixed. v8's regen should validate ALL header ordering claims against the graph.
4. **Risk lines are now present on destructive leaves but their *mitigations reference other leaves* (AUT-4.2 step-up, SEC-3.2 export, SEC-4.1 audit) without those being hard `_deps:_`.** E.g. SEC-3.1 already deps SEC-3.2/SEC-3.5/SRC-2.5 but its risk also leans on AUT-4.2 (step-up) and SEC-4.1 (audit) — neither is a dep. Either the mitigation is advisory (fine) or it should be an edge (safer). v8 could decide per-risk whether a cited mitigation leaf should become a real dependency, so "mitigated by X" can't be satisfied by shipping without X.
5. **`GF-COMBO-FX` is the 4th combo fixture and the combos are getting long.** The header golden-fixture block is now ~21 fixtures with the combos running to paragraph length. They're correct and load-bearing, but a reader scanning the header hits a wall of prose. v8 (consolidation) might move the full combo *definitions* into a dedicated sub-section and keep only the one-line catalog (block C) inline, so the header stays scannable — tightening over growth, per the compactness mandate.
6. **No coverage regression check was run this pass.** I verified IDs/graph/fields but did not re-walk the §1 vision bullets and table-stakes PFM features to confirm none lost a mapping (this pass didn't touch coverage, but the quality bar asks every pass to confirm it). v8 should do the explicit vision-bullet→leaf coverage sweep as part of consolidation, since it's the last chance before the tree is considered done.

## Invariants honored

IDs stable; **no leaf deleted/added/renumbered/split/merged** (346 → 346); coverage preserved; server-verified identity untouched (SEC-1.1/1.2 unchanged; the new SEC-3.1/3.5 risks *reinforce* erasure safety); encrypted tokens untouched; migration-safe + idempotent data leaves still tagged `_xc: idem`; money on integer minor units preserved and the new `GF-COMBO-FX` *strengthens* the money invariant (native-currency split math, non-destructive conversion); staging/prod separation untouched; provider-abstraction + Plaid-default-swappable intact; the 2 new edges keep the graph acyclic. **Verified programmatically: 346 leaves, 0 duplicate IDs, 0 dangling deps, 0 cycles, 0 self-loops, 0 leaves above `M`, 12/12 spikes carry cost+decide-by, 8/8 HYP perf leaves carry benchmark-by, 0 SLO leaves carry benchmark-by, all 346 v6 IDs present, every in-line `obs:<signal>` ∈ the PLT-4.6 contract, the corrected first-12-PR slice is internally dependency-consistent, the corrected critical path is a fully-linked real edge chain, GF-COMBO-FX wired into exactly its 5 cataloged leaves.**

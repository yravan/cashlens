# Iteration 00 — Baseline (v0)

**Author:** Claude (main session) · **Date:** 2026-05-29

## What v0 is

The initial complete feature tree, authored from: the user's product vision, the frozen
`spec history/` docs, the current repo (models, API, web screens), and the repo-native skills.

## Stats

- Leaves: **295**
- Epics: **17** (PLT, SEC, AUT, ONB, SRC, ING, LDG, ENR, RCP, CAT, OWE, INT, RPT, REV, NAV, NTF, IOS)
- Feature groups: **85**
- Research spikes: **11**

## Key decisions

- **Provider-agnostic from the start.** Plaid is today's implementation, but `SRC-1` models a
  provider interface and `SRC-1.5` is an explicit spike on Plaid vs Teller vs SimpleFIN. (Note:
  prior project memory claimed Teller was chosen, but the *current* repo is Plaid-only; treated
  as an open decision, not a settled fact.)
- **Two known debt items surfaced as leaves:** no migration framework yet → `PLT-2.1` (Alembic);
  money stored as `Float` → `LDG-4.3` (migrate to integer minor units).
- **Cross-source matching/dedup (`ENR`) is the structural heart** of the wedge (one purchase seen
  via bank + Venmo + receipt = one truth). Modeled as a matching framework + per-source matchers.
- Status tags (`built`/`partial`/`new`) reflect the current repo as of 2026-05-29.

## Self-critique → seeds for the refinement passes (v1–v8)

Each pass is a **full holistic re-attempt**, but these are the weakest areas to strengthen first:

1. **Acceptance criteria & test layer are missing** on nearly every leaf (quality-bar items 6).
   This is the single biggest gap.
2. **Data/API/shared-type deltas not yet named** per leaf (item 5) — ground them in the real
   models (`raw_transactions`, `ledger_events`, etc.) and the existing endpoint shapes.
3. **Dependency edges are sparse** (item 4) — only obvious ones are marked. Need fuller `deps:`
   coverage + a phase/critical-path rollup and a "first 10 PRs" starter slice.
4. **Sizing not yet validated** (item 2) — `L` leaves should be audited; some (e.g. `ENR-2.1`,
   `INT-1.1`, `SRC-8.1`, `RPT-2.2`) may need splitting to stay ≤500 LOC.
5. **Coverage gaps to probe** (item 1): no explicit *budgets/alerts on overspend*, *shared
   household/multi-user*, *goals/savings targets*, *net-worth account grouping*, *transaction
   notes/tags/attachments*, *merchant-level rules vs category rules*, *data backup/restore*,
   *accessibility* as first-class leaves, *cash/manual asset reconciliation*, *currency on iOS*.
6. **Cross-cutting requirements** (item 7) live mostly in `SEC`/`PLT`; later passes should
   annotate feature leaves with the cross-cutting reqs they must honor (authz, idempotency,
   rate limits, a11y) rather than leaving them siloed.
7. **Risk levels** (item 8) not yet tagged; spikes exist but lack a risk/mitigation note and
   cost estimate (esp. LLM/OCR spend, vendor access feasibility for Venmo/PayPal).
8. **Agent-readiness** (item 9): leaves are one-liners; the final passes should make each a
   self-contained brief (scope + files-likely-touched + acceptance + test + deps + skill).

## Invariants for all passes

See `00-README.md §8`. Most important: IDs stable, never silently drop a leaf, preserve/grow
coverage, server-verified identity only, migration-safe + idempotent data changes.

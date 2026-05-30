# Iteration 06 - Delegated critique integration and structural hardening

## Pass goal

Run a second brain over the whole tree, then use that critique to widen the tree where hidden correctness risks still existed.

## Delegated pass used here

A separate sub-agent reviewed:

- the deep research report
- the MVP spec
- the architecture roadmap PDF
- the current repo shape
- the baseline feature tree

The critique specifically looked for:

- missing epics or leaves
- places where leaves were still too large
- modeling risks that would create expensive rework later

## Whole-tree changes made from that critique

- Added `ING-4` reconciliation and operator-recovery leaves:
  - account-to-ledger reconciliation checks
  - connection-level discrepancy states
  - operator repair tooling for one connection
- Added `LDG-1.4` review lifecycle states so human-confirmed outcomes are durable
- Added `LDG-2.5` positions / holdings / liability snapshots to keep fragmented money honest
- Added `ENR-2.5` user-visible provenance trace for one ledger event
- Added `CAT-1.4` structured "reason" field on allocations
- Added `CAT-4.6` categorization explanation drill-down
- Added `OWE-1.0` counterparties model
- Added `OWE-4.4` credit-card statement semantics
- Added `INT-4` evaluation and regression harnesses:
  - golden-set fixtures
  - confidence calibration reports
  - recurring/anomaly regression scoring

## Why this pass mattered

This was the pass that most improved long-term trustworthiness. The critique correctly identified that a finance product can look polished while still being operationally weak if it lacks:

- reconciliation
- provenance
- durable review states
- evaluation harnesses
- operator recovery tooling

## Important "do not bundle this" lessons captured

- do not bundle Gmail auth, search, MIME handling, attachments, and dedupe into one task
- do not bundle LLM provider wiring, prompting, evaluation, and apply-to-ledger logic into one task
- do not bundle candidate generation, scoring, and review UX for matching
- do not build mobile-specific review logic before the shared review state machine exists

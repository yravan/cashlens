# Iteration 03 - Ledger semantics, itemization, and no-double-count rules

## Pass goal

Revisit the full tree around the most important product-modeling idea: a bank transaction is only evidence of an economic event, not the full event itself.

## Whole-tree changes made in this pass

- Deepened `LDG` so canonical state is more than a thin wrapper around raw transactions:
  - richer ledger event types
  - `ledger_event_sources`
  - review state and confidence
  - balance snapshots
  - point-in-time aggregates
  - net worth timeline
  - explicit pending / posted / reversed / refunded lifecycle fields
- Added integrity-oriented data upgrades:
  - append-only raw truth
  - replay-safe projections
  - idempotency tests
  - float-to-integer money migration
  - separate source signed amount from user-facing economic meaning
- Expanded `ENR` so enrichment is not a vague future bucket:
  - merchant normalization
  - receipt-to-bank matching
  - refund-to-purchase matching
  - duplicate economic-event detection
  - one-purchase-many-sources merge model
  - manual split editor
  - no-double-count invariant tests
- Split `RCP` into meaningful layers:
  - capture and storage
  - parsing and extraction
  - invoices and bill documents
  - itemization UX

## Why this pass mattered

This pass is what prevented the tree from becoming "just a nicer transaction list." The user explicitly wants grocery sub-breakdowns, health sub-breakdowns, returns, reimbursements, and source-linked explanations. That only works if the canonical ledger and enrichment layers are treated as first-class product surfaces.

## Key modeling guardrails established

- One purchase may depend on several raw sources
- One bank transaction may need to split into several allocations
- Reporting correctness matters more than UI speed here
- Money representation must be fixed before the product grows into serious analytics

## Biggest open tension after this pass

The float-to-integer migration is correctly modeled as a larger data task, but it remains a sequencing hazard because many later leaves assume it exists.

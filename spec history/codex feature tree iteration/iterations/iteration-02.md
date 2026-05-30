# Iteration 02 - Source-of-truth expansion and connection surfaces

## Pass goal

Revisit the entire tree with a focus on "where truth comes from" so the backlog does not silently assume Plaid is the whole product.

## Whole-tree changes made in this pass

- Expanded `SRC` from "connect Plaid" into a generic connection system:
  - generic `connections` model
  - capability metadata
  - standardized connect / reconnect / disconnect contract
  - feasibility spikes for uncertain providers
- Split Plaid work into more granular leaves:
  - richer item metadata
  - disconnect flow
  - reconnect/update-mode flow
  - better account-type distinction
- Added a first-class Gmail subtree:
  - connection record
  - scoped message pull
  - raw message metadata storage
  - disconnect/revocation
- Added person-to-person and manual-source leaves:
  - Venmo research
  - PayPal research
  - manual CSV import skeleton
  - manual cash / external account entry
- Widened `ING` so raw-source preservation is not Plaid-specific:
  - raw source record tables beyond Plaid
  - durable webhook event storage
  - ingestion run audit model

## Why this pass mattered

Without this pass, the tree would have accidentally encoded "the product equals Plaid plus categories." The user vision is much broader: receipts, reimbursements, claims, bills, manual accounts, Gmail, and fragmented money all require a source-agnostic connection model.

## Atomicity decisions made here

- Gmail connection, Gmail fetch, Gmail storage, and Gmail disconnect are separate leaves
- Venmo and PayPal are research leaves first, not fake implementation promises
- Manual CSV import is kept separate from manual account tracking

## Risks surfaced

- Gmail is potentially the highest-compliance source in the whole roadmap
- P2P integrations may stay manual-import-first for longer than the ideal product vision suggests
- Generic connection infrastructure must arrive before a provider explosion

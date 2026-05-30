# Iteration 01 - Baseline product decomposition

## Pass goal

Turn the user vision plus the existing repo into a first-pass full-app tree without collapsing unlike problems into one giant backlog bucket.

## Whole-tree changes made in this pass

- Established the north-star framing:
  - Cash Lens is a personal financial operating system
  - the core question is net inflow/outflow, where it went, and why
  - "transaction != purchase" is the foundational modeling rule
- Added explicit repo grounding so the tree starts from reality instead of a blank sheet:
  - existing web surfaces
  - existing FastAPI routes
  - existing core tables
  - important current gaps
- Chose a leaf format that makes every item implementation-ready:
  - stable ID
  - status
  - rough implementation size
  - layer
  - dependencies
  - one-line acceptance condition
- Split the product into initial epics rather than one generic "build finance app" bucket:
  - platform
  - security
  - auth
  - onboarding
  - source connections
  - ingestion
  - ledger
  - enrichment
  - receipts
  - categorization
  - obligations
  - intelligence
  - reporting
  - review
  - navigation
  - notifications
  - iOS

## Why this pass mattered

The biggest early risk was designing around screens instead of financial semantics. This pass intentionally anchored the backlog on the ledger, sources, and reviewability first, then let screens hang off those primitives.

## What stayed intentionally unresolved

- Which non-Plaid providers should come first
- How broad Gmail ingestion should be in phase one
- Whether investments should be modeled in the first serious schema expansion
- How much LLM intelligence belongs in the first implementation wave versus later

## Output of this pass

- A coherent canonical tree structure
- Current-repo grounding
- A stable leaf-node format future agent work can target directly

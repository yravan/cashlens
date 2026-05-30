# Iteration 08 - Final editorial pass and recommended first execution order

## Pass goal

Do one last whole-tree sweep for completeness, consistency, and practical next steps.

## Final structure at the end of this pass

- 17 implementation epics
- 59 sub-areas
- 209 leaf features
- grounded against the current repo, the deep research report, the MVP spec, and the architecture roadmap

## Final whole-tree checks performed

- Verified that the tree covers:
  - sources of truth
  - ingestion and replay
  - canonical ledger
  - itemization
  - categorization
  - reimbursements / returns / bills
  - intelligence
  - review UX
  - reporting
  - notifications
  - iOS delivery
- Verified that the tree includes both:
  - "single source of truth of my financials"
  - "understand where every dollar went and why"
- Verified that future-facing themes are present as explicit leaves:
  - Gmail invoices
  - fragmented money
  - tax context
  - push notifications
  - mobile app
  - smart LLM categorization

## Recommended first implementation tranches

### Tranche A - make the core safe

- `PLT-2.1` through `PLT-2.3`
- `LDG-4.3`
- `LDG-4.1` through `LDG-4.2`
- `ING-4.1`

### Tranche B - stabilize the source and connection model

- `SRC-1.1` through `SRC-1.3`
- `SRC-2.1` through `SRC-2.4`
- `ING-1.3`
- `ING-2.5`

### Tranche C - make the ledger financially honest

- `LDG-1.1` through `LDG-1.4`
- `LDG-2.1` through `LDG-2.4`
- `LDG-3.1` through `LDG-3.3`

### Tranche D - unlock reviewable enrichment

- `ENR-1.1` through `ENR-1.3`
- `ENR-2.1`
- `ENR-3.1` through `ENR-3.4`
- `REV-1.1` through `REV-2.2`

### Tranche E - broaden sources and smartness

- `SRC-3.*`
- `SRC-4.*`
- `RCP-*`
- `CAT-*`
- `INT-*`

## Final open questions that still deserve separate design work

- Gmail restricted-scope compliance burden
- realistic Venmo / PayPal import path
- exact scope of early investment coverage
- tax feature boundary: tracking vs actionable planning
- when to introduce production LLM providers versus rules-first categorization
- whether iOS should start in SwiftUI native or via a lighter parity strategy

## Conclusion of this pass

The tree is now detailed enough to drive many months of agent-sized implementation work, while still being structured enough for manual review and prioritization instead of becoming an unreadable mega-spec.

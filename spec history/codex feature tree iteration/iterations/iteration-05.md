# Iteration 05 - Intelligence, reporting, review UX, and product breadth

## Pass goal

Revisit the entire tree with an eye toward the user-facing surfaces that make the ledger useful day to day, without letting those surfaces dictate the core model.

## Whole-tree changes made in this pass

- Expanded `CAT` into separate dimensions:
  - taxonomy and dimensions
  - manual categorization workflows
  - rules engine
  - LLM-assisted categorization
- Expanded `INT` into separate intelligence families:
  - recurring streams
  - anomaly detection
  - prediction and explanation
- Expanded `RPT` beyond a generic dashboard:
  - dashboard and summary cards
  - spending analysis
  - cash-flow and balance history
  - tax and exports
- Added `REV` as a first-class epic rather than a UI detail:
  - queue construction
  - swipe/card review UX
  - bulk review workflows
- Added `NAV`, `NTF`, and `IOS` leaves so the product stays honest about delivery channels:
  - app shell and information architecture
  - settings and preferences
  - in-app notifications
  - push groundwork
  - iOS bootstrap, parity, and native integrations

## Why this pass mattered

The user does not just want a data warehouse. They want a website and iOS app with reviewable, smart, actionable financial context. This pass made sure the feature tree covers the experience layer without collapsing back into brittle page-level backlog items.

## Important guardrails added here

- Review UX should assert outcomes, not hard-code one layout forever
- LLM categorization should stay separate from rules and separate from taxonomy
- iOS work should follow shared backend and review semantics, not invent its own model

## What this pass intentionally avoided

- No pixel-perfect feature leaves
- No "build all charts" leaves without semantic prerequisites
- No single giant "AI categorization system" leaf

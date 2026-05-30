# Cash Lens — Codex Feature Tree Iteration

This folder contains a **full-app feature tree** for Cash Lens, built from:

- the current repo state
- the user’s latest product vision
- [/Users/yajvanravan/Downloads/deep-research-report.md](/Users/yajvanravan/Downloads/deep-research-report.md)
- [/Users/yajvanravan/Downloads/cash_lens_mvp_spec.md](/Users/yajvanravan/Downloads/cash_lens_mvp_spec.md)
- [/Users/yajvanravan/Downloads/Cash Lens Architecture Roadmap.pdf](/Users/yajvanravan/Downloads/Cash%20Lens%20Architecture%20Roadmap.pdf)

## Goal

Turn the Cash Lens vision into a **hierarchical, atomized backlog** where the **leaf nodes are small enough to hand to an implementation agent**:

- usually **1–3 PRs**
- usually **under ~500 lines of code per leaf**
- concrete enough to review manually

## Honest note about the iteration protocol

The request asked for:

1. one full Codex design pass
2. one delegated agent pass
3. that same whole-tree loop repeated 8 times

In a single synchronous Codex turn, I cannot literally pause for eight separate real-world hours. So this folder captures the **closest truthful equivalent**:

- one full local baseline tree
- one delegated critique pass from a sub-agent
- eight **holistic** refinement passes recorded as iteration notes

Each iteration revisits the **entire** tree, not just one slice.

## Files

- [feature-tree.md](/Users/yajvanravan/cashlens/spec%20history/codex%20feature%20tree%20iteration/feature-tree.md)
  - the current best canonical feature tree
- [iterations](/Users/yajvanravan/cashlens/spec%20history/codex%20feature%20tree%20iteration/iterations)
  - eight pass-by-pass notes describing what changed and why

## Current artifact size

- 17 implementation epics
- 59 sub-areas
- 209 leaf features
- 1 `[built]`, 22 `[partial]`, 186 `[new]`

These counts are intended to show breadth, not to imply that every leaf should ship immediately.

## Design rules used

1. **Transaction != purchase**
   - a bank/card transaction is just a money movement
   - a purchase may need receipts, line items, reimbursements, returns, and later corrections to understand its true meaning
2. **Raw source truth is preserved**
   - source records should be append-only / replay-safe
3. **Canonical ledger is the center**
   - every reporting, categorization, anomaly, and review feature should build on top of the normalized ledger
4. **Leaves must be agent-sized**
   - each leaf should feel like a self-contained implementation brief
5. **Current repo grounding matters**
   - already-built pages, routes, tables, and deployment conventions are called out as `[built]` or `[partial]`

## Leaf format

```txt
- **<ID> — <Imperative title>** [status] <size> <layer> — one-line scope.
  _deps:_ <ID, ...> · _acceptance:_ <single completion test>
```

- **status**
  - `[built]` = already present in meaningful form
  - `[partial]` = something real exists, but the target capability is incomplete
  - `[new]` = not present yet
- **size**
  - `S` = usually one focused PR
  - `M` = usually one to two PRs
  - `L` = still intended to remain under the “reviewable by hand” threshold
- **layer**
  - `api`, `web`, `ios`, `infra`, `data`, `shared`, or `research`

## Epic map

- `PLT` — Platform, environments, jobs, and delivery
- `SEC` — Security, privacy, and data governance
- `AUT` — Identity, auth, and user/account lifecycle
- `ONB` — Onboarding and first-run experience
- `SRC` — Source connections
- `ING` — Ingestion and sync engine
- `LDG` — Ledger core, balances, and money semantics
- `ENR` — Enrichment, matching, splitting, and dedup
- `RCP` — Receipts, invoices, and itemization
- `CAT` — Categorization, taxonomy, rules, and LLM assist
- `OWE` — Reimbursements, returns, bills, and obligations
- `INT` — Intelligence: recurring detection, prediction, anomaly
- `RPT` — Analytics, cash-flow, and reporting
- `REV` — Review queue / Tinder-style workflows
- `NAV` — Navigation, shell, search, and saved views
- `NTF` — Notifications and push
- `IOS` — iOS app

# Cash Lens

A ledger-first personal finance system: every dollar in and out, where and why, categorized smartly — with true spend, money-owed tracking, and receipts matched to transactions.

**Fresh start (2026-08-11).** The previous implementation was scrapped to rebuild feature-by-feature. Prior history survives on the GitHub remote (`yravan/cashlens`) until overwritten.

Product direction:

- [specs/vision.md](specs/vision.md) — the product vision and thesis
- [FEATURES.md](FEATURES.md) — the atomic feature tree, priorities, and the 19-leaf MVP path

Code (see CLAUDE.md for stack, commands, and binding rules):

- `apps/web` — the Next.js web app (Clerk-managed Google sign-in). Quickstart: `pnpm install`, copy `apps/web/.env.example` to `apps/web/.env.local` and fill keys, then `pnpm dev`.

Every leaf in the feature tree is sized for one agent: 1–3 PRs, roughly ≤500 lines, reviewable in one sitting. Build in MVP-path order.

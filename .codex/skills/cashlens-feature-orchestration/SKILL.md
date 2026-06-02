---
name: cashlens-feature-orchestration
description: Use when acting as the orchestrator for Cash Lens feature work — taking a feature-tree leaf or feature request and driving it to a merged PR by launching a separate implementer agent and an independent reviewer agent. Also use when deciding what to build next, dispatching background agents, or relaying agent results to a mobile user.
---

# Cash Lens Feature Orchestration

You do not write feature code yourself. You **dispatch a separate implementer agent and
an independent reviewer agent**, gate on real evidence, and report PR links for the user
to merge. The two agents MUST be separate sessions with no shared context — independent
review is the whole safeguard. An agent grading its own homework is not a gate.

## When to use

- You are the orchestrator (often driven by a mobile user) and were asked to build/fix/extend a feature, or to "do `<LEAF-ID>`".
- Default to **one feature at a time** (mobile review-ability). Parallelize only when the user accepts multiple open PRs.

## The two-agent loop (per feature)

1. **Pick the leaf.** From `spec history/claude feature tree iteration/feature-tree.md`, choose the next leaf whose `_deps:_` are all merged (block E waves give a safe order). Restate its `_accept:_` / `_test:_` to the user.
2. **Isolate.** Use `superpowers:using-git-worktrees` — one worktree per feature so the implementer (and any retry) can't clobber the workspace.
3. **Dispatch the IMPLEMENTER** (Agent tool, general-purpose, full tools; tell it to follow `cashlens-feature-implementation`). Pass: leaf ID + full brief + worktree path + "open a PR when self-verified." Run in background; continue when it returns.
4. **Dispatch the REVIEWER** — a FRESH agent with NO implementer context, told to follow `cashlens-feature-review`, pointed at the PR/branch + the same leaf brief. Never let the implementer review its own work.
5. **Gate on the verdict:**
   - APPROVE → step 6.
   - REQUEST CHANGES → send the reviewer's specific list to a fix agent (the implementer, applying `superpowers:receiving-code-review`), then re-review (step 4). Loop until approve, or escalate to the user after 2–3 rounds.
6. **Verify yourself** (`superpowers:verification-before-completion`): confirm the PR's required checks (`api`/`web`/`e2e`/`docs`) are actually green via `gh pr checks`. Do NOT trust agent self-reports.
7. **Report** to the user: PR link, one-line summary, reviewer verdict, checks status. The user merges on mobile.

## Reliability principles

- Implementer ≠ reviewer. Separate agents, separate context.
- Treat every agent claim ("tests pass") as a claim to verify. CI required checks are the hard backstop; your `gh pr checks` confirmation is the soft one.
- Never push to `main`; everything lands via PR (`cashlens-pr-workflow`).
- Keep the orchestrating session alive — it holds the loop state. Use background agents + completion notifications when the user is away.
- **Dispatch implementer/reviewer with `model: claude-opus-4-8` at max reasoning effort.** This is enforced durably by `.claude/settings.local.json` env (`CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-4-8`, `CLAUDE_CODE_EFFORT_LEVEL=max`), which applies on the next session launch; until a restart picks that up, pass `model: claude-opus-4-8` explicitly on each dispatch.

## Quick reference

| Step | Agent | Skill it follows |
|------|-------|------------------|
| Build | implementer (general-purpose, worktree) | `cashlens-feature-implementation` |
| Check | reviewer (fresh, separate) | `cashlens-feature-review` |
| Fix | implementer + feedback | `superpowers:receiving-code-review` |
| Merge | the user (mobile, GitHub) | — |

## Red flags — STOP

- Same agent implements and reviews → dispatch a separate reviewer.
- Reporting "done" without `gh pr checks` green → verify first.
- Building a leaf whose deps aren't merged → pick an unblocked leaf.
- Fanning out many parallel features to a mobile reviewer unasked → one at a time.

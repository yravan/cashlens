# 2026-05-31-02 — Claude feature-tree backlog + agentic feature-dev skills

## What changed

Two additions, both planning/workflow artifacts (no application code):

1. **`spec history/claude feature tree iteration/`** — a hierarchical, atomized product
   backlog for the full Cash Lens vision. 346 leaves across 17 epics, each ≤ ~500 LOC /
   1–3 PRs, tagged with status, size, layer, deps, acceptance criterion, test layer,
   data/API deltas, file paths, cross-cutting requirements, and risk. Produced as a v0
   baseline plus 8 full holistic refinement passes (snapshots v0–v8 and per-pass logs
   under `iterations/`). Complements the earlier `codex feature tree iteration/` package.

2. **Three repo-native dev-flow skills under `.codex/skills/`:**
   - `cashlens-feature-orchestration` — orchestrator contract: drive a feature to a merged
     PR by launching a separate implementer agent and an independent reviewer agent, gate
     on real evidence (`gh pr checks`), and hand the PR to the user to merge.
   - `cashlens-feature-implementation` — implementer-agent contract: leaf-as-brief,
     tests-first, implement, self-run `make` tests with pasted evidence, clean/minimal
     code, PR with acceptance→test mapping.
   - `cashlens-feature-review` — independent reviewer/tester contract: fresh context,
     re-run tests in a clean checkout, audit test quality, adversarial + diff/security/
     scope/code-quality review, APPROVE or REQUEST CHANGES.

## Why

Establishes the standing dev loop: orchestrator → implementer → independent reviewer → PR.
The independent reviewer closes the "agent grades its own homework" gap. Captured as skills
per the `AGENTS.md` rule that repeated workflows become skills.

## Validation

Docs/skills/planning only — no app code touched. The opening PR runs the standard required
checks (`api`, `web`, `e2e`, `docs`); the planning files live outside `docs/` mkdocs nav, so
`docs-build` is unaffected.

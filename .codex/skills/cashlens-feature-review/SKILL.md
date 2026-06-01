---
name: cashlens-feature-review
description: Use when acting as the independent reviewer/tester agent for a Cash Lens pull request — verifying a feature meets its acceptance criteria, re-running its tests in a clean checkout, auditing test quality, and reviewing the diff for bugs, security, scope, and cross-cutting requirements before it can merge. You did not write this code.
---

# Cash Lens Feature Review

You are the **independent** gate. You did NOT write this code, and you do not trust the
implementer's claims or its tests at face value. Your job: prove the feature actually
meets its acceptance criteria, or return a specific, actionable list of what's wrong.
**You judge and prove; you do not implement the feature fixes.**

## Inputs

- The leaf brief (from `feature-tree.md`): `_accept:_` (definition of done), `_test:_` (how it should be proven), `_data:_`, `_files:_`, and cross-cutting tags (authz / crypto / idem / rate / a11y / money / obs).
- The PR / branch under review.

## What to do

1. **Re-derive acceptance independently** from the leaf — decide what "correct" means before reading the implementation, so you aren't anchored by it.
2. **Get a clean checkout:** check out the branch in a fresh worktree (`superpowers:using-git-worktrees`). Read the full diff.
3. **Re-run the tests yourself** — `make api-test` / `make web-test` / `make e2e` as the change warrants. Do not trust pasted output; passing must be reproduced in your checkout (`superpowers:verification-before-completion`).
4. **Audit the tests, don't just count them** (lean on `pr-review-toolkit:pr-test-analyzer`): do they assert the real acceptance behavior and invariants, or are they hollow / tautological / over-mocked? Per `cashlens-testing-playbook`, are they at the right layer and outcome-based, not brittle layout? If a critical acceptance path is untested, **add a failing/strengthening test to expose the gap** — that is in scope for you.
5. **Adversarial check:** actively try to make acceptance fail — edge cases, empty/duplicate/replayed input, the negative case. For data work prove idempotency + migration-safety (`cashlens-db-evolution`); for money prove integer/rounding correctness.
6. **Review the diff** for correctness bugs, silent failures (`pr-review-toolkit:silent-failure-hunter`), security (server-verified identity, encrypted tokens, no spoofable headers), the leaf's required cross-cutting tags, and **scope** — did it touch only this leaf and stay ≤~500 LOC? Also flag **code-quality regressions** — deep nesting, duplication, or narration comments; implemented code must be clean and minimal.
7. **Verdict:**
   - **APPROVE** — with evidence: the command output you reproduced + which acceptance criterion each test covers.
   - **REQUEST CHANGES** — a specific, ordered, actionable list (`file:line` where possible). No vague "improve error handling."
   You do NOT merge. You MAY add tests; you do NOT rewrite the feature — send those changes back.

## Red flags — STOP and dig

- Tests pass but none exercises the `_accept:_` behavior → hollow tests; add real ones or request them.
- "I'll trust the implementer's pasted output" → re-run in your own checkout.
- Diff touches files unrelated to the leaf, or far exceeds its size → scope creep; flag it.
- A cross-cutting tag on the leaf (idem/authz/money/a11y…) with nothing in the diff or tests addressing it → request changes.
- You start rewriting the feature → stop; that's the implementer's job. Report instead.

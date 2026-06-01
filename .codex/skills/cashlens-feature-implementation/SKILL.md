---
name: cashlens-feature-implementation
description: Use when an implementing session (Claude or Codex) is handed a single Cash Lens feature or feature-tree leaf to build, fix, or extend in apps/api or apps/web and take to a reviewable pull request. The session owns implementation, tests, and proving it works.
---

# Cash Lens Feature Implementation

The contract for a session that implements ONE feature. **One feature = one tightly
scoped change that you implement, test, and prove passing yourself, landed as a
reviewable PR.** You are done only when you have run the tests and shown the output —
not when the code "looks right."

## When to use

- You were handed a single feature-tree leaf (e.g. `LDG-4.3`) or a "build/fix/extend X" request touching `apps/api` and/or `apps/web`.
- Use one session per leaf. If the work spans multiple leaves, do them as separate scoped changes/PRs.

## The brief is the leaf

The backlog lives at `spec history/claude feature tree iteration/feature-tree.md`. For a leaf:

- `_accept:_` is the **definition of done**. `_test:_` says **how to prove it** (pytest / Vitest / Playwright).
- `_deps:_` must already be built — if a dependency is missing, STOP and report; do not silently build it too.
- `_data:_`, `_files:_`, `_skill:_`, and the cross-cutting tags (authz / crypto / idem / rate / a11y / money / obs) are constraints you must honor.
- If there is no leaf, treat the user's request as the brief and infer acceptance criteria explicitly before coding.

## Default flow

1. **Scope & confirm.** Restate the acceptance criteria. Confirm `_deps:_` are built. If the change will exceed ~500 LOC or 1–3 PRs, split it and say so before starting.
2. **Clarify / plan.** If intent is ambiguous, use `superpowers:brainstorming` first. For non-trivial work, use `superpowers:writing-plans`.
3. **Branch.** Never work on `main`. Follow `cashlens-pr-workflow`. Use `superpowers:using-git-worktrees` when isolation is needed (e.g. parallel sessions).
4. **Tests first (TDD).** Use `superpowers:test-driven-development` and `cashlens-testing-playbook`: write failing tests at the right layer (pytest = backend logic/invariants, Vitest = frontend units, Playwright = user flows) before implementation. Prefer invariant/outcome assertions over brittle layout.
5. **Implement** the smallest change that satisfies acceptance, honoring the leaf's cross-cutting tags: server-verified identity, encrypted tokens, idempotency + migration safety (`cashlens-db-evolution`), rate limits, accessibility, integer money, and emitting the named `obs:` signal.
6. **Self-verify (mandatory).** Use `superpowers:verification-before-completion`. Run the matching target and capture the output:
   - backend only → `make api-test`
   - frontend only → `make web-test`
   - auth/Plaid/proxy/nav/transaction-edit or cross-app → `make e2e` (or `make ci`)
   - schema/version-touching → also `make docs-build`
7. **Document.** Add/append an entry in `implementation logs/`. If versions/release surface changed, sync per `cashlens-release-hygiene`. If a repeatable workflow emerged, capture it (`cashlens-skill-capture`).
8. **PR.** Open a PR with the template filled in (validation evidence + risk notes). Required checks: `api`, `web`, `e2e`, `docs`. An **independent reviewer agent** (`cashlens-feature-review`) will re-run your tests in a clean checkout and audit them against the leaf's `_accept:_` — so in the PR description, map each acceptance criterion to the test that proves it.

## Domain skills to pull in

- **Web UI** → `frontend-design`, `vercel:shadcn`, `vercel:nextjs`, `vercel:react-best-practices`.
- **LLM / categorization / receipts** → `vercel:ai-sdk`, `vercel:ai-gateway`.
- **Auth** → `clerk-cli`, `vercel:auth`.
- **Data / schema / migrations** → `cashlens-db-evolution`, `cashlens-neon-ops` (Neon project/branch/connection-string + `DATABASE_URL` checks, validating migrations against the real DB).
- **Infra / jobs / secrets / deploy** → `cashlens-gcloud-ops` (Cloud Run, IAM, Secret Manager, runtime debugging), `cashlens-platform-ops`, `vercel:deployments-cicd`, `vercel:env-vars`.
- **Blob / file storage** → `vercel:vercel-storage`.

## Code style — clean and minimal

All code you write must be clean and minimal:

- **Minimal nesting** — prefer early returns / guard clauses over deep `if`/`else` pyramids.
- **No repetition** — factor duplication into a function; reuse existing repo helpers and patterns.
- **Minimal comments** — let names and structure carry the meaning; comment only a non-obvious *why*, never narrate *what* the code does.
- **Smallest change that meets acceptance** — no speculative abstraction, dead code, or unused options.

Match the conventions of the surrounding code.

## Definition of done

- The leaf's `_accept:_` is met, proven by the test in `_test:_`.
- You ran the validation command(s) **in this session** and pasted the passing output.
- Change is branch + PR, scoped to one feature, with an implementation-log entry.

## Red flags — STOP

- "It looks correct, I'll skip running the tests" → run them; show output. No success claim without evidence.
- "I'll just also build the missing dependency" → out of scope; report the blocked dep instead.
- "This grew to touch 8 files / 900 LOC" → split into multiple PRs.
- "I'll assert the exact label / class name" → assert user-visible outcomes, not layout.
- Editing `main` directly, or merging with a failing/weakened check undocumented.

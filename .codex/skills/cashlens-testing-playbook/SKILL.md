---
name: cashlens-testing-playbook
description: Use when adding, changing, or reviewing tests in the Cash Lens repo, especially when deciding how to cover frontend changes without brittle layout assertions or how to split behavior across pytest, Vitest, and Playwright.
---

# Cash Lens Testing Playbook

This skill keeps tests stable while the product keeps evolving.

## Layer selection

- `pytest`: backend logic, auth/security helpers, seeded API behavior, and future migration or backfill invariants.
- `Vitest`: frontend utilities, client components, and environment wiring.
- `Playwright`: smoke-level user flows across the running backend and frontend.

## Frontend test rules

- Prefer roles, labels, and business-visible copy.
- Use a small number of stable `data-testid` attributes only for high-value controls whose wording may evolve.
- Never assert layout dimensions, DOM depth, Tailwind class names, or animation details unless the bug is explicitly visual.

## Backend test rules

- Favor invariant-style assertions: authorization, idempotency, serialization safety, and seeded workspace behavior.
- Keep fixtures small and representative.
- When a bug came from a tricky live integration edge case, preserve that edge case in a unit or integration test before moving on.

## Future-facing guidance

- Database and migration work should add upgrade and re-run safety coverage.
- Dedup and backfill work should prove “no double-application” behavior.
- LLM features should test structure and guardrails instead of exact generated wording.

---
name: cashlens-db-evolution
description: Use when changing Cash Lens data models, sync persistence, migrations, dedup logic, backfills, or future LLM/data-processing pipelines that touch the database or replay historical records.
---

# Cash Lens Database Evolution

Use this skill before shipping persistent-data changes.

## Default checklist

1. Identify whether the change is schema, data migration, sync semantics, or derived-data logic.
2. Add or update tests for:
   - upgrade safety
   - idempotency on re-run
   - backward-compatible reads where relevant
3. Call out rollout order in the implementation log or PR notes.
4. If the workflow becomes repeatable, update this skill or create a focused child skill.

## What to protect

- Existing users should not lose data because a sync or replay runs twice.
- New classification or dedup logic should not create duplicate ledger events.
- Future migrations should be testable independently of app startup behavior.

## Prefer these assertions

- record counts stay stable across replays
- cursors advance safely
- backfills can resume
- schema changes preserve existing rows

Avoid using manual spot checks as the only proof for persistent-data changes.

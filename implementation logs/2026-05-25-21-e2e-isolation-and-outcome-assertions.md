# E2E isolation and outcome assertions

- Date: 2026-05-25
- Area: testing, CI, Playwright

## What changed

- Changed the Playwright smoke test to assert that the number of connected institutions increases after adding a demo institution instead of asserting a duplicated institution label.
- Changed the Playwright backend web server command to delete the throwaway SQLite database before each run.
- Disabled `reuseExistingServer` for the Playwright-managed backend and frontend servers so the suite always runs against app-owned processes instead of attaching to arbitrary local servers.
- Updated the repo testing skill with the rule that Playwright should assert user outcomes and use isolated state.

## Why

- The previous smoke test failed even though the product behavior was correct because it looked for a single exact text node that can appear more than once.
- The backend for Playwright was using a persistent SQLite file in `/private/tmp`, which let demo institutions accumulate across runs and made the suite non-idempotent.
- Long-term, this repo will grow more stateful features like migrations, deduplication, and backfills, so the e2e layer needs deterministic state control now.

## Validation

- Re-ran `make e2e` after the changes and confirmed the smoke suite passes against a fresh database.

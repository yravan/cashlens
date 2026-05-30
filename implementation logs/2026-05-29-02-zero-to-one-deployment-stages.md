# Zero-to-one deployment stages rewrite

- Date: 2026-05-29
- Area: deployment docs

## What changed

- Rewrote `deployment instructions.md` into a staged zero-to-one rollout.
- The guide is now organized around:
  - Stage 0: local setup
  - Stage 1: first hosted deployment, which becomes staging
  - Stage 2: second hosted deployment, which becomes production
- Rewrote `docs/deployment.md` to summarize the same staged model.

## Why

- The previous rewrite correctly separated staging from production, but it still started from the assumption that one hosted deployment already existed.
- The user wanted the guide to read like a full build path from zero to one:
  - first deployment first
  - second deployment second
- That structure is easier to follow when someone is actively building the environments in order.

## Result

- The deployment guide now matches the actual order a person should follow.
- Future infrastructure work can still preserve the staging/production separation while giving the user a clearer first-time setup sequence.

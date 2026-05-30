# Changelog

All notable changes to Cash Lens should be recorded here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Deployment guidance now assumes the existing hosted app is staging and that real production should be a second, separate hardened deployment.
- The current backend deploy workflow is now explicitly staged as the Stage 1 staging deployment path.
- The repo now includes separate manual production backend and frontend deploy workflows so the second hosted environment can be promoted without exposing secrets in chat.



## [0.0.0] - 2026-05-25

### Added

- Cash Lens MVP with Next.js frontend and FastAPI backend.
- Dashboard, accounts, transactions, notifications, and settings flows.
- Plaid sandbox connectivity plus demo-mode fallbacks.
- GitHub-based Cloud Run backend deployment and Vercel frontend deployment.
- Repo-wide CI with `api`, `web`, `e2e`, and `docs` checks.
- MkDocs documentation source plus Read the Docs configuration.
- Root `VERSION` file and version-sync validation.
- Repo-native skills for PR workflow, testing, database evolution, skill capture, and release hygiene.
- Root `pnpm` monorepo workspace with a first-class shared `@cashlens/api-types` package.

### Changed

- `main` now uses a PR-first workflow with required checks and protected-branch guardrails.
- Frontend and backend now have durable test foundations suitable for ongoing refactors.
- JavaScript dependency management now lives at the repo root instead of under `apps/web`.
- Deployment guidance is now organized around `local`, `preview`, and `production` instead of historical setup order.

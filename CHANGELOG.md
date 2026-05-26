# Changelog

All notable changes to Cash Lens should be recorded here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repo-wide CI with `api`, `web`, `e2e`, and `docs` checks.
- MkDocs documentation source plus Read the Docs configuration.
- Root `VERSION` file and version-sync validation.
- Repo-native skills for PR workflow, testing, database evolution, skill capture, and release hygiene.

### Changed

- `main` now uses a PR-first workflow with required checks and protected-branch guardrails.
- Frontend and backend now have durable test foundations suitable for ongoing refactors.

## [0.1.0] - 2026-05-25

### Added

- Cash Lens MVP with Next.js frontend and FastAPI backend.
- Dashboard, accounts, transactions, notifications, and settings flows.
- Plaid sandbox connectivity plus demo-mode fallbacks.
- GitHub-based Cloud Run backend deployment and Vercel frontend deployment.

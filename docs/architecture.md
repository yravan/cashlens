# Architecture

Cash Lens currently has a simple polyglot monorepo shape with external managed services.

## Apps

- `apps/web`: Next.js 16 App Router frontend
- `apps/api`: FastAPI backend managed with `uv`
- `packages/api-types`: shared TypeScript contract package consumed by the frontend workspace

## Core external services

- **Neon**: Postgres database
- **Clerk**: authentication and session management
- **Plaid**: financial account connectivity
- **Vercel**: frontend hosting
- **Google Cloud Run**: backend hosting
- **GitHub Actions**: backend deployment and CI
- **Read the Docs**: documentation hosting once configured

## Runtime flow

1. The browser talks to `apps/web`.
2. `apps/web` proxies authenticated requests to `apps/api`.
3. `apps/api` verifies identity, reads or writes data in Neon, and talks to Plaid when needed.
4. GitHub Actions deploys backend changes from `main` to Cloud Run.
5. Vercel deploys frontend changes from the connected GitHub repo.

## Documentation philosophy

This repo keeps several layers of durable context:

- `spec history/` for frozen planning inputs
- `implementation logs/` for technical change-by-change notes
- `docs/` for stable operating knowledge
- `.codex/skills/` for repeated agent workflows

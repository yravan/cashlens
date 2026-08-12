# Cash Lens — web

Next.js 16 (App Router, TypeScript, Tailwind v4) with [Clerk](https://clerk.com) managed auth. Sign-in is Google-only; every route except `/sign-in` and `/sign-up` requires a session.

## Run

```sh
pnpm install                 # from the repo root
cp .env.example .env.local   # then fill in the Clerk development keys
npx clerk@latest env pull    # easiest way — the CLI is linked to the "Cash Lens" app
pnpm dev                     # http://localhost:3000
```

## Checks

```sh
pnpm lint        # ESLint 9 (flat config)
pnpm typecheck   # next typegen && tsc --noEmit
pnpm test:e2e    # Playwright: builds and serves on :3100, tests against the
                 # real Clerk development instance (needs .env.local keys)
```

## Auth layout

- `proxy.ts` — Clerk middleware; redirects signed-out requests to `/sign-in`. Optimistic gate only: pages and route handlers re-check `auth()` themselves (CVE-2025-29927 lesson).
- `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx` — Clerk components; the instance has only Google enabled.
- Keys: `.env.example` documents everything. `pk_test_`/`sk_test_` keys are development-instance only — production gets its own instance and Google OAuth client (leaf 1.3).

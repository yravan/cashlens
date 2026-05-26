# Cash Lens Web

This app is the Cash Lens frontend:

- Next.js 16 App Router
- Clerk-aware auth shell with demo-mode fallback
- Plaid connect controls and ledger-first finance views
- Vitest unit coverage plus Playwright smoke coverage

## Run locally

```bash
cd /Users/yajvanravan/cashlens/apps/web
pnpm install --frozen-lockfile --trust-lockfile
pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3000
```

If you want the simplest local demo path, set:

```env
ENABLE_CLERK=false
API_BASE_URL=http://127.0.0.1:8000
```

## Validate locally

```bash
cd /Users/yajvanravan/cashlens/apps/web
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
pnpm exec playwright test
```

## Test philosophy

- Prefer behavior and semantics over layout assertions.
- Use roles, labels, and a small number of stable test ids for user-critical actions.
- Avoid brittle CSS, pixel, or DOM-shape assertions unless a visual bug specifically depends on them.

## Deploy

Vercel handles frontend deployments from the connected GitHub repo. Production configuration details live in [deployment instructions.md](/Users/yajvanravan/cashlens/deployment instructions.md).

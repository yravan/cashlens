# Local Clerk Toggle

## Why this change was needed

Local development was entering Clerk mode automatically whenever Clerk keys existed in `apps/web/.env.local`.

That caused the local Next.js request path to hang during server-side rendering for routes like:

- `/`
- `/login`

The backend was healthy, so the failure point was isolated to the local frontend auth mode.

## Fix applied

Added an explicit environment-aware Clerk toggle in `apps/web/lib/runtime.ts`.

New behavior:

- in local `next dev`, Clerk stays off by default
- in production, Clerk turns on automatically when valid keys are present
- `ENABLE_CLERK=true` or `ENABLE_CLERK=false` can override the default explicitly

## Why this is the right tradeoff

This preserves a stable demo-first local developer experience while keeping the deployed production path Clerk-ready.

It also avoids forcing users to delete or comment out real Clerk keys just to run the app locally.

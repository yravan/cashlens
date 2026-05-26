# Local Clerk Host And Route Fix

## Problem observed

Local Clerk testing did not behave like a normal app render. Requests to auth-related routes stalled and the middleware debug output reported:

```txt
reason: "dev-browser-missing"
```

## Important finding

Clerk's backend API itself was reachable and the local keys were valid test keys. That ruled out:

- bad API keys
- a basic network outage
- a Next.js / Clerk version incompatibility

## Root-cause direction

The remaining issue was the local development handshake path used by Clerk development instances.

Two things in the project were working against the standard Clerk setup:

1. The app used a custom `/login` page instead of Clerk's documented catch-all sign-in route shape.
2. The local instructions were built around `127.0.0.1`, while Clerk development mode is designed around a browser-bound local host flow and consistently documents `localhost`.

## Fixes applied

- added a standard Clerk sign-in route at:
  - `app/sign-in/[[...sign-in]]/page.tsx`
- changed protected-route redirects to point at `/sign-in`
- moved route protection into `clerkMiddleware()` using `auth.protect()`
- kept `/login` as a simple redirect to `/sign-in`
- changed local runtime behavior so Clerk is the default whenever valid Clerk keys are present
- reserved `ENABLE_CLERK=false` for intentionally forcing demo mode
- updated local instructions to use:
  - `http://localhost:3000`
  - `http://localhost:8000`

## Why this matters

This keeps the local Clerk flow much closer to the official Next.js integration pattern instead of relying on a custom path and a host value that is more appropriate for backend-only local testing.

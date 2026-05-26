# Backend Auth Hardening

## Problem observed

Cash Lens was not safe for real financial accounts because the Python API trusted identity headers that could be spoofed by any caller.

## Root cause

The deployed Cloud Run service was public, and the backend accepted:

- `x-external-auth-user-id`
- `x-user-email`

as if they were authoritative user identity.

Those headers were only supposed to come from the Next.js proxy, but the backend itself was not verifying that assumption.

## Fix applied

- added backend JWT verification for Clerk session tokens
- the Next.js proxy now forwards `Authorization: Bearer <Clerk session token>` to the API instead of spoofable identity headers
- the backend now verifies:
  - signature
  - expiry / `nbf` / `iat`
  - `sub`
  - allowed origin via Clerk `azp` when present
- added `CLERK_JWT_KEY` as a required backend secret for deployed Clerk mode
- production FastAPI docs / OpenAPI are now disabled

## Additional hardening

- added Plaid webhook signature verification using the `Plaid-Verification` header
- validates:
  - JWT signature
  - key id lookup
  - webhook age
  - request-body SHA-256 hash

## Deployment impact

The backend now requires a new Secret Manager secret:

- `cash-lens-clerk-jwt-key`

That secret must match the same Clerk instance as the frontend keys in Vercel.

## Verification

- `uv lock`
- `uv sync`
- focused backend validation script for:
  - Clerk JWT verification
  - Plaid webhook verification
- backend import check
- production-shaped app check confirming docs are disabled
- `pnpm lint`
- `pnpm exec next build --webpack`

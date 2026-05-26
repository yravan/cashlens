# Plaid Link Singleton Loader

## Problem observed

The browser showed this warning:

```txt
The Plaid link-initialize.js script was embedded more than once.
```

## Root cause

The app used `usePlaidLink()` directly inside the reusable `PlaidConnectButton` component.

That button appeared on multiple authenticated pages:

- Accounts
- Settings

With the App Router, navigating between those pages can mount a fresh client component instance while the Plaid script is already present, which leads Plaid's loader to warn that the script has been embedded again.

## Fix applied

- moved `usePlaidLink()` into a single shared `PlaidLinkProvider`
- mounted that provider once in the authenticated app layout
- converted `PlaidConnectButton` into a lightweight context consumer
- removed duplicate server-side link-token fetches from individual pages

## Why this is better

- Plaid Link now initializes once per authenticated app shell
- the button UI can be reused without re-owning the Plaid script lifecycle
- Accounts and Settings now share the same live/demo Plaid connection state

## Verification

- `pnpm lint`
- `pnpm exec next build --webpack`

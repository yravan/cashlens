# Plaid Live Open Handler Fix

## Problem observed

On the hosted web app, the Plaid button could show a live state but still do nothing when clicked.

## Root cause

The shared Plaid provider stored the `react-plaid-link` `open` callback incorrectly.

Instead of registering the callback itself, it registered a wrapper:

- `onRegisterOpen(() => open)`

That meant the click handler called a function that only returned Plaid's `open` function instead of launching Link.

## Fix applied

- changed the registration call to `onRegisterOpen(open)`
- kept the surrounding provider architecture the same

## Why this fixes the bug

When the live Plaid client reports `ready`, the button now invokes the real Plaid `open()` handler directly.
That restores the expected path:

1. hosted settings page loads
2. backend creates a link token
3. Plaid client becomes ready
4. button click opens Plaid Link

## Verification

- `pnpm lint`
- `pnpm exec next build --webpack`

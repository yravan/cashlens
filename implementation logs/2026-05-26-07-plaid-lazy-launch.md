# Plaid Lazy Launch On Deployed Web

## Problem observed

On the deployed Vercel site, clicking the Plaid button could appear to do nothing.

## Most likely cause

The live Plaid button previously depended on `usePlaidLink()` already being in a ready state before a click happened.

That meant:

- the button could be effectively dead on first click if Plaid had not finished initializing
- a stale initial link token could also leave the page in a non-interactive state
- there was no user-visible feedback explaining whether Plaid was still preparing or had failed to initialize

## Fix applied

- kept the singleton Plaid loader architecture
- changed the live connect flow to prepare Plaid on demand when the user clicks
- refreshed the link token as part of that live launch preparation
- auto-opened Plaid once the script reported `ready`
- added inline error feedback when Plaid initialization fails
- added a warning color token for that error state

## Result

The Plaid button no longer relies on an already-ready client state before it can react to the user's click.
On deployed environments, the first click now actively drives initialization instead of silently no-oping.

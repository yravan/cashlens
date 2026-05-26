# Plaid Sandbox Returning User Fix

## Problem observed

Hosted Plaid Link could open successfully but then stop the user on an "Invalid phone number" screen after they entered a real phone number.

## Root cause

The backend is configured for `PLAID_ENV=sandbox`.

Plaid's returning-user flow in Sandbox does not accept arbitrary real phone numbers. It only accepts seeded test numbers and OTPs. Our app was technically working, but it gave the user no clue which sandbox values Plaid expected.

## Fix applied

- extended the link-token response with an explicit Plaid environment value
- when Plaid is running in Sandbox, prefills Plaid's seeded sandbox returning-user phone number during `link_token_create`
- added a sandbox guide directly under the Plaid button in the web UI
- included the exact OTP and institution credentials needed for the common sandbox path

## User-facing result

When the app is using Plaid Sandbox:

- the user sees that the environment is sandbox
- Plaid receives a valid seeded phone number by default
- the UI shows the verification code `123456`
- the UI shows the test institution and credentials needed to finish the flow

## Verification

- backend import check with `uv run python`
- `pnpm lint`
- `pnpm exec next build --webpack`

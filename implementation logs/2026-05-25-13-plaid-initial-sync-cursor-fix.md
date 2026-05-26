# Plaid Initial Sync Cursor Fix

## Problem observed

Plaid Link could complete successfully, but Cash Lens failed during the final token handoff and showed:

- `Plaid connected, but Cash Lens could not finish the handoff.`

## Root cause

The backend crashed on the first live transaction sync after exchanging the Plaid public token.

Cloud Run logs showed:

- `plaid.exceptions.ApiTypeError`
- `Invalid type for variable 'cursor'`

The issue was that Cash Lens always passed `cursor=None` into `TransactionsSyncRequest` for first-time Plaid items. The Plaid Python SDK requires the cursor field to be omitted entirely until a real cursor exists.

## Fix applied

- changed `_sync_live_item()` so it builds the Plaid request dynamically
- only includes `cursor` when a non-empty cursor value exists
- leaves first-time sync requests with only `access_token` and `count`

## Verification

- confirmed the Cloud Run traceback pointed to the `TransactionsSyncRequest` call
- verified in the `uv` environment that:
  - `TransactionsSyncRequest(access_token=..., count=100)` succeeds
  - `TransactionsSyncRequest(access_token=..., cursor=None, count=100)` raises `ApiTypeError`

## Result

First-time live Plaid connections can now complete their initial transaction sync without crashing on a null cursor.

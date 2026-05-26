# Plaid Date Normalization Fix

## Problem observed

After fixing the initial null-cursor crash, live Plaid handoff still failed with a backend `500`.

## Root cause

Cloud Run logs showed:

- `TypeError: fromisoformat: argument must be str`

The Plaid sync response path was not stable about date shapes. In this runtime path, at least some transaction dates reached our code as Python `date` objects instead of ISO strings. Our code assumed strings and always called `date.fromisoformat(...)`.

## Fix applied

- added `_coerce_plaid_date(...)` in the Plaid service
- accepts `str`, `date`, or `datetime`
- converts each shape into a plain Python `date`
- updated both `date` and `authorized_date` parsing to use this helper

## Verification

- verified the helper with:
  - ISO string input
  - Python `date` input
  - Python `datetime` input

## Result

Plaid transaction payloads can now be ingested even when the SDK returns already-parsed date objects instead of strings.

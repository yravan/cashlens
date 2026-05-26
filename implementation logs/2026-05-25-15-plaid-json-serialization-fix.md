# Plaid Raw JSON Serialization Fix

## Problem observed

After fixing cursor handling and date parsing, the live Plaid handoff still failed on the deployed backend.

## Root cause

The app stores the original Plaid transaction payload in a JSON column for debugging and traceability.

Cloud Run logs showed:

- `TypeError: Object of type date is not JSON serializable`

So even though we had normalized the transaction dates for the typed SQL columns, the untouched raw Plaid payload still contained Python `date` values from the SDK and failed when SQLAlchemy tried to serialize the JSON column.

## Fix applied

- added `_json_safe_value(...)` to recursively convert:
  - `date` to ISO strings
  - `datetime` to ISO strings
  - nested lists and dictionaries
- applied the helper before writing:
  - `raw_json`
  - `raw_personal_finance_category`

## Verification

- verified the helper on nested dictionaries containing `date`, `datetime`, and list values

## Result

Plaid transaction payloads can now be stored in Postgres JSON columns without crashing when the SDK returns already-parsed Python date objects.

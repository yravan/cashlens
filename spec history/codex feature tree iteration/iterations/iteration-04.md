# Iteration 04 - Obligations, reimbursements, returns, and bills

## Pass goal

Revisit the whole tree around the parts of the vision that normal budgeting apps usually miss: money owed, future transactions, returns, bill obligations, and partial settlement logic.

## Whole-tree changes made in this pass

- Expanded `OWE` into several distinct problem families:
  - reimbursements / money owed
  - returns / refunds
  - bills / future obligations
  - credit and tax obligations
- Added reimbursement-oriented leaves:
  - claims model
  - settlement matching
  - balance of outstanding claims
  - review support for ambiguous settlements
- Added returns-oriented leaves:
  - return intent capture
  - refund matching
  - unresolved-return reminders
  - split-aware partial refund handling
- Added bills and future-obligation leaves:
  - recurring bill records
  - due-date states
  - bill-payment matching
  - future-outflow visibility
- Added tax/credit placeholder leaves so those concepts do not get lost:
  - tax-obligation placeholder
  - credit-liability semantics

## Why this pass mattered

The user vision is unusually explicit about "stuff I plan on returning," "paying for everyone and then getting Venmoed," and "how much I owe in credit cards, bills, etc. at a given time." Those are not cosmetic features; they change the required data model.

## Atomicity decisions made here

- Claims and settlements are separated
- Return intents and refund matches are separated
- Bills are separated from recurring-subscription detection
- Tax starts as a placeholder capability, not a fake mature feature

## Remaining uncertainty after this pass

- Whether bill ingestion starts from Gmail, manual entry, or both
- Whether tax support stays "tracking only" for a long time
- Whether reimbursements need dedicated social-source imports early or can start manual-first

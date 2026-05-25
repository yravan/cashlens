# Implementation Log 03: Web Implementation

## Objective

Build a polished but lean Next.js dashboard that uses the backend directly rather than inventing duplicate frontend state.

## Shared frontend architecture

### Data access

- Server Components fetch backend data through `lib/server-api.ts`
- Browser actions go through `/api/proxy/[...path]`
- The proxy injects either demo headers or Clerk-derived headers

### Session shape

- `lib/session.ts` is the single server-side session bridge
- demo mode returns a synthetic session
- Clerk mode uses `auth()`

### Why proxy through Next.js

- keeps browser code simple
- avoids browser-side secret handling
- gives a clean path to Clerk-authenticated server requests

## UI primitives created

- `AppShell`
- `NavLink`
- `UserPill`
- `SummaryCard`
- `SectionCard`
- `StatusBadge`
- `ManualSyncButton`
- `PlaidConnectButton`
- `TransactionEditor`
- `MarkAllReadButton`

## Page implementation notes

### Dashboard

- summary cards
- account snapshot panel
- connected institutions panel
- recent transactions
- recent notifications

### Accounts

- institution cards
- manual sync actions
- add demo institution / live Plaid connect button
- account balance table

### Transactions

- server-side search and direction filters
- review side panel for:
  - event type
  - category
  - subcategory
  - exclude-from-spend flag

### Settings

- auth mode visibility
- user profile summary
- sync controls
- notification controls
- deployment posture summary

## Visual system decisions

- warm sand background with teal accent instead of generic white/purple SaaS styling
- rounded oversized panels to make the app feel more deliberate than stock admin scaffolding
- no dependency on network-fetched Google fonts in production builds

## Bugs found and fixed during implementation

1. `next/font/google` failed in restricted builds
   - replaced with local CSS font stacks
2. transaction editor state persisted across row changes
   - remounted editor using `key={selectedTransaction.id}`

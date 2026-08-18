# Production deployment

The app runs on **Vercel** (Hobby, project `cashlens`, root directory `apps/web`, region `iad1`);
the database is **Neon Postgres** (direct account — not the Vercel Marketplace variant); auth is a
**Clerk production instance** on the founder's domain. Merging to `main` deploys automatically;
nothing else does.

## How a deploy works

1. Push lands on `main` → the Vercel Git integration starts a production build.
2. `vercel.json` `ignoreCommand` skips every non-production build (previews return in leaf 10.6).
3. Build runs `pnpm deploy:build`:
   - `scripts/migrate-deploy.mts` — only when `VERCEL_ENV=production`: applies committed
     migrations from `db/migrations` as `cashlens_owner` over the **direct** (non-pooler)
     connection. A migration failure fails the build; nothing ships.
   - `next build`.
4. Vercel promotes the new deployment atomically.

The previous deployment keeps serving while migrations run, so migrations must be
backward-compatible with the code still live (expand → migrate → contract).

The future CI gate (leaf 10.1) is GitHub branch protection + required checks on `main`: it gates
the merge, and Vercel only ever deploys merged commits — no Vercel-side change needed.

## Database model (identical to local)

| role | used by | connection |
| --- | --- | --- |
| `neondb_owner` | bootstrap only (`pnpm db:setup`), never the app | direct |
| `cashlens_owner` | migrations during deploy | direct |
| `cashlens_app` | the app at runtime, RLS-enforced | `-pooler` (transaction mode) |

Transaction pooling is safe for `withRequestScope`: the per-request `set_config(..., true)` is
transaction-local and the whole transaction pins one backend.

**Never create roles or databases in the Neon console.** Console/CLI/API-created roles silently
receive `BYPASSRLS` (neondatabase/neon#12926), which disables row-level security without any
error. `pnpm db:setup` creates the two roles by SQL and fails closed if either ever carries
`BYPASSRLS`.

All production URLs pin `?sslmode=verify-full` (node-postgres currently treats `require` the
same, but pg@9 will not; `channel_binding` is ignored by node-postgres — leave it out).

## Production environment variables (Vercel → Settings → Environment Variables)

All scoped to **Production** only. Previews get nothing until leaf 10.6.

| name | value | sensitive |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` | **no** — needed at build time; the Sensitive flag would hide it from the build |
| `CLERK_SECRET_KEY` | `sk_live_…` | yes |
| `DATABASE_URL` | `postgresql://cashlens_app:<pw1>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=verify-full` | yes |
| `DATABASE_URL_OWNER` | `postgresql://cashlens_owner:<pw2>@<endpoint>.<region>.aws.neon.tech/neondb?sslmode=verify-full` | yes |
| `APP_ORIGIN` | `https://<app-domain>` | no |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (all environments — honors the repo's pinned pnpm) | no |

`DATABASE_URL_SUPERUSER` is never set on Vercel: the `neondb_owner` credential exists only on the
founder's machine, for bootstrap.

## Operations

- `GET /api/health` — public, uncached: `200 {"status":"ok","db":"ok"}` or
  `503 {"status":"error","db":"error"}`. Point an uptime monitor at it.
- Fail-fast budgets when Postgres is unreachable: 5s connect, 20s client query timeout, 15s
  server `statement_timeout` and 30s `idle_in_transaction_session_timeout` (role-level on
  `cashlens_app`, so they survive pooling).
- Neon Free scales to zero after 5 min idle → first request pays a few hundred ms. The Launch
  plan (no monthly minimum, ~$3–4/mo at this scale) removes the "non-production" caveat and
  extends restore history to 7 days.

## Founder go-live checklist

Prerequisite: a domain you own (`<domain>` below; the app can live at `<domain>` or a subdomain —
`<app-domain>` is whichever you pick).

### 1. Neon (~10 min)

1. Create an account at neon.tech → New project: Postgres 17+, AWS `us-east-1` (pairs with
   Vercel `iad1`). Free plan is fine to start.
2. Do **not** create any role or database in the console. Copy the `neondb_owner` **direct**
   connection string (untick "Pooled connection" in the connect widget).
3. Generate two passwords locally: `openssl rand -hex 24` (twice — pw1 for `cashlens_app`, pw2
   for `cashlens_owner`; alphanumeric only, well above Neon's 60-bit minimum).
4. Bootstrap roles + schema + migrations from your laptop, in `apps/web`:

   ```sh
   DATABASE_URL='postgresql://cashlens_app:<pw1>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=verify-full' \
   DATABASE_URL_OWNER='postgresql://cashlens_owner:<pw2>@<endpoint>.<region>.aws.neon.tech/neondb?sslmode=verify-full' \
   DATABASE_URL_SUPERUSER='<the neondb_owner direct URL from step 2>' \
   pnpm db:setup
   ```

   Expect `database neondb ready: owner=cashlens_owner (migrations), app=cashlens_app (runtime,
   RLS-enforced)` and `migrations applied successfully`.

### 2. Clerk production instance (~20 min + DNS wait)

1. dashboard.clerk.com → app **Cash Lens** → instance dropdown (top bar) → **Create production
   instance** → *Clone development settings*. Home URL: `https://<app-domain>`. (Users never
   transfer between instances; your first production sign-in creates your production user.)
2. **Configure → Domains** now lists ~5 CNAME records — typically `clerk.<domain>`,
   `accounts.<domain>`, `clkmail.<domain>`, `clk._domainkey.<domain>`, `clk2._domainkey.<domain>`.
   Add each at your DNS host, copying names and targets literally from that page. If the DNS
   host is Cloudflare: DNS-only (grey cloud) — proxying breaks Clerk's certificates.
3. Google OAuth client (production requires your own credentials):
   1. console.cloud.google.com → new project (e.g. `cashlens-prod`).
   2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding): user type
      **External**, app name `Cash Lens`, your email for support and developer contact. No extra
      scopes (the defaults — openid, email, profile — are non-sensitive). Under Audience, click
      **Publish app** — with only basic scopes there is no verification review; the alternative
      (staying in Testing with yourself as a test user) also works.
   3. **Credentials → Create credentials → OAuth client ID** → type **Web application**. In the
      Clerk Dashboard open **SSO connections → Google → Use custom credentials**: it displays
      the exact **Authorized redirect URI** (shape: `https://clerk.<domain>/v1/oauth_callback`)
      and authorized origin to paste here. Create, then copy the Client ID and Client Secret
      back into that Clerk panel and save.
4. When DNS has propagated, return to **Configure → Domains** → verify → **Deploy certificates**.
   (If issuance stalls, check no CAA record on `<domain>` blocks Google Trust Services /
   Let's Encrypt.)
5. **Configure → API keys**: copy `pk_live_…` and `sk_live_…` for the next step.

### 3. Vercel (~15 min)

1. vercel.com → delete the stale project: **cashlens → Settings → Advanced → Delete Project**
   (this also ends the failing-deploy emails).
2. **Add New → Project** → import `yravan/cashlens` (personal account — Hobby requires it).
   Root Directory: `apps/web`. Framework preset: Next.js. Build settings: leave as-is —
   `vercel.json` supplies the build command.
3. Before the first deploy, add every environment variable from the table above.
4. Deploy. Then **Settings → Domains** → add `<app-domain>` and create the DNS record Vercel
   shows (CNAME `cname.vercel-dns.com`, or the A/ALIAS values for an apex).
5. If anything was deployed before the env vars/Clerk certificates were ready:
   **Deployments → ⋯ → Redeploy**.

### 4. Smoke test (2 min)

- `https://<app-domain>/api/health` → `{"status":"ok","db":"ok"}`.
- `https://<app-domain>/robots.txt` → `Disallow: /`.
- Visit `https://<app-domain>/` signed out → lands on `/sign-in`.
- Sign in with Google → shell renders; `/api/me` returns your id.
- Sign out → back to `/sign-in`.
- Optional: point a free uptime monitor (e.g. UptimeRobot) at `/api/health`.

## Deferred (tracked, deliberate)

- **Content-Security-Policy** — needs the production Clerk Frontend API hostname
  (`clerk.<domain>`), which only exists after the domain is chosen. First task under branch 9.
- **Preview deployments** — leaf 10.6 (remove `ignoreCommand`, add Preview-scoped env vars).
- **CI gate before merge** — leaf 10.1 (branch protection + required checks).

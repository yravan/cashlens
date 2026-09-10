# Operations — machine & incident knowledge

Field notes that lived in session memory until now. `docs/production.md` is the go-live runbook; this file is the "when something is weird" companion. Any agent (or human) picking this repo up cold should read CLAUDE.md first, then this.

## Local stack triage — check the boring things first

- **"Page won't load" / "auth is broken" is almost always the database.** Signed-out probes (curl 307, `/sign-in` rendering) never touch Postgres, so they "verify" a stack whose authenticated half is dead. Before any browser forensics: read the dev-server logs, then `docker ps` + `nc -z localhost 5433`. After any reboot: `pnpm db:up && pnpm db:setup`.
- **Verifying login without Google credentials:** mint a Clerk sign-in token (`POST /v1/sign_in_tokens` with the dev secret key) and drive `/sign-in?__clerk_ticket=<token>` with Playwright. Revoke the session after.
- **e2e runs wipe the e2e users' ledgers in the shared dev database** (afterAll cleanup). Reseed (`pnpm db:seed <clerkUserId>`) before manually browsing after any e2e run, or the app looks mysteriously empty.
- **Stale servers lie.** After a machine sleep, a `next start` from before the sleep can still hold port 3100 serving an old build; Playwright reuses it (`reuseExistingServer`) and failures look like regressions. Kill stray listeners on 3000/3100 and warm the build before trusting a red suite.

## Production verification

- **Prod secrets live outside the repo in `~/.cashlens/prod.env`** (dir 700, file 600). Nothing under `apps/web/` may ever hold production values — Next's implicit env loading is why (three separate sessions touched prod Neon through `.env.production.local` before the move; see the incident log below). Admin work `source`s that file explicitly.
- **`cashlens_owner` is FORCE-RLS-blinded**: as the owner role, `SELECT` on user tables returns zero rows *without error* — a dangerously convincing false "clean". Always verify prod state with `DATABASE_URL_SUPERUSER`.
- Local `psql` to Neon needs `&sslrootcert=system` appended to the URL (no `~/.postgresql/root.crt` exists by default).
- Health: `GET https://cashlens.org/api/health` → `{"status":"ok","db":"ok"}`.

## Provider dashboards & CLI quirks

- **Vercel**: project `cashlens`, root `apps/web`, deploys `main` only. CLI auth token goes stale — run `vercel whoami` to refresh. Cross-team commands need `--scope yravans-projects` (`vercel redeploy <url>` fails with "different team" without it). Env changes need a redeploy to take effect.
- **Neon**: create roles ONLY via `pnpm db:setup` — roles created in the console silently receive `BYPASSRLS` (neondatabase/neon#12926), which defeats the entire isolation model. `db:setup` fails closed on `rolbypassrls`.
- **Clerk**: two instances — production (on `clerk.cashlens.org`) and the dev instance used by local + e2e. Prod keys use `*_LIVE` names in the founder's secrets file; the repo/CI never sees them.
- **Cloudflare DNS**: every record stays grey-cloud/DNS-only — proxying breaks Clerk and Vercel certificate issuance.
- **Plaid**: sandbox and production are separate secrets; the sandbox secret only works against sandbox. US OAuth institutions (Chase etc.) may additionally need per-institution enablement in the Plaid dashboard on new accounts.

## Incident log (distilled — full detail in the PRs that disclosed them)

1. **2026-08-30 (PR #48):** local `pnpm db:migrate` applied migrations to production Neon. Cause: `@next/env` with `NODE_ENV` unset loads *production* env files, and `.env.production.local` outranked `.env.local`. Zero data impact; guarded rollback; drizzle-kit and Playwright pinned to dev env files.
2. **2026-09-01 (PR #50):** bare `pnpm start` (production mode) resolved the prod DATABASE_URL while Clerk stayed dev — an authenticated local page load wrote rows to prod (removed surgically; a prior session had done the same silently).
3. **Structural fix (2026-09-02):** prod secrets moved to `~/.cashlens/prod.env`; production-mode env resolution inside the repo now yields localhost only. **The class is closed — keep it closed:** audit any NEW local tool that loads env files before its first run.

## Known flake classes (correlate before believing a red)

- **Plaid sandbox timing**: `/transactions/sync` occasionally commits a run with `added=0` before sandbox data is ready (spec sees 0 transactions); transient 502s from the sandbox gateway. Green on rerun = flake; red on a clean link twice = real.
- **Local wifi blackouts**: this dev machine's link drops for seconds-to-minutes. Before treating a network-touching failure as real, run a timestamped curl probe loop (api.clerk.com / production.plaid.com) alongside the rerun and correlate.
- **`health.signed-in.spec.ts`** exercises a 15s fail-fast budget and is timing-sensitive under load.
- CI's clean runners are the authority when local runs die to machine sleep — say so explicitly in evidence rather than re-running forever.

## Process craft that kept 19 leaves moving

- **Persist-then-work**: on an unstable machine, push the prior-art survey as the branch's first commit, then commit+push every logical chunk. Anything only in an agent's context dies with it; anything pushed survives anything.
- **PR-body placeholders**: draft the body to a file, create the PR with `--body-file` in one command — never compose interactively across a flaky link.
- **Reviews re-derive, never trust**: the independent pass re-computes anchor math by hand from the seed and mutation-tests the guards (drop a predicate → the exact expected numbers must go red). Two "proven" claims in shipped PRs were unpinned until a reviewer mutated them; assume yours is too.

# Platform Playbooks

## GitHub

Use `gh` first.

Core commands:

```bash
gh auth status
gh run list --workflow deploy-api.yml --limit 5
gh run view <run-id>
gh run view <run-id> --log-failed
```

Use GitHub Actions logs as the first source of truth for backend deploy failures.

## Google Cloud Run

Use `gcloud` first.

Core commands:

```bash
gcloud config get-value project
gcloud auth list
gcloud run services describe cash-lens-api --region us-central1
gcloud builds get-default-service-account --project "$PROJECT_ID"
gcloud iam service-accounts list --project "$PROJECT_ID"
```

For source deploy failures:

1. identify the current default build service account
2. verify it has `roles/run.builder`
3. if it is user-managed, verify the GitHub deployer can act as it
4. verify the GitHub deployer can act as the runtime service account

## Vercel

Use `vercel` first.

Core commands:

```bash
vercel whoami
vercel ls
vercel project ls
vercel inspect <deployment-url-or-id>
```

When the deployed web app behaves differently from local:

1. confirm the latest commit is actually deployed
2. inspect the deployment environment variables in Vercel if CLI access allows it
3. compare deployed behavior against the current `main` commit

## Neon

Neon CLI is installed in this environment and can be used directly when authenticated.

Core commands:

```bash
neon me
neon projects list
neon branches list
neon connection-string
```

Use these fallback sources first:

- `DATABASE_URL` location in env files or Secret Manager mapping
- backend runtime behavior
- migration or DB connectivity errors

If dashboard-only Neon state is needed:

- prefer the Neon CLI first
- ask for a Neon CLI login or token only if the CLI is no longer authenticated
- or ask for the exact value needed
- do not ask for screenshots unless there is no better option

## Clerk

Clerk CLI is installed in this environment and can be used directly when authenticated.

Core commands:

```bash
clerk whoami
clerk apps list
clerk env ls
clerk doctor --mode agent
```

Use these sources first:

- `apps/web/.env.local`
- Vercel environment variable setup
- deployed HTML and auth headers
- official Clerk docs

When checking production readiness:

1. determine whether the deployed site is using development or production Clerk keys
2. distinguish Clerk development-instance behavior from true production-domain behavior
3. avoid requiring screenshots when exact dashboard field names or values are enough
4. check whether the linked Clerk app already has a production instance

## Plaid

Use app logs plus backend routes.

Useful checks:

- whether `/plaid/create-link-token` returns `demo` or `live`
- whether clicks produce a follow-up `exchange-public-token` request
- whether Cloud Run logs show the click-driven requests you expect

For frontend Plaid issues, inspect:

- `apps/web/components/plaid-link-provider.tsx`
- `apps/web/components/plaid-connect-button.tsx`

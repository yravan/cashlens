---
name: cashlens-gcloud-ops
description: Use when working in the Cash Lens repo on Google Cloud tasks such as Cloud Run deploys, build service account permissions, IAM bindings, service inspection, or backend runtime debugging. Prefer `gcloud` and GitHub Actions logs first, and use the repo's deployment workflow and instructions as the source of truth.
---

# Cash Lens GCloud Ops

Use this skill for Cash Lens Google Cloud work.

## Start here

1. Confirm the active project with `gcloud config get-value project`.
2. Read [references/current-gcp-state.md](references/current-gcp-state.md).
3. If the task is deploy-related, inspect:
   - `.github/workflows/deploy-api.yml`
   - `deployment instructions.md`
   - latest `gh run` logs

## Default workflow

- Prefer `gcloud` over dashboard navigation.
- For deploy failures, inspect GitHub Actions logs before changing IAM.
- For source deploy issues, always identify the current default build service account with:
  - `gcloud builds get-default-service-account --project "$PROJECT_ID"`

## High-value commands

```bash
gcloud config get-value project
gcloud auth list
gcloud run services describe cash-lens-api --region us-central1
gcloud builds get-default-service-account --project "$PROJECT_ID"
gcloud iam service-accounts list --project "$PROJECT_ID"
gcloud projects get-iam-policy "$PROJECT_ID"
```

## Special focus areas

- Cloud Run source deploy permissions
- runtime service account access
- default build service account `run.builder` and `actAs` chain
- Secret Manager access for backend runtime

## When to escalate to the user

- before making persistent IAM changes with security impact
- when billing, project ownership, or environment choice is ambiguous

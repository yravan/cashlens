# Build Service Account ActAs Permission

## Problem observed

The GitHub Actions backend deploy still failed after granting `roles/run.builder` to the default compute service account.

The actual error was:

```txt
caller does not have permission to act as service account
```

## Root cause

For Cloud Run source deployments, two separate permissions were needed around the build service account:

1. the build service account itself needed `roles/run.builder`
2. the GitHub deployer service account also needed `roles/iam.serviceAccountUser` on that build service account

The first permission had already been documented.
The second one was missing from the deployment guide.
Also, the guide originally assumed the build service account would always be the Compute Engine default service account, which is not always true.

## Fix applied

- updated `deployment instructions.md`
- added a step to discover the active default build service account with:
  - `gcloud builds get-default-service-account`
- generalized the docs so they no longer assume one hard-coded build service account pattern
- added the missing command granting:
  - `roles/iam.serviceAccountUser`
  - on the user-managed default build service account when applicable
  - to `cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com`
- added a troubleshooting note for the exact `act as service account` error text

## Result

The deployment guide now covers the full IAM chain needed for GitHub-based Cloud Run source deploys instead of only the builder role.

# Current GCP State

## Known project baseline

- project id: `cashlens-492517`
- region: `us-central1`
- Cloud Run service: `cash-lens-api`

## Verified CLI baseline

- `gcloud` installed
- active account: `yajvanravan@gmail.com`
- active project: `cashlens-492517`
- latest known default build service account:
  - `647780281169-compute@developer.gserviceaccount.com`

## Key repo files

- workflow: `.github/workflows/deploy-api.yml`
- deployment guide: `deployment instructions.md`
- implementation logs: `implementation logs/`

## Unstable values to re-check live

- current Cloud Run URL
- current default build service account
- exact IAM bindings on runtime, deployer, and build service accounts

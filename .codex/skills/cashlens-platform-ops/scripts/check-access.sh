#!/usr/bin/env bash
set -euo pipefail

echo "== Cash Lens platform access check =="
echo

check_bin() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    echo "[ok] $name installed: $(command -v "$name")"
  else
    echo "[missing] $name"
  fi
}

echo "-- CLI availability --"
check_bin gh
check_bin gcloud
check_bin vercel
check_bin neon
check_bin clerk
echo

echo "-- GitHub CLI --"
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    gh auth status
  else
    echo "gh is installed but not authenticated."
  fi
else
  echo "gh not installed."
fi
echo

echo "-- Google Cloud CLI --"
if command -v gcloud >/dev/null 2>&1; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
  ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
  echo "project: ${PROJECT_ID:-<unset>}"
  echo "active account: ${ACTIVE_ACCOUNT:-<unset>}"
  if [[ -n "${PROJECT_ID}" ]]; then
    BUILD_SA="$(gcloud builds get-default-service-account --project "$PROJECT_ID" 2>/dev/null || true)"
    echo "default build service account: ${BUILD_SA:-<unavailable>}"
  fi
else
  echo "gcloud not installed."
fi
echo

echo "-- Vercel CLI --"
if command -v vercel >/dev/null 2>&1; then
  if vercel whoami >/dev/null 2>&1; then
    echo "vercel user: $(vercel whoami)"
    echo "vercel projects:"
    vercel project ls 2>/dev/null | sed -n '1,8p' || true
  else
    echo "vercel is installed but not authenticated."
  fi
else
  echo "vercel not installed."
fi
echo

echo "-- Neon CLI --"
if command -v neon >/dev/null 2>&1; then
  if neon me >/dev/null 2>&1; then
    neon me
  else
    echo "neon is installed but not authenticated."
  fi
else
  echo "neon not installed."
fi
echo

echo "-- Clerk CLI --"
if command -v clerk >/dev/null 2>&1; then
  if clerk whoami >/dev/null 2>&1; then
    clerk whoami
  else
    echo "clerk is installed but not authenticated."
  fi
else
  echo "clerk not installed."
fi
echo

echo "-- Repo config presence --"
for path in \
  "apps/api/.env" \
  "apps/web/.env.local" \
  ".github/workflows/deploy-api.yml" \
  "deployment instructions.md"
do
  if [[ -f "$path" ]]; then
    echo "[ok] $path"
  else
    echo "[missing] $path"
  fi
done
echo

echo "-- Frontend env key presence --"
if [[ -f "apps/web/.env.local" ]]; then
  for key in \
    API_BASE_URL \
    NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    CLERK_SECRET_KEY \
    ENABLE_CLERK
  do
    if grep -q "^${key}=" "apps/web/.env.local"; then
      echo "[set] $key"
    else
      echo "[unset] $key"
    fi
  done
else
  echo "apps/web/.env.local not present."
fi
echo

echo "-- Backend env key presence --"
if [[ -f "apps/api/.env" ]]; then
  for key in \
    DATABASE_URL \
    APP_ENCRYPTION_KEY \
    PLAID_CLIENT_ID \
    PLAID_SECRET \
    PLAID_ENV \
    PLAID_WEBHOOK_URL
  do
    if grep -q "^${key}=" "apps/api/.env"; then
      echo "[set] $key"
    else
      echo "[unset] $key"
    fi
  done
else
  echo "apps/api/.env not present."
fi

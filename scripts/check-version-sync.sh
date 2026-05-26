#!/usr/bin/env bash
set -euo pipefail

ROOT_VERSION="$(tr -d '[:space:]' < VERSION)"
API_VERSION="$(python3 - <<'PY'
from pathlib import Path
import tomllib

data = tomllib.loads(Path("apps/api/pyproject.toml").read_text())
print(data["project"]["version"])
PY
)"
WEB_VERSION="$(python3 - <<'PY'
from pathlib import Path
import json

data = json.loads(Path("apps/web/package.json").read_text())
print(data["version"])
PY
)"

if [[ -z "$ROOT_VERSION" ]]; then
  echo "VERSION is empty"
  exit 1
fi

if [[ "$ROOT_VERSION" != "$API_VERSION" ]]; then
  echo "Version mismatch: VERSION=$ROOT_VERSION apps/api=$API_VERSION"
  exit 1
fi

if [[ "$ROOT_VERSION" != "$WEB_VERSION" ]]; then
  echo "Version mismatch: VERSION=$ROOT_VERSION apps/web=$WEB_VERSION"
  exit 1
fi

if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "CHANGELOG.md must contain an [Unreleased] section"
  exit 1
fi

echo "Version sync check passed: $ROOT_VERSION"

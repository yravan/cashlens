#!/usr/bin/env bash
set -euo pipefail

ROOT_VERSION="$(tr -d '[:space:]' < VERSION)"
ROOT_PACKAGE_VERSION="$(python3 - <<'PY'
from pathlib import Path
import json

data = json.loads(Path("package.json").read_text())
print(data["version"])
PY
)"
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
API_TYPES_VERSION="$(python3 - <<'PY'
from pathlib import Path
import json

data = json.loads(Path("packages/api-types/package.json").read_text())
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

if [[ "$ROOT_VERSION" != "$ROOT_PACKAGE_VERSION" ]]; then
  echo "Version mismatch: VERSION=$ROOT_VERSION package.json=$ROOT_PACKAGE_VERSION"
  exit 1
fi

if [[ "$ROOT_VERSION" != "$WEB_VERSION" ]]; then
  echo "Version mismatch: VERSION=$ROOT_VERSION apps/web=$WEB_VERSION"
  exit 1
fi

if [[ "$ROOT_VERSION" != "$API_TYPES_VERSION" ]]; then
  echo "Version mismatch: VERSION=$ROOT_VERSION packages/api-types=$API_TYPES_VERSION"
  exit 1
fi

if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "CHANGELOG.md must contain an [Unreleased] section"
  exit 1
fi

echo "Version sync check passed: $ROOT_VERSION"

"""SCRATCH / DO NOT MERGE.

Deliberate Postgres-only failing test used to prove the CI `api` gate goes to
*failure* (not skipped) when a single matrix leg fails. Delete this file and the
scratch branch after capturing evidence.
"""

import os

import pytest


@pytest.mark.skipif(
    "postgresql" not in os.environ.get("DATABASE_URL", ""),
    reason="scratch red-path probe: only fail on the Postgres matrix leg",
)
def test_redpath_postgres_only_failure() -> None:
    assert False, "intentional Postgres-only failure to exercise the api gate"

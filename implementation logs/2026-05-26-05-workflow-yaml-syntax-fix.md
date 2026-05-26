# Workflow YAML Syntax Fix

## Problem observed

GitHub Actions rejected `.github/workflows/deploy-api.yml` with a YAML syntax error reported on line 65.

## Root cause

The final step used a one-line `run:` command containing a colon inside the shell string:

```txt
run: echo "Cloud Run service URL: ..."
```

In GitHub workflow YAML, that form can be parsed ambiguously as a plain scalar.

## Fix applied

- changed the final step to block `run` syntax
- kept the shell command itself the same

## Result

The workflow structure is now valid YAML again, and GitHub should be able to parse the file instead of rejecting it before execution.

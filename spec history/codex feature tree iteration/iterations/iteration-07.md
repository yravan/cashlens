# Iteration 07 - Atomicity audit and implementation slicing

## Pass goal

Re-walk the whole tree with a stricter implementation lens: if I handed each leaf to an agent, would the result still land in roughly one to three reviewable PRs?

## Whole-tree adjustments made in this pass

- Reconfirmed that research spikes remain explicitly separate from implementation leaves
- Tightened dependency chains so "foundation first" work is easier to read:
  - migrations before schema-heavy expansion
  - generic connections before provider fan-out
  - raw-source preservation before replay tooling
  - money integer migration before serious split/report work
  - shared review state before iOS parity
- Preserved `status` tags grounded in the real repo:
  - `[built]` only where a meaningful capability already exists
  - `[partial]` where the repo already has real but incomplete scaffolding
  - `[new]` where the capability is absent
- Kept large-but-still-reviewable tasks as `L` rather than pretending they are tiny

## Atomicity heuristics used

- If a leaf would likely require touching multiple models, multiple screens, and a cloud provider all at once, it should probably split
- If a leaf exists mostly to answer feasibility, it should be a research leaf
- If a leaf cannot state a one-line acceptance test, it is still too mushy
- If a leaf mainly exists to protect correctness, it should stay even if it feels "unsexy"

## Places intentionally left as larger `L` slices

- Alembic baseline
- float-to-integer money migration
- positions / holdings / liability snapshot model
- manual split editor

Those are still small enough to review, but too consequential to lie about as "tiny."

## Output of this pass

The tree now reads much more like an implementation backlog than a strategy memo.

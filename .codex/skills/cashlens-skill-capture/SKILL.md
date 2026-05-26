---
name: cashlens-skill-capture
description: Use when a Cash Lens workflow, debugging sequence, deploy fix, or engineering habit has repeated enough that it should be captured or updated in a repo skill, and when the act of capturing that workflow should also be logged.
---

# Cash Lens Skill Capture

This skill exists so repeated work becomes durable repo knowledge.

## When to use it

- A troubleshooting path was used twice.
- A deploy or environment fix is easy to forget.
- A recurring implementation habit is currently living only in chat memory.
- A new workflow makes an older skill stale.

## Capture procedure

1. Prefer updating an existing repo skill if the workflow clearly belongs there.
2. Create a new skill only when the workflow has a distinct trigger and checklist.
3. Keep `SKILL.md` short and procedural.
4. After the skill change, add an implementation-log entry that notes:
   - what workflow was captured
   - why it was repeated often enough to deserve a skill
   - what future agents should do differently now

## Cross-agent rule

If the workflow also matters to human collaborators or Claude-style agent sessions, mirror the essential rule in `AGENTS.md`, `CLAUDE.md`, or the matching engineering doc.

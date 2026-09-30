---
name: sow
description: >
  Author or improve a Scope of Work (SOW) in .data/sow/. Invoke for "/sow", "/sow init",
  "create a sow", "write a sow", or when the user asks to capture work as a SOW. "/sow init"
  scaffolds the lane framework (idempotent). Otherwise enforce the pre-checks: improve an existing
  SOW before creating a new one, ground it in a code audit, reference related completed SOWs,
  default the lane to queue, and follow the project's plan-mode and writing conventions.
---

# Managing Scopes of Work

SOWs are local planning documents in `.data/sow/` (kept OUT of version control), organized into
lanes a work item moves through: `0_queue` -> `1_progressing` -> `2_completed`, plus a `_staging`
side-lane for items parked on an external blocker. One canonical markdown file per SOW; move the same
file between lanes as the work advances.

There is no review lane, and nothing waits on a human test. An item moves to the completed lane when it
is built, tested and shipped. It is assumed correct; defects are flagged later and become their own
SOWs. Do not create a review lane, route work into one, or describe an item as awaiting sign-off.

## Initialize (/sow init)

When invoked as /sow init (or when the lane folders do not exist yet), scaffold idempotently, then
stop (this command only builds folders, it never authors a SOW):

```bash
mkdir -p .data/sow/{_staging,0_queue,1_progressing,2_completed}
[ -f .data/sow/todo.md ] || printf '# SOW todo\n' > .data/sow/todo.md
grep -qxF '.data/' .gitignore 2>/dev/null || echo '.data/' >> .gitignore
```

It creates only what is missing and never overwrites an existing todo.md.

## Authoring a SOW: do these steps IN ORDER

1. **Improve an existing SOW first (never duplicate).** Search the open lanes for a SOW this work
   belongs in and extend it (a decision, a phase, an open-question resolution). A completed item
   is shipped: a defect found in it later gets its own SOW that cites it, and only scope that was
   never delivered moves the item back to `1_progressing`. Only create a new SOW when no open SOW is
   a reasonable home, and say that you checked.
2. **Ground it in a code audit (no guessing).** Read the real code so the SOW cites file and line
   and the true root cause, not assumptions. For a bug, name the root cause; for a feature, name
   the surfaces and the pattern to reuse. Prefer reusing existing infrastructure.
3. **Reference related completed SOWs.** Search the completed lane and cite the relevant items:
   dependencies, the origin of a regression, or the pattern to reuse, each by id and path.
4. **Number and place it.** Find the next free sow-NNN. Default the lane to 0_queue unless told to
   start in 1_progressing. Group SOWs into subfolders matching your project's areas.
5. **Plan mode and conventions.** Every SOW is BUILT in plan mode: add a banner note saying its
   build begins there, and leave genuine decisions as open questions rather than pinning what is
   the owner's call. Follow your project's writing conventions throughout.
6. **Structure.** Frontmatter: id, title, status (matching the lane), priority, phase, created (an
   absolute date), depends_on, related, owner. Then the title, a status banner (what and why,
   grounded in the audit), design decisions, phases, constraints and guardrails, open questions,
   and cross-references.
7. **Design-first SOWs.** A SOW that redesigns a visual surface is never built from prose: request
   a mockup, store the assets under `sow-NNN-assets/` with a source note, and reference them.

## Reminders

- The planning docs are local only and never committed.
- A SOW is a living document: keep its status field and lane in sync as work moves.
- When a build completes, write an as-built note into the banner before moving lanes, so the doc
  reads true months later.

---
title: 'Manage Statements of Work: a /sow Skill for Claude Code'
slug: scope-of-work-manager-claude-code-skill
shortDescription: >-
  A drop-in /sow skill for Claude Code: lane-based Statement of Work management (queue, progressing,
  waiting review, completed) with authoring rules that stop duplicate plans, force a real code
  audit, and keep owner decisions in plan mode.
targets:
  - Claude Code
categories:
  - ai
  - prompts
  - skill
tags:
  - sow
  - workflow
  - planning
  - documentation
  - claude-code
  - agent-skills
publishedAt: '2026-07-10T15:43:57.582Z'
status: published
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/sow` command for managing Statements of Work: local, lane-based planning documents that move kanban-style from queue to completed, living beside your code but outside version control.

It exists because agent-driven projects accumulate work items faster than anyone can track them in their head. A SOW gives every work item one canonical markdown file with a status banner, phases, and open questions; the lanes give the whole project a glanceable board; and the authoring rules keep the agent from duplicating items or writing plans detached from the real code.

## Install

1. Create `.claude/skills/sow/` in your repo.
2. Save the file below as `.claude/skills/sow/SKILL.md`.
3. Adjust the lane subfolders and conventions to your project (see Making it yours).
4. Type `/sow init` once to scaffold the framework, then `/sow <request>` to author.

## The skill file

````markdown
---
name: sow
description: >
  Author or improve a Statement of Work (SOW) in .data/sow/. Invoke for "/sow", "/sow init",
  "create a sow", "write a sow", or when the user asks to capture work as a SOW. "/sow init"
  scaffolds the lane framework (idempotent). Otherwise enforce the pre-checks: improve an existing
  SOW before creating a new one, ground it in a code audit, reference related completed SOWs,
  default the lane to queue, and follow the project's plan-mode and writing conventions.
---

# Managing Statements of Work

SOWs are local planning documents in `.data/sow/` (kept OUT of version control), organized into
lanes a work item moves through: `0_queue` -> `1_progressing` -> `2_waiting_review` ->
`3_completed`, plus a `_staging` side-lane for items parked on an external blocker. One canonical
markdown file per SOW; move the same file between lanes as the work advances.

## Initialize (/sow init)

When invoked as /sow init (or when the lane folders do not exist yet), scaffold idempotently, then
stop (this command only builds folders, it never authors a SOW):

```bash
mkdir -p .data/sow/{_staging,0_queue,1_progressing,2_waiting_review,3_completed}
[ -f .data/sow/todo.md ] || printf '# SOW todo\n' > .data/sow/todo.md
grep -qxF '.data/' .gitignore 2>/dev/null || echo '.data/' >> .gitignore
```

It creates only what is missing and never overwrites an existing todo.md.

## Authoring a SOW: do these steps IN ORDER

1. **Improve an existing SOW first (never duplicate).** Search the open lanes for a SOW this work
   belongs in and extend it (a decision, a phase, an open-question resolution). An item in
   2_waiting_review is code-complete, so additions there are dated review-feedback notes. Only
   create a new SOW when no open SOW is a reasonable home, and say that you checked.
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
````

## Making it yours

Three dials worth adjusting:

1. **Lane subfolders**: group SOWs by your project's real areas (a frontend/backend split, per-service folders, whatever matches how work divides). The skill file's step 4 is where that rule lives.
2. **Conventions**: point step 5 at your project's actual writing and review conventions so authored SOWs match the docs around them.
3. **The planning root**: `.data/sow/` is a convention, not a requirement; any gitignored folder works. Keep it out of version control either way; plans churn too fast for useful history and the lanes ARE the state.

## Why the rules are in there

Each authoring rule closes a failure mode agents repeat: creating a duplicate SOW instead of extending the open one (rule 1); writing plans from memory that cite code that does not exist (rule 2); losing the thread between related work items (rule 3); and building straight from a prose wish without surfacing the decisions that belong to a human (rule 5). The lane system does the rest: at any moment, the queue is the backlog, progressing is the work in flight, waiting-review is what needs a human eye, and completed is the record.

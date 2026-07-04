---
title: Manage Statements of Work with Claude Code
slug: author-a-gbti-sow
shortDescription: >-
  This is a Claud Code skill that assists with scope of work (SOW) managment. It comes with commands
  to ship a kanban style lane management system for markdown scope of work files, as well as
  commands for quickly creating and scaling scopes of work. See description for more details.
categories:
  - skill
status: published
visibility: public
publicStub: false
pricing: free
targets:
  - Claude Code
tags:
  - sow
  - workflow
  - planning
  - documentation
type: prompt
author: atwellpub
---

When you are asked to author or improve a SOW (Statement of Work), do these steps IN ORDER before writing anything. SOWs are local planning documents that live in a .data/sow/ folder (kept out of version control), organized into lanes that a work item moves through: 0_queue, 1_progressing, 2_waiting_review, 3_completed, with a _staging side-lane for items parked on an external blocker. Keep one canonical markdown file per SOW.

## Initialize (/sow init)

When invoked as /sow init (or when the lane folders do not exist yet), scaffold the framework idempotently, then stop (this command only builds the folders, it does not author a SOW):

```bash
mkdir -p .data/sow/{_staging,0_queue,1_progressing,2_waiting_review,3_completed}
[ -f .data/sow/todo.md ] || printf '# SOW todo\n' > .data/sow/todo.md
grep -qxF '.data/' .gitignore 2>/dev/null || echo '.data/' >> .gitignore
```

It creates only what is missing and never overwrites an existing todo.md. The .data/ folder stays out of version control (local planning, never committed).

## 1. Improve an existing SOW first (do not duplicate)

Search the open lanes for a SOW this work belongs in and extend that one instead of creating a new file. If a fitting SOW exists, add to it (a decision, a phase, an open-question resolution). If it sits in 2_waiting_review, add a dated review-feedback note (it is code-complete, so this is a follow-up). Only create a new SOW when no open SOW is a reasonable home, and state that you checked.

## 2. Ground it in a code audit (no guessing)

Read the real code so the SOW cites file and line and the true root cause, not assumptions. For a bug, name the root cause. For a feature, name the surfaces and the pattern to reuse. Prefer reusing existing infrastructure over inventing new code.

## 3. Reference related completed SOWs

Search the completed lane and cite the relevant items (as dependencies or related work, the origin of a regression, or the pattern to reuse). Name each completed SOW by id and path in the cross-references section.

## 4. Number and place it

Find the next free number, and default the lane to 0_queue unless told to start in 1_progressing. Group SOWs into subfolders that match the areas of your project.

## 5. Plan mode and writing conventions

Every SOW is built in plan mode, so add a note that its build begins in plan mode and leave genuine decisions as open questions. Follow the writing conventions of your project consistently.

## 6. Structure it

Frontmatter: id, title, status (matching the lane), priority, phase, created (today, as an absolute date), depends_on, related, owner. Then a title, a status banner (what and why, grounded in the audit), design decisions, phases, constraints and guardrails, open questions, and cross-references.

## 7. Design-first SOWs

If the SOW redesigns a visual surface, do not build from prose: request a mockup, store the assets under a sow-NNN-assets folder with a source note, and reference them.

## Reminders

The planning docs are local only and never committed. A SOW is a living document: keep its status and lane in sync as the work moves from queue to completed.

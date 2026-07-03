---
title: Author a GBTI Network SOW
slug: author-a-gbti-sow
status: published
shortDescription: >-
  A step-by-step skill for authoring or improving a GBTI Network Statement of Work. It enforces the
  pre-checks: reuse an existing SOW, ground the work in a code audit, cite the completed SOWs it
  builds on, place it in the right lane, and follow the writing and plan-mode conventions.
categories:
  - skill
targets:
  - Claude Code
tags:
  - sow
  - workflow
  - planning
  - documentation
pricing: free
type: prompt
author: atwellpub
---

When you are asked to author or improve a GBTI Network SOW (Statement of Work), do these steps IN ORDER before writing anything. SOWs live in .data/sow/ (local planning), organized into lanes: 0_queue, 1_progressing, 2_waiting_review, 3_completed, with a _staging side-lane for items parked on an external blocker. Each lane has extension, cf-server, and website subfolders. Keep one canonical markdown file per SOW.

## 1. Improve an existing SOW first (do not duplicate)

Search the open lanes for a SOW this work belongs in and extend that one instead of creating a new file. If a fitting SOW exists, add to it (a decision, a phase, an open-question resolution). If it sits in 2_waiting_review, add a dated QA FEEDBACK note (it is code-complete, so this is a follow-up). Only create a new SOW when no open SOW is a reasonable home, and state that you checked.

## 2. Ground it in a code audit (no guessing)

Read the real code so the SOW cites file and line and the true root cause, not assumptions. For a bug, name the root cause. For a feature, name the surfaces and the pattern to reuse. Prefer reusing existing infrastructure over inventing new code.

## 3. Reference related completed SOWs

Search the completed lane and cite the relevant items (as depends_on or related, the origin of a regression, or the pattern to reuse). Name each completed SOW by id and path in the Cross-references section.

## 4. Number and place it

Find the next free number, and default the lane to 0_queue unless told to start in 1_progressing. Pick the subfolder by area: extension (extension and client-ui UI), cf-server (Worker, membership, house config, scripts), or website (the public Astro site).

## 5. Plan mode and writing conventions

Every SOW is built in plan mode, so add a note that its build begins in plan mode and leave genuine decisions as open questions. Follow the writing conventions: no em or en dashes, no contractions, no smart quotes.

## 6. Structure it

Frontmatter: id, title, status (matching the lane), priority, phase, created (today, absolute date), depends_on, related, owner. Then a title, a status banner (what and why, grounded in the audit), Design decisions, Phases, Constraints and guardrails, Open questions, and Cross-references.

## 7. Design-first SOWs

If the SOW redesigns a visual surface, do not build from prose: request a mockup, store the assets under a sow-NNN-assets folder with a SOURCE note, and reference them.

## Reminders

The planning docs are local only and never committed. Commit and pull-request messages must never credit the AI assistant that helped write them.

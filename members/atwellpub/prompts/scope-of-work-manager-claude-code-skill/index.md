---
title: '/SOW : An Agent Skill for Scopes of Work'
slug: scope-of-work-manager-claude-code-skill
shortDescription: >-
  A drop-in /sow skill for Claude Code: lane-based Scope of Work management (queue, progressing,
  completed) with authoring rules that stop duplicate plans, force a real code
  audit, and keep owner decisions in plan mode.
targets:
  - Claude Code
categories:
  - ai
  - prompts
tags:
  - sow
  - workflow
  - planning
  - documentation
  - claude-code
  - agent-skills
publishedAt: '2026-07-02T00:00:00.000Z'
status: published
type: prompt
kind: skill
author: atwellpub
---

This one gives your agent a `/sow` command for managing Scopes of Work: local, lane-based planning documents that move kanban-style from queue to completed, living beside your code but outside version control.

It exists because agent-driven projects accumulate work items faster than anyone can track them in their head. A SOW gives every work item one canonical markdown file with a status banner, phases, and open questions; the lanes give the whole project a glanceable board; and the authoring rules keep the agent from duplicating items or writing plans detached from the real code.

## Making it yours

Three dials worth adjusting:

1. **Lane subfolders**: group SOWs by your project's real areas (a frontend/backend split, per-service folders, whatever matches how work divides). The skill file's step 4 is where that rule lives.
2. **Conventions**: point step 5 at your project's actual writing and review conventions so authored SOWs match the docs around them.
3. **The planning root**: `.data/sow/` is a convention, not a requirement; any gitignored folder works. Keep it out of version control either way; plans churn too fast for useful history and the lanes ARE the state.

## Why the rules are in there

Each authoring rule closes a failure mode agents repeat: creating a duplicate SOW instead of extending the open one (rule 1); writing plans from memory that cite code that does not exist (rule 2); losing the thread between related work items (rule 3); and building straight from a prose wish without surfacing the decisions that belong to a human (rule 5). The lane system does the rest: at any moment, the queue is the backlog, progressing is the work in flight, waiting-review is what needs a human eye, and completed is the record.

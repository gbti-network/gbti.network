---
title: '/QA : An Agent Skill for Resolving Open Questions'
slug: qa-skill-for-claude-code-and-codex
shortDescription: >-
  A drop-in `/qa` skill for Claude Code that collects the questions your agent just raised and asks
  them in a single batch, in plan mode, before any code is written. By default, it reviews only the
  last reply to keep usage low; `/qa deep` runs the full six-category review when needed.
targets:
  - Claude Code
categories:
  - ai
  - prompts
tags:
  - claude-code
  - agent-skills
  - planning
  - workflow
publishedAt: '2026-07-30T19:37:31.690Z'
status: published
visibility: members
publicStub: true
kind: skill
updatedAt: '2026-09-30T06:42:46.695Z'
encryptedSkill: members/atwellpub/_enc/prompt-qa-skill-for-claude-code-and-codex-skillfile.enc
type: prompt
author: atwellpub
encryptedBody: members/atwellpub/_enc/prompt-qa-skill-for-claude-code-and-codex-body.enc
---

This one gives your agent a `/qa` command that stops before it builds, pulls every unresolved decision into a single batch of questions, and refuses to write code until you have answered them.

It exists because open questions have a habit of surfacing at the wrong end of the work. A sprint finishes, and only then does the agent raise the decisions it should have raised at the start, at exactly the point where acting on them means redoing something.

The mechanism is plan mode, invoked deliberately. The agent puts ITSELF into a read-only state, does its research there, asks everything it found as a form you click through, and only then acts. That ordering is the whole feature.

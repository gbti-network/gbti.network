---
kind: skill
title: '/QA : An Agent Skill for Resolving Open Questions'
slug: qa-skill-for-claude-code-and-codex
shortDescription: >-
  A drop-in `/qa` skill for Claude Code that collects the questions your agent just raised and asks
  them in a single batch, in plan mode, before any code is written. By default, it reviews only the
  last reply to keep usage low; `/qa deep` runs the full six-category review when needed.
categories:
  - ai
  - prompts
status: published
visibility: public
publicStub: false
pricing: free
targets:
  - Claude Code
tags:
  - claude-code
  - agent-skills
  - planning
  - workflow
publishedAt: '2026-07-30T19:37:31.690Z'
updatedAt: '2026-10-08T22:15:54.332Z'
type: prompt
author: atwellpub
---

The QA in the `/qa` Claude code still stands for *Questions and Answers, *and this is probably the skill I use the most across CLI sessions when working with Claude. 

What it does is, after a progress report from Claude Code, there are often open-ended questions and unknowns that Claude seeks to learn from the user, and it does not automatically enter plan mode to ask them. Instead, it tends to ask several questions in paragraph format. Sometimes the questions are buried at the top of a long summary.   
  
  
After Claude completes a round, I oftentimes immediately type in `/qa` and Claude will analyze its last summary for open-ended questions and then immediately ask them to me in *plan mode* while offering a multiple-choice style intake with an option to add commentary. 

## Skill parameters

This skill ships with several parameters, however you will probably never need to use them. Here they are for your consideration.

- **`/qa`** is the default, and it is deliberately narrow: the agent gathers what its own last reply left open, and that set becomes the batch. This is the everyday case, and it costs almost nothing because there is no sweep.
- **`/qa continue`** or **`/qa proceed`** is the same, minus the approval round. You answer, it builds. Still plan mode, so nothing gets written while the questions are open.
- **`/qa deep`** widens the scope to the full six-category sweep in the skill file: the request, the governing doc, the audit findings, silent defaults, the decisions that are inherently yours, and conflicts with existing conventions. Use it when you are starting real work, not when you are closing out a reply.
- **`/qa <anything else>`** scopes to a subject. `"/qa the rate limiter"` asks everything unresolved about the rate limiter specifically.

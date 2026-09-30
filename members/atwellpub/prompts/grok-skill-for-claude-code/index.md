---
title: '/GROK : An Agent Skill for Narrative Summaries'
slug: grok-skill-for-claude-code
shortDescription: >-
  A drop-in /grok skill for Claude Code that re-tells the agent's own last reply as two or three
  short narrative paragraphs, so the point survives without the headers, bullets and tables. It
  re-expresses what was already said rather than researching again, and it is written so the awkward
  parts cannot be smoothed away.
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
  - writing
  - summarization
  - workflow
image: ./images/stranger-in-a-strange-land-header.webp
publishedAt: '2026-08-27T00:22:08.659Z'
updatedAt: '2026-08-27T00:22:08.659Z'
type: prompt
kind: skill
author: atwellpub
---

This one gives your agent a `/grok` command that takes its own last reply and re-tells it as two or three short paragraphs of plain narrative prose.

The term "Grok" comes from Robert Heinlein's novel *Stranger in a Strange Land*, where to "grok" something is to drink it deeply enough to essentially be one with it.

## What makes it different from asking for a summary

The skill is explicit that there are no new tool calls, no fresh research, and no findings that were not already in the previous reply. The /grok skill asks the agent to only consider the last reply. We are not asking it to QA its response, rather we just want it to rephrase it.

**Asking the bot to summarize does not inform the bot *how* to summarize or what the reader will consider valuable in a summary. This skill takes some of that extra definition off the plate of the operator (you).**

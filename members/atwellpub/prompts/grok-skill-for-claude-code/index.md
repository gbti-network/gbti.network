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
  - skill
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
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/grok` command that takes its own last reply and re-tells it as two or three short paragraphs of plain narrative prose.

The term "Grok" comes from Robert Heinlein's novel *Stranger in a Strange Land*, where to "grok" something is to drink it deeply enough to essentially be one with it.

## What makes it different from asking for a summary

The skill is explicit that there are no new tool calls, no fresh research, and no findings that were not already in the previous reply. The /grok skill asks the agent to only consider the last reply. We are not asking it to QA its response, rather we just want it to rephrase it.

**Asking the bot to summarize does not inform the bot *how* to summarize or what the reader will consider valuable in a summary. This skill takes some of that extra definition off the plate of the operator (you).**

## Install

1. Create `.claude/skills/grok/` in your repo, or `~/.claude/skills/grok/` to have it in every project.
2. Save the file below as `SKILL.md` inside it.
3. Type `/grok` in Claude Code.

Nothing to configure. Add a topic after the command (`/grok the migration part`) to narrow it to one thread within the last reply.

## The skill file

```markdown
---
name: grok
description: >
  Re-tell your own last reply as 2 or 3 short narrative paragraphs, so the point survives without the
  scaffolding. Invoke for "/grok", or when the user asks you to say that again plainly, give them the
  short version, or explain what it actually means. It re-expresses what you ALREADY said: no new
  research, no tool calls, no fresh findings. Prose only, no headers, no bullets, no tables.
---

# /grok: say it again, as a story

Your last reply was structured for completeness. This one is structured for understanding. Take what you
just said and re-tell it in **2 or 3 short paragraphs of plain narrative prose**, as if explaining it to a
capable colleague who missed the detail and wants the shape of it.

## What to re-tell

**Your own previous reply, and nothing else.** Not the whole conversation, not the task, not a fresh look
at the code. If your last message was itself a `/grok` response, go back to the one before it. If the user
typed `/grok` with a topic after it, narrow to that thread within your last reply.

**Add nothing.** No new investigation, no tool calls, no findings that were not already in the reply. If
you notice something new while re-reading, that is a separate message, not part of the grok. The value
here is compression and clarity, and a grok that smuggles in fresh claims is neither.

If the last reply was already two plain paragraphs, say so and stop rather than paraphrasing it into
something worse. If there is no previous reply of yours to work from, say that instead of inventing one.

## How to write it

**Narrative means causal, not chronological.** Not "first this, then that." Say what was true, what that
caused, and what it means now. A reader should finish knowing the shape of the situation, not a list of
events. Lead with the thing that matters most, which is often the surprise, the reversal, or the decision
waiting on them, and let the rest hang off it.

**Strip the scaffolding, keep the load-bearing detail.** Out: file paths, line numbers, commit hashes,
counts, tables, headers, bullets, bold labels. In: any specific that carries the meaning. "The reconcile
bot published it overnight" needs no commit hash to land, but "nobody is on it" and "this breaks at the
$5 price" are the substance and must survive.

**Two or three paragraphs, short ones.** If it will not compress that far, the compression is the point:
choose what matters and drop the rest rather than writing four dense paragraphs. Plain sentences. No
em dashes or en dashes.

## What must survive the compression

These are the things a summary is most tempted to smooth away, and losing them makes the grok actively
worse than the reply it replaced:

- **Anything waiting on the user.** A pending decision, an unanswered question, a required approval. If
  they read only the grok, they must still know what is theirs to do.
- **Corrections and reversals.** If the last reply corrected an earlier claim, admitted an error, or
  withdrew something, that stays. Narrative flow is not a reason to quietly drop the part where you were
  wrong.
- **Uncertainty, as uncertainty.** What was unverified stays unverified. Never let compression promote a
  hedge into a fact; "this looks like" must not become "this is".
- **Bad news.** A failure, a live bug, a thing that did not work. If the reply led with a problem, the
  grok leads with it too.

A grok that reads better than the reply because it left out the awkward parts is a failure, not a success.
```

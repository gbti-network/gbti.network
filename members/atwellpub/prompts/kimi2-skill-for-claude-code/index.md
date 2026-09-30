---
title: '/KIMI2 : An Agent Skill for Drafting with Kimi'
slug: kimi2-skill-for-claude-code
shortDescription: >-
  A /kimi2 skill for Claude Code that hands drafting to Kimi from inside a session, against a written
  voice record and under a byline the agent is never allowed to guess. It refuses to invent
  first-person material, leaving a marker where real material is missing instead.
categories:
  - ai
  - prompts
status: draft
visibility: public
publicStub: false
pricing: free
targets:
  - Claude Code
tags:
  - claude-code
  - agent-skills
  - writing
  - drafting
  - workflow
type: prompt
kind: skill
author: atwellpub
---

**`/kimi2`** uses that hook to hand drafting work to Kimi from inside a session. It also answers to `/kimi`, so either slash command starts the same flow. The agent handles the mechanical work around the request, so you stay in the same terminal without breaking flow to open a browser or copy text between windows.

This is a division of labour. The drafting model works from a documented **voice record** rather than a generic set of instructions. That record is a long markdown file describing how the operator writes: their tells, prohibitions, and preferences. Because the agent that commissions the draft is not the one that reviews it, the model writing can be held to a specific voice while the agent running the session stays focused on context and execution. You brief the agent, the agent briefs Kimi, and the result is a draft you review before it goes anywhere. The default model is `kimi-k2.6`. You can name the flagship model for one piece instead, though that costs roughly three times as much and its thinking cannot be turned off.

### What it does

| Command | What it does |
|---|---|
| `/kimi2 status` | The agent checks the key and the voice record are in place without printing the key. |
| `/kimi2 write` | The agent builds the request from a brief, the named byline, the voice record and any material files, and writes the draft to a path you name. |
| `/kimi2 rewrite` | The same call against an existing draft, frontmatter held back and reattached, with no fact, figure, link, quote or first-person statement changed. |
| Setup | Put the API key in an environment variable read from the shell profile rather than in the chat. |

The output path is required, and an existing file is never overwritten.

### The two rules it enforces

The first rule is that the **byline** is chosen, not guessed. Every call to `write` or `rewrite` names exactly one byline, and the skill refuses to run if one is missing. A missing byline is an error rather than a silent default, because a draft under the wrong name is a misattribution with a real person's name on it. There is no fallback to a generic voice and no silent assumption that the current project is the speaker. The skill also refuses to write a bylined draft when the voice record is missing, unless the user says to go ahead without one.

The second rule is that the model does not invent first-person material. The prompts bar fabricated motivation, anecdotes, quotes, opinions, and facts. Where real material is missing, the model leaves a **[NEEDS]** marker. The agent reports every marker with its line number and does not fill one in itself. The fix is to supply real material files and rerun. This rule exists because a fabricated origin story shipped under a real byline in July 2026. The skill treats a gap as recoverable and a filled-in lie as a failure. That is why real material files are the only source of facts and first-person statements for a write, and why the rewrite prompt forbids changing any fact, figure, link, quote, or first-person statement.

### What the skill checks before it reports back

The agent post-processes every draft before writing it to disk. If the model produced any em dashes, the agent sends the piece back once with a narrow repair instruction rather than substituting a different dash character, because swapping one dash for another is the same construction in disguise. Any that survive are named in the report. Curly quotes are straightened without a model call. An outer code fence or preamble around the draft is removed. The final report states where the draft is, its length, every `[NEEDS]` marker verbatim, and anything flagged as truncated or still present. It also names any em dashes that survived the repair pass. You get the draft and a summary of what still needs attention in one step.

### Install

1. Create the folder `.claude/skills/kimi2`.
2. Save the `SKILL.md` file there.
3. Put the API key in an environment variable read from the shell profile rather than passing it through the chat transcript.
4. Check that everything is ready with `/kimi2 status`.

If you are working in a team, there is also a relay setup: a small service on a private network holds the key so client machines hold nothing. The clients reach the relay by name, and the key does not leave the one host.

This published version is the simplified one: the author runs a command line version of the same skill privately, and the file here has no dependency on it.

### The honest limitation

A model applying a voice record to its own draft is a first pass, not a review. A single writer checking its own work against rules it was just handed is exactly the failure an independent review exists to catch, so a draft goes through a separate review before anything ships. The voice record is roughly 30,000 tokens and rides along with every call, and while the API caches repeated prefixes, the overhead is still real enough that thinking can be turned off for short pieces where the reasoning time is not worth the trade.

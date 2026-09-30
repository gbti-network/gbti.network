---
title: '/FARLEY : An Agent Skill for Remembering People'
slug: farley-file-skill-for-claude-code
shortDescription: >-
  Named for the files Jim Farley kept for Franklin Roosevelt, and borrowed from Robert Heinlein's
  science fiction novel "Double Star".  The /farley claude code skill helps maintain a "Farley File"
  from their agentic interface.
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
  - workflow
  - note-taking
  - relationship-management
image: ./images/farleyfile.jpg
publishedAt: '2026-09-17T20:05:27.945Z'
updatedAt: '2026-09-18T17:01:16.461Z'
type: prompt
kind: skill
author: atwellpub
---

This Claude Code skill offers your agent an `/farley` command that helps keep track of memorable data you learn about the people you meet. This is for those who network with many people and would like to be able to record and recall details that may otherwise slip the memory.

The name comes from James Farley, Franklin Roosevelt's campaign manager and later Postmaster General, who kept a file on everyone the two of them met: family, work, the last conversation. Before a return visit he read it, and a man who had shaken his hand once, a year earlier, got asked about a family member by name.

I came across this concept while reading Robert Heinlein's *Double Star*, where an actor stands in for a politician and survives the handshakes because the politician's staff keeps exactly that file. Heinlein named it after Farley, and the 1956 novel is how most people who keep one first heard of the idea.

## What it does

`/farley` takes a mode as its first word, and `/farleyfile` is the same skill under a second name.

| Command | What it does |
| --- | --- |
| `/farley <name> <notes>` | Creates or updates that person's dossier, logs the meeting, and tags it. Plain sentences work: `/farley Met Tom Ruiz at the fundraiser, his wife is Ana`. |
| `/farley brief <name>` | Reads the notes back as a pre-meeting brief: names, last conversation, open threads, what to raise, what to avoid. |
| `/farley search <query>` | Finds people by text (`fly fishing`) or by tag (`tag:role/donor tag:place/austin`). Local only, plain grep. |
| `/farley research <name>` | Searches the web for their public footprint and records confirmed findings with sources, in their own section. |
| `/farley list`,  | Everyone on file; re-tag one dossier or all of them; set where the file lives. |
|  /farley init | Run this once after dropping the skill into your Claude |

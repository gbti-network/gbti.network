---
title: '/CI : An Agent Skill for GitHub Actions Health'
slug: ci-health-check-skill-for-claude-code
shortDescription: >-
  A drop-in /ci skill for Claude Code that audits your GitHub Actions: a red/green health board,
  root-cause failure triage with an extensible bucket taxonomy, a post-push watcher, scheduled-job
  staleness alarms, and a living workflow inventory.
targets:
  - Claude Code
categories:
  - ai
  - prompts
tags:
  - claude-code
  - github-actions
  - ci
  - devops-automation
  - agent-skills
variables:
  - artifact build commands + dirs
  - workflow inventory table
publishedAt: '2026-07-09T19:09:11.755Z'
status: published
type: prompt
kind: skill
author: atwellpub
---

This one gives your agent a `/ci` command that audits your GitHub Actions: a red/green health board, real failure triage, a post-push watcher, and a living inventory of what every workflow does.

It exists because agents (and humans) keep re-deriving the same motions every time CI goes red: which runs failed, how to actually get the logs, whether the failure is your commit or something that was already broken. The skill encodes those motions once, including a few non-obvious `gh` behaviors that cost me real debugging time.

## Making it yours

There is nothing to configure for the repo itself: `gh` infers it from the working directory, so the skill works the moment you drop it in. Only two parts are inherently repo-specific:

1. **The drift action**: keep it only if your repo commits build artifacts (bundled JS, generated schemas, packaged extensions). List every build command and every artifact directory. If you do not commit artifacts, delete the action.
2. **The inventory table**: have your agent seed it once from `.github/workflows/` and then treat it as living documentation. This is the part future sessions (and new contributors) thank you for.

And treat the failure taxonomy as a starting point, not a fixed set: projects fail in project-shaped ways, so add the buckets yours actually produces.

## Why the odd details are in there

Each lore item is a real failure mode: `--log-failed` silently returning nothing while the jobs API works; a scheduled backup that failed for four days while its failure emails blamed whatever commit happened to be newest on main; a workflow reading a secret nobody ever created and reporting it as a vague downstream error instead of failing fast; a drift check that stayed red because the rebuild command regenerated only one of two committed bundles. The Fix discipline section is there because agents notoriously "fix" a failing test by editing the test — the classification buckets plus that rule keep the agent from the three classic wastes: rerunning a job that can never pass, "fixing" code that was never broken, and silencing a test that was telling the truth.

Several of the sharpest edges were folded in from a member running the skill on their own repo the morning it shipped: the per-workflow health board (a chatty cron floods a grouped window), `--commit` for the post-push watcher, the non-binary conclusion states, the 60-day cron auto-disable, the log-retention 410 fallback, and the `--template` float-id trap. That is exactly how a living skill should grow; when yours diverges, fold the lessons back into the file.

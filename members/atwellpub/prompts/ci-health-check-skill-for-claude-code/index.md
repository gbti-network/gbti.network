---
title: 'CI Health Check: a /ci Skill for Claude Code'
slug: ci-health-check-skill-for-claude-code
shortDescription: >-
  A drop-in /ci skill for Claude Code that audits your GitHub Actions: a red/green health board,
  failure triage into broken-by-commit vs provisioning gap vs flaky, a post-push watcher,
  scheduled-job staleness alarms, and a living workflow inventory.
targets:
  - Claude Code
categories:
  - ai
  - prompts
  - skill
tags:
  - claude-code
  - github-actions
  - ci
  - devops-automation
  - agent-skills
variables:
  - <owner>/<repo>
  - <artifact build commands + dirs>
  - <workflow inventory table>
status: published
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/ci` command that audits your GitHub Actions: a red/green health board, real failure triage, a post-push watcher, and a living inventory of what every workflow does.

It exists because agents (and humans) keep re-deriving the same motions every time CI goes red: which runs failed, how to actually get the logs, whether the failure is your commit or something that was already broken. The skill encodes those motions once, including a few non-obvious `gh` behaviors that cost me real debugging time.

## Install

1. Create `.claude/skills/ci/` in your repo.
2. Save the file below as `.claude/skills/ci/SKILL.md`.
3. Replace the placeholders (marked `<like-this>`) with your repo specifics, and fill in the workflow inventory table.
4. Type `/ci` (or `/ci health check`) in Claude Code.

Requires the `gh` CLI authenticated against your repo.

## The skill file

````markdown
---
name: ci
description: >
  Inspect and diagnose this repo's GitHub Actions CI. Invoke for "/ci", "/ci health", "/ci health check",
  "/ci watch", "/ci schedule", "/ci diagnose <run-id>", "/ci list", or when the user asks whether CI is
  green, why a workflow failed, or what a workflow does. Pulls recent runs with gh, downloads failed job
  logs the reliable way, and classifies failures into broken-by-commit vs provisioning gap vs flaky/external.
---

# CI operations

All commands run from the repo root against `<owner>/<repo>` with the `gh` CLI. Default action when none is
named: `health`.

## Tooling lore (read first)

- **Fetching logs:** `gh run view <id> --log-failed` often returns NOTHING. The reliable recipe:
  ```bash
  JOB=$(gh run view <run-id> --json jobs -q '.jobs[0].databaseId')
  gh api repos/<owner>/<repo>/actions/jobs/$JOB/logs > /tmp/job.log
  ```
  Then grep the file; strip the timestamp column with `cut -c30-` when quoting. Multi-job runs: iterate
  `.jobs[]` and pick by `.conclusion == "failure"`. Step-level status without logs:
  `gh api .../actions/runs/<id>/jobs -q '.jobs[0].steps[] | .name + " " + .conclusion'`.
- **Scheduled-failure attribution:** the failure email for a SCHEDULED workflow cites the LATEST main sha,
  which is often NOT the commit that broke it. Always check
  `gh run list --workflow <file> --limit 5 --json conclusion,createdAt,event` first; if the failures predate
  the cited commit, it is a standing provisioning or external problem, not a regression.
- **Secrets vs variables:** repo secrets via `gh secret list`, plain variables via `gh variable list`. A
  workflow reading `secrets.X` where X was never created gets an EMPTY string, not an error, so the symptom
  is a downstream "not set" message, a 401, or an empty env var in the step header.
- **Setting secrets may be gated:** an agent session may be blocked from `gh secret set` by permission
  policy. Prepare the value in a local untracked file and hand the human the one command.

## Failure classification (use these three buckets in every report)

1. **Broken by commit:** the failure starts at a specific sha and the log implicates changed files. Fix the
   code or rebuild the artifact; verify with a rerun on the fix commit.
2. **Provisioning gap:** missing or empty secret, unset variable, an external account not configured. Route
   to the human with the exact command; do not retry.
3. **Flaky / external:** network hiccup, provider outage, rate limit; the same job passed before and after
   without a related change. `gh run rerun <id> --failed` once, then re-check.

## Actions

### /ci health [N]   (also: /ci health check; the default)

1. `gh run list --limit ${N:-30} --json databaseId,workflowName,conclusion,headSha,event,createdAt` and
   group by workflow. Report a red/green board: latest conclusion per workflow, streak (consecutive fails),
   and the event (push vs schedule).
2. For each currently-red workflow: pull its recent history (`--workflow <file> --limit 5`) to date the
   breakage, download the failed job log (recipe above), and classify into the three buckets with a
   one-line root cause and the proposed fix.
3. End with the board, the diagnoses, and what to do next. Offer to make low-risk code-side fixes;
   provisioning gaps go to the human.

### /ci watch

The post-push ritual. Find the runs for the current HEAD and watch until all conclude:
```bash
SHA=$(git rev-parse HEAD)
gh run list --limit 15 --json databaseId,workflowName,conclusion,headSha \
  -q ".[] | select(.headSha==\"$SHA\")"
gh run watch <id> --exit-status   # per unfinished run
```
Report each result; diagnose any red as in health.

### /ci drift   (only if your repo commits build artifacts)

The LOCAL pre-push check that committed artifacts match their source:
```bash
<your full artifact build command(s)>
git diff --name-only -- <artifact-dir-1> <artifact-dir-2>
```
Empty diff = safe to push. Non-empty = stage those files with the commit that changed the source. Fill in
EVERY build command: partial rebuilds that skip one artifact are the classic way this check reds your main
branch anyway.

### /ci schedule

Staleness audit of the scheduled workflows. For each one (list yours here with cadences): pull the last 5
runs and report the last SUCCESS date. Alarm on any workflow whose last success is older than 2x its
cadence. A scheduled job can be silently red for days; nobody rereads yesterday's failure email. Note which
scheduled jobs are load-bearing (a backup, a data sync something else depends on) so staleness there is
escalated, not just listed.

### /ci diagnose <run-id | workflow-name>

Deep-dive one run (or the latest run of a named workflow): step table, failed job log to disk,
classification, root cause, fix proposal.

### /ci rerun <run-id>

`gh run rerun <run-id> --failed` then watch it. Only for the flaky/external bucket; never rerun a
provisioning gap (it cannot pass) or a broken-by-commit red (fix first).

### /ci list

Print this workflow inventory (keep it current when workflows are added or changed):

| Workflow (file) | Trigger | What it does | Needs |
|---|---|---|---|
| <Name> (<file>.yml) | push / PR / cron | <one line on what it validates or does> | <secrets or nothing> |

To seed it, read every file in `.github/workflows/` and summarize: name, trigger, the job's purpose (the
header comment usually says), and which secrets it reads.

## Reporting conventions

- Lead with the board (workflow, latest state, streak), then diagnoses, then actions taken or proposed.
````

## Customizing it

Three placeholders matter:

1. **The repo slug** (`<owner>/<repo>`) in the log-fetch recipe.
2. **The drift action**: keep it only if your repo commits build artifacts (bundled JS, generated schemas, packaged extensions). List every build command and every artifact directory. If you do not commit artifacts, delete the action.
3. **The inventory table**: have your agent seed it once from `.github/workflows/` and then treat it as living documentation. This is the part future sessions (and new contributors) thank you for.

## Why the odd details are in there

Each lore item is a real failure mode: `--log-failed` silently returning nothing while the jobs API works; a scheduled backup that failed for four days while its failure emails blamed whatever commit happened to be newest on main; a workflow reading a secret nobody ever created and reporting it as a vague downstream error instead of failing fast; a drift check that stayed red because the rebuild command regenerated only one of two committed bundles. The classification buckets keep the agent from the two classic wastes: rerunning a job that can never pass, and "fixing" code that was never broken.

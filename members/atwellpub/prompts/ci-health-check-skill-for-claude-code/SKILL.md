---
name: ci
description: >
  Inspect and diagnose this repo's GitHub Actions CI. Invoke for "/ci", "/ci health", "/ci health check",
  "/ci watch", "/ci schedule", "/ci diagnose <run-id>", "/ci list", or when the user asks whether CI is
  green, why a workflow failed, or what a workflow does. Pulls recent runs with gh, downloads failed job
  logs the reliable way, and triages failures to their real root cause.
---

# CI operations

All commands run from the repo root with the `gh` CLI (it resolves the repo from the working directory;
`{owner}/{repo}` in API paths is a native gh placeholder). Default action when none is named: `health`.

## Tooling lore (read first)

- **Fetching logs:** `gh run view <id> --log-failed` often returns NOTHING. The reliable recipe (pick the
  FAILED job, not the first one):
  ```bash
  JOB=$(gh run view <run-id> --json jobs -q '[.jobs[] | select(.conclusion == "failure")][0].databaseId')
  gh api repos/{owner}/{repo}/actions/jobs/$JOB/logs > /tmp/job.log
  ```
  Then grep the file; strip the timestamp column with `cut -c30-` when quoting. Step-level status without
  logs: `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs -q '.jobs[].steps[] | .name + " " + .conclusion'`.
- **Old logs are GONE (HTTP 410):** the logs endpoint returns 410 on runs older than the log retention
  (~90 days). Job and step metadata outlive the logs, so for an old red fall back to the step table plus
  the commit diff around the breakage date.
- **Never extract run or job ids with `--template`:** Go templates print JSON numbers as float64
  (`{{.databaseId}}` renders like `2.9079759914e+10`). Ids must come from `-q`/`--jq`.
- **Scheduled-failure attribution:** the failure email for a SCHEDULED workflow cites the LATEST main sha,
  which is often NOT the commit that broke it. Always check
  `gh run list --workflow <file> --limit 5 --json conclusion,createdAt,event` first; if the failures predate
  the cited commit, it is a standing provisioning or external problem, not a regression.
- **Secrets vs variables:** repo secrets via `gh secret list`, plain variables via `gh variable list`. A
  workflow reading `secrets.X` where X was never created gets an EMPTY string, not an error, so the symptom
  is a downstream "not set" message, a 401, or an empty env var in the step header.
- **Setting secrets may be gated:** an agent session may be blocked from `gh secret set` by permission
  policy. Prepare the value in a local untracked file and hand the human the one command.

## Failure triage (a starting taxonomy — extend it to fit the project)

Classify every red into a named bucket, because the bucket decides the response. These three cover most
repos; add project-specific buckets as you meet them (examples: environment/toolchain drift, a dependency
or upstream API regression, resource exhaustion such as OOM or disk or rate limits, data- or state-dependent
failures, expired credentials). When a failure fits no bucket, name a new one in the report rather than
forcing it into a wrong response.

1. **Broken by commit:** the failure starts at a specific sha and the log implicates changed files. Fix the
   root cause (see Fix discipline below); verify with a rerun on the fix commit.
2. **Provisioning gap:** missing or empty secret, unset variable, an external account not configured. Route
   to the human with the exact command; do not retry.
3. **Flaky / external:** network hiccup, provider outage, rate limit; the same job passed before and after
   without a related change. `gh run rerun <id> --failed` once, then re-check.

Conclusions are not binary. `cancelled` (common under concurrency groups) and `skipped` are NOT red and
must not count toward a streak; `startup_failure` means the workflow file itself is broken (bad YAML) and
belongs in broken-by-commit; `action_required` is a fork PR awaiting approval, not a failure. Only
`failure` (and a `timed_out`) is red.

## Fix discipline (failing tests especially)

When a test fails, evaluate the REAL defect the test is exposing and propose a fix for that root cause.
Never patch the symptom, and never modify a test so it passes while the underlying failure remains — if you
find yourself weakening an assertion, deleting a case, or special-casing the test input, stop and re-derive
what the test was protecting. Changing a test is only correct when the test itself is wrong about the
intended behavior, and the report must say that explicitly and justify it. The same rule generalizes beyond
tests: a fix that makes the red go away without explaining WHY it was red is a symptom patch, not a fix.

## Actions

### /ci health [N]   (also: /ci health check; the default)

1. Build the board PER WORKFLOW, not from one grouped list (a chatty cron floods a `--limit 30` window and
   rare workflows silently vanish): `gh workflow list --all --json name,path,state` to enumerate (this also
   surfaces disabled workflows), then per workflow
   `gh run list --workflow <file> --limit ${N:-5} --json databaseId,conclusion,event,createdAt`. Report a
   red/green board: latest conclusion per workflow, streak (consecutive `failure` conclusions only), and
   the event (push vs schedule).
2. For each currently-red workflow: pull its recent history (`--workflow <file> --limit 5`) to date the
   breakage, download the failed job log (recipe above), and triage it (the taxonomy above) with a
   one-line root cause and the proposed fix.
3. End with the board, the diagnoses, and what to do next. Offer to make low-risk code-side fixes (root
   cause, per Fix discipline); provisioning gaps go to the human.

### /ci watch

The post-push ritual. Find the runs for the current HEAD and watch until all conclude:
```bash
SHA=$(git rev-parse HEAD)
gh run list --commit "$SHA" --json databaseId,workflowName,conclusion
gh run watch <id> --exit-status   # per unfinished run
```
Runs may not exist yet right after a push (a race): poll for a few seconds before concluding "no runs for
HEAD". `--commit` is exact; never jq-filter a recent-runs window by headSha (busy repos overflow it).
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

Also check for SILENT DISABLING: GitHub disables cron workflows after 60 days without repo activity, with
no failure signal at all, so "last success too old" alone cannot distinguish a red streak from a disabled
workflow. `gh workflow list --all --json name,state` and alarm on any state other than `active`.

### /ci diagnose <run-id | workflow-name>

Deep-dive one run (or the latest run of a named workflow): step table, failed job log to disk,
triage bucket, root cause, fix proposal.

### /ci rerun <run-id>

`gh run rerun <run-id> --failed` then watch it. Only for the flaky/external bucket; never rerun a
provisioning gap (it cannot pass) or a broken-by-commit red (fix the root cause first).

### /ci list

Print this workflow inventory, then police it: diff the table rows against the actual files in
`.github/workflows/` and flag any workflow missing from the table or any row whose file no longer exists
(update the table as part of the same run). The living doc polices itself.

| Workflow (file) | Trigger | What it does | Needs |
|---|---|---|---|
| <Name> (<file>.yml) | push / PR / cron | <one line on what it validates or does> | <secrets or nothing> |

To seed it, read every file in `.github/workflows/` and summarize: name, trigger, the job's purpose (the
header comment usually says), and which secrets it reads.

## Reporting conventions

- Lead with the board (workflow, latest state, streak), then diagnoses, then actions taken or proposed.

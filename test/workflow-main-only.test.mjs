// sow-295: a workflow that can be started by hand and holds a secret runs from main only.
//
// A manual run uses the ref it was started from, so before this rule any branch's unmerged code could be run against
// Stripe, Discord roles, the member KV, the Chrome Web Store listing or the member-key rotation by picking the branch
// in the "Run workflow" menu. On 2026-08-31 the same shape put an unmerged branch on the production site. The two
// deploy workflows carry their own confirm-or-preview guard (scripts/deploy-target.mjs, deploy-workflows.test.mjs);
// every other such workflow must START EVERY JOB with the refusal step below.
//
// This is a guard against accidents, not against a malicious branch: a manual run uses the branch's own copy of the
// workflow, which can drop the step. The rule lives here so a NEW workflow added without it fails CI on its first
// push, instead of being discovered the day someone runs it from a branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const REFUSAL_IF = "github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'";
const OWN_GUARD = new Set(['deploy.yml', 'deploy-worker.yml']); // confirm-or-preview, tested in deploy-workflows.test.mjs

/** The workflows this rule governs: hand-startable, and holding any secret other than the per-run GITHUB_TOKEN. */
export function governedWorkflows(dir = DIR) {
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const doc = yaml.load(raw);
    const on = doc?.on ?? doc?.[true]; // js-yaml reads a bare `on:` key as boolean true
    const dispatchable = typeof on === 'string' ? on === 'workflow_dispatch' : Array.isArray(on) ? on.includes('workflow_dispatch') : !!on && 'workflow_dispatch' in on;
    // Only a secret READ inside an expression counts; prose and file names (check-build-secrets.mjs) do not.
    const secrets = [...new Set([...raw.matchAll(/\$\{\{[^}]*?\bsecrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].filter((s) => s !== 'GITHUB_TOKEN');
    if (dispatchable && secrets.length) out.push({ file, doc });
  }
  return out;
}

/** Problems with one workflow's jobs: every job must open with the refusal step. */
export function mainOnlyProblems({ file, doc }) {
  const problems = [];
  for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
    if (!Array.isArray(job?.steps)) { problems.push(`${file} job "${name}" has no steps list, so it cannot open with the refusal`); continue; }
    const first = job.steps[0] || {};
    if (first.if !== REFUSAL_IF) { problems.push(`${file} job "${name}" does not open with the main-only refusal step (if: ${REFUSAL_IF})`); continue; }
    if (!/\bexit 1\b/.test(String(first.run || ''))) problems.push(`${file} job "${name}": the refusal step does not exit 1, so a branch run would continue`);
    if (/\$\{\{/.test(String(first.run || ''))) problems.push(`${file} job "${name}": the refusal step interpolates into run; pass the branch through env`);
  }
  return problems;
}

test('every hand-startable workflow holding a secret opens every job with the main-only refusal', () => {
  const governed = governedWorkflows().filter((w) => !OWN_GUARD.has(w.file));
  // ZERO SUBJECTS IS A FAILURE: a parse change that matched nothing would otherwise pass silently.
  assert.ok(governed.length >= 10, `only ${governed.length} governed workflows were found; the discovery is broken`);
  const problems = governed.flatMap(mainOnlyProblems);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the two deploy workflows are governed too, and carry their own guard instead', () => {
  const files = governedWorkflows().map((w) => w.file);
  for (const f of OWN_GUARD) assert.ok(files.includes(f), `${f} should be hand-startable with secrets; if it no longer is, revisit OWN_GUARD`);
});

test('the checker rejects a job without the step, a loosened condition, and a step that does not stop the run', () => {
  const wf = (steps) => ({ file: 'x.yml', doc: { jobs: { a: { steps } } } });
  const refusal = { if: REFUSAL_IF, env: { REF_NAME: '${{ github.ref_name }}' }, run: 'echo "::error::no"\nexit 1' };
  assert.deepEqual(mainOnlyProblems(wf([refusal, { uses: 'actions/checkout@v4' }])), []);
  assert.match(mainOnlyProblems(wf([{ uses: 'actions/checkout@v4' }, refusal])).join(), /does not open with/);
  assert.match(mainOnlyProblems(wf([{ ...refusal, if: "github.ref != 'refs/heads/main'" }])).join(), /does not open with/, 'a condition that also refuses schedules and pushes is a different rule');
  assert.match(mainOnlyProblems(wf([{ ...refusal, run: 'echo refused' }])).join(), /does not exit 1/);
  assert.match(mainOnlyProblems(wf([{ ...refusal, run: 'echo "${{ github.ref_name }}"\nexit 1' }])).join(), /interpolates/);
  assert.match(mainOnlyProblems({ file: 'x.yml', doc: { jobs: { a: { uses: './.github/workflows/y.yml' } } } }).join(), /no steps list/);
});

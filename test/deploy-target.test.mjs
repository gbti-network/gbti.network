// sow-295: what a deploy run may send where (scripts/deploy-target.mjs), and what it announces
// (scripts/notify-deploy.mjs). The workflow wiring that calls these is pinned in deploy-workflows.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decide, runGuard, runStamp, withNoindex, summaryMarkdown, NOINDEX_RULE } from '../scripts/deploy-target.mjs';
import { buildDeployMessage, notifyDeploy, readLiveRef } from '../scripts/notify-deploy.mjs';

const D = 'workflow_dispatch';

test('a push to main and a dispatch from main deploy production; the recovery path is unchanged', () => {
  assert.deepEqual(decide({ event: 'push', ref: 'main' }), { ok: true, mode: 'production', deployBranch: 'main', branch: 'main' });
  assert.deepEqual(decide({ event: D, ref: 'main', target: 'production' }), { ok: true, mode: 'production', deployBranch: 'main', branch: 'main' });
  assert.equal(decide({ event: D, ref: 'main' }).mode, 'production', 'an empty target means production');
  assert.equal(decide({ event: 'push', ref: 'feature' }).ok, false, 'a push is only ever main');
});

test('a branch reaches production only when confirm_branch repeats its name exactly', () => {
  const refused = decide({ event: D, ref: 'codex/workbench-image-intake', target: 'production' });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /would send the branch "codex\/workbench-image-intake" to production/);
  assert.match(refused.message, /confirm_branch set to exactly "codex\/workbench-image-intake"/);
  assert.match(refused.message, /target "preview"/, 'the refusal names the way to test without touching production');
  assert.equal(decide({ event: D, ref: 'feature', confirm: 'featur' }).ok, false, 'a near miss is a miss');
  assert.equal(decide({ event: D, ref: 'feature', confirm: 'main' }).ok, false, 'confirming main does not confirm a branch');
  assert.deepEqual(decide({ event: D, ref: 'feature', confirm: ' feature ' }), { ok: true, mode: 'branch-production', deployBranch: 'main', branch: 'feature' });
});

test('a preview deploy goes to the preview alias from any branch; the Worker has no preview', () => {
  assert.deepEqual(decide({ event: D, ref: 'feature', target: 'preview' }), { ok: true, mode: 'preview', deployBranch: 'preview', branch: 'feature' });
  assert.equal(decide({ event: D, ref: 'main', target: 'preview' }).deployBranch, 'preview');
  assert.equal(decide({ event: D, ref: 'feature', target: 'preview', worker: true }).ok, false);
  const w = decide({ event: D, ref: 'feature', worker: true });
  assert.equal(w.ok, false);
  assert.match(w.message, /the live signup Worker/);
  assert.equal(decide({ event: D, ref: 'feature', confirm: 'feature', worker: true }).mode, 'branch-production');
});

test('anything else is refused: an unknown target, another event, no ref', () => {
  assert.equal(decide({ event: D, ref: 'main', target: 'staging' }).ok, false);
  assert.equal(decide({ event: 'schedule', ref: 'main' }).ok, false);
  assert.equal(decide({ event: 'repository_dispatch', ref: 'main' }).ok, false);
  assert.equal(decide({ event: D, ref: '' }).ok, false);
});

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const quietLog = () => { const lines = []; return { lines, log: (s) => lines.push(s), error: (s) => lines.push(s) }; };

test('runGuard writes the outputs the workflow reads, and fails with an ::error annotation on a refusal', () => {
  const out = path.join(tmp('gbti-guard-'), 'output');
  const ok = runGuard({ env: { EVENT_NAME: D, REF_NAME: 'feature', TARGET: 'preview', GITHUB_OUTPUT: out }, log: quietLog() });
  assert.equal(ok, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), 'mode=preview\ndeploy_branch=preview\nbranch=feature\n');
  const log = quietLog();
  const refusedOut = path.join(tmp('gbti-guard-'), 'output');
  const bad = runGuard({ env: { EVENT_NAME: D, REF_NAME: 'feature', TARGET: 'production', GITHUB_OUTPUT: refusedOut }, log });
  assert.equal(bad, 1);
  assert.match(log.lines.join('\n'), /^::error title=Deploy refused::/m);
  assert.equal(fs.existsSync(refusedOut), false, 'a refusal writes no outputs, so no later step can read a mode');
});

test('runStamp writes build.json, and a preview build gains exactly one noindex rule', () => {
  const dist = tmp('gbti-stamp-');
  fs.writeFileSync(path.join(dist, '_headers'), '/*\n  Content-Security-Policy: default-src \'self\'\n');
  const now = new Date('2026-09-14T12:00:00Z');
  runStamp({ env: { SHA: 'abc123def456', REF_NAME: 'main', MODE: 'production', RUN_ID: '9', RUN_URL: 'u' }, distDir: dist, now, log: quietLog() });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')),
    { commit: 'abc123def456', branch: 'main', target: 'production', mode: 'production', run: '9', runUrl: 'u', builtAt: '2026-09-14T12:00:00.000Z' });
  assert.doesNotMatch(fs.readFileSync(path.join(dist, '_headers'), 'utf8'), /X-Robots-Tag/, 'production is never noindexed');

  runStamp({ env: { SHA: 'abc', REF_NAME: 'feature', MODE: 'preview' }, distDir: dist, now, log: quietLog() });
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  assert.ok(headers.startsWith('/*\n  Content-Security-Policy'), 'the existing rules are kept');
  assert.ok(headers.endsWith(NOINDEX_RULE));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')).target, 'preview');
  assert.equal(withNoindex(headers), headers, 'stamping twice does not add a second rule');
});

test('the summary says a refused run deployed nothing', () => {
  assert.match(summaryMarkdown({ mode: '', branch: 'feature' }), /Refused before building: the branch `feature` was not deployed/);
  assert.match(summaryMarkdown({ mode: 'branch-production', branch: 'feature', sha: 'abc', outcome: 'success' }), /CONFIRMED branch deploy/);
});

test('announcements: a branch on production, a return to main, a preview; nothing for an ordinary main deploy', () => {
  const base = { branch: 'feature', sha: 'abc123def456', actor: 'gbtilabs', runUrl: 'https://github.com/x/actions/runs/1' };
  const branchProd = buildDeployMessage({ ...base, mode: 'branch-production' });
  assert.match(branchProd, /Production \(gbti\.network\) now runs the branch `feature`/);
  assert.match(branchProd, /`abc123de`/);
  assert.match(branchProd, /To put main back, run "Deploy to Cloudflare Pages" from main/);
  assert.match(buildDeployMessage({ ...base, mode: 'branch-production', worker: true }), /live signup Worker now runs the branch `feature`[\s\S]*"Deploy signup Worker" from main/);
  assert.match(buildDeployMessage({ ...base, mode: 'preview' }), /preview\.gbti\.network now serves the branch `feature`[\s\S]*Production is unchanged/);
  assert.match(buildDeployMessage({ ...base, branch: 'main', mode: 'production', prevRef: 'feature' }), /back on main[\s\S]*replacing the branch `feature`/);
  assert.equal(buildDeployMessage({ ...base, branch: 'main', mode: 'production', prevRef: 'main' }), null);
  assert.equal(buildDeployMessage({ ...base, branch: 'main', mode: 'production', prevRef: '' }), null, 'an unreadable live stamp is not a branch');
  assert.equal(buildDeployMessage({ ...base, branch: 'main', mode: 'production', prevRef: 'feature', worker: true }), null);
});

test('notifyDeploy posts to the channel, skips without a token, and never rejects', async () => {
  const posts = [];
  const createClient = () => ({ async postChannelMessage(ch, content) { posts.push({ ch, content }); } });
  const env = { MODE: 'branch-production', REF_NAME: 'feature', GITHUB_SHA: 'abc', GITHUB_ACTOR: 'a', DISCORD_BOT_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '5' };
  assert.equal(await notifyDeploy({ env, createClient, channelId: 'c1' }), 'posted: branch-production');
  assert.equal(posts[0].ch, 'c1');
  assert.match(posts[0].content, /https:\/\/github\.com\/o\/r\/actions\/runs\/5/);
  assert.match(await notifyDeploy({ env: { ...env, MODE: 'production', REF_NAME: 'main' }, createClient }), /^skipped: nothing to announce/);
  assert.match(await notifyDeploy({ env: { ...env, DISCORD_BOT_TOKEN: '' }, createClient }), /^skipped: DISCORD_BOT_TOKEN/);
  const throwing = () => ({ async postChannelMessage() { throw new Error('discord down'); } });
  assert.equal(await notifyDeploy({ env, createClient: throwing }), 'skipped: discord down');
});

test('readLiveRef reads the production stamp, and treats a preview stamp, a 404 or a failure as unknown', async () => {
  const json = (status, body) => async () => ({ ok: status === 200, status, async json() { return body; } });
  assert.equal(await readLiveRef({ fetchImpl: json(200, { branch: 'feature', target: 'production' }) }), 'feature');
  assert.equal(await readLiveRef({ fetchImpl: json(200, { branch: 'feature', target: 'preview' }) }), '');
  assert.equal(await readLiveRef({ fetchImpl: json(404, {}) }), '');
  assert.equal(await readLiveRef({ fetchImpl: async () => { throw new Error('offline'); } }), '');
});

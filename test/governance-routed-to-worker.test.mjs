// The five governance actions are served by the WORKER, not by a local writer (sow-213 Phase 2b), and as of
// sow-274 so is every other admin action.
//
// WHY THIS GUARD EXISTS. The local writer held a GitHub token and no KV credential, so it could write the git
// half of a ban or grant and could not write the KV half at all. A ban issued through it was therefore
// invisible to the paid oracle and the PR gate until the next scheduled mirror sync, up to six hours later,
// with nothing reporting the gap. Only the Worker holds SIGNUP_KV, and only the Worker can write the private
// moderation log.
//
// sow-274 REMOVED the local writers entirely, so the fall-through this guarded no longer exists to be taken.
// The routing tests at the foot changed accordingly: they used to assert that the governance branch came first,
// and now assert that there is no second branch on either host for anything to come before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { governanceAdminOp } from '../client/src/operations-admin.mjs';
import { OperationError } from '../client/src/operations-core.mjs';

const ROLES_YML = "superadmins:\n  - github_id: '1'\nadmins:\n  - github_id: '2'\nmoderators: []\n";

/** `calls` records every URL the op touches, so "went to the Worker" is asserted rather than assumed. */
// sow-213 Step 3: a successful member-status action is KV-native (no PR): the Worker returns kvWritten:true and
// no number/html_url. `role` alone still opens a PR; the tests that need it set their own response.
function ctxFor(calls, { response = { ok: true, kvWritten: true }, status = 200 } = {}) {
  return {
    identity: () => ({ username: 'admin', githubId: '2' }),
    reader: { readFile: async (p) => (p === 'house/roles.yml' ? ROLES_YML : '') },
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      return { ok: status < 400, status, async json() { return response; } };
    },
  };
}

test('sow-213: a ban goes to the Worker author endpoint, and touches GitHub directly NOT AT ALL', async () => {
  const calls = [];
  const r = await governanceAdminOp(ctxFor(calls), { action: 'ban', githubId: '555', reason: 'spam' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/membership\/admin\/author$/, 'the Worker, which holds SIGNUP_KV and writes the moderation log');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.action, 'ban');
  assert.equal(calls[0].body.githubId, '555');
  assert.equal(calls[0].body.reason, 'spam');
  assert.equal(/api\.github\.com/.test(calls[0].url), false, 'no direct git write from the local path');
  assert.equal(r.changed, true);
  assert.equal(r.prNumber, null, 'sow-213 Step 3: a KV-native ban opens no PR');
});

test('sow-213: a grandfather grant carries its tier through to the Worker', async () => {
  const calls = [];
  await governanceAdminOp(ctxFor(calls), { action: 'grandfather', githubId: '77', tier: 'creator', reason: 'comp' });
  assert.equal(calls[0].body.tier, 'creator', 'the phase 2a tier axis survives the reroute');
});

test('sow-213 Step 3: the Worker kvWritten:true is relayed on a KV-native success (behaviour change: no git-only state to distinguish)', async () => {
  // BEHAVIOUR CHANGE recorded, not quietly relaxed: Phase 2b returned kvWritten:false when the KV half failed
  // but the git half landed, so the caller could tell a dual-write from a git-only write. Step 3 deletes the git
  // half, so a member-status action is KV-only: on success the Worker reports kvWritten:true, and there is no
  // git-only state to signal. The client still relays the flag faithfully.
  const r = await governanceAdminOp(ctxFor([]), { action: 'ban', githubId: '555' });
  assert.equal(r.kvWritten, true);
});

test('sow-213 Step 3 CONTROL: a KV-native governance action opens NO PR, so prNumber is null', async () => {
  // The counterpart of the retired dual-write signal: with no git half, there is no PR to report.
  const r = await governanceAdminOp(ctxFor([]), { action: 'ban', githubId: '555' });
  assert.equal(r.prNumber, null);
});

test('sow-213: a Worker no-op is relayed as "no change" rather than as a phantom PR', async () => {
  const r = await governanceAdminOp(ctxFor([], { response: { ok: true, noop: true, message: 'no change (ban)' } }), { action: 'ban', githubId: '555' });
  assert.equal(r.changed, false);
  assert.equal(r.noop, true);
});

test('sow-213: a non-admin is refused locally BEFORE any Worker call', async () => {
  const calls = [];
  const ctx = ctxFor(calls);
  ctx.identity = () => ({ username: 'nobody', githubId: '999' });
  await assert.rejects(() => governanceAdminOp(ctx, { action: 'ban', githubId: '555' }), OperationError);
  assert.equal(calls.length, 0, 'the Worker re-checks anyway, but a rejected caller should not reach it');
});

test('sow-213: a Worker refusal surfaces as an error, never as a silent success', async () => {
  await assert.rejects(
    () => governanceAdminOp(ctxFor([], { status: 503, response: { message: 'the moderation log could not be written' } }), { action: 'ban', githubId: '555' }),
    (e) => e instanceof OperationError && /moderation log/.test(e.message),
  );
});

// ---- the routing itself, asserted against the extension dispatcher source ----
// Read from source in the same spirit as the route-parity manifest: the claim is about which branch a request
// takes, and a unit test that calls the op directly cannot observe that the dispatcher still prefers it.

const extDispatch = readFileSync(fileURLToPath(new URL('../extension/src/ext-dispatch.mjs', import.meta.url)), 'utf8');

const apiHost = readFileSync(fileURLToPath(new URL('../client/src/api.mjs', import.meta.url)), 'utf8');

test('every admin action on both hosts goes to the Worker, because neither host has anywhere else to send one', () => {
  for (const [name, src] of [['the extension', extDispatch], ['the website and command line host', apiHost]]) {
    // One table, imported rather than restated, so the two hosts cannot drift apart into different vocabularies.
    assert.match(src, /import \{ toWorkerRequest \} from '[^']*admin-worker-actions\.mjs'/, `${name} no longer reads the shared action table`);
    assert.match(src, /toWorkerRequest\(body \?\? \{\}\)/, `${name} no longer routes its admin body through the table`);
    assert.match(src, /governanceAdminOp\(ctx, \{ action: wreq\.action/, `${name} no longer sends the result to the Worker`);

    // And no second path: the table that used to hold the local writers, and the fall-through that reached it.
    assert.doesNotMatch(src, /ADMIN_ACTIONS\[/, `${name} has a local admin writer table again`);
    assert.doesNotMatch(src, /GOVERNANCE_ACTIONS/, `${name} sorts admin actions into routed and not-routed again`);
    assert.doesNotMatch(src, /WORKER_CONFIG_ACTIONS/, `${name} sorts admin actions into routed and not-routed again`);
  }
});

test('an action neither host knows is refused, so nothing falls back', () => {
  // Stated on the hosts rather than only on the table, because a host is free to ignore a null and carry on.
  assert.match(apiHost, /if \(!wreq\) return \{ status: 400/);
  assert.match(extDispatch, /if \(!wreq\) throw new OperationError\('bad-request'/);
});

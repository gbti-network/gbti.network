// sow-213 Phase 2b: the five governance actions are served by the WORKER, not by the local git-only writer.
//
// WHY THIS GUARD EXISTS. client/src/admin-ops.mjs holds a GitHub token and no KV credential, so it can write
// the git half of a ban or grant and cannot write the KV half at all. A ban issued through it was therefore
// invisible to the paid oracle and the PR gate until the next scheduled mirror sync, up to six hours later,
// with nothing reporting the gap. Only the Worker holds SIGNUP_KV, and only the Worker can write the private
// moderation log, so these five actions must not silently fall back to the local writer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { governanceAdminOp } from '../client/src/operations-admin.mjs';
import { OperationError } from '../client/src/operations-core.mjs';

const ROLES_YML = "superadmins:\n  - github_id: '1'\nadmins:\n  - github_id: '2'\nmoderators: []\n";

/** `calls` records every URL the op touches, so "went to the Worker" is asserted rather than assumed. */
function ctxFor(calls, { response = { ok: true, number: 42, html_url: 'https://x/pull/42', kvWritten: true, kvReason: null }, status = 200 } = {}) {
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
  assert.equal(r.prNumber, 42);
});

test('sow-213: a grandfather grant carries its tier through to the Worker', async () => {
  const calls = [];
  await governanceAdminOp(ctxFor(calls), { action: 'grandfather', githubId: '77', tier: 'creator', reason: 'comp' });
  assert.equal(calls[0].body.tier, 'creator', 'the phase 2a tier axis survives the reroute');
});

test('sow-213: kvWritten:false is PASSED THROUGH, so the caller can tell a dual-write from a git-only write', async () => {
  const calls = [];
  const r = await governanceAdminOp(ctxFor(calls, { response: { ok: true, number: 7, html_url: 'u', kvWritten: false, kvReason: 'the overrides mirror is absent or not an object' } }),
    { action: 'ban', githubId: '555' });
  assert.equal(r.kvWritten, false);
  assert.match(r.kvReason, /absent/);
});

test('sow-213 CONTROL: a successful dual-write reports kvWritten true, so the false above is a real signal', async () => {
  const r = await governanceAdminOp(ctxFor([]), { action: 'ban', githubId: '555' });
  assert.equal(r.kvWritten, true);
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

test('sow-213 routing: ext-dispatch sends the five governance actions to the Worker op', () => {
  const set = extDispatch.match(/const GOVERNANCE_ACTIONS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(set, 'GOVERNANCE_ACTIONS is declared');
  for (const a of ['ban', 'unban', 'grandfather', 'ungrandfather', 'role']) {
    assert.match(set[1], new RegExp(`'${a}'`), `${a} is routed to the Worker`);
  }
});

test('sow-213 routing: the governance branch is reached BEFORE the local ADMIN_ACTIONS fallback', () => {
  const branch = extDispatch.indexOf('GOVERNANCE_ACTIONS.has(body?.action)');
  const fallback = extDispatch.indexOf('const fn = ADMIN_ACTIONS[body?.action];');
  assert.ok(branch > 0 && fallback > 0, 'both branches are present');
  assert.ok(branch < fallback, 'a governance action must never fall through to the local git-only writer');
});

const apiHost = readFileSync(fileURLToPath(new URL('../client/src/api.mjs', import.meta.url)), 'utf8');

test('sow-213 routing: the npm/website host reroutes governance too, or the gap just moves hosts', () => {
  const set = apiHost.match(/const GOVERNANCE_ACTIONS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(set, 'GOVERNANCE_ACTIONS is declared in the website host');
  for (const a of ['ban', 'unban', 'grandfather', 'ungrandfather', 'role']) {
    assert.match(set[1], new RegExp(`'${a}'`), `${a} is routed to the Worker in the website host`);
  }
  const branch = apiHost.indexOf('GOVERNANCE_ACTIONS.has(body?.action)');
  const fallback = apiHost.indexOf('const fn = ADMIN_ACTIONS[body?.action];');
  assert.ok(branch > 0 && fallback > 0);
  assert.ok(branch < fallback, 'governance must not fall through to the local git-only writer');
});

test('sow-213 routing: BOTH hosts route the SAME five actions, so neither can drift', () => {
  const pick = (src) => (src.match(/const GOVERNANCE_ACTIONS = new Set\(\[([^\]]*)\]\)/)[1].match(/'[a-z]+'/g) || []).sort();
  assert.deepEqual(pick(extDispatch), pick(apiHost), 'the extension and website hosts must agree on the governance set');
});

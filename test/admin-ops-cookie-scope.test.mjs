// sow-161 A least-privilege: /membership/admin/ops fires FOUR actions off one map (reconcile, e2e,
// category-migrate, sync-mirror). The website categories workspace needs exactly ONE of them over a cookie
// session (category-migrate). This pins that only category-migrate accepts a cookie identity; reconcile (a full
// --apply), e2e and sync-mirror stay BEARER-ONLY even when the route enables cookies, and a BEARER caller still
// reaches all four (the gate is scoped, not a blanket block). Mutation check: drop `&& action === 'category-migrate'`
// (unconditional allowCookie) and the cookie-reconcile case flips from 401 to 200.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminOps } from '../workers/signup/membership-admin-ops.mjs';

// Mirrors resolveCaller's contract: a Bearer header authenticates regardless of allowCookie; a cookie (no bearer)
// authenticates ONLY when allowCookie is true; otherwise 401. This IS the property the scope relies on.
const authorize = async (request, env, { allowCookie } = {}) => {
  const bearer = /^Bearer\s/i.test(request.headers.get('authorization') || '');
  if (bearer) return { ok: true, githubId: '1', role: 'admin' };
  if (allowCookie) return { ok: true, githubId: '1', role: 'admin' };
  return { ok: false, status: 401, body: { error: 'unauthorized', message: 'a GitHub bearer token is required' } };
};
const fetchOk = async () => ({ ok: true, status: 204, json: async () => ({}) }); // repository_dispatch returns 204
const ENV = { REGATE_DISPATCH_TOKEN: 'tok', GITHUB_CONTENT_REPO: 'gbti-network/gbti.network' };
const MIGRATE_PARAMS = { action: 'rename', from: 'ai', newKey: 'ml' };

function req({ bearer = false, action, params } = {}) {
  const h = new Map();
  if (bearer) h.set('authorization', 'Bearer xyz');
  return { headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null }, json: async () => ({ action, ...(params ? { params } : {}) }) };
}
const run = (opts) => membershipAdminOps(req(opts), ENV, { authorize, fetch: fetchOk, allowCookie: true });

test('cookie identity: reconcile is REFUSED (bearer-only)', async () => {
  const r = await run({ action: 'reconcile' });
  assert.equal(r.status, 401, JSON.stringify(r.body));
});

test('cookie identity: e2e and sync-mirror are also REFUSED', async () => {
  assert.equal((await run({ action: 'e2e' })).status, 401);
  assert.equal((await run({ action: 'sync-mirror' })).status, 401);
});

test('cookie identity: category-migrate is ALLOWED and fires', async () => {
  const r = await run({ action: 'category-migrate', params: MIGRATE_PARAMS });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body?.triggered, 'category-migrate');
});

test('cookie identity: an INVALID action is refused (401 before the OPS check, so no enumeration oracle)', async () => {
  const r = await run({ action: 'definitely-not-an-op' });
  // 401 (auth path is bearer for a non-migrate action) rather than 400 (which would confirm the action is unknown).
  assert.equal(r.status, 401, JSON.stringify(r.body));
});

test('BEARER identity reaches all four (the gate is scoped, not a blanket block)', async () => {
  for (const action of ['reconcile', 'e2e', 'sync-mirror']) {
    assert.equal((await run({ bearer: true, action })).status, 200, action);
  }
  assert.equal((await run({ bearer: true, action: 'category-migrate', params: MIGRATE_PARAMS })).status, 200);
});

test('a BEARER caller with an unknown action gets 400 (authorized, then the OPS check rejects)', async () => {
  const r = await run({ bearer: true, action: 'nope' });
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

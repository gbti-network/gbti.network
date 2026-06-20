// SOW-038 P3: the admin-gated operations dispatch (reconcile / E2E-smoke). Fail-closed admin gate FIRST; an
// allow-list maps action -> repository_dispatch event_type (no arbitrary workflow/event); the dispatch token stays
// in the Worker. Pure over injected authorize/fetch; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminOps } from '../workers/signup/membership-admin-ops.mjs';

const req = (body) => ({ headers: { get: () => 'Bearer t' }, json: async () => body });
const okAuth = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const denyAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'admin access is required' } });
const ENV = { REGATE_DISPATCH_TOKEN: 'tok', GITHUB_CONTENT_REPO: 'gbti-network/gbti.network' };

test('admin-ops: a non-admin is forbidden BEFORE any dispatch', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: denyAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 403);
  assert.equal(called, false);
});

test('admin-ops: reconcile -> repository_dispatch "admin-reconcile" with NO github_id (full --apply), bot token', async () => {
  let sent = null;
  const fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return { status: 204 }; };
  const r = await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: okAuth, fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.triggered, 'reconcile');
  assert.match(sent.url, /\/repos\/gbti-network\/gbti\.network\/dispatches$/);
  assert.equal(sent.body.event_type, 'admin-reconcile');
  assert.equal(sent.body.client_payload.github_id, undefined); // NOT targeted -> reconcile runs a full --apply
  assert.equal(sent.body.client_payload.by, '1');
  assert.equal(sent.auth, 'Bearer tok'); // the Worker-held dispatch token, never the caller's
});

test('admin-ops: e2e -> "admin-e2e"', async () => {
  let evt = null;
  const r = await membershipAdminOps(req({ action: 'e2e' }), ENV, { authorize: okAuth, fetch: async (_u, init) => { evt = JSON.parse(init.body).event_type; return { status: 204 }; } });
  assert.equal(r.status, 200);
  assert.equal(evt, 'admin-e2e');
});

test('admin-ops: an unknown action -> 400 (allow-list), no dispatch', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'deploy' }), ENV, { authorize: okAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 400);
  assert.equal(called, false);
});

test('admin-ops: misconfigured (no dispatch token) -> 500, no dispatch (inert until provisioned)', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'reconcile' }), { GITHUB_CONTENT_REPO: 'x/y' }, { authorize: okAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 500);
  assert.equal(called, false);
});

test('admin-ops: a GitHub non-204 / network error -> 502', async () => {
  assert.equal((await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: okAuth, fetch: async () => ({ status: 422 }) })).status, 502);
  assert.equal((await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: okAuth, fetch: async () => { throw new Error('net'); } })).status, 502);
});

// SOW-005/SOW-015 reliability: the standalone overrides-mirror sync (scripts/sync-overrides-mirror.mjs) that a
// 6-hourly Action runs INDEPENDENTLY of the daily reconcile, so the Worker's effective-paid gating never goes
// stale because of an unrelated reconcile failure. Pure over injected deps (root, env, fetchImpl, now): the
// loadOverridesRaw read is real (the repo's own house/ files), the KV write is a fake fetch — no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncOverridesMirror } from '../scripts/sync-overrides-mirror.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const NOW = new Date('2026-06-17T00:00:00Z');

test('dry-run reports the blob it would write and touches nothing', async () => {
  let fetched = false;
  const r = await syncOverridesMirror({ root: ROOT, dryRun: true, now: NOW, fetchImpl: async () => { fetched = true; return { ok: true }; } });
  assert.equal(r.dryRun, true);
  assert.ok(r.bytes > 0);
  assert.ok(r.roles >= 1, 'the real house/roles.yml has at least one section'); // roles section is present
  assert.equal(r.generatedAt, '2026-06-17T00:00:00.000Z');
  assert.equal(fetched, false, 'a dry run never writes');
});

test('with CF credentials it PUTs the mirror to the KV REST API', async () => {
  // sow-213 Step 3: bans + grandfathered are KV-native now (the git files are deleted), so the writer PRESERVES
  // the existing KV sections rather than rebuilding from git. The read-before-write fake therefore returns an
  // EXISTING mirror; a 404 here would (correctly) ABORT the write, because writing an empty section over the live
  // one is the exact erase the preserve rule prevents. The PUT assertions are unchanged.
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (opts.method === 'PUT') return { ok: true, status: 200 };
    return { ok: true, status: 200, json: async () => ({ generatedAt: 'x', roles: {}, bans: { bans: [{ github_id: '7', source: 'kv' }] }, grandfathered: { grandfathered: [{ github_id: '11', source: 'kv' }] } }) };
  };
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const r = await syncOverridesMirror({ root: ROOT, env, now: NOW, fetchImpl });
  assert.equal(r.written, true);
  const captured = calls.find((c) => c.opts.method === 'PUT');
  assert.match(captured.url, /accounts\/acc\/storage\/kv\/namespaces\/ns\/values\/overrides%3Amirror$/);
  assert.equal(captured.opts.method, 'PUT');
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
});

test('missing CF credentials is reported as NOT written (the CLI turns this into a loud failure)', async () => {
  const r = await syncOverridesMirror({ root: ROOT, env: {}, now: NOW, fetchImpl: async () => { throw new Error('must not write'); } });
  assert.equal(r.written, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

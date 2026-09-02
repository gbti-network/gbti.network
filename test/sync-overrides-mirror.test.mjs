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
  // sow-213 Phase 2: the writer READS the current blob before writing, so KV-native bans are not erased.
  // The fake models that read (404 = the legitimate first write); the PUT assertions are unchanged.
  // Phase 3b changed what this fake has to model. It used to answer the read with 404, "the legitimate
  // first write", which was fine while git still owned both sections and could rebuild them. Now that
  // house/bans.yml and house/grandfathered.yml are deleted, git owns NOTHING, and no-git-plus-no-KV is
  // exactly the state the writer must REFUSE: there is no source for the sections, so writing would erase
  // them. That refusal is the Phase 3b safety property, not a broken test. The fake now returns the live
  // blob, which is the real production shape.
  const existingBlob = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    roles: {},
    bans: { bans: [] },
    grandfathered: { grandfathered: [{ github_id: '4242', tier: 'member', source: 'kv' }] },
  };
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (opts.method === 'PUT') return { ok: true, status: 200 };
      return { ok: true, status: 200, json: async () => existingBlob };
  };
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const r = await syncOverridesMirror({ root: ROOT, env, now: NOW, fetchImpl });
  assert.equal(r.written, true);
  const captured = calls.find((c) => c.opts.method === 'PUT');
  assert.match(captured.url, /accounts\/acc\/storage\/kv\/namespaces\/ns\/values\/overrides%3Amirror$/);
  assert.equal(captured.opts.method, 'PUT');
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
  // And the KV-only grant SURVIVED the write. Without this the test would pass on a writer that PUT an
  // empty blob to the right URL with the right header, which is precisely the erase 3b exists to prevent.
  const put = JSON.parse(captured.opts.body);
  assert.deepEqual(put.grandfathered.grandfathered, existingBlob.grandfathered.grandfathered);
});

test('missing CF credentials is reported as NOT written (the CLI turns this into a loud failure)', async () => {
  const r = await syncOverridesMirror({ root: ROOT, env: {}, now: NOW, fetchImpl: async () => { throw new Error('must not write'); } });
  assert.equal(r.written, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

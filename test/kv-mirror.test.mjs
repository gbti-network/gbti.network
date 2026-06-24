// SOW-015: the overrides-to-KV mirror written by the reconcile (so GET /membership/key can apply ban/staff/
// grandfather server-side). Verifies the blob shape, the no-credentials no-op, a successful PUT, and that an
// API error throws (so the reconcile fails the run). Injected fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverridesMirror, mirrorOverridesToKv, OVERRIDES_KV_KEY, mirrorSyndicationConfigToKv } from '../scripts/lib/kv-mirror.mjs';

const raw = { roles: { admins: [{ github_id: '4' }] }, bans: { bans: [{ github_id: '7' }] }, grandfathered: { grandfathered: [] } };
const NOW = new Date('2026-06-06T00:00:00Z');

test('buildOverridesMirror carries roles/bans/grandfathered + a generatedAt stamp', () => {
  const blob = buildOverridesMirror(raw, NOW);
  assert.equal(blob.generatedAt, '2026-06-06T00:00:00.000Z');
  assert.deepEqual(blob.roles, raw.roles);
  assert.deepEqual(blob.bans, raw.bans);
  assert.deepEqual(blob.grandfathered, raw.grandfathered);
});

test('buildOverridesMirror defaults missing files to empty objects', () => {
  const blob = buildOverridesMirror({}, NOW);
  assert.deepEqual(blob.roles, {});
  assert.deepEqual(blob.bans, {});
  assert.deepEqual(blob.grandfathered, {});
});

test('no-op (not written) when Cloudflare credentials are absent', async () => {
  const r = await mirrorOverridesToKv({ raw, env: {}, now: NOW, fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal(r.written, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('PUTs the blob to the KV REST API with bearer auth when configured', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200 }; };
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const r = await mirrorOverridesToKv({ raw, env, now: NOW, fetchImpl });
  assert.equal(r.written, true);
  assert.match(captured.url, /accounts\/acc\/storage\/kv\/namespaces\/ns\/values\/overrides%3Amirror$/);
  assert.equal(captured.opts.method, 'PUT');
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.generatedAt, '2026-06-06T00:00:00.000Z');
  assert.deepEqual(sent.bans, raw.bans);
});

test('throws on an API error so the reconcile fails the run', async () => {
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(mirrorOverridesToKv({ raw, env, now: NOW, fetchImpl }), /KV mirror write failed: 403/);
});

// SOW-058: the syndication-config mirror (so the drain reads house/syndication-config.yml live).
test('mirrorSyndicationConfigToKv is a no-op without CF creds', async () => {
  const r = await mirrorSyndicationConfigToKv({ raw: { syndication: { enabled: true } }, env: {}, fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal(r.written, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('mirrorSyndicationConfigToKv PUTs the normalized config (incl require_approval) to synd:config', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200 }; };
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const r = await mirrorSyndicationConfigToKv({ raw: { syndication: { enabled: true, channels: { discord: true } } }, env, fetchImpl });
  assert.equal(r.written, true);
  assert.match(captured.url, /values\/synd%3Aconfig$/);
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.require_approval, true); // the gate is carried into the mirror, defaulting safe
  assert.equal(sent.enabled, true);
  assert.equal(sent.channels.discord, true);
});

test('OVERRIDES_KV_KEY matches the Worker endpoint key', () => {
  assert.equal(OVERRIDES_KV_KEY, 'overrides:mirror');
});

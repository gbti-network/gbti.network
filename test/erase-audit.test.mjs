// SOW-024: the erasure AUDIT LOG. The record must EVIDENCE compliance without re-introducing personal data, so
// it is identity-minimal (github_id pseudonym only) and lives in the deletable edge store (KV), never git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditRecord, storeAuditRecord, sanitizeStep, deriveAuditStatus, AUDIT_KEY } from '../scripts/lib/erase-audit.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const NOW = new Date('2026-06-13T12:00:00.000Z');

test('buildAuditRecord is identity-minimal: github_id pseudonym only, no personal fields', () => {
  const rec = buildAuditRecord({
    githubId: 9, operator: 'hudson', apply: true, now: NOW,
    // a deliberately polluted step result: only whitelisted fields may survive
    steps: [{ step: 'discord', outcome: 'removed', detail: 'member', username: 'alice', email: 'a@b.c', discordUserId: 'u1' }],
  });
  assert.equal(rec.githubId, '9');
  assert.equal(rec.at, NOW.toISOString());
  assert.equal(rec.operator, 'hudson');
  assert.equal(rec.kind, 'erasure-audit');
  // the polluting fields are stripped
  const json = JSON.stringify(rec);
  assert.ok(!json.includes('alice'), 'no username');
  assert.ok(!json.includes('a@b.c'), 'no email');
  assert.ok(!json.includes('u1'), 'no discord id');
  assert.deepEqual(rec.steps[0], { step: 'discord', outcome: 'removed', detail: 'member' });
});

test('buildAuditRecord requires a github_id and a null operator stays null', () => {
  assert.throws(() => buildAuditRecord({ githubId: '', steps: [] }), /github_id is required/);
  assert.equal(buildAuditRecord({ githubId: 9, now: NOW }).operator, null);
});

test('sanitizeStep keeps only step/outcome/detail', () => {
  assert.deepEqual(sanitizeStep({ step: 'activity', outcome: 'deleted', key: 'activity:9', secret: 'x' }), { step: 'activity', outcome: 'deleted' });
});

test('deriveAuditStatus reflects the enacted steps', () => {
  assert.equal(deriveAuditStatus([{ outcome: 'deleted' }, { outcome: 'drafted' }]), 'complete');
  assert.equal(deriveAuditStatus([{ outcome: 'deleted' }, { outcome: 'error' }]), 'partial');
  assert.equal(deriveAuditStatus([{ outcome: 'error' }]), 'failed');
  assert.equal(deriveAuditStatus([{ outcome: 'skipped' }, { outcome: 'skipped' }]), 'noop'); // nothing enacted
});

test('storeAuditRecord PUTs to erasure-audit:<id>:<iso> with the bearer token', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true }; };
  const record = buildAuditRecord({ githubId: 9, now: NOW, steps: [{ step: 'activity', outcome: 'deleted' }] });
  const r = await storeAuditRecord({ record, env: CF, fetchImpl });
  assert.equal(r.recorded, true);
  assert.equal(seen.init.method, 'PUT');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.ok(seen.url.includes(encodeURIComponent(AUDIT_KEY('9', NOW.toISOString()))));
  assert.equal(JSON.parse(seen.init.body).githubId, '9');
});

test('storeAuditRecord is a reported no-op without CF creds (never silently succeeds)', async () => {
  const record = buildAuditRecord({ githubId: 9, now: NOW });
  const r = await storeAuditRecord({ record, env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.recorded, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('storeAuditRecord throws on a real API error', async () => {
  const record = buildAuditRecord({ githubId: 9, now: NOW });
  const fetchImpl = async () => ({ ok: false, status: 500, async text() { return 'boom'; } });
  await assert.rejects(() => storeAuditRecord({ record, env: CF, fetchImpl }), /audit record write failed: 500/);
});

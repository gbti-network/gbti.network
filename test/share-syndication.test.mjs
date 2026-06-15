// SOW-018: Discord syndication of PUBLIC Shares. The pure planner (public-only, idempotent, oldest-first,
// capped) + the message formatter + the runner's apply path (best-effort: only posted ids are recorded, a
// failed post is retried, members Shares are never posted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planShareSyndication, formatShareMessage } from '../scripts/lib/share-syndication.mjs';
import { main, readState } from '../scripts/syndicate-shares.mjs';

const share = (id, over = {}) => ({ id, author: 'a', status: 'published', visibility: 'public', createdAt: `2026-06-${id.slice(-2)}T00:00:00Z`, body: `note ${id}`, ...over });

test('planShareSyndication: public-only, not-yet-syndicated, oldest-first, capped', () => {
  const shares = [
    share('2026-10', { createdAt: '2026-10-01T00:00:00Z' }),
    share('2026-05', { createdAt: '2026-05-01T00:00:00Z' }),
    share('2026-09', { visibility: 'members', encryptedBody: 'x.enc' }), // members -> NEVER syndicated
    share('2026-07', { status: 'draft' }), // draft -> excluded
    share('2026-06', { createdAt: '2026-06-01T00:00:00Z' }),
  ];
  const { toPost, syndicated } = planShareSyndication({ shares, syndicated: ['2026-05'], limit: 50 });
  assert.deepEqual(toPost.map((s) => s.id), ['2026-06', '2026-10'], 'oldest-first, public only, drops the already-syndicated 2026-05 and the members/draft');
  assert.deepEqual(syndicated, ['2026-05', '2026-06', '2026-10']);
});

test('planShareSyndication: orders by createdAt only (an undated share never jumps ahead of dated ones by id)', () => {
  // Regression (review): the sort must key on createdAt, not fold the timestamp-slug id into the key — else an
  // undated share would mis-sort against ISO-dated ones. Undated groups together (deterministic id tie-break).
  const shares = [
    share('2026-03', { createdAt: '2026-03-01T00:00:00Z' }),
    share('20991231-undated', { createdAt: null }),
    share('2026-01', { createdAt: '2026-01-01T00:00:00Z' }),
  ];
  const { toPost } = planShareSyndication({ shares, syndicated: [] });
  // dated shares stay chronological; the undated one is grouped at the front (createdAt '' sorts first), never
  // interleaved by its id digits.
  assert.deepEqual(toPost.map((s) => s.id), ['20991231-undated', '2026-01', '2026-03']);
});

test('planShareSyndication: a members Share is never syndicated even if unseen', () => {
  const { toPost } = planShareSyndication({ shares: [share('2026-08', { visibility: 'members', encryptedBody: 'e.enc', body: '' })], syndicated: [] });
  assert.equal(toPost.length, 0);
});

test('planShareSyndication: re-run with the full set already syndicated is a no-op', () => {
  const shares = [share('2026-01'), share('2026-02')];
  const { syndicated } = planShareSyndication({ shares, syndicated: [] });
  const second = planShareSyndication({ shares, syndicated });
  assert.equal(second.toPost.length, 0);
});

test('formatShareMessage: truncates the body, includes author + link, never exceeds Discord limit', () => {
  const long = formatShareMessage({ author: 'alice', title: 'Hi', body: 'x'.repeat(5000), url: 'https://e.com' }, (a) => (a === 'alice' ? 'Alice' : a));
  assert.ok(long.includes('Alice'));
  assert.ok(long.includes('**Hi**'));
  assert.ok(long.length <= 2000);
  assert.match(long, /New Share from Alice/);
});

// Integration: the runner against a temp repo (no network in dry-run).
function tmpRepoWithShares() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-synd-'));
  const w = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), txt); };
  w('members/alice/shares/20260601000000-a.md', '---\ntype: share\nid: 20260601000000-a\nauthor: alice\nstatus: published\nvisibility: public\ncreatedAt: 2026-06-01T00:00:00Z\n---\n\npublic note\n');
  w('members/bob/shares/20260602000000-b.md', '---\ntype: share\nid: 20260602000000-b\nauthor: bob\nstatus: published\nvisibility: members\nencryptedBody: members/bob/_enc/share-20260602000000-b-body.enc\ncreatedAt: 2026-06-02T00:00:00Z\n---\n\n');
  fs.mkdirSync(path.join(root, 'house'), { recursive: true });
  return root;
}

test('runner dry-run: plans the public Share, posts nothing, writes no state', async () => {
  const root = tmpRepoWithShares();
  const r = await main({ argv: [], root, env: {} });
  assert.deepEqual(r.planned, ['20260601000000-a'], 'only the public Share is planned');
  assert.deepEqual(r.posted, []);
  assert.equal(fs.existsSync(path.join(root, 'house/shares-syndicated.yml')), false, 'dry-run writes no state');
  fs.rmSync(root, { recursive: true, force: true });
});

test('runner --apply: posts the public Share to Discord, records its id, never posts the members Share', async () => {
  const root = tmpRepoWithShares();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: init?.body }); return { ok: true, status: 200, text: async () => '{"id":"m1"}' }; };
  const env = { DISCORD_BOT_TOKEN: 'tok', DISCORD_SHARES_CHANNEL_ID: 'chan123' };
  const r = await main({ argv: ['--apply'], root, env, fetchImpl });
  assert.deepEqual(r.posted, ['20260601000000-a']);
  assert.equal(calls.length, 1, 'exactly one Discord post (the public Share; the members Share is skipped)');
  assert.match(calls[0].url, /\/channels\/chan123\/messages/);
  assert.deepEqual(readState(root), ['20260601000000-a'], 'the posted id is recorded for idempotency');
  // a second run is a no-op (already syndicated)
  const r2 = await main({ argv: ['--apply'], root, env, fetchImpl });
  assert.deepEqual(r2.posted, []);
  fs.rmSync(root, { recursive: true, force: true });
});

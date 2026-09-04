// sow-313: the purge that clears the KV left behind by upvoting and the SOW-126 popular promoter.
//
// This is a DESTRUCTIVE script against production KV, run by hand exactly once, and the two erasure steps that
// currently reach that data come out only after it is confirmed. So the properties worth pinning are the ones
// that decide whether the owner can TRUST the run: dry-run means dry-run, favorites and collections survive the
// activity rewrite, and a re-run reports zero rather than rewriting everything again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { main, stripUpvotes } from '../scripts/purge-retired-engagement.mjs';

const CF = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };

/** A fake CF KV REST API over a plain object. Records every mutating call. */
function mkKv(store) {
  const calls = { deleted: [], put: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url.includes('/keys?')) {
      const prefix = decodeURIComponent(new URL(url).searchParams.get('prefix') || '');
      const result = Object.keys(store).filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { ok: true, json: async () => ({ result, result_info: { cursor: '' } }) };
    }
    const key = decodeURIComponent(url.split('/values/')[1] || '');
    if (method === 'DELETE') { calls.deleted.push(key); delete store[key]; return { ok: true }; }
    if (method === 'PUT') { calls.put.push({ key, value: JSON.parse(init.body) }); store[key] = JSON.parse(init.body); return { ok: true }; }
    return { ok: true, json: async () => store[key] };
  };
  return { fetchImpl, calls };
}

const seed = () => ({
  'upvotes:share:alice/x': { voters: ['9'], author: null },
  'upvotes:share:bob/y': { voters: ['4', '7'], author: '4' },
  'content-opens:post:hello': { openers: ['9', '4'] },
  'activity:9': { favorites: [{ type: 'post', slug: 'a' }], upvotes: [{ type: 'share', slug: 'b/c' }], collections: [{ id: 'k', name: 'Keep', items: [] }], updatedAt: 5 },
  'activity:4': { favorites: [], collections: [], updatedAt: 6 }, // already clean
});

test('a DRY RUN counts everything and mutates NOTHING', async () => {
  // The whole value of a dry run is that the owner can believe it. A single stray delete here and the mode is
  // worthless, so this asserts on the CALLS rather than on the report.
  const store = seed();
  const { fetchImpl, calls } = mkKv(store);
  const r = await main({ argv: [], env: CF, fetchImpl, log: () => {} });
  assert.deepEqual(calls.deleted, [], 'a dry run must delete nothing');
  assert.deepEqual(calls.put, [], 'a dry run must write nothing');
  assert.equal(r.prefixes['upvotes:share:'], 2);
  assert.equal(r.prefixes['content-opens:'], 1);
  assert.equal(r.activity.carrying, 1, 'only activity:9 still carries an upvotes array');
  assert.equal(r.deleted, 0);
  assert.equal(r.stripped, 0);
  assert.deepEqual(Object.keys(store).sort(), Object.keys(seed()).sort(), 'the store is untouched');
});

test('--apply deletes both prefixes and strips ONLY the upvotes array', async () => {
  const store = seed();
  const { fetchImpl } = mkKv(store);
  const r = await main({ argv: ['--apply'], env: CF, fetchImpl, log: () => {} });
  assert.equal(r.deleted, 3, 'two vote sets and one opens set');
  assert.equal(r.stripped, 1);
  assert.deepEqual(Object.keys(store).sort(), ['activity:4', 'activity:9']);

  // THE INVARIANT THIS WHOLE CHANGE MUST NOT BREAK. The owner asked to keep favoriting and collections, and
  // they live in the same record as the array being removed, so a rewrite is exactly where they would be lost.
  const a9 = store['activity:9'];
  assert.deepEqual(a9.favorites, [{ type: 'post', slug: 'a' }], 'favorites must survive the rewrite');
  assert.deepEqual(a9.collections, [{ id: 'k', name: 'Keep', items: [] }], 'collections must survive the rewrite');
  assert.equal(a9.updatedAt, 5, 'nothing else in the record is touched');
  assert.ok(!('upvotes' in a9), 'and the retired array is gone');
});

test('a RE-RUN after the purge reports zero and rewrites nothing', async () => {
  // The exit baseline is this, not a number written into the SOW: re-run, everything reads 0. If a second
  // --apply still rewrote records, the first run did not converge and the "confirmed" signal would be false.
  const store = seed();
  const first = mkKv(store);
  await main({ argv: ['--apply'], env: CF, fetchImpl: first.fetchImpl, log: () => {} });
  const second = mkKv(store);
  const r = await main({ argv: ['--apply'], env: CF, fetchImpl: second.fetchImpl, log: () => {} });
  assert.equal(r.deleted, 0);
  assert.equal(r.stripped, 0);
  assert.equal(r.activity.carrying, 0);
  assert.deepEqual(second.calls.put, [], 'a converged store must take no further writes');
  assert.deepEqual(second.calls.deleted, []);
});

test('without CF credentials it is a reported no-op, never a throw', async () => {
  const { fetchImpl, calls } = mkKv(seed());
  const r = await main({ argv: ['--apply'], env: {}, fetchImpl, log: () => {} });
  assert.equal(r.deleted, 0);
  assert.deepEqual(calls.deleted, [], 'no creds must mean no calls, so a local run cannot touch production');
  assert.equal(r.prefixes['upvotes:share:'], null);
});

test('stripUpvotes is conservative about what it will touch', async () => {
  // It rewrites a record only when the key is actually present, which is what makes the re-run above a true
  // no-op rather than a full rewrite of every member record with the same bytes.
  assert.equal(stripUpvotes({ favorites: [] }).changed, false, 'a record with no upvotes key is left alone');
  assert.equal(stripUpvotes({ upvotes: [] }).changed, true, 'an EMPTY array still counts: the key is the thing being removed');
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.equal(stripUpvotes(bad).changed, false, `${JSON.stringify(bad)} is not a record and must not be rewritten`);
  }
});

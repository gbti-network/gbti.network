// SOW-057 (+ SOW-087): the paid-gated upvote handler + the per-target vote wrapper. SOW-087 RETIRED the
// upvote-threshold syndication trigger (shares enqueue at publish time), so a vote only records the count.
// Fake KV + injected paid gate. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleUpvote, recordShareVote, SHARE_VOTES_KEY } from '../workers/signup/membership-upvote.mjs';
import { ACTIVITY_KEY } from '../workers/signup/membership-activity.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}
const at = (t) => () => t;
function req(body, { token = 'tok' } = {}) {
  return { method: 'POST', headers: { get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : null) }, async json() { return body; } };
}
const paidAs = (githubId, login) => async () => ({ ok: true, githubId, login });

// ---- the vote wrapper (recordShareVote) ----

test('recordShareVote: counts distinct non-author voters and NEVER enqueues (SOW-087)', async () => {
  const kv = fakeKV();
  const opts = { kv, now: at(1) };
  let r = await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'alice', id: 'note', on: true }, opts);
  assert.equal(r.count, 1);
  assert.equal(r.enqueued, false);
  r = await recordShareVote({}, { voterId: 'v2', voterLogin: 'v2', author: 'alice', id: 'note', on: true }, opts);
  assert.equal(r.count, 2);
  assert.equal(r.enqueued, false); // publish-time enqueue now; the threshold no longer triggers anything
  // the voter set persisted under the share key
  const record = JSON.parse(kv.store.get(SHARE_VOTES_KEY('alice', 'note')));
  assert.equal(Object.keys(record.voters).length, 2);
});

test('recordShareVote: the author own upvote does not count toward the visible count', async () => {
  const kv = fakeKV();
  const opts = { kv, now: at(1) };
  // the author upvotes their own share (login matches the slug author) -> excluded
  await recordShareVote({}, { voterId: 'aId', voterLogin: 'Alice', author: 'alice', id: 'n', on: true }, opts);
  let r = await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'alice', id: 'n', on: true }, opts);
  assert.equal(r.count, 1); // only the one non-author voter
  r = await recordShareVote({}, { voterId: 'v2', voterLogin: 'v2', author: 'alice', id: 'n', on: true }, opts);
  assert.equal(r.count, 2);
});

test('recordShareVote: a pre-SOW-087 enqueuedAt watermark is surfaced read-only', async () => {
  const kv = fakeKV({ [SHARE_VOTES_KEY('a', 'n')]: JSON.stringify({ voters: { v0: 1 }, enqueuedAt: 123 }) });
  const r = await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'a', id: 'n', on: true }, { kv, now: at(9) });
  assert.equal(r.enqueued, true); // historical stamp preserved, never re-created
});

// ---- the handler (handleUpvote) ----

test('handleUpvote: 403 when not paid', async () => {
  const kv = fakeKV();
  const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
  const r = await handleUpvote(req({ slug: 'alice/note', on: true }), {}, { kv, authorize: denied, recordVote: async () => ({ count: 0, enqueued: false }) });
  assert.equal(r.status, 403);
});

test('handleUpvote: a paid member records the per-member upvote + per-target vote and returns the count', async () => {
  const kv = fakeKV();
  const r = await handleUpvote(req({ slug: 'alice/note', on: true }), {}, {
    kv, now: at(5),
    authorize: paidAs('42', 'voter'),
    recordVote: async () => ({ count: 2, enqueued: true }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.upvoted, true);
  assert.equal(r.body.upvoteCount, 2);
  assert.equal(r.body.enqueued, true);
  // the per-member upvote persisted under the activity key
  const activity = JSON.parse(kv.store.get(ACTIVITY_KEY('42')));
  assert.equal(activity.upvotes.length, 1);
  assert.equal(activity.upvotes[0].slug, 'alice/note');
});

test('handleUpvote: a bad slug or non-share type is a 400', async () => {
  const kv = fakeKV();
  const deps = { kv, authorize: paidAs('42', 'voter'), recordVote: async () => ({ count: 0, enqueued: false }) };
  assert.equal((await handleUpvote(req({ slug: 'no-slash', on: true }), {}, deps)).status, 400);
  assert.equal((await handleUpvote(req({ type: 'post', slug: 'a/b', on: true }), {}, deps)).status, 400);
});

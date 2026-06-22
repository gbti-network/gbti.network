// SOW-057: the paid-gated upvote handler + the per-target vote wrapper. Fake KV + injected paid gate + injected
// share-metadata resolver + injected enqueue. No network, no secrets.
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
const enabledCfg = { enabled: true, hold_minutes: 60, upvote_threshold: 2, channels: { discord: true } };

// ---- the vote wrapper (recordShareVote) ----

test('recordShareVote: two distinct non-author voters enqueue exactly once', async () => {
  const kv = fakeKV();
  const enqueued = [];
  const enqueueImpl = async (env, item) => { enqueued.push(item); return { enqueued: true, id: 'x' }; };
  const resolveShareMeta = async () => ({ status: 'published', url: 'https://ex.com/a', title: 'T', visibility: 'public' });
  const opts = { kv, now: at(1), cfg: enabledCfg, enqueueImpl, resolveShareMeta };

  let r = await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'alice', id: 'note', on: true }, opts);
  assert.equal(r.count, 1);
  assert.equal(r.enqueued, false);
  assert.equal(enqueued.length, 0);

  r = await recordShareVote({}, { voterId: 'v2', voterLogin: 'v2', author: 'alice', id: 'note', on: true }, opts);
  assert.equal(r.count, 2);
  assert.equal(r.enqueued, true);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].url, 'https://ex.com/a');
  assert.equal(enqueued[0].source, 'share');

  // a third voter does NOT re-enqueue (watermark)
  r = await recordShareVote({}, { voterId: 'v3', voterLogin: 'v3', author: 'alice', id: 'note', on: true }, opts);
  assert.equal(enqueued.length, 1);
});

test('recordShareVote: the author own upvote does not count toward the threshold', async () => {
  const kv = fakeKV();
  const enqueued = [];
  const opts = {
    kv, now: at(1), cfg: enabledCfg,
    enqueueImpl: async (e, item) => { enqueued.push(item); return { enqueued: true }; },
    resolveShareMeta: async () => ({ status: 'published', url: 'https://ex.com/a', visibility: 'public' }),
  };
  // the author upvotes their own share (login matches the slug author) -> excluded
  await recordShareVote({}, { voterId: 'aId', voterLogin: 'Alice', author: 'alice', id: 'n', on: true }, opts);
  let r = await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'alice', id: 'n', on: true }, opts);
  assert.equal(r.count, 1); // only the one non-author voter
  assert.equal(enqueued.length, 0);
  r = await recordShareVote({}, { voterId: 'v2', voterLogin: 'v2', author: 'alice', id: 'n', on: true }, opts);
  assert.equal(r.count, 2);
  assert.equal(enqueued.length, 1);
});

test('recordShareVote: syndication disabled never enqueues', async () => {
  const kv = fakeKV();
  let called = false;
  const opts = {
    kv, now: at(1), cfg: { enabled: false, upvote_threshold: 2 },
    enqueueImpl: async () => { called = true; return {}; },
    resolveShareMeta: async () => ({ status: 'published', url: 'https://ex.com', visibility: 'public' }),
  };
  await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'a', id: 'n', on: true }, opts);
  await recordShareVote({}, { voterId: 'v2', voterLogin: 'v2', author: 'a', id: 'n', on: true }, opts);
  assert.equal(called, false);
});

test('recordShareVote: a draft share is not enqueued, and persists for a later retry', async () => {
  const kv = fakeKV();
  let called = false;
  const opts = {
    kv, now: at(1), cfg: enabledCfg,
    enqueueImpl: async () => { called = true; return {}; },
    resolveShareMeta: async () => ({ status: 'draft', url: 'https://ex.com', visibility: 'public' }),
  };
  await recordShareVote({}, { voterId: 'v1', voterLogin: 'v1', author: 'a', id: 'n', on: true }, opts);
  const r = await recordShareVote({}, { voterId: 'v2', voterLogin: 'v2', author: 'a', id: 'n', on: true }, opts);
  assert.equal(called, false);
  assert.equal(r.enqueued, false); // not stamped -> a later vote can retry once published
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

// SOW-089: the comments index — the row builder, the ops fast path (index-first with the reader fallback,
// alias union, gate + echo composition), and the Worker trial carve-out for comment envelopes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCommentIndexRow, isPublishedComment } from '../src/lib/comments-index.mjs';
import { listComments, _resetCommentsIndexCache } from '../client/src/operations.mjs';
import { membershipDecrypt } from '../workers/signup/membership-content.mjs';
import { encryptAsset, generateEpochKey } from '../client/src/crypto-assets.mjs';

test('toCommentIndexRow: public bodies ship; members rows withhold the body and carry the pointer', () => {
  const pub = toCommentIndexRow({ body: 'Hello thread', data: { id: 'c1', author: 'alice', targetType: 'prompt', targetSlug: 'x', createdAt: '2026-07-01', authorNote: false } });
  assert.equal(pub.body, 'Hello thread');
  assert.equal(pub.path, 'members/alice/comments/c1.md');
  assert.equal(pub.encryptedBody, null);
  const mem = toCommentIndexRow({ body: 'SECRET', data: { id: 'c2', author: 'bob', targetType: 'post', targetSlug: 'y', visibility: 'members', encryptedBody: 'members/bob/_enc/comment-c2-body.enc', createdAt: '2026-07-02' } });
  assert.equal(mem.body, '');
  assert.equal(mem.encryptedBody, 'members/bob/_enc/comment-c2-body.enc');
  const house = toCommentIndexRow({ body: 'Intro', data: { id: 'intro-x', author: 'gbti', targetType: 'prompt', targetSlug: 'x', authorNote: true, createdAt: '2026-07-01' } });
  assert.equal(house.path, 'house/comments/intro-x.md');
  assert.equal(house.authorNote, true);
  assert.equal(isPublishedComment({ data: {} }), true); // missing status = published
  assert.equal(isPublishedComment({ data: { status: 'draft' } }), false);
});

const INDEX = {
  items: [
    { id: 'c1', author: 'alice', targetType: 'prompt', targetSlug: 'new-name', visibility: 'public', createdAt: '2026-07-02T00:00:00Z', body: 'newer', path: 'members/alice/comments/c1.md' },
    { id: 'c0', author: 'bob', targetType: 'prompt', targetSlug: 'old-name', visibility: 'public', createdAt: '2026-07-01T00:00:00Z', body: 'older (pre-rename)', path: 'members/bob/comments/c0.md' },
    { id: 'c9', author: 'zed', targetType: 'post', targetSlug: 'new-name', visibility: 'public', createdAt: '2026-07-03T00:00:00Z', body: 'other type', path: 'members/zed/comments/c9.md' },
    { id: 'cm', author: 'mem', targetType: 'prompt', targetSlug: 'new-name', visibility: 'members', createdAt: '2026-07-04T00:00:00Z', body: '', encryptedBody: 'members/mem/_enc/comment-cm-body.enc', path: 'members/mem/comments/cm.md' },
  ],
};

function ctxFor({ fetchImpl, membership = 'paid', walk = null } = {}) {
  return {
    identity: () => ({ username: 'alice' }),
    membership: async () => membership,
    fetch: fetchImpl,
    store: { get: () => null }, // no token -> the echo merge short-circuits
    reader: walk ? { listComments: walk } : {},
  };
}

test('listComments consumes the index: type + alias union, oldest-first, member gating by tier', async () => {
  _resetCommentsIndexCache();
  const fetchImpl = async () => ({ ok: true, json: async () => INDEX });
  const r = await listComments(ctxFor({ fetchImpl }), { targetType: 'prompt', targetSlug: 'new-name', aliases: ['old-name'] });
  assert.deepEqual(r.items.map((c) => c.id), ['c0', 'c1', 'cm']); // oldest first, alias row included, post row excluded
  _resetCommentsIndexCache();
  const free = await listComments(ctxFor({ fetchImpl, membership: 'none' }), { targetType: 'prompt', targetSlug: 'new-name', aliases: ['old-name'] });
  assert.deepEqual(free.items.map((c) => c.id), ['c0', 'c1']); // members stub gated for non-members
});

test('listComments falls back to the reader walk when the index fetch fails', async () => {
  _resetCommentsIndexCache();
  const walk = async () => [{ id: 'w1', author: 'alice', targetType: 'prompt', targetSlug: 'x', visibility: 'public', createdAt: '2026-07-01T00:00:00Z', body: 'walked' }];
  const r = await listComments(ctxFor({ fetchImpl: async () => ({ ok: false, status: 500 }), walk }), { targetType: 'prompt', targetSlug: 'x' });
  assert.deepEqual(r.items.map((c) => c.id), ['w1']);
  _resetCommentsIndexCache();
});

// ---- the Worker tier rule (SOW-089): comment envelopes join the share trial carve-out; content stays paid.
// The worker-membership-content harness pattern: inject fetchUser + Stripe; REAL envelopes prove full decrypt.
const KEY = generateEpochKey();
const freshMirror = (over = {}) => ({ generatedAt: new Date().toISOString(), roles: {}, bans: over.bans ?? { bans: [] }, grandfathered: { grandfathered: [] } });
const ENV = (mirror = freshMirror()) => ({ STRIPE_SECRET_KEY: 'rk_test', MEMBER_CONTENT_KEY: KEY, MEMBER_CONTENT_KID: '1', SIGNUP_KV: { get: async (k) => (k === 'overrides:mirror' ? mirror : null) } });
const CUSTOMERS = {
  paid: { id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1 }] } },
  trialing: { id: 'c', metadata: { github_id: '1', trial_started_at: new Date(Date.now() - 5 * 86400e3).toISOString() }, subscriptions: { data: [] } },
  expired: { id: 'c', metadata: { github_id: '1', trial_started_at: new Date(Date.now() - 120 * 86400e3).toISOString() }, subscriptions: { data: [] } },
};
const depsFor = (kind) => ({ fetchUser: async () => ({ githubId: '1', githubLogin: 'u1' }), makeStripe: () => ({ findCustomerByGithubId: async () => CUSTOMERS[kind] ?? null }) });
const POST = (body) => new Request('https://signup.gbti.network/membership/decrypt', { method: 'POST', headers: { Authorization: 'Bearer g' }, body: JSON.stringify(body) });

test('decrypt tiers: trial reads comment + share envelopes fully, never content; banned/expired locked', async () => {
  const commentEnv = await encryptAsset({ plaintext: 'member reply', key: KEY, assetId: 'comment:c1:body', kid: '1' });
  const shareEnv = await encryptAsset({ plaintext: 'a share', key: KEY, assetId: 'share:s1:body', kid: '1' });
  const contentEnv = await encryptAsset({ plaintext: 'paid body', key: KEY, assetId: 'prompt:x:body', kid: '1' });
  // trial fully decrypts comment + share envelopes
  const c = await membershipDecrypt(POST(commentEnv), ENV(), depsFor('trialing'));
  assert.equal(c.status, 200);
  assert.equal(c.body.text, 'member reply');
  assert.equal((await membershipDecrypt(POST(shareEnv), ENV(), depsFor('trialing'))).status, 200);
  // trial is refused CONTENT at the gate
  assert.equal((await membershipDecrypt(POST(contentEnv), ENV(), depsFor('trialing'))).status, 403);
  // paid decrypts content as before
  assert.equal((await membershipDecrypt(POST(contentEnv), ENV(), depsFor('paid'))).status, 200);
  // a banned account is locked even for comments (the mirror ban overrides)
  const banned = ENV(freshMirror({ bans: { bans: [{ github_id: '1' }] } }));
  assert.equal((await membershipDecrypt(POST(commentEnv), banned, depsFor('paid'))).status, 403);
  // an expired trial is locked
  assert.equal((await membershipDecrypt(POST(commentEnv), ENV(), depsFor('expired'))).status, 403);
  // a content envelope RELABELED as a comment fails GCM (422): the carve-out cannot be forged
  const forged = { ...contentEnv, aad: 'comment:x:body' };
  assert.equal((await membershipDecrypt(POST(forged), ENV(), depsFor('trialing'))).status, 422);
});

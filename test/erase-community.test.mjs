// sow-494: the erasure step for Community. It calls the Worker's superadmin route with the operator's own GitHub token;
// here a fake fetch runs the REAL admin handler, object op table and store, so the test proves the member's data is
// gone from the store itself, not only that a request was sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseCommunity, COMMUNITY_TOKEN_ENV } from '../scripts/lib/erase-community.mjs';
import { planErasure } from '../scripts/lib/erase-member.mjs';
import { membershipAdminCommunity } from '../workers/signup/membership-community.mjs';
import { runOp, encodeRpc, decodeRpc } from '../workers/signup/community-do.mjs';
import { makeStore, SUPER, PRIYA, BEN, PNG } from './lib/community-sqlite.mjs';

function wired(store, { superToken = 'tok-super' } = {}) {
  const seen = [];
  const call = async (_e, msg, bytes) => { const f = decodeRpc(encodeRpc(msg, bytes)); return runOp(store, f.msg, f.bytes); };
  const superadmin = async (request) => (request.headers.get('Authorization') === `Bearer ${superToken}`
    ? { ok: true, viewer: SUPER } : { ok: false, status: 401, body: { error: 'unauthorized', message: 'could not verify the GitHub token' } });
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    const r = await membershipAdminCommunity(new Request(url, init), {}, { call, superadmin });
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { fetchImpl, seen };
}

test('with a superadmin token the member\'s Community data is erased in the store', async () => {
  const { store } = makeStore();
  const poll = store.createEntry(SUPER, { kind: 'typed', title: 'Movie?' }, { open: true }).id;
  const topic = store.createEntry(SUPER, { kind: 'topic', title: 'Desks', access: { mode: 'chosen', members: [PRIYA.githubId, BEN.githubId] } }, { open: true }).id;
  store.answer(PRIYA, poll, { text: 'Arrival' });
  const img = store.putImage(PRIYA, topic, { name: 'desk.png', contentType: 'image/png', bytes: PNG }).id;
  const p = store.post(PRIYA, topic, { body: 'My desk', images: [img] }).id;
  store.post(BEN, topic, { body: 'Nice', parentId: p });
  const { fetchImpl, seen } = wired(store);
  const r = await eraseCommunity({ githubId: PRIYA.githubId, env: { [COMMUNITY_TOKEN_ENV]: 'tok-super', GBTI_SIGNUP_BASE: 'https://signup.example/' }, fetchImpl });
  assert.deepEqual(r, { deleted: true });
  assert.equal(seen[0].url, 'https://signup.example/membership/admin/community');
  assert.deepEqual(seen[0].body, { op: 'erase-member', githubId: PRIYA.githubId });
  const view = store.getEntry(SUPER, topic);
  assert.equal(view.discussion.posts[0].deleted, true, 'her post is a placeholder');
  assert.equal(view.discussion.posts[0].author, null);
  assert.equal(view.discussion.posts[0].replies[0].body, 'Nice', 'and the reply under it still reads');
  assert.deepEqual(view.entry.access.members.map((m) => m.githubId), [BEN.githubId], 'her access grant is gone');
  assert.equal(store.getEntry(SUPER, poll).results.total, 0, 'her answer is gone');
  const again = await eraseCommunity({ githubId: PRIYA.githubId, env: { [COMMUNITY_TOKEN_ENV]: 'tok-super' }, fetchImpl });
  assert.deepEqual(again, { deleted: false, reason: 'nothing in Community' });
});

test('without a token the step is incomplete, never a quiet skip, and nothing is sent', async () => {
  const { store } = makeStore();
  const { fetchImpl, seen } = wired(store);
  const r = await eraseCommunity({ githubId: PRIYA.githubId, env: {}, fetchImpl });
  assert.equal(r.incomplete, true);
  assert.match(r.reason, new RegExp(COMMUNITY_TOKEN_ENV));
  assert.equal(seen.length, 0);
});

test('a refused token comes back as an error the audit records', async () => {
  const { store } = makeStore();
  const { fetchImpl } = wired(store);
  const r = await eraseCommunity({ githubId: PRIYA.githubId, env: { [COMMUNITY_TOKEN_ENV]: 'tok-not-a-superadmin' }, fetchImpl });
  assert.match(r.error, /refused \(401\)/);
});

test('the written plan names the Community step and the token it needs', () => {
  const step = planErasure({ githubId: '9', username: 'alice' }).find((s) => s.step === 'community');
  assert.ok(step && step.auto);
  assert.match(step.action, new RegExp(COMMUNITY_TOKEN_ENV));
  assert.doesNotMatch(step.action, /[—–]/);
});

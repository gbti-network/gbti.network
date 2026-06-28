// SOW-076 P1b: the comment-echo edge endpoint. Fake KV + injected authorize -> no network. Verifies read-your-writes,
// author-from-token (never the body), reap-only-your-own, validation, and the TTL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCommentEcho, ECHO_KEY, ECHO_TTL_SECONDS } from '../workers/signup/membership-comment-echo.mjs';

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial)); const puts = [];
  return { m, puts, async get(k, t) { const v = m.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v, o) { m.set(k, v); puts.push({ k, o }); } };
}
const req = (method, { body, query = '' } = {}) => ({ method, url: `https://x/membership/comment-echo${query}`, headers: { get: () => 'Bearer t' }, async json() { if (body === undefined) throw new Error('no body'); return body; } });
const asMember = (id) => async () => ({ ok: true, githubId: id });
const now = () => 1000;
const echo = (id, extra = {}) => ({ id, targetType: 'post', targetSlug: 'a', body: id, prNumber: 7, ...extra });

test('POST add stores the echo under commentecho:<type>:<slug> with the TTL; author comes from the TOKEN', async () => {
  const kv = fakeKv();
  const r = await handleCommentEcho(req('POST', { body: { action: 'add', echo: echo('e1', { author: 'SPOOF' }) } }), {}, { kv, authorize: asMember('alice'), now });
  assert.equal(r.status, 200);
  const rec = JSON.parse(kv.m.get(ECHO_KEY('post', 'a')));
  assert.equal(rec.echoes[0].id, 'e1');
  assert.equal(rec.echoes[0].author, 'alice'); // the spoofed body author is ignored
  assert.equal(kv.puts[0].o.expirationTtl, ECHO_TTL_SECONDS);
});

test('GET is read-your-writes: a member sees only their OWN echoes for the thread', async () => {
  const kv = fakeKv({ [ECHO_KEY('post', 'a')]: JSON.stringify({ echoes: [
    { id: 'e1', author: 'alice', targetType: 'post', targetSlug: 'a', body: 'a', postedAt: 2 },
    { id: 'e2', author: 'bob', targetType: 'post', targetSlug: 'a', body: 'b', postedAt: 1 },
  ] }) });
  const r = await handleCommentEcho(req('GET', { query: '?targetType=post&targetSlug=a' }), {}, { kv, authorize: asMember('alice') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.echoes.map((e) => e.id), ['e1']); // not bob's e2
});

test('POST reap removes only the requester\'s OWN echoes', async () => {
  const kv = fakeKv({ [ECHO_KEY('post', 'a')]: JSON.stringify({ echoes: [
    { id: 'e1', author: 'alice', targetType: 'post', targetSlug: 'a', body: 'a', postedAt: 2 },
    { id: 'e2', author: 'bob', targetType: 'post', targetSlug: 'a', body: 'b', postedAt: 1 },
  ] }) });
  await handleCommentEcho(req('POST', { body: { action: 'reap', targetType: 'post', targetSlug: 'a', ids: ['e1', 'e2'] } }), {}, { kv, authorize: asMember('alice'), now });
  const rec = JSON.parse(kv.m.get(ECHO_KEY('post', 'a')));
  assert.deepEqual(rec.echoes.map((e) => e.id), ['e2']); // bob's survives alice's reap
});

test('validation: a bad target / unknown action / missing KV / non-GET-POST', async () => {
  const kv = fakeKv();
  assert.equal((await handleCommentEcho(req('GET', { query: '?targetType=page&targetSlug=a' }), {}, { kv, authorize: asMember('a') })).status, 400);
  assert.equal((await handleCommentEcho(req('POST', { body: { action: 'add', echo: { id: 'e', targetType: 'post' } } }), {}, { kv, authorize: asMember('a'), now })).status, 400);
  assert.equal((await handleCommentEcho(req('POST', { body: { action: 'nope' } }), {}, { kv, authorize: asMember('a'), now })).status, 400);
  assert.equal((await handleCommentEcho(req('GET', { query: '?targetType=post&targetSlug=a' }), {}, { kv: null, authorize: asMember('a') })).status, 500);
  assert.equal((await handleCommentEcho(req('DELETE'), {}, { kv, authorize: asMember('a') })).status, 405);
});

test('a denied caller (banned / unauthorized) is passed through', async () => {
  const r = await handleCommentEcho(req('GET', { query: '?targetType=post&targetSlug=a' }), {}, { kv: fakeKv(), authorize: async () => ({ ok: false, status: 403, body: { error: 'forbidden' } }) });
  assert.equal(r.status, 403);
});

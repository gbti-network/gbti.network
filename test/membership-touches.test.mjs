// SOW-059 P1b: the pre-signup touch-capture Worker endpoint. Fake KV + fake request -> no network, no secrets.
// Verifies the anonymous session keying, consent-gating of content touches, the always-on invite capture, the
// validation, the TTL, and the read/erase helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTouch, readTouches, eraseTouches, TOUCH_KEY, TOUCH_TTL_SECONDS } from '../workers/signup/membership-touches.mjs';

const SESSION = 'sess_abcDEF0123456789'; // matches the 16-128 char id rule
function fakeKV() {
  const store = new Map(); const puts = [];
  return {
    store, puts,
    async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v, opts) { store.set(k, v); puts.push({ k, opts }); },
    async delete(k) { store.delete(k); },
  };
}
const req = (body) => ({ method: 'POST', async json() { if (body === undefined) throw new Error('no body'); return body; } });
const now = () => 1000;

test('records a content touch WITH consent; persists under touch:<session> with the attribution-window TTL', async () => {
  const kv = fakeKV();
  const r = await handleTouch(req({ session: SESSION, touch: { owner: 'alice', type: 'post', slug: 'a' }, consent: true }), {}, { kv, now });
  assert.equal(r.status, 200); assert.equal(r.body.recorded, true);
  const stored = JSON.parse(kv.store.get(TOUCH_KEY(SESSION)));
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].owner, 'alice');
  assert.equal(kv.puts[0].opts.expirationTtl, TOUCH_TTL_SECONDS); // self-expires at the 90-day window
});

test('a content touch WITHOUT consent is NOT recorded (the GDPR gate)', async () => {
  const kv = fakeKV();
  const r = await handleTouch(req({ session: SESSION, touch: { owner: 'alice', type: 'post', slug: 'a' } }), {}, { kv, now });
  assert.equal(r.status, 200); assert.equal(r.body.recorded, false); assert.equal(r.body.reason, 'no_consent');
  assert.equal(kv.store.has(TOUCH_KEY(SESSION)), false); // nothing stored
});

test('the invite code is recorded REGARDLESS of consent (essential referral signal, first-wins)', async () => {
  const kv = fakeKV();
  await handleTouch(req({ session: SESSION, invite: 'alice-code' }), {}, { kv, now });
  let stored = JSON.parse(kv.store.get(TOUCH_KEY(SESSION)));
  assert.equal(stored.invite, 'alice-code');
  // a later invite does not override
  await handleTouch(req({ session: SESSION, invite: 'bob-code' }), {}, { kv, now });
  stored = JSON.parse(kv.store.get(TOUCH_KEY(SESSION)));
  assert.equal(stored.invite, 'alice-code');
});

test('invite + consented touch in one call both apply', async () => {
  const kv = fakeKV();
  const r = await handleTouch(req({ session: SESSION, invite: 'carol-code', touch: { owner: 'bob', type: 'prompt', slug: 'b' }, consent: true }), {}, { kv, now });
  assert.equal(r.body.recorded, true);
  const stored = JSON.parse(kv.store.get(TOUCH_KEY(SESSION)));
  assert.equal(stored.invite, 'carol-code'); assert.equal(stored.items[0].owner, 'bob');
});

test('rejects a missing / malformed session id (400), and never writes', async () => {
  const kv = fakeKV();
  for (const s of [undefined, '', 'short', 'has spaces!!', 'x'.repeat(200)]) {
    const r = await handleTouch(req({ session: s, invite: 'c' }), {}, { kv, now });
    assert.equal(r.status, 400);
  }
  assert.equal(kv.store.size, 0);
});

test('rejects a malformed touch (400) but only when consent is present', async () => {
  const kv = fakeKV();
  const r = await handleTouch(req({ session: SESSION, touch: { owner: 'a', type: 'banana', slug: 'x' }, consent: true }), {}, { kv, now });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid');
});

test('non-POST -> 405; a non-JSON body -> 400; no KV -> 500', async () => {
  assert.equal((await handleTouch({ method: 'GET' }, {}, { kv: fakeKV(), now })).status, 405);
  assert.equal((await handleTouch(req(undefined), {}, { kv: fakeKV(), now })).status, 400);
  assert.equal((await handleTouch(req({ session: SESSION }), {}, { kv: null, now })).status, 500);
});

test('readTouches reads the record back; an unknown session is an empty record', async () => {
  const kv = fakeKV();
  await handleTouch(req({ session: SESSION, touch: { owner: 'alice', type: 'post', slug: 'a' }, consent: true }), {}, { kv, now });
  const rec = await readTouches({ SIGNUP_KV: kv }, SESSION);
  assert.equal(rec.items[0].owner, 'alice');
  assert.deepEqual((await readTouches({ SIGNUP_KV: kv }, 'sess_unknown00000000')).items, []);
  assert.deepEqual((await readTouches({ SIGNUP_KV: kv }, 'bad')).items, []); // invalid session -> empty
});

test('eraseTouches hard-deletes the session record (right to erasure)', async () => {
  const kv = fakeKV();
  await handleTouch(req({ session: SESSION, invite: 'c' }), {}, { kv, now });
  assert.ok(kv.store.has(TOUCH_KEY(SESSION)));
  const e = await eraseTouches({ SIGNUP_KV: kv }, SESSION);
  assert.equal(e.ok, true); assert.equal(kv.store.has(TOUCH_KEY(SESSION)), false);
});

// Adversarial finding (2026-07-11): the anonymous /touch route SERVER-stamps time — a client-supplied
// `at` can never plant an artificially early first touch.
test('the route ignores a client-supplied at (server-stamped time wins)', async () => {
  const kv = fakeKV();
  const sid = SESSION;
  const r = await handleTouch(req({ session: sid, consent: true, touch: { owner: '42', type: 'profile', slug: 'atwellpub', at: 1 } }), { SIGNUP_KV: kv }, { kv, now: () => 555000 });
  assert.equal(r.status, 200);
  const rec = JSON.parse(kv.store.get(TOUCH_KEY(sid)));
  assert.equal(rec.items[0].firstAt, 555000, 'the forged at:1 is discarded');
});

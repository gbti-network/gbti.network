// sow-202: the signed-in member's weekly digest switch (workers/signup/membership-digest.mjs). Fake KV, injected
// authorize, customer lookup, limiter and notice; real mailHash. The review rules each get a test that goes red if
// the rule is broken: on/off is about the caller's own record only, no record moves between hashes, OFF is a flag
// and never a suppression marker, and ON lifts an earlier unsubscribe at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDigestSwitch, scanForOwnRecord } from '../workers/signup/membership-digest.mjs';
import { mailHash, subscriberKey, suppressKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { buildSubscriber, canReceive } from '../membership/mail-subscriber.mjs';

const ENV = { MAIL_SUPPRESS_KEY: 'test-suppress-key' };
const EMAIL = 'member@example.com';
const hashOf = (email) => mailHash(ENV.MAIL_SUPPRESS_KEY, email);

function fakeKv(seed = {}) {
  const map = new Map(Object.entries(seed));
  const kv = {
    map,
    writes: [],
    failGet: null,
    async get(k, type) {
      if (kv.failGet && kv.failGet(k)) throw new Error('kv read failed');
      if (!map.has(k)) return null;
      const v = map.get(k);
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { kv.writes.push(k); map.set(k, String(v)); },
    async delete(k) { kv.writes.push(`delete ${k}`); map.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true };
    },
  };
  return kv;
}
const put = (kv, rec) => kv.map.set(subscriberKey(rec.hash), JSON.stringify(rec));
const read = (kv, hash) => (kv.map.has(subscriberKey(hash)) ? JSON.parse(kv.map.get(subscriberKey(hash))) : null);
const req = (method, body) => new Request('https://x/membership/digest', {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

function deps(kv, { githubId = '42', email = EMAIL, customerId = 'cus_1', allowed = true } = {}) {
  const d = {
    kv,
    authCalls: [],
    notices: [],
    authorize: async (_r, _e, opts) => { d.authCalls.push(opts); return { ok: true, githubId, login: 'm', status: 'none' }; },
    lookupCustomer: async () => (email ? { id: customerId, email } : { id: customerId, email: '' }),
    limiter: async () => ({ allowed }),
    notify: async (info) => { d.notices.push(info); },
    now: () => 1000,
  };
  return d;
}
const call = (method, body, kv, opts) => { const d = deps(kv, opts); return handleDigestSwitch(req(method, body), ENV, d).then((r) => ({ r, d })); };

test('GET: the switch is off, with the account address, when this member has no record', async () => {
  const { r, d } = await call('GET', undefined, fakeKv());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, on: false, address: EMAIL });
  assert.equal(d.authCalls[0].allowCookie, true, 'the cookie is allowed, so a cookie POST meets the CSRF gate in resolveIdentity');
});

test('GET: on for the caller\'s own active record, off when they switched it off', async () => {
  const h = await hashOf(EMAIL);
  const kv = fakeKv();
  put(kv, buildSubscriber({ hash: h, source: 'member', githubId: '42' }, { now: () => 1 }));
  assert.equal((await call('GET', undefined, kv)).r.body.on, true);
  put(kv, buildSubscriber({ hash: h, source: 'member', githubId: '42', digestOff: true }, { now: () => 1 }));
  assert.equal((await call('GET', undefined, kv)).r.body.on, false);
});

test('GET NEVER REPORTS SOMEONE ELSE\'S STATE: nothing, a form record, a block and another account read identically', async () => {
  // The account email is not proven to be the member's. If GET answered differently for these, it would be the
  // "is this address subscribed" lookup /mail/subscribe hides.
  const h = await hashOf(EMAIL);
  const bodies = [];
  bodies.push((await call('GET', undefined, fakeKv())).r.body);
  const withAnon = fakeKv(); put(withAnon, buildSubscriber({ hash: h, source: 'anon', emailEnc: 'enc' }, { now: () => 1 }));
  bodies.push((await call('GET', undefined, withAnon)).r.body);
  const blocked = fakeKv({ [suppressKey(h)]: SUPPRESS_VALUE });
  bodies.push((await call('GET', undefined, blocked)).r.body);
  const other = fakeKv(); put(other, buildSubscriber({ hash: h, source: 'member', githubId: '99' }, { now: () => 1 }));
  bodies.push((await call('GET', undefined, other)).r.body);
  for (const b of bodies) assert.deepEqual(b, bodies[0]);
});

test('GET: no email on the account says so, and GET never writes', async () => {
  const kv = fakeKv();
  const { r } = await call('GET', undefined, kv, { email: '' });
  assert.deepEqual(r.body, { ok: true, on: false, address: null, reason: 'no_address' });
  assert.equal(kv.writes.length, 0);
});

test('ON with nothing on file creates a member record for this account and sends one admin notice', async () => {
  const h = await hashOf(EMAIL);
  const kv = fakeKv();
  const { r, d } = await call('POST', { on: true }, kv);
  assert.deepEqual(r.body, { ok: true, on: true, address: EMAIL });
  const rec = read(kv, h);
  assert.equal(rec.source, 'member');
  assert.equal(rec.githubId, '42');
  assert.equal(rec.customerId, 'cus_1');
  assert.equal(rec.emailEnc, null, 'a member record stores no address');
  assert.equal(rec.digestOff, false);
  assert.equal(d.notices.length, 1);
  assert.equal((await call('GET', undefined, kv)).r.body.on, true);
});

test('ON LIFTS AN EARLIER UNSUBSCRIBE AT ONCE (owner, 2026-09-13), and deletes the block before writing', async () => {
  const h = await hashOf(EMAIL);
  const kv = fakeKv({ [suppressKey(h)]: SUPPRESS_VALUE });
  await call('POST', { on: true }, kv);
  assert.equal(kv.map.has(suppressKey(h)), false, 'the unsubscribe block is gone');
  assert.ok(read(kv, h), 'and the record exists');
  assert.ok(kv.writes.indexOf(`delete ${suppressKey(h)}`) < kv.writes.indexOf(subscriberKey(h)), 'block deleted first, so "on" is never written while the drain would still refuse');
});

test('ON on the member\'s own switched-off or bounced record reactivates it in place, lifts its block, sends no notice', async () => {
  const h = await hashOf(EMAIL);
  const kv = fakeKv({ [suppressKey(h)]: SUPPRESS_VALUE });
  put(kv, { ...buildSubscriber({ hash: h, source: 'member', githubId: '42', digestOff: true }, { now: () => 1 }), status: 'unsubscribed', welcomedAt: 5 });
  const { d } = await call('POST', { on: true }, kv);
  const rec = read(kv, h);
  assert.equal(rec.status, 'active');
  assert.equal(rec.digestOff, false);
  assert.equal(rec.welcomedAt, 5, 'not re-welcomed');
  assert.equal(kv.map.has(suppressKey(h)), false);
  assert.equal(d.notices.length, 0, 'not a new subscriber');
});

test('ON NEVER CLAIMS A FORM SUBSCRIPTION (SowMaster review): it stays anonymous, and a bounced one resumes', async () => {
  // The account email is not proven. Claiming would let an account holding a stranger's address take over the
  // stranger's form subscription and then silence it, with no way back through the form.
  const h = await hashOf(EMAIL);
  const active = fakeKv();
  const form = buildSubscriber({ hash: h, source: 'anon', emailEnc: 'enc' }, { now: () => 1 });
  put(active, form);
  const { r, d } = await call('POST', { on: true }, active);
  assert.deepEqual(r.body, { ok: true, on: true, address: EMAIL }, 'the same answer as creating a record');
  assert.deepEqual(read(active, h), JSON.parse(JSON.stringify(form)), 'the form record is untouched');
  assert.equal(d.notices.length, 0);

  const bounced = fakeKv({ [suppressKey(h)]: SUPPRESS_VALUE });
  put(bounced, { ...form, status: 'unsubscribed' });
  await call('POST', { on: true }, bounced);
  assert.equal(read(bounced, h).source, 'anon', 'still not claimed');
  assert.equal(read(bounced, h).status, 'active', 'the lift the owner chose: it resumes');
  assert.equal(bounced.map.has(suppressKey(h)), false);
});
test('ON never touches another member account\'s record under the same address, its unsubscribe block included', async () => {
  const h = await hashOf(EMAIL);
  const kv = fakeKv({ [suppressKey(h)]: SUPPRESS_VALUE });
  const theirs = { ...buildSubscriber({ hash: h, source: 'member', githubId: '99' }, { now: () => 1 }), status: 'unsubscribed' };
  put(kv, theirs);
  const { r } = await call('POST', { on: true }, kv);
  assert.equal(r.status, 409);
  assert.deepEqual(read(kv, h), JSON.parse(JSON.stringify(theirs)));
  assert.equal(kv.map.get(suppressKey(h)), SUPPRESS_VALUE, 'the block is checked for ownership before anything is deleted');
  assert.equal(kv.writes.length, 0);
});

test('a store write that fails answers 503, never an unhandled throw', async () => {
  for (const on of [true, false]) {
    const kv = fakeKv();
    kv.put = async () => { throw new Error('kv write failed'); };
    const { r } = await call('POST', { on }, kv);
    assert.equal(r.status, 503, `on=${on}`);
  }
});

test('OFF on the member\'s own record sets the flag, keeps it receivable, and writes NO suppression marker', async () => {
  const h = await hashOf(EMAIL);
  const kv = fakeKv();
  put(kv, buildSubscriber({ hash: h, source: 'member', githubId: '42' }, { now: () => 1 }));
  const { r } = await call('POST', { on: false }, kv);
  assert.deepEqual(r.body, { ok: true, on: false, address: EMAIL });
  const rec = read(kv, h);
  assert.equal(rec.digestOff, true);
  assert.equal(canReceive(rec), true, 'follow alerts still reach it');
  assert.equal(kv.map.has(suppressKey(h)), false, 'a suppression marker would also stop follow alerts');
});

test('OFF with nothing on file records the choice; a form subscription, another account and a block are left alone', async () => {
  const h = await hashOf(EMAIL);
  const empty = fakeKv();
  await call('POST', { on: false }, empty);
  assert.equal(read(empty, h).digestOff, true);
  assert.equal(read(empty, h).githubId, '42');

  const form = buildSubscriber({ hash: h, source: 'anon', emailEnc: 'enc' }, { now: () => 1 });
  const anon = fakeKv();
  put(anon, form);
  const { r } = await call('POST', { on: false }, anon);
  assert.deepEqual(read(anon, h), JSON.parse(JSON.stringify(form)), 'OFF never claims or silences a form subscription');
  assert.deepEqual(r.body, { ok: true, on: false, address: EMAIL }, 'and says nothing about it');

  const theirs = buildSubscriber({ hash: h, source: 'member', githubId: '99' }, { now: () => 1 });
  const other = fakeKv();
  put(other, theirs);
  await call('POST', { on: false }, other);
  assert.deepEqual(read(other, h), JSON.parse(JSON.stringify(theirs)));

  const blocked = fakeKv({ [suppressKey(h)]: SUPPRESS_VALUE });
  await call('POST', { on: false }, blocked);
  assert.equal(read(blocked, h), null);
  assert.equal(blocked.map.get(suppressKey(h)), SUPPRESS_VALUE, 'OFF never lifts a block');
});
test('A RECORD UNDER AN OLDER ADDRESS is found by the scan on POST and changed in place: no duplicate, no move', async () => {
  const oldHash = await hashOf('old@example.com');
  const newHash = await hashOf(EMAIL);
  const kv = fakeKv();
  put(kv, buildSubscriber({ hash: oldHash, source: 'member', githubId: '42', digestOff: true }, { now: () => 1 }));
  await call('POST', { on: true }, kv);
  assert.equal(read(kv, oldHash).digestOff, false, 'the existing record is switched on where it is');
  assert.equal(read(kv, newHash), null, 'no second record, so no second copy of every issue');
});

test('GET does not scan: a record under an older address reads off until the member switches', async () => {
  const kv = fakeKv();
  put(kv, buildSubscriber({ hash: await hashOf('old@example.com'), source: 'member', githubId: '42' }, { now: () => 1 }));
  let listed = false;
  const list = kv.list.bind(kv);
  kv.list = async (o) => { listed = true; return list(o); };
  const { r } = await call('GET', undefined, kv);
  assert.equal(r.body.on, false);
  assert.equal(listed, false, 'no subscriber scan on a page view');
});

test('the scan is bounded, and a record it cannot read fails the POST closed with nothing written', async () => {
  const kv = fakeKv();
  for (const n of ['a', 'b', 'c']) put(kv, buildSubscriber({ hash: n, source: 'anon', emailEnc: 'e' }, { now: () => 1 }));
  put(kv, buildSubscriber({ hash: 'z', source: 'member', githubId: '42' }, { now: () => 1 }));
  assert.equal((await scanForOwnRecord(kv, '42', { budget: 2 })).exhausted, true);
  assert.equal((await scanForOwnRecord(kv, '42', { budget: 10 })).rec.hash, 'z');

  kv.failGet = (k) => k === subscriberKey('b');
  const before = new Map(kv.map);
  const { r } = await call('POST', { on: true }, kv);
  assert.equal(r.status, 503);
  assert.deepEqual(kv.map, before);
});

test('refusals write nothing: a denied caller, a bad body, a bad method, a rate limit, no address, no hashing key', async () => {
  const denied = fakeKv();
  const d = deps(denied);
  d.authorize = async () => ({ ok: false, status: 403, body: { error: 'denied' } });
  assert.equal((await handleDigestSwitch(req('POST', { on: true }), ENV, d)).status, 403);
  assert.equal(denied.writes.length, 0);

  for (const [method, body, expect] of [['POST', { on: 'yes' }, 400], ['DELETE', undefined, 405]]) {
    const kv = fakeKv();
    assert.equal((await call(method, body, kv)).r.status, expect);
    assert.equal(kv.writes.length, 0);
  }
  const limited = fakeKv();
  assert.equal((await call('POST', { on: true }, limited, { allowed: false })).r.status, 429);
  assert.equal(limited.writes.length, 0);

  const noAddress = fakeKv();
  assert.equal((await call('POST', { on: true }, noAddress, { email: '' })).r.status, 409);
  assert.equal(noAddress.writes.length, 0);

  const unkeyed = fakeKv();
  const u = deps(unkeyed);
  assert.equal((await handleDigestSwitch(req('POST', { on: true }), {}, u)).status, 503);
  assert.equal(unkeyed.writes.length, 0);
});

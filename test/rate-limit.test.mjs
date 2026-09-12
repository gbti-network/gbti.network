// The shared edge limiter (workers/signup/abuse.mjs rateLimit), keyed per subject.
//
// These cases were written for the sow-293 share slow mode and OUTLIVED it: the owner removed that six-hour
// window on 2026-09-12 (sow-323), since editorial approval is a stronger brake than a timer, but the limiter
// itself still guards the author route, enrolment, mail subscribe and the admin author route. The coverage
// moved here rather than being deleted with the feature that happened to be its first caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../workers/signup/abuse.mjs';

const SIX_HOURS = 6 * 60 * 60;

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, opts) { const v = store.get(key); return v === undefined ? null : (opts?.type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
  };
}

test('rateLimit keys on an explicit id, so two members do not throttle each other', async () => {
  // An IP key is wrong for a per-member rule: a shared NAT throttles strangers together and a phone hopping
  // networks defeats it entirely.
  const kv = fakeKV();
  const opts = { kv, limit: 1, windowSeconds: SIX_HOURS, prefix: 'rl:test:', now: 1_000_000 };

  assert.equal((await rateLimit({ ...opts, id: 'ada' })).allowed, true, 'first call allowed');
  assert.equal((await rateLimit({ ...opts, id: 'ada' })).allowed, false, 'second call inside the window refused');
  assert.equal((await rateLimit({ ...opts, id: 'bob' })).allowed, true, 'a DIFFERENT subject is unaffected');

  // The window really does expire rather than being a permanent block.
  const later = { ...opts, now: 1_000_000 + (SIX_HOURS + 1) * 1000 };
  assert.equal((await rateLimit({ ...later, id: 'ada' })).allowed, true, 'allowed again after the window');

  // `id` wins over `ip`, and `ip` still works for the callers that pass it.
  const kv2 = fakeKV();
  await rateLimit({ ...opts, kv: kv2, id: 'ada', ip: '1.2.3.4' });
  assert.ok([...kv2.store.keys()].includes('rl:test:ada'), `id must win over ip; keys were ${JSON.stringify([...kv2.store.keys()])}`);
  const kv3 = fakeKV();
  await rateLimit({ ...opts, kv: kv3, ip: '1.2.3.4' });
  assert.ok([...kv3.store.keys()].includes('rl:test:1.2.3.4'), 'the existing ip form must keep working unchanged');
});

test('the limiter fails CLOSED on a broken store, so it cannot become an open door', async () => {
  const exploding = { async get() { throw new Error('kv down'); }, async put() {} };
  assert.equal((await rateLimit({ kv: exploding, id: 'ada', limit: 1 })).allowed, false);
  assert.equal((await rateLimit({ kv: null, id: 'ada', limit: 1 })).allowed, false);
  assert.equal((await rateLimit({ kv: fakeKV(), id: null, ip: null, limit: 1 })).allowed, false,
    'no subject to key on must deny, never allow');
});

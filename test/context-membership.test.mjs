// SOW-089 fix: membershipResolved self-heals an 'unknown' login-time cache. A failed one-shot resolution
// at login used to lock a PAID member out of member comment bodies and the members-only thread until a
// re-login (fail-closed gates reading the stale cache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../client/src/context.mjs';

function fakeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { get: (k) => m.get(k) ?? null, set: (patch) => { for (const [k, v] of Object.entries(patch)) m.set(k, v); }, _m: m };
}

test('membershipResolved: a known cache returns as-is without any network', async () => {
  const store = fakeStore({ membership: 'paid' });
  const ctx = buildContext(store);
  assert.equal(await ctx.membershipResolved(), 'paid');
});

test('membershipResolved: unknown with no token stays unknown (fail-closed)', async () => {
  const ctx = buildContext(fakeStore({}));
  assert.equal(await ctx.membershipResolved(), 'unknown');
});

test('membership() stays sync and reads the cache', () => {
  const ctx = buildContext(fakeStore({ membership: 'trialing' }));
  assert.equal(ctx.membership(), 'trialing');
});

test('membershipResolved: the heal seeds couponUntil from the oracle (and clears a stale one)', async () => {
  // SOW-119 QA: this seed site used to drop couponUntil (the one host left behind), so the npm host's
  // /api/status could report a coupon end date for a member who had converted to a real subscription.
  const store = fakeStore({ membership: 'unknown', githubToken: 'tok', identity: { githubId: '7', login: 'x' }, couponUntil: '2026-01-01T00:00:00.000Z' });
  const ctx = buildContext(store);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'paid', couponUntil: null }) });
  try {
    assert.equal(await ctx.membershipResolved(), 'paid');
    assert.equal(store._m.get('couponUntil'), null, 'the stale coupon date is overwritten by the heal');
  } finally { globalThis.fetch = realFetch; }
});

// sow-293: the per-member share slow mode. One share per six hours for a Network Member; Content Creators
// exempt (owner answer 4, 2026-08-29).
//
// THE ASSERTION THAT MATTERS IS THE LAST ONE. An exemption is where a fail-open hides: the natural way to
// write this is "if the caller is a creator, skip the throttle", and that inverts silently the moment the
// tier lookup degrades, because an unresolvable tier then reads as "not throttled" instead of "throttled".
// meetsTier returns false for an absent tier, so the safe direction is the default here, but it is a default
// and defaults get refactored, so it is pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isShareSet, isMembersOnlyShare, SHARE_SLOW_MODE_SECONDS } from '../workers/signup/membership-author.mjs';
import { rateLimit } from '../workers/signup/abuse.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, opts) { const v = store.get(key); return v === undefined ? null : (opts?.type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
  };
}

test('the slow-mode window is six hours', () => {
  assert.equal(SHARE_SLOW_MODE_SECONDS, 21600);
});

test('isShareSet is a PATH question only, independent of the visibility check', () => {
  // Two rules, two predicates. If the throttle reused isMembersOnlyShare, a future change to what counts as
  // members-only would silently change who is throttled, in the permissive direction.
  const pub = { path: 'members/ada/shares/x.md', content: '---\nvisibility: public\n---' };
  assert.equal(isShareSet([pub], 'ada'), true, 'a PUBLIC share is still a share for throttling purposes');
  assert.equal(isMembersOnlyShare([pub], 'ada'), false, 'but it is not members-only');

  assert.equal(isShareSet([{ path: 'members/ada/posts/p/index.md' }], 'ada'), false);

  // A MIXED set still counts as a share, and this one was found by mutation testing rather than by reading:
  // swapping `some` for `every` here reddened nothing until this line existed. With `every`, bundling one
  // share alongside any other file would slip past the throttle entirely, which is the cheapest possible
  // way around a per-member limit.
  assert.equal(
    isShareSet([{ path: 'members/ada/shares/x.md' }, { path: 'members/ada/comments/c.md' }], 'ada'),
    true,
    'a share bundled with anything else is still a share, or the throttle is trivially bypassed',
  );
  assert.equal(
    isShareSet([{ path: 'members/ada/shares/x.md' }, { path: 'members/ada/shares/x.enc' }], 'ada'),
    true,
    'the normal two-file members-only shape',
  );
  assert.equal(isShareSet([{ path: 'members/mallory/shares/x.md' }], 'ada'), false, "another member's folder");
  assert.equal(isShareSet([{ path: 'members/ada/shares/../../mallory/shares/x.md' }], 'ada'), false, 'traversal');
  for (const bad of [null, undefined, [], 'nope']) assert.equal(isShareSet(bad, 'ada'), false);
  for (const f of [null, '', 42]) assert.equal(isShareSet([{ path: 'members/ada/shares/x.md' }], f), false);
});

test('rateLimit keys on an explicit id, so two members do not throttle each other', async () => {
  // An IP key is wrong for a per-member rule: a shared NAT throttles strangers together and a phone hopping
  // networks defeats it entirely.
  const kv = fakeKV();
  const opts = { kv, limit: 1, windowSeconds: SHARE_SLOW_MODE_SECONDS, prefix: 'rl:share:', now: 1_000_000 };

  assert.equal((await rateLimit({ ...opts, id: 'ada' })).allowed, true, 'first share allowed');
  assert.equal((await rateLimit({ ...opts, id: 'ada' })).allowed, false, 'second share inside the window refused');
  assert.equal((await rateLimit({ ...opts, id: 'bob' })).allowed, true, 'a DIFFERENT member is unaffected');

  // The window really does expire rather than being a permanent block.
  const later = { ...opts, now: 1_000_000 + (SHARE_SLOW_MODE_SECONDS + 1) * 1000 };
  assert.equal((await rateLimit({ ...later, id: 'ada' })).allowed, true, 'allowed again after six hours');

  // `id` wins over `ip`, and `ip` still works for the callers that pass it.
  const kv2 = fakeKV();
  await rateLimit({ ...opts, kv: kv2, id: 'ada', ip: '1.2.3.4' });
  assert.ok([...kv2.store.keys()].includes('rl:share:ada'), `id must win over ip; keys were ${JSON.stringify([...kv2.store.keys()])}`);
  const kv3 = fakeKV();
  await rateLimit({ ...opts, kv: kv3, ip: '1.2.3.4' });
  assert.ok([...kv3.store.keys()].includes('rl:share:1.2.3.4'), 'the existing ip form must keep working unchanged');
});

test('the limiter fails CLOSED on a broken store, so it cannot become an open door', async () => {
  const exploding = { async get() { throw new Error('kv down'); }, async put() {} };
  assert.equal((await rateLimit({ kv: exploding, id: 'ada', limit: 1 })).allowed, false);
  assert.equal((await rateLimit({ kv: null, id: 'ada', limit: 1 })).allowed, false);
  assert.equal((await rateLimit({ kv: fakeKV(), id: null, ip: null, limit: 1 })).allowed, false,
    'no subject to key on must deny, never allow');
});

test('the creator EXEMPTION resolves the safe way when the tier is unknown', async () => {
  // The route guards with `!meetsTier(paid.tier, TIER.creator)`. This asserts what that expression does for
  // every tier value the authorizer can hand it, because the whole safety of the exemption rests on an
  // unresolvable tier landing on THROTTLED rather than EXEMPT.
  const { meetsTier, TIER } = await import('../membership/tiers.mjs');
  const throttled = (tier) => !meetsTier(tier, TIER.creator);

  assert.equal(throttled('creator'), false, 'a Content Creator is exempt');
  assert.equal(throttled('member'), true, 'a Network Member is throttled');
  for (const unknown of [null, undefined, '', 'none', 'nonsense', 0, false, {}]) {
    assert.equal(throttled(unknown), true,
      `an unresolvable tier (${JSON.stringify(unknown)}) must be THROTTLED, not exempt: the exemption must never be the fail-open`);
  }
});

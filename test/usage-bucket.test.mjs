// SOW-061 P1: the pure usage-analytics tier bucket + event vocabulary. No IO. The bucket must follow the SAME
// precedence as the real gate (ban > staff > grandfather > Stripe), so the analytics cohort never drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageBucket, overridesFromMirror, isUsageEvent, USAGE_EVENTS, USAGE_BUCKETS } from '../membership/usage-bucket.mjs';

// The mirror section shapes match the gate's (see test/worker-membership-content.test.mjs freshMirror).
const mirror = (over = {}) => ({ roles: over.roles ?? {}, bans: over.bans ?? { bans: [] }, grandfathered: over.grandfathered ?? { grandfathered: [] } });

test('no github_id (no/invalid token) -> anonymous', () => {
  assert.equal(usageBucket('paid', { githubId: null }), 'anonymous');
  assert.equal(usageBucket('none', {}), 'anonymous');
});

test('without overrides, the Stripe-derived status passes through (bad values -> unknown)', () => {
  assert.equal(usageBucket('paid', { githubId: '1' }), 'paid');
  assert.equal(usageBucket('trialing', { githubId: '1' }), 'trialing');
  assert.equal(usageBucket('none', { githubId: '1' }), 'none');
  assert.equal(usageBucket('expired', { githubId: '1' }), 'expired');
  assert.equal(usageBucket('garbage', { githubId: '1' }), 'unknown');
  assert.equal(usageBucket(undefined, { githubId: '1' }), 'unknown');
});

test('overrides precedence: a ban beats a paid subscription (-> banned)', () => {
  const overrides = overridesFromMirror(mirror({ bans: { bans: [{ github_id: '1' }] } }));
  assert.equal(usageBucket('paid', { githubId: '1', overrides }), 'banned');
});

test('overrides precedence: staff and grandfather count as paid', () => {
  const staff = overridesFromMirror(mirror({ roles: { admins: [{ github_id: '2' }] } }));
  assert.equal(usageBucket('none', { githubId: '2', overrides: staff }), 'paid');
  const gf = overridesFromMirror(mirror({ grandfathered: { grandfathered: [{ github_id: '3' }] } }));
  assert.equal(usageBucket('none', { githubId: '3', overrides: gf }), 'paid');
});

test('a member with no override keeps its Stripe status even when overrides are present', () => {
  const overrides = overridesFromMirror(mirror({ bans: { bans: [{ github_id: '1' }] } }));
  assert.equal(usageBucket('trialing', { githubId: '9', overrides }), 'trialing');
  assert.equal(usageBucket('none', { githubId: '9', overrides }), 'none');
});

test('overridesFromMirror returns null on a missing/incomplete mirror (caller falls back to Stripe)', () => {
  assert.equal(overridesFromMirror(null), null);
  assert.equal(overridesFromMirror({ bans: { bans: [] } }), null); // missing roles + grandfathered
  assert.ok(overridesFromMirror(mirror())); // complete -> maps
});

test('the event vocabulary is closed', () => {
  assert.equal(isUsageEvent('status_check'), true);
  assert.equal(isUsageEvent('publish_attempt'), true);
  assert.equal(isUsageEvent('nope'), false);
  assert.equal(isUsageEvent(''), false);
  assert.deepEqual([...USAGE_EVENTS].sort(), ['browse_activity', 'follow', 'news_view', 'publish_attempt', 'save', 'status_check']);
});

test('every produced bucket is in the closed tier vocabulary', () => {
  const seen = ['anonymous', usageBucket('paid', { githubId: '1' }), usageBucket('x', { githubId: '1' }),
    usageBucket('paid', { githubId: '1', overrides: overridesFromMirror(mirror({ bans: { bans: [{ github_id: '1' }] } })) })];
  for (const b of seen) assert.ok(USAGE_BUCKETS.includes(b), `${b} is a known bucket`);
});

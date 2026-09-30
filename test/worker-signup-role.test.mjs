// Tests how the signup Worker (SOW-002) resolves the Discord role and the Content Creator badge for a member who
// links Discord: resolveSignupRole against the overrides mirror, a coupon grant and the Stripe Customer, and
// runSignup assigning what it resolved. No network, no secrets. Split out of test/worker.test.mjs at the 900-line
// limit (owner, 2026-09-30); the shared fixtures live in test/lib/worker-fixtures.mjs.
//
// Coverage:
//   - sow-218: the role is resolved rather than hardcoded; a ban outranks a coupon; an unreadable mirror withholds
//   - sow-185: a coupon confers its own tier, and the badge raises but never lowers
//   - runSignup assigns the resolved role, swaps out stale ones, and leaves an unprovisioned badge inert

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runSignup, resolveSignupRole } from '../workers/signup/signup.mjs';
import { IDENTITY, CONFIG, fakeStripe, fakeDiscord, NOW, mirrorKv, freshMirror, paidCustomer } from './lib/worker-fixtures.mjs';

// --- sow-218: signup resolves the Discord role instead of hardcoding one -----------------------------------
//
// Two earlier versions of this handed ONE fixed role to everybody (first trial, then locked), which is right for
// exactly one kind of member and wrong for every other, with reconcile correcting it only on its next DAILY run.
// These pin the resolution, and in particular the two directions that must never swap: a banned member whose
// Stripe still says paid gets NOTHING, and an unreadable mirror withholds rather than grants.

test('sow-185: a LIVE TIERLESS coupon grant resolves to member and NO creator badge', async () => {
  // The invitee case. The grant is authoritative here precisely because house/grandfathered.yml does not carry
  // it yet: reconcile folds it AFTER computing roles, so waiting for the mirror meant up to two daily cycles.
  //
  // CHANGED BY THE OWNER RULING 2026-08-24: "coupons ... should only offer membership rather than creator".
  // This test asserted `creator: true` under sow-218, when the invite promised Content Creator for a year.
  // It is now WRONG rather than broken, so it is rewritten rather than deleted: the access half of the claim
  // still needs a guard, and deleting it would quietly shrink coverage by one while looking like a fix.
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: false, eligible: true, reason: 'eligible' });
});

test('sow-218: an EXPIRED coupon grant grants nothing', async () => {
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2020-01-01T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'locked', creator: false, eligible: false, reason: 'free' });
});

test('sow-218: a paying subscriber linking Discord gets the MEMBER role, not locked', async () => {
  const r = await resolveSignupRole({ kv: mirrorKv(freshMirror()), githubId: '12345', customer: paidCustomer, now: NOW });
  assert.equal(r.access, 'member');
});

test('sow-218: a BANNED member gets locked and NO badge, even holding a live coupon', async () => {
  // A ban outranks a coupon everywhere else, so it must here too: otherwise a banned account buys its way back
  // in with an invite code. Checked BEFORE the coupon is honoured.
  const mirror = freshMirror({ bans: { bans: [{ github_id: '12345', reason: 'test' }] } });
  const r = await resolveSignupRole({
    kv: mirrorKv(mirror), githubId: '12345', customer: paidCustomer,
    couponGrant: { until: '2027-08-11T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'locked', creator: false, eligible: false, reason: 'banned' });
});

test('sow-218: a grandfathered member with NO Stripe subscription still gets the member role', async () => {
  const mirror = freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp' }] } });
  const r = await resolveSignupRole({ kv: mirrorKv(mirror), githubId: '12345', customer: null, now: NOW });
  assert.equal(r.access, 'member');
});

test('sow-218: a STALE, absent or unreadable mirror withholds the grant', async () => {
  const stale = freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' }); // older than the 48h bound
  assert.equal((await resolveSignupRole({ kv: mirrorKv(stale), githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
  assert.equal((await resolveSignupRole({ kv: mirrorKv(null), githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
  const throwingKv = { get: async () => { throw new Error('kv down'); } };
  assert.equal((await resolveSignupRole({ kv: throwingKv, githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
  assert.equal((await resolveSignupRole({ kv: null, githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
});

test('sow-218: an EXISTING coupon grant is read from KV, not just one redeemed in this run', async () => {
  // The bug the owner caught in the live guild. A member who redeemed weeks ago and links Discord later sends
  // NO coupon code, so couponGrant is null. Reading only the in-run value made the account fall through to the
  // Stripe derivation, where a stale trial_started_at from before the trial retirement derived `trialing` and
  // handed a Codeable invitee the retired Applicant role instead of Member plus Creator.
  const withGrant = {
    get: async (k) => (k === 'overrides:mirror' ? freshMirror()
      : k === 'coupon-grant:12345' ? { code: 'CODEABLEYEAR', until: '2027-08-11T00:00:00.000Z' } : null),
    put: async () => {},
  };
  const trialCustomer = { id: 'cus_old', metadata: { github_id: '12345', trial_started_at: '2026-07-01T00:00:00.000Z' } };
  const r = await resolveSignupRole({ kv: withGrant, githubId: '12345', customer: trialCustomer, couponGrant: null, now: NOW });
  // `creator: false` since the 2026-08-24 ruling. The ACCESS half is what this test is really about, and it
  // is unchanged: the stored grant still outranks a stale trial clock. Only the badge moved.
  assert.deepEqual(r, { access: 'member', creator: false, eligible: true, reason: 'eligible' }, 'the stored grant outranks a stale trial clock');
});

test('sow-218: without a grant, a stale trial clock still resolves to the trial role', async () => {
  // The other half of the same behaviour, so the fix above is not just "always return member". A genuine
  // mid-trial member keeps the trial role until their clock runs out.
  const trialCustomer = { id: 'cus_old', metadata: { github_id: '12345', trial_started_at: '2026-07-01T00:00:00.000Z' } };
  const r = await resolveSignupRole({ kv: mirrorKv(freshMirror()), githubId: '12345', customer: trialCustomer, now: NOW });
  assert.equal(r.access, 'trial');
  assert.equal(r.creator, false);
});

test('sow-218: a coupon invitee is still admitted when the mirror is unavailable', async () => {
  // The grant lives in KV and needs no mirror to be true. Denying an invitee because an unrelated blob went
  // stale would recreate the lockout this whole change exists to remove.
  //
  // The badge is now `false` for a tierless grant (ruling 2026-08-24), but ADMISSION is the point of this
  // test and must not move: an unavailable mirror may cost an invitee a badge they were never promised, and
  // must never cost them access.
  const r = await resolveSignupRole({
    kv: mirrorKv(null), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: false, eligible: true, reason: 'eligible' });
});

// --- sow-185 (2026-08-24): a coupon confers its OWN tier, and the badge raises but never lowers ----------

test('sow-185 TDZ REGRESSION: a live coupon NEVER resolves to locked, on any mirror path', async () => {
  // THE BUG THIS EXISTS TO CATCH IS NOT A WRONG TIER, IT IS A SILENT LOCKOUT OF EVERY INVITEE.
  //
  // `resolveSignupRole` had a `const grant` at the foot of its try block shadowing the outer `let grant`.
  // Any read of `grant` earlier in that try throws a temporal dead zone ReferenceError, and the catch turns
  // ANY throw into `{ access: 'locked', creator: false }`. So the failure does not crash and does not log an
  // error: it presents as a policy decision. Every Codeable invitee is refused, and the refusal looks
  // deliberate. A verifier reproduced exactly that by executing the naive patch.
  //
  // Asserted as a PROPERTY over every path rather than at one input, because the shadow bites wherever the
  // outer binding is read, and which of these branches reads it first is an implementation detail that will
  // move. A single-input version of this test would go quiet the moment the code was reorganised.
  const live = { until: '2027-08-11T00:00:00.000Z' };
  const paths = [
    ['a present mirror', mirrorKv(freshMirror())],
    ['an absent mirror', mirrorKv(null)],
    ['a stale mirror', mirrorKv(freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' }))],
    ['a mirror carrying a grandfather entry', mirrorKv(freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp' }] } }))],
    ['a mirror carrying a staff entry', mirrorKv(freshMirror({ roles: { superadmins: [{ github_id: '12345' }] } }))],
  ];
  for (const [label, kv] of paths) {
    const r = await resolveSignupRole({ kv, githubId: '12345', customer: null, couponGrant: live, now: NOW });
    assert.equal(r.access, 'member', `a live coupon must admit the invitee with ${label}`);
  }
});

test('sow-185: a MEMBER-tier coupon confers no creator badge', async () => {
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z', tier: 'member' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: false, eligible: true, reason: 'eligible' });
});

test('sow-185: an EXPLICIT creator-tier coupon still confers the badge', async () => {
  // The ruling moved the DEFAULT, it did not remove the capability. A campaign that really does sell the top
  // tier says so on its own record, and must still deliver it, or the ruling silently becomes "no coupon can
  // ever grant creator" and a future creator campaign fails with no error.
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z', tier: 'creator' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: true, eligible: true, reason: 'eligible' });
});

test('sow-185: a STAFF member holding a member-tier coupon KEEPS the creator badge', async () => {
  // THE BADGE RAISES, IT NEVER LOWERS, and this is the case where getting it wrong does real damage rather
  // than merely showing the wrong label. `creator: false` calls removeRole, so a naive "the coupon decides
  // the tier" fix STRIPS a Discord badge that was granted by hand, from a superadmin, the moment they link
  // Discord while holding any member-tier coupon. The coupon deliberately no longer short-circuits ahead of
  // the role read for this reason.
  const mirror = freshMirror({ roles: { superadmins: [{ github_id: '12345' }] } });
  const r = await resolveSignupRole({
    kv: mirrorKv(mirror), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z', tier: 'member' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: true, eligible: true, reason: 'eligible' }, 'staff resolves to creator and the coupon must not lower it');
});

test('sow-185: a hand-set creator GRANDFATHER keeps the badge while holding a member coupon', async () => {
  // The second lowering case, and the one the escape hatch exists for. An entry carrying an explicit
  // `tier: creator` is somebody a human decided should keep full access; a member-tier coupon must not undo
  // that decision. The tierless entry beside it is the control: it resolves to member and gets no badge, so
  // this test would fail if the code simply returned creator for every grandfather.
  const withCreator = freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp', tier: 'creator' }] } });
  const memberCoupon = { until: '2027-08-11T00:00:00.000Z', tier: 'member' };
  const kept = await resolveSignupRole({ kv: mirrorKv(withCreator), githubId: '12345', customer: null, couponGrant: memberCoupon, now: NOW });
  assert.deepEqual(kept, { access: 'member', creator: true, eligible: true, reason: 'eligible' });

  const tierless = freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp' }] } });
  const plain = await resolveSignupRole({ kv: mirrorKv(tierless), githubId: '12345', customer: null, couponGrant: memberCoupon, now: NOW });
  assert.deepEqual(plain, { access: 'member', creator: false, eligible: true, reason: 'eligible' }, 'a tierless grandfather is member, so no badge');
});

test('sow-185: an absent or stale mirror reports the COUPON tier, not a hardcoded true', async () => {
  // These three branches each returned `creator: couponLive`, which was `true` for any live coupon whatever
  // its tier. They now read the coupon's own tier. Both directions are asserted on both branches, because a
  // fix applied to one branch and missed on the other is the likeliest way this half-lands.
  const member = { until: '2027-08-11T00:00:00.000Z', tier: 'member' };
  const creator = { until: '2027-08-11T00:00:00.000Z', tier: 'creator' };
  const stale = freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' });
  for (const [label, kv] of [['absent', mirrorKv(null)], ['stale', mirrorKv(stale)]]) {
    const m = await resolveSignupRole({ kv, githubId: '12345', customer: null, couponGrant: member, now: NOW });
    assert.deepEqual(m, { access: 'member', creator: false, eligible: true, reason: 'eligible' }, `a member coupon gets no badge with a ${label} mirror`);
    const c = await resolveSignupRole({ kv, githubId: '12345', customer: null, couponGrant: creator, now: NOW });
    assert.deepEqual(c, { access: 'member', creator: true, eligible: true, reason: 'eligible' }, `a creator coupon keeps its badge with a ${label} mirror`);
  }
});

test('sow-185: an EXPIRED creator-tier coupon leaks no badge', async () => {
  // redeemCoupon returns an existing grant even when it has lapsed (`already: true`), so the tier read is
  // gated on couponLive. Without that gate a member whose creator year ran out keeps the badge forever.
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2020-01-01T00:00:00.000Z', tier: 'creator' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'locked', creator: false, eligible: false, reason: 'free' });
});

test('sow-218: runSignup ASSIGNS the resolved role, not a hardcoded one', async () => {
  const discord = fakeDiscord();
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.equal(result.discordLinked, true);
  assert.deepEqual(discord.calls.addRole, [{ guildId: 'guild-1', userId: 'd-987', roleId: 'role-member' }], 'a paying member gets @Member');
  // The join `roles` and the explicit addRole must stay symmetric: Discord ignores the join roles for a user
  // already in the guild, so the pair is what makes this work for both new and returning members.
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, ['role-member'], 'and the join carries the same role');
});

test('sow-218: signup SWAPS roles, so a stale one cannot accumulate', async () => {
  // The bug the owner caught in the live guild: the test account held Applicant AND Locked at once, because
  // signup only ever ADDED. The trial role came from its first signup, Locked from a later Discord link, and
  // nothing removed either. Only the daily reconcile swapped, so linking twice stacked roles until then.
  const discord = fakeDiscord();
  const CFG = { ...CONFIG, creatorRoleId: 'r-creator' };
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CFG, now: NOW,
  });
  const added = discord.calls.addRole.map((c) => c.roleId);
  const removed = discord.calls.removeRole.map((c) => c.roleId).sort();
  assert.ok(added.includes('role-member'), 'the target access role is added');
  assert.deepEqual(removed.filter((r) => r !== 'r-creator'), ['role-locked', 'role-trial'], 'BOTH other access roles are stripped');
  assert.ok(!removed.includes('role-member'), 'and never the role just granted');
});

test('sow-218: a coupon invitee is badged Content Creator at link time, not a reconcile later', async () => {
  const discord = fakeDiscord();
  const CFG = { ...CONFIG, creatorRoleId: 'r-creator' };
  const kv = { get: async (k) => (k === 'overrides:mirror' ? freshMirror() : null), put: async () => {} };
  await runSignup({
    // sow-356: a PAYING member holding the coupon parameter. The fixture used to be a brand-new account, which
    // is now refused the guild outright, and a refusal makes no Discord calls at all, so the badge claim below
    // would have passed for the wrong reason.
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord, kv,
    config: CFG, coupon: 'CODEABLEYEAR', now: NOW,
  });
  // No coupon config is mirrored in this fixture, so redeemCoupon returns null and the member resolves from
  // Stripe alone: the badge must then be REMOVED rather than granted. Fail-closed, and it proves the axis is
  // driven by the resolution rather than by the mere presence of a coupon parameter.
  assert.ok(discord.calls.removeRole.some((c) => c.roleId === 'r-creator'), 'no live grant -> no badge');
});

test('sow-218: the Creator badge is INERT until the role id is provisioned', async () => {
  const discord = fakeDiscord();
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW, // CONFIG has no creatorRoleId
  });
  const touched = [...discord.calls.addRole, ...discord.calls.removeRole].map((c) => c.roleId);
  assert.ok(!touched.includes(undefined), 'never sends an undefined role id');
  assert.ok(!touched.includes('r-creator'));
});

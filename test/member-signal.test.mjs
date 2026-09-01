// sow-158 Phase 2: the pure identity core — the /membership/status -> MemberSignal mapper and the cookie-wins
// precedence selector. No DOM, no network (the .ts wrapper holds the browser glue; this covers the logic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberSignalFromStatus, selectIdentity, isActiveMember, ACTIVE_MEMBERSHIPS } from '../src/lib/member-signal-core.mjs';
import fs from 'node:fs';
import path from 'node:path';

test('memberSignalFromStatus maps a paid member (canPublish true, source cookie)', () => {
  const s = memberSignalFromStatus({ ok: true, github_id: 42, login: 'octocat', status: 'paid', canCurate: false, couponUntil: null });
  assert.equal(s.authenticated, true);
  assert.equal(s.login, 'octocat');
  assert.equal(s.githubId, '42'); // stringified
  assert.equal(s.username, 'octocat');
  assert.equal(s.membership, 'paid');
  assert.equal(s.canPublish, true);
  assert.equal(s.role, 'member');
  assert.equal(s.source, 'cookie');
});

test('memberSignalFromStatus reflects trialing/expired without paid perks', () => {
  const t = memberSignalFromStatus({ ok: true, login: 'a', status: 'trialing' });
  assert.equal(t.membership, 'trialing');
  assert.equal(t.canPublish, false);
  const e = memberSignalFromStatus({ ok: true, login: 'a', status: 'expired' });
  assert.equal(e.membership, 'expired');
  assert.equal(e.canPublish, false);
});

// sow-158 follow-up: the oracle now returns effectiveStatus (staff/grandfather folded) + role, which the static
// site cannot derive itself. The signal must prefer them so a superadmin shows as paid + reveals Admin tools.
test('memberSignalFromStatus prefers effectiveStatus + role (a staff superadmin with Stripe status none)', () => {
  const s = memberSignalFromStatus({ ok: true, login: 'sam', github_id: 5, status: 'none', effectiveStatus: 'paid', role: 'superadmin' });
  assert.equal(s.membership, 'paid', 'the folded effectiveStatus wins over the raw Stripe status');
  assert.equal(s.canPublish, true);
  assert.equal(s.role, 'superadmin', 'the resolved role drives the header admin-item gate');
});

test('memberSignalFromStatus falls back to status + member for an older Worker (no effectiveStatus/role)', () => {
  const s = memberSignalFromStatus({ ok: true, login: 'a', status: 'paid' });
  assert.equal(s.membership, 'paid');
  assert.equal(s.role, 'member');
  assert.equal(s.paidTier, 'none'); // sow-185: an older Worker sends no paidTier -> fail-closed to none
});

test('sow-185: memberSignalFromStatus surfaces the resolved paid tier (fail-closed to none)', () => {
  assert.equal(memberSignalFromStatus({ ok: true, login: 'a', status: 'paid', paidTier: 'creator' }).paidTier, 'creator');
  assert.equal(memberSignalFromStatus({ ok: true, login: 'a', status: 'paid', paidTier: 'member' }).paidTier, 'member');
  assert.equal(memberSignalFromStatus({ ok: true, login: 'a', status: 'none', paidTier: 'none' }).paidTier, 'none');
  assert.equal(memberSignalFromStatus({ ok: true, login: 'a', status: 'paid', paidTier: 5 }).paidTier, 'none'); // non-string -> none
});

test('memberSignalFromStatus returns null for a non-member payload', () => {
  assert.equal(memberSignalFromStatus(null), null);
  assert.equal(memberSignalFromStatus({ ok: false }), null);
  assert.equal(memberSignalFromStatus({ ok: true }), null); // no login
  assert.equal(memberSignalFromStatus({ ok: true, login: '' }), null);
});

test('selectIdentity: the cookie session wins over the extension signal', () => {
  const cookie = { login: 'c', source: 'cookie' };
  const ext = { login: 'e', source: 'extension' };
  assert.equal(selectIdentity({ cookieResolved: true, cookieSignal: cookie, extSignal: ext }), cookie);
  assert.equal(selectIdentity({ cookieResolved: true, cookieSignal: null, extSignal: ext }), ext); // signed-out cookie defers
  assert.equal(selectIdentity({ cookieResolved: false, cookieSignal: null, extSignal: ext }), ext); // interim extension display
  assert.equal(selectIdentity({ cookieResolved: true, cookieSignal: null, extSignal: null }), null);
  assert.equal(selectIdentity({ cookieResolved: false, cookieSignal: null, extSignal: null }), null);
});

// sow-191: the ACTIVE MEMBER predicate behind the Shop Talk calendar CTA. Owner decision 2026-08-31: the
// Saturday call's calendar is a membership perk, so a signed-in but non-paying account is treated like a
// visitor. Presentation only: the .ics itself is a public file on a CDN and is readable regardless.

test('isActiveMember: paid and trialing are active, and nothing else is', () => {
  assert.equal(isActiveMember({ membership: 'paid' }), true);
  assert.equal(isActiveMember({ membership: 'trialing' }), true);
  // The FREE tier is the case this whole change is about: signed in, authenticated, not a member.
  assert.equal(isActiveMember({ membership: 'none', authenticated: true }), false);
  assert.equal(isActiveMember({ membership: 'unknown', authenticated: true }), false);
  assert.equal(isActiveMember({ membership: 'expired' }), false);
  assert.equal(isActiveMember({ membership: 'cancelled' }), false);
});

test('isActiveMember fails closed on every shape that is not a signal', () => {
  for (const bad of [null, undefined, {}, { authenticated: true }, 'paid', 0, [], { membership: null }]) {
    assert.equal(isActiveMember(bad), false, `isActiveMember(${JSON.stringify(bad)}) should be false`);
  }
});

test('isActiveMember does NOT accept authenticated alone, which was the pre-sow-191 rule', () => {
  // The specific regression: the CTA used to check `authenticated === true`, which admitted the free tier.
  // If this ever passes, the gate has silently widened back to signed-in-anyone.
  assert.equal(isActiveMember({ authenticated: true, membership: 'none' }), false);
});

test('ACTIVE_MEMBERSHIPS is frozen and is exactly the two active states', () => {
  assert.deepEqual([...ACTIVE_MEMBERSHIPS], ['paid', 'trialing']);
  const before = [...ACTIVE_MEMBERSHIPS];
  try { ACTIVE_MEMBERSHIPS.push('none'); } catch { /* frozen throws in strict mode: the good path */ }
  assert.deepEqual([...ACTIVE_MEMBERSHIPS], before, 'ACTIVE_MEMBERSHIPS was mutated by a consumer');
});

test('DRIFT GUARD: the homepage inline CTA uses the same rule as ACTIVE_MEMBERSHIPS', () => {
  // The Shop Talk CTA lives in an `is:inline` script, which cannot import, so the predicate is duplicated
  // there by necessity. This asserts the copy has not drifted. A test on the pure helper alone would stay
  // green while the actual button silently reverted to admitting anyone signed in.
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/index.astro'), 'utf8');
  const fn = /function activeMember\(sig\) \{([\s\S]*?)\}/.exec(src);
  assert.ok(fn, 'the homepage no longer defines activeMember(); the CTA gate may have been removed');
  for (const state of ACTIVE_MEMBERSHIPS) {
    assert.ok(fn[1].includes(`'${state}'`), `the inline CTA rule does not mention '${state}'`);
  }
  // And it must NOT have fallen back to the old signed-in-anyone check.
  assert.ok(!/authenticated === true/.test(fn[1]), 'the inline CTA rule accepts bare authentication again');

  // Positive control on the read: prove this file really is the homepage and the regex reaches real content,
  // so an empty or wrong file cannot make the assertions above pass by finding nothing to object to.
  assert.ok(src.includes('data-shoptalk-cta'), 'read a file that is not the homepage; the guard is pointed wrong');
});

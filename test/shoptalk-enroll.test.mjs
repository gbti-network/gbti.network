// sow-314: the Shop Talk calendar enrollment planner.
//
// The tests that matter here are the DESTRUCTIVE ones. An enrollment planner that adds nobody is a visible
// bug somebody reports on day one; a planner that removes the owner's hand-added guests mails an apparent
// cancellation to real people and there is no undo. So the foreign-attendee case is asserted first, hardest,
// and with a positive control on its own fixture, because a test that proves "nothing was removed" passes
// perfectly well when the fixture contained nothing to remove.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planShoptalkEnrollment,
  enrollmentCounts,
  ELIGIBLE_STATUSES,
  SKIP_REASON,
} from '../scripts/lib/shoptalk-enroll.mjs';

const member = (githubId, status, email, extra = {}) => ({
  githubId,
  githubLogin: `user${githubId}`,
  username: `user${githubId}`,
  email,
  effective: { status, source: 'stripe' },
  ...extra,
});

test('RULE 1: an attendee the sweep did not place is never removed', () => {
  // The owner's real calendar: two people they added by hand, plus one member we placed who has since lapsed.
  const attendees = ['hand-added@example.com', 'a-friend@example.org', 'lapsed@example.com'];
  const placed = new Map([['lapsed@example.com', '900']]);

  const plan = planShoptalkEnrollment({
    members: [member('900', 'expired', 'lapsed@example.com')],
    attendees,
    placed,
  });

  // POSITIVE CONTROL, and the reason this test is trustworthy. Without it, a planner that removed everything
  // and a planner that removed nothing would both satisfy the assertion below on an empty fixture.
  assert.equal(plan.foreign.length, 2, 'the fixture must actually contain unattributed attendees');
  const foreignAddrs = plan.foreign.map((r) => r.address).sort();
  assert.deepEqual(foreignAddrs, ['a-friend@example.org', 'hand-added@example.com']);

  const removed = plan.remove.map((r) => r.address);
  assert.deepEqual(removed, ['lapsed@example.com'], 'only the address we placed may be removed');
  for (const addr of foreignAddrs) {
    assert.ok(!removed.includes(addr), `${addr} was placed by the owner and must never be removed`);
  }
});

test('RULE 1 holds even when the unattributed attendee belongs to a BANNED member', () => {
  // The tempting shortcut is "remove any attendee whose address maps to an ineligible member". That would
  // strip an address the owner added deliberately, for their own reasons, for somebody we happen to know.
  const plan = planShoptalkEnrollment({
    members: [member('7', 'banned', 'banned@example.com')],
    attendees: ['banned@example.com'],
    placed: new Map(), // we did NOT place it
  });
  assert.deepEqual(plan.remove, [], 'an address we did not place stays, whoever it belongs to');
  assert.deepEqual(plan.foreign.map((r) => r.address), ['banned@example.com']);
});

test('RULE 2: a member who removed themselves is not re-added, and their placed seat comes off', () => {
  const plan = planShoptalkEnrollment({
    members: [member('11', 'paid', 'quit@example.com')],
    attendees: ['quit@example.com'],
    placed: new Map([['quit@example.com', '11']]),
    optedOut: new Set(['11']),
  });
  assert.deepEqual(plan.add, [], 'an opted-out member must never be re-added by a sweep');
  assert.equal(plan.optedOut.length, 1);
  assert.equal(plan.optedOut[0].reason, SKIP_REASON.OPTED_OUT);
  assert.deepEqual(plan.remove.map((r) => r.address), ['quit@example.com'],
    'the seat we placed before they opted out must come off');
});

test('RULE 2: the opt-out is keyed by MEMBER, so it survives an address change', () => {
  // Keying the opt-out by address would let a member who linked a Google account be swept straight back in
  // under the new address, which is the same failure wearing a different hat.
  const plan = planShoptalkEnrollment({
    members: [member('11', 'paid', 'old@example.com')],
    attendees: [],
    placed: new Map(),
    optedOut: new Set(['11']),
    preferred: new Map([['11', 'new@gmail.com']]),
  });
  assert.deepEqual(plan.add, [], 'a new address does not defeat the opt-out');
  assert.equal(plan.optedOut.length, 1);
});

test('RULE 3: a member with no address anywhere is reported by name, not skipped', () => {
  // Override-only members (a grandfather grant, no Stripe Customer) carry email: null. A silent skip reads
  // as success in every count the owner sees.
  const plan = planShoptalkEnrollment({
    members: [member('42', 'paid', null)],
    attendees: [],
  });
  assert.deepEqual(plan.add, []);
  assert.equal(plan.unreachable.length, 1, 'the member must appear in the report');
  assert.equal(plan.unreachable[0].githubId, '42');
  assert.equal(plan.unreachable[0].githubLogin, 'user42', 'the row must name them, or it cannot be acted on');
  assert.equal(plan.unreachable[0].reason, SKIP_REASON.NO_EMAIL);
});

test('a TRIAL member earns a seat, and the status spelling is the real one', () => {
  // `trialing`, not `trial`. The conversational word is "trial", and a planner written against that spelling
  // matches nobody, adds nobody, and reports a clean run forever.
  assert.ok(ELIGIBLE_STATUSES.has('trialing'), 'trialing is the STATUS value from derive-status.mjs');
  assert.ok(!ELIGIBLE_STATUSES.has('trial'), 'guard against the wrong spelling being added later');

  const plan = planShoptalkEnrollment({
    members: [member('5', 'trialing', 'trial@example.com')],
    attendees: [],
  });
  assert.deepEqual(plan.add.map((r) => r.address), ['trial@example.com']);
});

test('free, expired, cancelled and banned members earn no seat', () => {
  const members = [
    member('1', 'none', 'free@example.com'),
    member('2', 'expired', 'expired@example.com'),
    member('3', 'cancelled', 'cancelled@example.com'),
    member('4', 'banned', 'banned@example.com'),
  ];
  const plan = planShoptalkEnrollment({ members, attendees: [] });
  assert.deepEqual(plan.add, [], 'none of these statuses is eligible');
  assert.equal(plan.unreachable.length, 0, 'an ineligible member is not "unreachable", they are ineligible');
});

test('a member the owner already added BY HAND is adopted, never added twice', () => {
  const plan = planShoptalkEnrollment({
    members: [member('8', 'paid', 'known@example.com')],
    attendees: ['known@example.com'],
    placed: new Map(), // we never placed it: the owner did, before this feature existed
  });
  assert.deepEqual(plan.add, [], 'they are already on the event, so there is nothing to do');
  assert.equal(plan.alreadyOn.length, 1);
  assert.equal(plan.alreadyOn[0].address, 'known@example.com');
  assert.deepEqual(plan.foreign, [], 'a hand-added address matching a member is adopted, not flagged foreign');
  assert.deepEqual(plan.remove, []);
});

test('a linked Google address wins over the GitHub one', () => {
  const plan = planShoptalkEnrollment({
    members: [member('9', 'paid', 'github@example.com')],
    attendees: [],
    preferred: new Map([['9', 'Chosen@Gmail.com']]),
  });
  assert.deepEqual(plan.add.map((r) => r.address), ['chosen@gmail.com'], 'and it is normalized');
});

test('addresses are matched case-insensitively against the live guest list', () => {
  // Google compares attendee addresses case-insensitively. Matching case-sensitively here would see an
  // existing guest as absent and add a duplicate, mailing them a second invitation.
  const plan = planShoptalkEnrollment({
    members: [member('10', 'paid', 'Mixed.Case@Example.com')],
    attendees: ['mixed.case@example.com'],
  });
  assert.deepEqual(plan.add, [], 'a differently-cased match is the same guest');
  assert.equal(plan.alreadyOn.length, 1);
});

test('the plan is IDEMPOTENT: applying it and re-planning yields no further changes', () => {
  const members = [
    member('1', 'paid', 'a@example.com'),
    member('2', 'trialing', 'b@example.com'),
    member('3', 'expired', 'c@example.com'),
  ];
  let attendees = ['c@example.com', 'owner-friend@example.org'];
  let placed = new Map([['c@example.com', '3']]);

  const first = planShoptalkEnrollment({ members, attendees, placed });
  assert.equal(enrollmentCounts(first).changes, 3, 'two adds and one removal on the first pass');

  // Apply it the way the runner would.
  const next = new Set(attendees);
  for (const r of first.add) { next.add(r.address); placed.set(r.address, r.githubId); }
  for (const r of first.remove) { next.delete(r.address); placed.delete(r.address); }
  attendees = [...next];

  const second = planShoptalkEnrollment({ members, attendees, placed });
  const counts = enrollmentCounts(second);
  assert.equal(counts.changes, 0, 'a second sweep must change nothing and therefore mail nobody');
  assert.equal(counts.alreadyOn, 2);
  assert.deepEqual(second.foreign.map((r) => r.address), ['owner-friend@example.org'],
    'and the owner\'s own guest survived both passes');
});

test('a placed address already gone from the event is not removed again', () => {
  // The owner removed somebody by hand. Emitting a removal for an absent attendee would be a wasted API call
  // and, worse, a plan whose counts overstate what actually happens.
  const plan = planShoptalkEnrollment({
    members: [member('6', 'expired', 'gone@example.com')],
    attendees: [],
    placed: new Map([['gone@example.com', '6']]),
  });
  assert.deepEqual(plan.remove, []);
  assert.equal(enrollmentCounts(plan).changes, 0);
});

test('enrollmentCounts reports every bucket and survives a malformed plan', () => {
  const empty = enrollmentCounts(null);
  assert.equal(empty.changes, 0);
  assert.deepEqual(Object.keys(empty).sort(),
    ['add', 'alreadyOn', 'changes', 'foreign', 'optedOut', 'remove', 'unreachable']);
});

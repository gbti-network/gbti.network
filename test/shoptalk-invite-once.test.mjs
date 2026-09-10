// sow-314, 2026-09-10: the two rules added after the sweep mailed 22 members a cancellation on the evening of
// 2026-09-09 and a fresh invitation the next morning.
//
//   RULE 4  absence from the roster is not a lapse   (the targeted one-member run is the case that bit)
//   RULE 5  the invitation goes out once             (owner: "do not send out any more re-invitations")
//
// Plus the sweep's removal cap and the seen record it maintains. Every test here is a MAIL test: each asserts
// what the calendar would have been told to send, because that is the thing that reached real inboxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoptalkEnrollment, enrollmentCounts, SKIP_REASON } from '../scripts/lib/shoptalk-enroll.mjs';
import { runShoptalkSweep, nextSeenRecord, describeSweep, MAX_REMOVALS_PER_RUN } from '../scripts/lib/shoptalk-sweep.mjs';
import { enactShoptalk, shoptalkTargetedSkip } from '../scripts/reconcile.mjs';

const member = (githubId, status, email) => ({ githubId, githubLogin: `user${githubId}`, username: `user${githubId}`, email, effective: { status, source: 'stripe' } });
const seats = (n, prefix = 'm') => Array.from({ length: n }, (_, i) => [`${prefix}${i}@example.com`, String(100 + i)]);

// ---------------------------------------------------------------------------------------------------------
// RULE 4
// ---------------------------------------------------------------------------------------------------------

test('RULE 4: the targeted one-member roster removes NOBODY (the 2026-09-09 incident, replayed)', () => {
  // 22 seats we placed, all on the event, and a roster containing only the one member a payment fired for.
  const placed = new Map(seats(22));
  const attendees = [...placed.keys(), 'hand-added@example.org'];
  const plan = planShoptalkEnrollment({ members: [member('999', 'paid', 'new@example.com')], attendees, placed });
  assert.deepEqual(plan.remove, [], 'the first version removed all 22 here');
  assert.equal(plan.unaccounted.length, 22, 'they are reported, by address, as not in this roster');
  assert.equal(plan.unaccounted[0].reason, SKIP_REASON.UNACCOUNTED);
  assert.equal(plan.add.length, 1, 'the new member is still added');
  assert.equal(enrollmentCounts(plan).changes, 1);
});

test('RULE 4 control: a member PRESENT in the roster and lapsed is still removed', () => {
  // Without this the rule above would pass on a planner that never removes anybody.
  const placed = new Map([['lapsed@example.com', '7'], ['fine@example.com', '8']]);
  const plan = planShoptalkEnrollment({
    members: [member('7', 'expired', 'lapsed@example.com'), member('8', 'paid', 'fine@example.com')],
    attendees: [...placed.keys()], placed,
  });
  assert.deepEqual(plan.remove.map((r) => r.address), ['lapsed@example.com']);
  assert.equal(plan.remove[0].why, 'not-eligible');
  assert.equal(plan.unaccounted.length, 0);
});

test('RULE 4: an opted-out member present in the roster is removed (the Worker backstop), absent is not', () => {
  const placed = new Map([['a@example.com', '1'], ['b@example.com', '2']]);
  const plan = planShoptalkEnrollment({
    members: [member('1', 'paid', 'a@example.com')], attendees: [...placed.keys()], placed, optedOut: new Set(['1', '2']),
  });
  assert.deepEqual(plan.remove.map((r) => r.address), ['a@example.com']);
  assert.equal(plan.remove[0].why, 'opted-out');
  assert.deepEqual(plan.unaccounted.map((r) => r.address), ['b@example.com'], 'member 2 is not in this roster, so their seat stays even though a marker exists');
});

test('an address change is reported as stale and the old seat is left, never cancelled', () => {
  const placed = new Map([['old@example.com', '5']]);
  const plan = planShoptalkEnrollment({ members: [member('5', 'paid', 'new@example.com')], attendees: ['old@example.com'], placed });
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.stale.length, 1);
  assert.equal(plan.stale[0].address, 'old@example.com');
  assert.deepEqual(plan.add.map((r) => r.address), ['new@example.com'], 'the new address gets its one invitation');
});

// ---------------------------------------------------------------------------------------------------------
// RULE 5
// ---------------------------------------------------------------------------------------------------------

test('RULE 5: an address the sweep has seen before and that has left the event is NOT re-added', () => {
  const seen = new Map([['gone@example.com', '3']]);
  const plan = planShoptalkEnrollment({ members: [member('3', 'paid', 'gone@example.com')], attendees: [], seen });
  assert.deepEqual(plan.add, [], 'this is the re-invitation the owner ruled out');
  assert.equal(plan.dropped.length, 1);
  assert.equal(plan.dropped[0].reason, SKIP_REASON.DROPPED);
});

test('RULE 5: a placed address counts as seen even when the seen record is empty (cold start)', () => {
  // The placed record predates the seen record. A member we placed on 2026-09-07 who was then removed by hand
  // must not be re-invited by the first run after this rule landed.
  const placed = new Map([['placed@example.com', '4']]);
  const plan = planShoptalkEnrollment({ members: [member('4', 'paid', 'placed@example.com')], attendees: [], placed, seen: new Map() });
  assert.deepEqual(plan.add, []);
  assert.equal(plan.dropped.length, 1);
});

test('RULE 5 control: a member never seen and not on the event IS added, once', () => {
  const plan = planShoptalkEnrollment({ members: [member('6', 'trialing', 'brand-new@example.com')], attendees: [], seen: new Map([['other@example.com', '9']]) });
  assert.deepEqual(plan.add.map((r) => r.address), ['brand-new@example.com']);
  assert.deepEqual(plan.dropped, []);
});

test('the seen record remembers alreadyOn and add, and releases only what the sweep itself removed', () => {
  const plan = {
    alreadyOn: [{ address: 'On@Example.com', githubId: '1' }],
    add: [{ address: 'new@example.com', githubId: '2' }],
    remove: [{ address: 'lapsed@example.com', githubId: '3' }],
  };
  const next = nextSeenRecord(new Map([['lapsed@example.com', '3'], ['hand-removed@example.com', '4']]), plan);
  assert.equal(next.get('on@example.com'), '1', 'normalized');
  assert.equal(next.get('new@example.com'), '2');
  assert.equal(next.has('lapsed@example.com'), false, 'a lapse releases the address so a returning member gets one fresh invitation');
  assert.equal(next.get('hand-removed@example.com'), '4', 'an address somebody else removed stays remembered: never re-added');
});

// ---------------------------------------------------------------------------------------------------------
// the sweep: the cap, the seen write, and the no-mail proof
// ---------------------------------------------------------------------------------------------------------

function fakeCal(guests = []) {
  const cal = {
    writes: [], guests: guests.slice(),
    async nextOccurrences() { return [{ id: 'i', recurringEventId: 'S1', status: 'confirmed', start: { dateTime: '2026-09-12T11:00:00-05:00' } }]; },
    async listAttendees() { return cal.guests.slice(); },
    async setAttendees(id, list, opts) { cal.writes.push({ id, list, opts }); cal.guests = list.slice(); },
  };
  return cal;
}

test('a full roster where everyone is already on writes NOTHING to the calendar, and seeds the seen record', async () => {
  // The state of the real calendar on the morning of 2026-09-10: 23 placed, 4 adopted, all on the event.
  const placed = new Map(seats(23));
  const adopted = seats(4, 'h');
  const members = [...placed].map(([a, id]) => member(id, 'paid', a)).concat(adopted.map(([a, id]) => member(id, 'paid', a)));
  const cal = fakeCal([...placed.keys(), ...adopted.map(([a]) => a), 'foreign@example.org']);
  const r = await runShoptalkSweep({ members, cal, placed, seen: new Map(), apply: true });
  assert.equal(r.ok, true);
  assert.equal(cal.writes.length, 0, 'no PATCH means no mail to anybody');
  assert.equal(r.counts.changes, 0);
  assert.equal(r.seenChanged, true);
  assert.equal(r.seen.size, 27, 'every member address on the event is remembered from now on');
  assert.equal(r.seen.has('foreign@example.org'), false, 'a non-member address is not ours to remember');
});

test('the removal cap withholds every removal past the limit, applies the additions, and says so', async () => {
  const placed = new Map(seats(MAX_REMOVALS_PER_RUN + 1));
  const members = [...placed].map(([a, id]) => member(id, 'expired', a)).concat([member('500', 'paid', 'new@example.com')]);
  const cal = fakeCal([...placed.keys()]);
  const r = await runShoptalkSweep({ members, cal, placed, apply: true });
  assert.equal(r.ok, true);
  assert.equal(r.withheld.length, MAX_REMOVALS_PER_RUN + 1);
  assert.equal(r.counts.remove, 0);
  assert.equal(cal.writes.length, 1);
  assert.deepEqual(cal.writes[0].list, [...placed.keys(), 'new@example.com'], 'the lapsed seats stay; the new member is added');
  assert.match(describeSweep(r), /REFUSED 6 removal/);
  assert.equal(r.seen.has([...placed.keys()][0]), false, 'a withheld removal does not touch the seen record either way');
});

test('control: removals within the cap are applied and released from seen', async () => {
  const placed = new Map(seats(2));
  const members = [...placed].map(([a, id]) => member(id, 'expired', a));
  const cal = fakeCal([...placed.keys()]);
  const r = await runShoptalkSweep({ members, cal, placed, seen: new Map(placed), apply: true });
  assert.equal(r.withheld.length, 0);
  assert.equal(cal.writes.length, 1);
  assert.deepEqual(cal.writes[0].list, []);
  assert.equal(r.seen.size, 0);
  assert.equal(r.placed.size, 0);
});

// ---------------------------------------------------------------------------------------------------------
// reconcile: the targeted guard and the seen write
// ---------------------------------------------------------------------------------------------------------

test('a targeted run skips the sweep by name; a full run does not', () => {
  assert.equal(shoptalkTargetedSkip(null), null);
  assert.equal(shoptalkTargetedSkip(''), null);
  assert.match(shoptalkTargetedSkip('410930'), /SKIPPED in targeted mode \(github_id 410930\)/);
});

const CREDS = { GOOGLE_CALENDAR_CLIENT_ID: 'id', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec', GOOGLE_CALENDAR_REFRESH_TOKEN: 'ref', CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
function kvFetch({ placed = null, seen = null, puts = [] } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    if (init.method === 'PUT') { puts.push({ url: u, body: init.body }); return { ok: true, status: 200 }; }
    if (u.includes('/keys?')) return { ok: true, status: 200, json: async () => ({ result: [], result_info: {} }) };
    if (u.includes('/values/')) {
      const doc = u.endsWith('shoptalk%3Aseen') || u.endsWith('shoptalk:seen') ? seen : placed;
      if (doc === null) return { ok: false, status: 404 };
      return { ok: true, status: 200, text: async () => JSON.stringify(doc) };
    }
    return { ok: false, status: 404 };
  };
}

test('enactShoptalk writes the seen record on a zero-change apply run, and never on a dry run', async () => {
  const puts = [];
  const cal = fakeCal(['a@x.com']);
  const r = await enactShoptalk([member('1', 'paid', 'a@x.com')], { env: CREDS, apply: true, calendar: cal, fetchImpl: kvFetch({ placed: { 'a@x.com': '1' }, puts }) });
  assert.equal(r.ok, true);
  assert.equal(cal.writes.length, 0);
  assert.equal(puts.length, 1, 'one write: the seen record');
  assert.match(puts[0].url, /shoptalk(%3A|:)seen/);
  assert.deepEqual(JSON.parse(puts[0].body), { 'a@x.com': '1' });

  const dry = [];
  await enactShoptalk([member('1', 'paid', 'a@x.com')], { env: CREDS, apply: false, calendar: fakeCal(['a@x.com']), fetchImpl: kvFetch({ placed: { 'a@x.com': '1' }, puts: dry }) });
  assert.equal(dry.length, 0, 'a dry run writes nothing, the seen record included');
});

test('enactShoptalk refuses when the seen record is unreadable, and touches nothing', async () => {
  const cal = fakeCal([]);
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/keys?')) return { ok: true, status: 200, json: async () => ({ result: [], result_info: {} }) };
    if (u.includes('/values/') && /shoptalk(%3A|:)seen/.test(u)) return { ok: true, status: 200, text: async () => 'not json' };
    if (u.includes('/values/')) return { ok: false, status: 404 };
    return { ok: false, status: 404 };
  };
  const r = await enactShoptalk([member('1', 'paid', 'gone@x.com')], { env: CREDS, apply: true, calendar: cal, fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.reason, /seen record is not valid JSON/);
  assert.equal(cal.writes.length, 0, 'an unreadable seen record would otherwise re-invite everybody who left');
});

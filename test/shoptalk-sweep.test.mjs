// sow-314: the enrollment sweep end to end, against a fake calendar.
//
// The tests that earn their keep here are the ones where a wrong sweep still LOOKS fine: a missing series
// reported as "nothing to do", and a write that quietly drops the owner's own guests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runShoptalkSweep, nextAttendeeList, nextPlacedRecord, describeSweep, SHOPTALK_PLACED_KEY,
} from '../scripts/lib/shoptalk-sweep.mjs';

const member = (id, status, email) => ({
  githubId: id, githubLogin: `u${id}`, username: `u${id}`, email,
  effective: { status, source: 'stripe' },
});

/** A calendar double that records writes. `attendees` is the live guest list. */
function fakeCal({ instances = [{ id: 'i', recurringEventId: 'S1', status: 'confirmed', start: { dateTime: '2026-09-12T11:00:00-05:00' } }], attendees = [] } = {}) {
  const writes = [];
  return {
    writes,
    async nextOccurrences() { return instances; },
    async listAttendees() { return attendees === null ? null : attendees.slice(); },
    async setAttendees(id, list, opts) { writes.push({ id, list, opts }); },
  };
}

test('a MISSING series changes nothing and does not read as success', async () => {
  const cal = fakeCal({ instances: [] });
  const r = await runShoptalkSweep({ members: [member('1', 'paid', 'a@x.com')], cal, apply: true });
  assert.equal(r.ok, false);
  assert.equal(r.applied, false);
  assert.equal(cal.writes.length, 0, 'nothing may be written when the series cannot be found');
  assert.match(describeSweep(r), /CANNOT RUN/);
  assert.doesNotMatch(describeSweep(r), /applied/);
});

test('a series that cannot be READ BACK also changes nothing', async () => {
  const cal = fakeCal({ attendees: null });
  const r = await runShoptalkSweep({ members: [member('1', 'paid', 'a@x.com')], cal, apply: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'series-vanished');
  assert.equal(cal.writes.length, 0);
});

test('THE DESTRUCTIVE CASE: the write preserves guests the sweep did not place', async () => {
  const cal = fakeCal({ attendees: ['hand@owner.com', 'friend@x.org', 'lapsed@x.com'] });
  const r = await runShoptalkSweep({
    members: [member('9', 'expired', 'lapsed@x.com'), member('1', 'paid', 'new@x.com')],
    cal,
    placed: new Map([['lapsed@x.com', '9']]),
    apply: true,
  });
  assert.equal(r.applied, true);
  const written = cal.writes[0].list;
  // Positive control: the fixture really did contain guests we never placed.
  assert.equal(r.counts.foreign, 2, 'fixture must contain unattributed guests or this proves nothing');
  assert.ok(written.includes('hand@owner.com'), "the owner's hand-added guest must survive the write");
  assert.ok(written.includes('friend@x.org'), 'a non-member guest must survive the write');
  assert.ok(!written.includes('lapsed@x.com'), 'the lapsed member we placed comes off');
  assert.ok(written.includes('new@x.com'), 'the new paid member goes on');
});

test('every attendee write notifies, or guests are added in silence', async () => {
  const cal = fakeCal({ attendees: [] });
  await runShoptalkSweep({ members: [member('1', 'paid', 'a@x.com')], cal, apply: true });
  assert.equal(cal.writes[0].opts.sendUpdates, 'all',
    'without this Google records the guest and mails nobody, which is the feature failing invisibly');
});

test('a DRY RUN still reads, so its numbers are the numbers apply would act on', async () => {
  const cal = fakeCal({ attendees: ['hand@owner.com'] });
  const r = await runShoptalkSweep({ members: [member('1', 'paid', 'a@x.com')], cal, apply: false });
  assert.equal(r.ok, true);
  assert.equal(r.applied, false);
  assert.equal(cal.writes.length, 0, 'a dry run must not write');
  assert.equal(r.counts.add, 1, 'but it must still have planned against the real guest list');
  assert.equal(r.counts.foreign, 1);
});

test('a sweep with NOTHING to do writes nothing, so it cannot mail anyone', async () => {
  const cal = fakeCal({ attendees: ['a@x.com'] });
  const r = await runShoptalkSweep({ members: [member('1', 'paid', 'a@x.com')], cal, apply: true });
  assert.equal(r.counts.changes, 0);
  assert.equal(cal.writes.length, 0, 'an idempotent second run must not re-write the same list');
  assert.equal(r.applied, false);
});

test('the placed record claims additions and releases removals, and never learns a foreign address', async () => {
  const cal = fakeCal({ attendees: ['hand@owner.com', 'gone@x.com'] });
  const r = await runShoptalkSweep({
    members: [member('7', 'expired', 'gone@x.com'), member('8', 'trialing', 'fresh@x.com')],
    cal, placed: new Map([['gone@x.com', '7']]), apply: true,
  });
  assert.deepEqual([...r.placed.entries()], [['fresh@x.com', '8']]);
  assert.ok(!r.placed.has('hand@owner.com'), 'a guest we did not place must never enter the record');
});

test('nextAttendeeList dedupes and normalizes without losing anyone', () => {
  const list = nextAttendeeList(['A@X.com', 'a@x.com', 'keep@x.com', ''], { remove: [], add: [{ address: 'new@x.com' }] });
  assert.deepEqual(list, ['a@x.com', 'keep@x.com', 'new@x.com']);
});

test('nextPlacedRecord does not mutate the map it was given', () => {
  const before = new Map([['a@x.com', '1']]);
  const after = nextPlacedRecord(before, { add: [{ address: 'b@x.com', githubId: '2' }], remove: [{ address: 'a@x.com' }] });
  assert.deepEqual([...before.entries()], [['a@x.com', '1']], 'the input map is untouched');
  assert.deepEqual([...after.entries()], [['b@x.com', '2']]);
});

test('the KV key is a single stable document', () => {
  assert.equal(SHOPTALK_PLACED_KEY, 'shoptalk:placed');
});

test('a sweep without a calendar client throws rather than reporting a clean run', async () => {
  await assert.rejects(() => runShoptalkSweep({ members: [] }), /calendar client is required/);
});

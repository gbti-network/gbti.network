// sow-314: the member-facing Shop Talk endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleShoptalk, eraseMemberShoptalk, SHOPTALK_OPTOUT_KEY } from '../workers/signup/membership-shoptalk.mjs';

function fakeKv(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
  };
}
function fakeCal({ series = 'S1', guests = [], instances = null } = {}) {
  // `guests` is read through the object, not through the closed-over parameter. The first version of this
  // double closed over the parameter, so a test that updated cal.guests between calls changed nothing and the
  // handler kept seeing a stale list. It reported a real defect that did not exist.
  const cal = {
    writes: [],
    guests: guests.slice(),
    async nextOccurrences() {
      return instances ?? [{ id: 'i', recurringEventId: series, status: 'confirmed', start: { dateTime: '2026-09-12T11:00:00-05:00' } }];
    },
    async listAttendees() { return cal.guests.slice(); },
    async setAttendees(id, list, opts) { cal.writes.push({ id, list, opts }); cal.guests = list.slice(); },
  };
  return cal;
}
const req = (method, body) => new Request('https://x/membership/shoptalk', {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
const authAs = (status, githubId = '1') => async () => ({ ok: true, githubId, login: 'u', status, source: 'stripe' });

test('a paid member already on the list is told so', async () => {
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: fakeCal({ guests: ['m@x.com'] }), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.eligible, true);
  assert.equal(r.body.enrolled, true);
  assert.equal(r.body.address, 'm@x.com');
  assert.equal(r.body.nextCall, '2026-09-12T11:00:00-05:00');
});

test('a TRIAL member is eligible, matching the owner decision', async () => {
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv(), authorize: authAs('trialing'), calendar: fakeCal({ guests: [] }), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.eligible, true);
  assert.equal(r.body.enrolled, false);
});

test('a FREE member gets a real answer plus the reason, not a 403', async () => {
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv(), authorize: authAs('none'), calendar: fakeCal(), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.status, 200, 'a 403 here would read as breakage rather than as an upgrade prompt');
  assert.equal(r.body.eligible, false);
  assert.equal(r.body.status, 'none');
});

test('an UNREACHABLE calendar reports enrolled as unknown, never as false', async () => {
  // Saying "you are not on the list" when we could not look invites a member to press a button they do not
  // need, and it is a confident lie.
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: null, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.enrolled, null, 'null means unknown; false would be a claim we cannot support');
  assert.equal(r.body.eligible, true);
});

test('a missing series also reports unknown rather than false', async () => {
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: fakeCal({ instances: [] }), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.enrolled, null);
});

test('LEAVE records the marker BEFORE touching the calendar, and removes the guest', async () => {
  const kv = fakeKv();
  const cal = fakeCal({ guests: ['m@x.com', 'other@x.com'] });
  const r = await handleShoptalk(req('POST', { action: 'leave' }), {}, {
    kv, authorize: authAs('paid'), calendar: cal, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.optedOut, true);
  assert.ok(kv.map.has(SHOPTALK_OPTOUT_KEY('1')), 'the marker must exist or the next sweep re-invites them');
  assert.deepEqual(cal.writes[0].list, ['other@x.com'], 'only the caller comes off');
  assert.equal(cal.writes[0].opts.sendUpdates, 'all');
});

test('LEAVE still records the opt-out when the calendar cannot be reached', async () => {
  // The marker is what stops the next sweep undoing the request, so it must survive a calendar outage.
  const kv = fakeKv();
  const r = await handleShoptalk(req('POST', { action: 'leave' }), {}, {
    kv, authorize: authAs('paid'), calendar: null, lookupEmail: async () => 'm@x.com',
  });
  assert.ok(kv.map.has(SHOPTALK_OPTOUT_KEY('1')));
  assert.equal(r.body.applied, false);
  assert.match(r.body.message, /next sweep/);
});

test('REJOIN clears the marker and puts the guest back', async () => {
  const kv = fakeKv({ [SHOPTALK_OPTOUT_KEY('1')]: '{"optedOut":true}' });
  const cal = fakeCal({ guests: ['other@x.com'] });
  const r = await handleShoptalk(req('POST', { action: 'rejoin' }), {}, {
    kv, authorize: authAs('paid'), calendar: cal, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(kv.map.has(SHOPTALK_OPTOUT_KEY('1')), false, 'the marker must go or the sweep removes them again');
  assert.deepEqual(cal.writes[0].list, ['other@x.com', 'm@x.com']);
  assert.equal(r.body.enrolled, true);
});

test('REJOIN is refused for an ineligible member and leaves no trace', async () => {
  const kv = fakeKv({ [SHOPTALK_OPTOUT_KEY('1')]: '{"optedOut":true}' });
  const cal = fakeCal({ guests: [] });
  const r = await handleShoptalk(req('POST', { action: 'rejoin' }), {}, {
    kv, authorize: authAs('expired'), calendar: cal, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.status, 403);
  assert.equal(cal.writes.length, 0, 'a refused rejoin must not write to the calendar');
  assert.ok(kv.map.has(SHOPTALK_OPTOUT_KEY('1')), 'and must not clear the marker');
});

test('pressing LEAVE twice is harmless and writes the calendar once', async () => {
  const kv = fakeKv();
  const cal = fakeCal({ guests: ['m@x.com'] });
  const deps = { kv, authorize: authAs('paid'), calendar: cal, lookupEmail: async () => 'm@x.com' };
  await handleShoptalk(req('POST', { action: 'leave' }), {}, deps);
  assert.deepEqual(cal.guests, [], 'the double must reflect the write, or the second press proves nothing');
  await handleShoptalk(req('POST', { action: 'leave' }), {}, deps);
  assert.equal(cal.writes.length, 1, 'the second press must not re-write, and so must not mail anyone');
});

test('a member with no address on file is told so rather than silently doing nothing', async () => {
  const r = await handleShoptalk(req('POST', { action: 'leave' }), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: fakeCal(), lookupEmail: async () => '',
  });
  assert.equal(r.body.applied, false);
  assert.match(r.body.message, /no email address/);
});

test('a denied caller is passed straight through, and nothing is read or written', async () => {
  const kv = fakeKv();
  const cal = fakeCal();
  const r = await handleShoptalk(req('GET'), {}, {
    kv, calendar: cal, authorize: async () => ({ ok: false, status: 403, body: { error: 'denied' } }),
  });
  assert.equal(r.status, 403);
  assert.equal(cal.writes.length, 0);
  assert.equal(kv.map.size, 0);
});

test('a bad action and a bad method are rejected', async () => {
  const deps = { kv: fakeKv(), authorize: authAs('paid'), calendar: fakeCal() };
  assert.equal((await handleShoptalk(req('POST', { action: 'nope' }), {}, deps)).status, 400);
  assert.equal((await handleShoptalk(req('DELETE'), {}, deps)).status, 405);
});

test('erasure removes the opt-out marker', async () => {
  const kv = fakeKv({ [SHOPTALK_OPTOUT_KEY('7')]: '{"optedOut":true}' });
  assert.deepEqual(await eraseMemberShoptalk({}, '7', { kv }), { ok: true });
  assert.equal(kv.map.size, 0);
});

// ---------------------------------------------------------------------------------------------------------
// 2026-09-10: the member decides. A decline stays declined, a removed seat stays removed, and Rejoin is the
// one way back, sending exactly one fresh invitation.
// ---------------------------------------------------------------------------------------------------------
import { SEEN_KEY } from '../scripts/lib/shoptalk-state.mjs';
import { SHOPTALK_SEEN_KEY } from '../workers/signup/membership-shoptalk.mjs';

/** A calendar double that also knows each guest's RSVP, the way the real client's attendeeDetails does. */
function rsvpCal({ guests = [], declined = [] } = {}) {
  const cal = fakeCal({ guests });
  cal.declined = new Set(declined);
  cal.attendeeDetails = async () => cal.guests.map((email) => ({ email, responseStatus: cal.declined.has(email) ? 'declined' : 'needsAction' }));
  return cal;
}

test('the Worker reads the same seen record the sweep writes (one spelling, pinned)', () => {
  assert.equal(SHOPTALK_SEEN_KEY, SEEN_KEY);
});

test('GET reports a DECLINED guest as declined, still enrolled', async () => {
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: rsvpCal({ guests: ['m@x.com'], declined: ['m@x.com'] }), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.enrolled, true);
  assert.equal(r.body.declined, true);
  assert.equal(r.body.dropped, false);
});

test('GET reports a member invited before and no longer on the list as DROPPED, not "being added"', async () => {
  const kv = fakeKv({ [SEEN_KEY]: JSON.stringify({ 'm@x.com': '1' }) });
  const r = await handleShoptalk(req('GET'), {}, {
    kv, authorize: authAs('paid'), calendar: rsvpCal({ guests: [] }), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.enrolled, false);
  assert.equal(r.body.dropped, true, 'the sweep will not re-add them, so the page must not promise it');
});

test('GET: a member never invited and not on the list is NOT dropped (the sweep will add them)', async () => {
  const r = await handleShoptalk(req('GET'), {}, {
    kv: fakeKv({ [SEEN_KEY]: JSON.stringify({ 'someone-else@x.com': '2' }) }), authorize: authAs('paid'), calendar: rsvpCal({ guests: [] }), lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.dropped, false);
});

test('REJOIN while declined takes the guest off silently and puts them back with one invitation', async () => {
  const cal = rsvpCal({ guests: ['a@x.com', 'm@x.com', 'z@x.com'], declined: ['m@x.com'] });
  const r = await handleShoptalk(req('POST', { action: 'rejoin' }), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: cal, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.applied, true);
  assert.equal(r.body.resent, true);
  assert.equal(cal.writes.length, 2);
  assert.equal(cal.writes[0].opts.sendUpdates, 'none', 'the removal must not mail a cancellation to somebody asking to come back');
  assert.deepEqual(cal.writes[0].list, ['a@x.com', 'z@x.com']);
  assert.equal(cal.writes[1].opts.sendUpdates, 'all', 'the re-add is the one invitation they asked for');
  assert.deepEqual(cal.writes[1].list, ['a@x.com', 'z@x.com', 'm@x.com']);
});

test('REJOIN while on the list and not declined changes nothing and says so', async () => {
  const cal = rsvpCal({ guests: ['m@x.com'] });
  const r = await handleShoptalk(req('POST', { action: 'rejoin' }), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: cal, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.body.applied, false);
  assert.match(r.body.message, /already on the guest list/);
  assert.equal(cal.writes.length, 0);
});

test('REJOIN with no reachable calendar is an error, not a promise the sweep would break', async () => {
  // Under rule 5 the sweep never re-adds an address it has seen, so "goes out on the next sweep" would be false.
  const r = await handleShoptalk(req('POST', { action: 'rejoin' }), {}, {
    kv: fakeKv(), authorize: authAs('paid'), calendar: null, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'calendar_unavailable');
  assert.match(r.body.message, /Try again/);
});

test('LEAVE with no reachable calendar is still recorded (the sweep completes it)', async () => {
  const kv = fakeKv();
  const r = await handleShoptalk(req('POST', { action: 'leave' }), {}, {
    kv, authorize: authAs('paid'), calendar: null, lookupEmail: async () => 'm@x.com',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.optedOut, true);
  assert.ok(kv.map.has(SHOPTALK_OPTOUT_KEY('1')), 'the marker is what the sweep reads');
});

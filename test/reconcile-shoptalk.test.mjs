// sow-314: reconcile's Shop Talk enactment, and specifically that every refusal path changes nothing and
// says why. A sweep reporting "0 changes" when it could not read the opt-out list looks identical to a
// healthy quiet run, which is the failure this whole feature exists to avoid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { enactShoptalk } from '../scripts/reconcile.mjs';

const CREDS = {
  GOOGLE_CALENDAR_CLIENT_ID: 'id', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec', GOOGLE_CALENDAR_REFRESH_TOKEN: 'ref',
  CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't',
};
const member = (id, status, email) => ({ githubId: id, githubLogin: `u${id}`, email, effective: { status, source: 'stripe' } });

function fakeCal(guests = []) {
  const cal = {
    writes: [], guests: guests.slice(),
    async nextOccurrences() { return [{ id: 'i', recurringEventId: 'S1', status: 'confirmed', start: { dateTime: '2026-09-12T11:00:00-05:00' } }]; },
    async listAttendees() { return cal.guests.slice(); },
    async setAttendees(id, list, opts) { cal.writes.push({ id, list, opts }); cal.guests = list.slice(); },
  };
  return cal;
}
/** KV over REST: key list for the opt-out prefix, value read for the placed doc, PUT for the write-back. */
function kvFetch({ optoutKeys = [], placed = null, puts = [] } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    if (init.method === 'PUT') { puts.push(init.body); return { ok: true, status: 200 }; }
    if (u.includes('/keys?')) return { ok: true, status: 200, json: async () => ({ result: optoutKeys.map((k) => ({ name: k })), result_info: {} }) };
    if (u.includes('/values/')) {
      if (placed === null) return { ok: false, status: 404 };
      return { ok: true, status: 200, text: async () => JSON.stringify(placed) };
    }
    return { ok: false, status: 404 };
  };
}

test('an UNCONFIGURED credential is skipped loudly, not run silently', async () => {
  const r = await enactShoptalk([member('1', 'paid', 'a@x.com')], { env: {}, apply: true });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /GOOGLE_CALENDAR_\* not set/);
});

test('an UNREADABLE opt-out list refuses and writes nothing', async () => {
  // The dangerous case: an empty set reads as "nobody opted out", so the sweep re-invites people who declined.
  const cal = fakeCal([]);
  const r = await enactShoptalk([member('1', 'paid', 'a@x.com')], {
    env: { ...CREDS, CF_API_TOKEN: '' }, apply: true, calendar: cal,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /SKIPPED/);
  assert.equal(cal.writes.length, 0, 'a refusal must not touch the calendar');
});

test('a MISSING series refuses and writes nothing', async () => {
  const cal = fakeCal([]);
  cal.nextOccurrences = async () => [];
  const r = await enactShoptalk([member('1', 'paid', 'a@x.com')], {
    env: CREDS, apply: true, calendar: cal, fetchImpl: kvFetch({}),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /CANNOT RUN/);
  assert.equal(cal.writes.length, 0);
});

test('a real apply adds the member, preserves a hand-added guest, and records ownership', async () => {
  const puts = [];
  const cal = fakeCal(['hand@owner.com']);
  const r = await enactShoptalk([member('1', 'paid', 'new@x.com')], {
    env: CREDS, apply: true, calendar: cal, fetchImpl: kvFetch({ puts }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  assert.deepEqual(cal.writes[0].list, ['hand@owner.com', 'new@x.com']);
  assert.equal(puts.length, 1, 'the placed record is written back exactly once');
  assert.deepEqual(JSON.parse(puts[0]), { 'new@x.com': '1' });
  assert.ok(!JSON.parse(puts[0])['hand@owner.com'], 'a guest we did not place never enters the record');
});

test('a DRY RUN plans against the real guest list and writes nothing anywhere', async () => {
  const puts = [];
  const cal = fakeCal(['hand@owner.com']);
  const r = await enactShoptalk([member('1', 'paid', 'new@x.com')], {
    env: CREDS, apply: false, calendar: cal, fetchImpl: kvFetch({ puts }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.applied, false);
  assert.equal(r.counts.add, 1, 'the dry run must still have read and planned');
  assert.equal(cal.writes.length, 0);
  assert.equal(puts.length, 0, 'a dry run must never write the placed record');
});

test('an OPTED-OUT member is not enrolled, read from the real KV prefix', async () => {
  const cal = fakeCal([]);
  const r = await enactShoptalk([member('42', 'paid', 'quit@x.com')], {
    env: CREDS, apply: true, calendar: cal, fetchImpl: kvFetch({ optoutKeys: ['shoptalk:optout:42'] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.counts.add, 0);
  assert.equal(r.counts.optedOut, 1);
  assert.equal(cal.writes.length, 0);
});

test('the summary line distinguishes applied from planned', async () => {
  const cal = fakeCal([]);
  const dry = await enactShoptalk([member('1', 'paid', 'a@x.com')], { env: CREDS, apply: false, calendar: cal, fetchImpl: kvFetch({}) });
  assert.match(dry.summary, /planned/);
  const wet = await enactShoptalk([member('1', 'paid', 'a@x.com')], { env: CREDS, apply: true, calendar: fakeCal([]), fetchImpl: kvFetch({}) });
  assert.match(wet.summary, /applied/);
});

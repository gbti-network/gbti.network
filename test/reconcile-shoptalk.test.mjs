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
/**
 * KV over REST: key lists by prefix, value read for the placed doc, PUT for the write-back.
 *
 * sow-466: THE FAKE IS PREFIX-AWARE, and it has to be. It used to answer every key listing with the opt-out
 * keys whatever prefix was asked for, which was harmless while one prefix was listed and became a false red
 * the moment a second one was: readPreferred listed `shoptalk:addr:`, was handed `shoptalk:optout:42`, could
 * not read it as an address record and correctly refused. The fault was the fake modelling an API that
 * ignores its own query parameter.
 */
function kvFetch({ optoutKeys = [], addrs = {}, placed = null, puts = [] } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    if (init.method === 'PUT') { puts.push(init.body); return { ok: true, status: 200 }; }
    if (u.includes('/keys?')) {
      const prefix = new URL(u).searchParams.get('prefix') || '';
      const names = prefix.startsWith('shoptalk:addr') ? Object.keys(addrs) : optoutKeys;
      return { ok: true, status: 200, json: async () => ({ result: names.map((k) => ({ name: k })), result_info: {} }) };
    }
    if (u.includes('/values/')) {
      const key = decodeURIComponent(u.slice(u.indexOf('/values/') + '/values/'.length));
      if (key.startsWith('shoptalk:addr:')) {
        const v = addrs[key];
        return v === undefined
          ? { ok: false, status: 404 }
          : { ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) };
      }
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
  // Two writes since 2026-09-10: the placed record and the seen record (rule 5), each exactly once.
  assert.equal(puts.length, 2, 'the placed record and the seen record are each written back exactly once');
  assert.deepEqual(JSON.parse(puts[0]), { 'new@x.com': '1' });
  assert.ok(!JSON.parse(puts[0])['hand@owner.com'], 'a guest we did not place never enters the record');
  assert.deepEqual(JSON.parse(puts[1]), { 'new@x.com': '1' }, 'the seen record remembers the invitation');
  assert.ok(!JSON.parse(puts[1])['hand@owner.com'], 'a non-member address is not remembered either');
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

// ---- sow-466: the address a member chose for themselves ---------------------------------------------------

test('a CHOSEN address is what gets enrolled, not the billing address on file', async () => {
  const cal = fakeCal([]);
  const r = await enactShoptalk([member('7', 'paid', 'billing@x.com')], {
    env: CREDS,
    apply: true,
    calendar: cal,
    fetchImpl: kvFetch({ addrs: { 'shoptalk:addr:7': { address: 'calendar@x.com', at: '2026-10-17T00:00:00Z' } } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(cal.writes[0].list, ['calendar@x.com'], 'the sweep invites the address the member chose');
});

test('a member who already sits under their CHOSEN address is not given a second seat', async () => {
  // The regression this exists for: without the override the sweep resolves the billing address, does not
  // find it on the guest list, and adds it. The member then holds two seats and gets an invitation at the
  // address they told us not to use, every night, which is the original complaint on a timer.
  const cal = fakeCal(['calendar@x.com']);
  const r = await enactShoptalk([member('7', 'paid', 'billing@x.com')], {
    env: CREDS,
    apply: true,
    calendar: cal,
    fetchImpl: kvFetch({ addrs: { 'shoptalk:addr:7': { address: 'calendar@x.com', at: '2026-10-17T00:00:00Z' } } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.counts.add, 0, 'nothing to add: their seat is already the one they asked for');
  assert.equal(cal.writes.length, 0, 'and the calendar is not touched at all');
});

test('an UNREADABLE chosen address refuses the sweep rather than falling back to billing', async () => {
  // A dropped override does not read as "no override", it reads as "use the billing address", which is how
  // the duplicate seat above gets created. So it aborts, like every other unreadable record here.
  const cal = fakeCal([]);
  const unreadable = async (url, init = {}) => {
    const u = String(url);
    if (init.method === 'PUT') return { ok: true, status: 200 };
    if (u.includes('/keys?')) {
      const prefix = new URL(u).searchParams.get('prefix') || '';
      const names = prefix.startsWith('shoptalk:addr') ? ['shoptalk:addr:7'] : [];
      return { ok: true, status: 200, json: async () => ({ result: names.map((k) => ({ name: k })), result_info: {} }) };
    }
    if (u.includes('/values/')) return { ok: false, status: 500 }; // the read itself fails
    return { ok: false, status: 404 };
  };
  const r = await enactShoptalk([member('7', 'paid', 'billing@x.com')], {
    env: CREDS, apply: true, calendar: cal, fetchImpl: unreadable,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /chosen calendar address/);
  assert.equal(cal.writes.length, 0, 'a refusal must not touch the calendar');
});

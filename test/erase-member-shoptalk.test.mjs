// sow-314: erasure takes the member OFF the Saturday Shop Talk event, the one store this project does not own.
// Fake KV over the same REST shapes the state layer uses, and a fake calendar in the shape of the real client,
// so the test can assert the un-invite was written and the placed record no longer names the address.
import test from 'node:test';
import assert from 'node:assert/strict';

import { eraseShoptalk, planErasure } from '../scripts/lib/erase-member.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const GOOGLE = { GOOGLE_CALENDAR_CLIENT_ID: 'id', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec', GOOGLE_CALENDAR_REFRESH_TOKEN: 'rt' };

/** A fake KV namespace: GET/PUT/DELETE on .../values/<key>, recording every write. */
function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  const fetchImpl = async (url, init = {}) => {
    const key = decodeURIComponent(String(url).split('/values/')[1] || '');
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') return store.has(key) ? { ok: true, status: 200, text: async () => store.get(key) } : { ok: false, status: 404, text: async () => '' };
    if (method === 'PUT') { store.set(key, init.body); writes.push(['PUT', key]); return { ok: true, status: 200, text: async () => '', json: async () => ({ success: true }) }; }
    if (method === 'DELETE') { const had = store.delete(key); writes.push(['DELETE', key]); return { ok: true, status: had ? 200 : 404, text: async () => '', json: async () => ({ success: true }) }; }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  return { store, writes, fetchImpl };
}

/** A fake calendar: one series, a guest list, and a record of what setAttendees wrote. */
function fakeCalendar(guests) {
  const written = [];
  return {
    written,
    async nextOccurrences() { return [{ id: 'series_20260912', recurringEventId: 'series', status: 'confirmed', start: { dateTime: '2026-09-12T16:00:00Z' } }]; },
    async listAttendees(id) { assert.equal(id, 'series'); return guests; },
    async setAttendees(id, list, opts) { written.push({ id, list, opts }); },
  };
}

const PLACED = JSON.stringify({ 'stef@example.com': '77', 'other@example.com': '12' });

test('the member comes off the event, off the placed record, and their opt-out marker is deleted', async () => {
  const kv = fakeKv({ 'shoptalk:placed': PLACED, 'shoptalk:optout:77': '{"optedOut":true}' });
  const cal = fakeCalendar(['owner@example.com', 'stef@example.com', 'other@example.com']);
  const r = await eraseShoptalk({ githubId: '77', env: CF, fetchImpl: kv.fetchImpl, calendar: cal });
  assert.equal(r.ok, true);
  assert.equal(r.matched, 1);
  assert.equal(r.removedFromEvent, true);
  assert.equal(cal.written.length, 1, 'one guest-list write');
  assert.deepEqual(cal.written[0].list, ['owner@example.com', 'other@example.com'], 'everyone else stays');
  assert.equal(cal.written[0].opts.sendUpdates, 'all', 'Google mails the un-invite');
  assert.deepEqual(JSON.parse(kv.store.get('shoptalk:placed')), { 'other@example.com': '12' }, 'the placed record no longer names the address');
  assert.ok(!kv.store.has('shoptalk:optout:77'), 'the opt-out marker is gone');
});

test('a member who was never placed: nothing touches the calendar, the marker still goes', async () => {
  const kv = fakeKv({ 'shoptalk:placed': PLACED, 'shoptalk:optout:99': '{"optedOut":true}' });
  const cal = fakeCalendar(['owner@example.com']);
  const r = await eraseShoptalk({ githubId: '99', env: CF, fetchImpl: kv.fetchImpl, calendar: cal });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(cal.written.length, 0);
  assert.equal(kv.store.get('shoptalk:placed'), PLACED, 'untouched');
  assert.ok(!kv.store.has('shoptalk:optout:99'));
});

test('FAILS CLOSED without calendar credentials when there is a seat to remove: an error, and the placed record untouched', async () => {
  const kv = fakeKv({ 'shoptalk:placed': PLACED });
  const r = await eraseShoptalk({ githubId: '77', env: CF, fetchImpl: kv.fetchImpl }); // no GOOGLE_*, no injected calendar
  assert.equal(r.ok, false);
  assert.match(r.reason, /GOOGLE_CALENDAR_\* not set/);
  assert.match(r.reason, /stay on the event/);
  assert.equal(kv.store.get('shoptalk:placed'), PLACED, 'never dropped from the record while still on the event');
});

test('an already-absent guest is not re-written, but the record is still cleaned', async () => {
  const kv = fakeKv({ 'shoptalk:placed': PLACED });
  const cal = fakeCalendar(['owner@example.com']); // the owner already removed them by hand
  const r = await eraseShoptalk({ githubId: '77', env: CF, fetchImpl: kv.fetchImpl, calendar: cal });
  assert.equal(r.ok, true);
  assert.equal(r.removedFromEvent, false);
  assert.equal(cal.written.length, 0);
  assert.deepEqual(JSON.parse(kv.store.get('shoptalk:placed')), { 'other@example.com': '12' });
});

test('the plan names the step, auto-driven, and says it fails closed', () => {
  const step = planErasure({ githubId: '77', username: 'stef' }).find((s) => s.step === 'shoptalk');
  assert.ok(step, 'the plan lists the Shop Talk step');
  assert.equal(step.auto, true);
  assert.match(step.action, /shoptalk:optout:77/);
  assert.match(step.action, /Fails closed/);
  assert.match(step.action, /does not own/);
});

test('positive control: the Google credentials build a real client when none is injected', async () => {
  // With credentials present and no injected calendar, the step must at least try the token exchange rather
  // than report "not set". A fetch that refuses proves the branch was taken.
  const kv = fakeKv({ 'shoptalk:placed': PLACED });
  const fetchImpl = async (url, init) => (String(url).includes('oauth2.googleapis.com') ? { ok: false, status: 400, text: async () => '{"error":"invalid_grant"}', json: async () => ({ error: 'invalid_grant' }) } : kv.fetchImpl(url, init));
  await assert.rejects(eraseShoptalk({ githubId: '77', env: { ...CF, ...GOOGLE }, fetchImpl }), /invalid_grant|token|400/i);
  assert.equal(kv.store.get('shoptalk:placed'), PLACED, 'a failed calendar call leaves the record alone');
});

// 2026-09-10: the seen record (rule 5) carries the member's address keyed to their id, so erasure scrubs it.
test('erasure scrubs the member from the seen record, and leaves everybody else in it', async () => {
  const kv = fakeKv({ 'shoptalk:placed': PLACED, 'shoptalk:seen': JSON.stringify({ 'stef@example.com': '77', 'old-stef@example.com': '77', 'other@example.com': '12' }) });
  const cal = fakeCalendar(['stef@example.com', 'other@example.com']);
  const r = await eraseShoptalk({ githubId: '77', env: { ...CF, ...GOOGLE }, fetchImpl: kv.fetchImpl, calendar: cal });
  assert.equal(r.ok, true);
  assert.equal(r.seenScrubbed, 2);
  assert.deepEqual(JSON.parse(kv.store.get('shoptalk:seen')), { 'other@example.com': '12' });
  assert.ok(kv.writes.some(([m, k]) => m === 'PUT' && k === 'shoptalk:seen'));
});

test('erasure with NO seen record yet is a cold start, not a failure', async () => {
  const kv = fakeKv({ 'shoptalk:placed': PLACED });
  const cal = fakeCalendar(['stef@example.com']);
  const r = await eraseShoptalk({ githubId: '77', env: { ...CF, ...GOOGLE }, fetchImpl: kv.fetchImpl, calendar: cal });
  assert.equal(r.ok, true);
  assert.equal(r.seenScrubbed, 0);
  assert.ok(!kv.writes.some(([m, k]) => m === 'PUT' && k === 'shoptalk:seen'), 'nothing to scrub means nothing written');
});

// Owner, 2026-09-29: "I am always marking our Notifications content as read and it keeps popping up." The read
// state of the two bells moved from one browser to the member's account (membership/bell-seen.mjs), and from a
// "last read" time to which items were marked read. These cover the core, the Worker endpoint that stores it, and
// the wiring that carries it between the website, the extension and the npm host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  normalizeSeen, mergeSeen, markGroup, unreadPredicate, seedFromWatermark, sameSeen,
  LATE_WINDOW_MS, MAX_IDS_PER_GROUP, MAX_FUTURE_MS,
} from '../membership/bell-seen.mjs';
import { handleNotifications, deliverNotification, NOTIFICATIONS_KEY } from '../workers/signup/membership-notifications.mjs';
import { getBellSeen, markBellSeen } from '../client/src/member-bell-seen-client.mjs';

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T15:00:00Z');
const row = (id, ts) => ({ id, ts });

// ---------------------------------------------------------------------------
// The core
// ---------------------------------------------------------------------------

test('a member who has never read anything sees every row as new', () => {
  const unread = unreadPredicate(normalizeSeen(null).groups.following ?? null);
  assert.equal(unread(row('a', NOW - 10 * 24 * H)), true);
});

test('marking read clears what was shown; something published afterwards is new', () => {
  const shown = [row('a', NOW - 3 * H), row('b', NOW - 2 * H)];
  const seen = markGroup(null, 'following', shown, NOW);
  const unread = unreadPredicate(seen.groups.following);
  assert.equal(shown.filter(unread).length, 0, 'the cleared rows stay cleared');
  assert.equal(unread(row('c', NOW + H)), true, 'a later publish badges');
});

test('a late arrival, dated before the read but never shown, still badges', () => {
  const seen = markGroup(null, 'following', [row('a', NOW - 3 * H)], NOW);
  // A news story picked up an hour after it ran, or an article that reached the site after the read.
  assert.equal(unreadPredicate(seen.groups.following)(row('late', NOW - H)), true);
});

test('an old back catalogue does not flood the bell', () => {
  const seen = markGroup(null, 'following', [], NOW);
  assert.equal(unreadPredicate(seen.groups.following)(row('old', NOW - LATE_WINDOW_MS - H)), false,
    'older than the window counts as read (a newly followed member\'s old posts)');
});

test('a row dated ahead of the clock clears when marked, and stays cleared', () => {
  // A computer clock running slow, or a feed stamping a future time: with a "last read" time these could not clear.
  const ahead = row('ahead', NOW + 5 * H);
  const seen = markGroup(null, 'following', [ahead], NOW);
  assert.equal(unreadPredicate(seen.groups.following)(ahead), false);
});

test('merging is monotonic: a stale tab or device cannot bring a cleared row back', () => {
  const old = markGroup(null, 'following', [row('a', NOW - 5 * H)], NOW - 4 * H);
  const fresh = markGroup(old, 'following', [row('a', NOW - 5 * H), row('b', NOW - H)], NOW);
  for (const merged of [mergeSeen(fresh, old), mergeSeen(old, fresh)]) {
    assert.equal(merged.groups.following.at, NOW, 'the later read wins');
    assert.deepEqual([...merged.groups.following.ids].sort(), ['a', 'b'], 'every id either side marked');
  }
  // Two devices that each marked different rows: the union clears both.
  const other = markGroup(null, 'following', [row('c', NOW - H)], NOW - 1000);
  const both = mergeSeen(fresh, other);
  assert.equal(['a', 'b', 'c'].map((id) => unreadPredicate(both.groups.following)(row(id, NOW - H))).filter(Boolean).length, 0);
});

test('the groups are separate: reading Following on the website leaves Replies and approvals alone', () => {
  const seen = markGroup(null, 'following', [row('f', NOW - H)], NOW);
  assert.equal(seen.groups.replies, undefined);
  assert.equal(seen.groups.approvals, undefined);
  assert.equal(markGroup(null, 'nonsense', [row('x', NOW)], NOW).groups.nonsense, undefined, 'unknown groups are ignored');
});

test('a stored or posted record is cleaned: junk dropped, ids bounded', () => {
  assert.deepEqual(normalizeSeen('x'), { groups: {} });
  assert.deepEqual(normalizeSeen({ groups: { following: { at: 'soon', ids: ['a'] } } }), { groups: {} });
  const messy = normalizeSeen({ groups: { following: { at: NOW, ids: ['a', 'a', 7, '', 'x'.repeat(301), 'b'] }, evil: { at: NOW, ids: [] } } });
  assert.deepEqual(messy, { groups: { following: { at: NOW, ids: ['a', 'b'] } } });
  const many = Array.from({ length: MAX_IDS_PER_GROUP + 50 }, (_, i) => `id${i}`);
  assert.equal(normalizeSeen({ groups: { following: { at: NOW, ids: many } } }).groups.following.ids.length, MAX_IDS_PER_GROUP);
});

test('the server caps a read time set implausibly far ahead', () => {
  const merged = mergeSeen(null, { groups: { following: { at: NOW + 30 * 24 * H, ids: [] } } }, { now: NOW });
  assert.equal(merged.groups.following.at, NOW + MAX_FUTURE_MS);
});

test('the first time, a browser\'s old "last read" time seeds the record, so nothing already read comes back', () => {
  const items = [row('before', NOW - 2 * H), row('after', NOW + H)];
  const seeded = seedFromWatermark(null, 'following', items, NOW);
  const unread = unreadPredicate(seeded.groups.following);
  assert.equal(unread(items[0]), false, 'read under the old time, read now');
  assert.equal(unread(items[1]), true, 'newer than the old time, still new');
  const existing = markGroup(null, 'following', [], NOW - H);
  assert.ok(sameSeen(seedFromWatermark(existing, 'following', items, NOW), existing), 'never overwrites an account record');
  assert.ok(sameSeen(seedFromWatermark(null, 'following', items, 0), normalizeSeen(null)), 'no old time, no seed');
});

// ---------------------------------------------------------------------------
// The Worker endpoint (the member's own notifications:<github_id> record)
// ---------------------------------------------------------------------------

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    store: m,
    async get(k, type) { const v = m.get(k); return type === 'json' && typeof v === 'string' ? JSON.parse(v) : (v ?? null); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
const req = (method, body) => ({ method, headers: { get: () => 'Bearer tok' }, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
const member = async () => ({ ok: true, githubId: '42' });
const now = () => NOW;

test('the endpoint stores a bell read, merges it, and leaves the stored notifications alone', async () => {
  const kv = fakeKv();
  let n = 0;
  await deliverNotification({}, '42', { type: 'mention', actor: 'alice', target: { type: 'share', slug: 'a/b', title: 't', url: '/shares/a/b/' } }, { kv, now, genId: () => `n${++n}` });
  const first = markGroup(null, 'following', [row('a', NOW - H)], NOW - H);
  const r1 = await handleNotifications(req('POST', { bellSeen: first }), {}, { kv, authorize: member, now });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body.bellSeen.groups.following.ids, ['a']);
  // A stale device posting an older record cannot undo it.
  const stale = markGroup(null, 'following', [], NOW - 10 * H);
  const r2 = await handleNotifications(req('POST', { bellSeen: stale }), {}, { kv, authorize: member, now });
  assert.equal(r2.body.bellSeen.groups.following.at, NOW - H);
  assert.deepEqual(r2.body.bellSeen.groups.following.ids, ['a']);
  const got = await handleNotifications(req('GET'), {}, { kv, authorize: member, now });
  assert.deepEqual(got.body.bellSeen, r2.body.bellSeen, 'GET reads it back');
  assert.equal(got.body.unseen, 1, 'a bell read never marks the stored notifications');
});

test('every other write to the record keeps the bell read', async () => {
  const kv = fakeKv({ [NOTIFICATIONS_KEY('42')]: JSON.stringify({ items: [], updatedAt: null, bellSeen: markGroup(null, 'replies', [row('r', NOW - H)], NOW) }) });
  let n = 0;
  await deliverNotification({}, '42', { type: 'mention', actor: 'bob', target: { type: 'share', slug: 'c/d', title: 't', url: '/shares/c/d/' } }, { kv, now, genId: () => `n${++n}` });
  await handleNotifications(req('POST'), {}, { kv, authorize: member, now }); // the old "mark all stored items seen"
  const got = await handleNotifications(req('GET'), {}, { kv, authorize: member, now });
  assert.deepEqual(got.body.bellSeen.groups.replies.ids, ['r']);
  assert.equal(got.body.unseen, 0, 'the empty-body mark-all still works');
});

// ---------------------------------------------------------------------------
// The wiring: the Worker client, every host's route, and the two bells sharing ids
// ---------------------------------------------------------------------------

test('the Worker client reads and posts the record with the member\'s token', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body, auth: init.headers?.Authorization });
    return { ok: true, status: 200, json: async () => ({ ok: true, bellSeen: { groups: { following: { at: NOW, ids: ['a'] } } } }) };
  };
  const opts = { token: 'tok', signupBase: 'https://signup.test/', fetch };
  assert.equal((await getBellSeen(opts)).bellSeen.groups.following.at, NOW);
  await markBellSeen({ groups: {} }, opts);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET https://signup.test/membership/notifications', 'POST https://signup.test/membership/notifications/seen']);
  assert.deepEqual(JSON.parse(calls[1].body), { bellSeen: { groups: {} } });
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
  await assert.rejects(() => getBellSeen({ signupBase: 'x' }), /not signed in/);
});

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every host routes the read record: the extension, the npm host, the shared client and the website', () => {
  assert.match(read('client-ui/src/client.mjs'), /getBellSeen: \(\) => request\('GET', '\/api\/bell-seen'\)/);
  assert.match(read('client-ui/src/client.mjs'), /markBellSeen: \(bellSeen\) => request\('POST', '\/api\/bell-seen', \{ bellSeen \}\)/);
  assert.match(read('extension/src/ext-dispatch.mjs'), /case '\/api\/bell-seen':[^\n]*\n\s+return ok\(method === 'POST' \? await markBellSeen\(ctx, body \?\? \{\}\) : await getBellSeen\(ctx\)\)/);
  assert.match(read('client/src/api.mjs'), /pathname === '\/api\/bell-seen'/);
  const site = read('src/lib/workbench-client.ts');
  assert.match(site, /getBellSeen\(\) \{ return workerGet\('\/membership\/notifications'\)/);
  assert.match(site, /markBellSeen\(bellSeen: unknown\) \{ return workerPost\('\/membership\/notifications\/seen', \{ bellSeen \}\)/);
});

test('both bells name a Following row the same way, so a read on one surface clears it on the other', () => {
  // The website bell marks selectBellEntries rows by their id; the extension must carry that same id, not a prefixed one.
  const ext = read('client-ui/src/elements/gbti-activity-bell.mjs');
  assert.match(ext, /id: r\.id, \/\/ the website bell's id/);
  assert.doesNotMatch(ext, /id: `f:\$\{r\.id\}`/);
  assert.match(read('client-ui/src/elements/gbti-notification-bell.mjs'), /markGroup\(this\._seen, 'following', selectBellEntries\(this\._inputs\)/);
});

test('both bells re-read the record on every load and hear other tabs, and neither writes the old browser-only key', () => {
  for (const f of ['client-ui/src/elements/gbti-activity-bell.mjs', 'client-ui/src/elements/gbti-notification-bell.mjs']) {
    const src = read(f);
    assert.match(src, /readLocalSeen\(this\._login\)/, `${f}: re-reads this browser's copy`);
    assert.match(src, /fetchAccountSeen\(this\.client\)/, `${f}: merges the account's record`);
    assert.match(src, /onLocalSeenChange\(/, `${f}: hears another tab`);
    assert.doesNotMatch(src, /localStorage\.setItem\(/, `${f}: writes only through bell-seen-sync`);
  }
});

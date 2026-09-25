// sow-407 (owner, 2026-09-25): "I do not understand what "To approve" means in this context. The post was from
// superadmin." The group listed every item waiting its hour before going to the social channels, and with
// require_approval off those post on their own. Owner's answer: show only real approvals. Separately, the extension's
// copy of the group had been empty since sow-399 removed the queue read the bell depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { approvalsNeeded, SYNDICATION_OVERDUE_MS, BELL_GROUPS } from '../client-ui/src/activity-bell.mjs';
import { dispatch } from '../extension/src/ext-dispatch.mjs';

const NOW = Date.parse('2026-09-25T18:00:00Z');
const MIN = 60 * 1000;
const item = (id, availableInMin, extra = {}) => ({ id, source: 'share', title: id, enqueuedAt: new Date(NOW - 36 * MIN).toISOString(), availableAt: new Date(NOW + availableInMin * MIN).toISOString(), ...extra });

test('an ordinary post still inside its hour is not an approval', () => {
  assert.deepEqual(approvalsNeeded([item('homelabfest', 24)], NOW), []);
});

test('a post just past its hour is not one either: the drain runs every five minutes', () => {
  assert.deepEqual(approvalsNeeded([item('due-now', -10)], NOW), []);
  assert.equal(SYNDICATION_OVERDUE_MS, 30 * MIN);
});

test('a flagged post needs approval, whatever its hold', () => {
  const out = approvalsNeeded([item('flagged', 50, { flags: ['nsfw'] })], NOW);
  assert.deepEqual(out.map((o) => [o.item.id, o.why]), [['flagged', 'flagged']]);
});

test('a post long past its hour did not go out on its own, and shows as overdue', () => {
  const monthOld = item('upwork', -60 * 24 * 30, { source: 'post' });
  const out = approvalsNeeded([item('fresh', 20), monthOld, item('flagged', 5, { flags: ['x'] })], NOW);
  assert.deepEqual(out.map((o) => [o.item.id, o.why]), [['upwork', 'overdue'], ['flagged', 'flagged']]);
});

test('junk in the queue is ignored rather than shown', () => {
  assert.deepEqual(approvalsNeeded(null, NOW), []);
  assert.deepEqual(approvalsNeeded([null, 7, { id: 'no-time' }, { id: 'empty-flags', flags: [] }], NOW), []);
});

test('the group is called "Needs your approval", and the rows say why', () => {
  assert.equal(BELL_GROUPS.find((g) => g.key === 'approvals').label, 'Needs your approval');
  const bell = readFileSync(new URL('../client-ui/src/elements/gbti-activity-bell.mjs', import.meta.url), 'utf8');
  assert.match(bell, /return approvalsNeeded\(q\.pending\)\.map\(/);
  assert.match(bell, /`Flagged \$\{type\.toLowerCase\(\)\}: approve or cancel it`/);
  assert.match(bell, /`\$\{type\} did not post on its own: approve to send it`/);
  assert.equal(/holding: approve to post now/.test(bell), false, 'the old wording is back');
});

// ---- the extension serves the read again (GET only) ----

function ctx(fetchLog) {
  return {
    identity: () => ({ login: 'atwellpub', githubId: '2002207', username: 'atwellpub' }),
    store: { get: (k) => ({ githubToken: 'tok' })[k], set() {} },
    membership: () => 'paid',
    reader: { readFile: async () => null },
    fetch: async (url, init = {}) => {
      fetchLog.push({ path: new URL(String(url)).pathname, method: init.method || 'GET', auth: init.headers?.Authorization ?? null });
      return { ok: true, status: 200, json: async () => ({ ok: true, pending: [], approved: [], sent: [], cancelled: [], failed: [] }) };
    },
  };
}

test('the extension answers the bell\'s queue read, with the bearer token, and refuses a write on it', async () => {
  const log = [];
  const r = await dispatch(ctx(log), { method: 'GET', pathname: '/api/syndication' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.pending, []);
  assert.deepEqual(log.map((l) => [l.path, l.method, l.auth]), [['/membership/syndication', 'GET', 'Bearer tok']]);
  const w = await dispatch(ctx(log), { method: 'POST', pathname: '/api/syndication', body: {} });
  assert.equal(w.status, 404);
  assert.equal(log.length, 1, 'a POST reached the Worker');
});

test('approve and cancel stay on the website', async () => {
  for (const p of ['/api/syndication/approve', '/api/syndication/cancel']) {
    const r = await dispatch(ctx([]), { method: 'POST', pathname: p, body: { id: 'x' } });
    assert.equal(r.status, 404, p);
  }
});

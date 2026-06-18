// SOW-042 P3: the pure activity-bell aggregation (client-ui/src/activity-bell.mjs). Covers the SOW P5 contract:
// an errored/missing source contributes ZERO (never a phantom unread), the per-source watermark (ms for the
// timestamped groups, a seen-SET for PRs), and markSeen advancing the watermark on panel open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBell, unreadItems, markSeen, BELL_GROUPS } from '../client-ui/src/activity-bell.mjs';

const T0 = Date.parse('2026-06-10T00:00:00Z');
const T1 = Date.parse('2026-06-16T00:00:00Z');
const reply = (id, ts) => ({ id, ts, title: `r${id}`, href: 'newtab.html#tab=share' });

test('buildBell exposes the four groups in order', () => {
  const out = buildBell({}, {});
  assert.deepEqual(out.groups.map((g) => g.key), BELL_GROUPS.map((g) => g.key));
  assert.equal(out.total, 0);
});

test('buildBell counts unread past a ms watermark for the timestamped groups', () => {
  const sources = { replies: [reply('a', T0), reply('b', T1)], following: [], prs: [], review: [] };
  // watermark between T0 and T1 -> only b is unread
  const seen = { replies: Date.parse('2026-06-12T00:00:00Z') };
  const out = buildBell(sources, seen);
  assert.equal(out.groups.find((g) => g.key === 'replies').unread, 1);
  assert.equal(out.total, 1);
});

test('buildBell sorts each group newest-first', () => {
  const out = buildBell({ following: [reply('old', T0), reply('new', T1)] }, {});
  assert.deepEqual(out.groups.find((g) => g.key === 'following').items.map((x) => x.id), ['new', 'old']);
});

test('an errored/missing/non-array source contributes ZERO (no phantom unread)', () => {
  const out = buildBell({ replies: null, following: undefined, prs: 'oops', review: [{ id: 'c1', ts: T1 }] }, {});
  assert.equal(out.groups.find((g) => g.key === 'replies').unread, 0);
  assert.equal(out.groups.find((g) => g.key === 'following').unread, 0);
  assert.equal(out.groups.find((g) => g.key === 'prs').unread, 0);
  assert.equal(out.groups.find((g) => g.key === 'review').unread, 1); // the one valid item
  assert.equal(out.total, 1);
});

test('PRs use a seen-SET of ids, not a ms watermark', () => {
  const prs = [{ id: 101, ts: 101 }, { id: 102, ts: 102 }];
  assert.equal(unreadItems('prs', prs, {}).length, 2); // none seen
  assert.equal(unreadItems('prs', prs, { prsSeen: ['101'] }).length, 1); // 101 acknowledged
  assert.equal(unreadItems('prs', prs, { prsSeen: ['101', '102'] }).length, 0);
});

test('PR seen-set tolerates numeric vs string ids', () => {
  assert.equal(unreadItems('prs', [{ id: 5, ts: 5 }], { prsSeen: [5] }).length, 0);
});

test('an empty watermark makes every timestamped item unread', () => {
  assert.equal(unreadItems('replies', [reply('a', T0), reply('b', T1)], {}).length, 2);
});

test('markSeen advances the ms sources to now and records the current PR ids', () => {
  const sources = { replies: [reply('a', T0)], following: [], review: [], prs: [{ id: 7, ts: 7 }, { id: 8, ts: 8 }] };
  const seen = markSeen(sources, T1);
  assert.equal(seen.replies, T1);
  assert.equal(seen.following, T1);
  assert.equal(seen.review, T1);
  assert.deepEqual(seen.prsSeen, ['7', '8']);
  // After marking seen, nothing is unread.
  assert.equal(buildBell(sources, seen).total, 0);
});

test('markSeen on empty sources yields an empty PR set', () => {
  assert.deepEqual(markSeen({}, T1).prsSeen, []);
});

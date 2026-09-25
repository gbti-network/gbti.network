// SOW-042 P3: the pure activity-bell aggregation (client-ui/src/activity-bell.mjs). Covers the SOW P5 contract:
// an errored/missing source contributes ZERO (never a phantom unread), the per-source ms watermark, and markSeen
// advancing the watermark on panel open. sow-404 removed the "Your PRs" group and its seen-SET of PR numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBell, unreadItems, markSeen, BELL_GROUPS } from '../client-ui/src/activity-bell.mjs';
import * as bellModule from '../client-ui/src/activity-bell.mjs';

const T0 = Date.parse('2026-06-10T00:00:00Z');
const T1 = Date.parse('2026-06-16T00:00:00Z');
const reply = (id, ts) => ({ id, ts, title: `r${id}`, href: 'newtab.html#tab=share' });

test('buildBell exposes the groups in order (approvals first)', () => {
  const out = buildBell({}, {});
  assert.deepEqual(out.groups.map((g) => g.key), BELL_GROUPS.map((g) => g.key));
  assert.equal(out.groups[0].key, 'approvals');
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
  const out = buildBell({ replies: null, following: undefined, approvals: [{ id: 'c1', ts: T1 }] }, {});
  assert.equal(out.groups.find((g) => g.key === 'replies').unread, 0);
  assert.equal(out.groups.find((g) => g.key === 'following').unread, 0);
  assert.equal(out.groups.find((g) => g.key === 'approvals').unread, 1); // the one valid item
  assert.equal(out.total, 1);
});

// sow-274: the contribution review lane is gone with the feature. A source still named `review` (an old caller)
// is ignored rather than shown under a heading nothing feeds.
test('there is no To review group, and a stray review source counts for nothing', () => {
  const out = buildBell({ review: [{ id: 'c1', ts: T1 }] }, {});
  assert.equal(out.groups.some((g) => g.key === 'review'), false);
  assert.equal(out.total, 0);
});

// sow-404 (owner, 2026-09-25): "users do not care about pull requests anymore". The group is gone for every
// account, superadmins included. These pin it gone, including against a caller that still hands over a `prs` list.
test('the bell has exactly approvals, replies and following, in that order', () => {
  assert.deepEqual(BELL_GROUPS.map((g) => g.key), ['approvals', 'replies', 'following']);
  assert.equal(BELL_GROUPS.some((g) => /\bPRs?\b|pull request/i.test(g.label)), false); // not /pr/: "To approve" contains it
});

test('a stray pull request source shows nothing and counts for nothing', () => {
  const out = buildBell({ prs: [{ id: 101, ts: T1, title: 'New Share: x', sub: 'Accepted' }] }, {});
  assert.equal(out.groups.some((g) => g.key === 'prs'), false);
  assert.equal(out.total, 0, 'a pull request lit the badge');
});

test('the pull request helpers are gone with the group', () => {
  assert.equal('prTime' in bellModule, false);
  assert.equal(unreadItems('prs', [{ id: 5, ts: T1 }], { prsSeen: [5] }).length, 1, 'no seen-set rule is left: a prs list is just timestamps now');
});

test('an empty watermark makes every timestamped item unread', () => {
  assert.equal(unreadItems('replies', [reply('a', T0), reply('b', T1)], {}).length, 2);
});

test('markSeen advances every group to now and writes no pull request set', () => {
  const sources = { replies: [reply('a', T0)], following: [], prs: [{ id: 7, ts: 7 }, { id: 8, ts: 8 }] };
  const seen = markSeen(sources, T1);
  assert.equal(seen.replies, T1);
  assert.equal(seen.following, T1);
  assert.equal(seen.approvals, T1);
  assert.equal('review' in seen, false);
  assert.equal('prsSeen' in seen, false, 'sow-404: the pull request seen-set is gone');
  assert.equal('prs' in seen, false);
  // After marking seen, nothing is unread.
  assert.equal(buildBell(sources, seen).total, 0);
});

// SOW-088: the superadmin approvals source aggregates + counts unread like any timestamped group.
test('buildBell counts holding approvals as unread past the watermark', () => {
  const sources = { approvals: [{ id: 'syn:a', ts: T1, title: 'A held share', sub: 'Share holding' }, { id: 'syn:b', ts: T0, title: 'Old', sub: 'x' }] };
  const out = buildBell(sources, { approvals: T0 });
  const g = out.groups.find((x) => x.key === 'approvals');
  assert.equal(g.unread, 1, 'only the item past the watermark is unread');
  assert.equal(g.items[0].id, 'syn:a', 'newest-first');
  assert.equal(out.total, 1);
});

// Owner report 2026-09-24: "Mark all read" left 2 notices every time. markSeen wrote watermarks for replies and
// following only, so the approvals group (added later) was never marked. The test above missed it because its
// fixture had no approvals. This one puts an item in EVERY group, so a group added later is covered automatically.
test('markSeen clears every bell group, including approvals and any group added later', () => {
  const sources = {};
  for (const g of BELL_GROUPS) sources[g.key] = [{ id: `${g.key}:1`, ts: T0, title: 'x', sub: 'y' }];
  assert.ok(buildBell(sources, {}).total >= BELL_GROUPS.length, 'control: every group starts unread');
  const out = buildBell(sources, markSeen(sources, T1));
  for (const g of out.groups) assert.equal(g.unread, 0, `${g.key} still unread after Mark all read`);
  assert.equal(out.total, 0);
  // A holding item enqueued AFTER the mark badges again.
  sources.approvals.push({ id: 'syn:new', ts: T1 + 1000, title: 'New', sub: 'z' });
  assert.equal(buildBell(sources, markSeen({ ...sources, approvals: [] }, T1)).total, 1);
});

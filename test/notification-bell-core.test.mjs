// SOW-186 C2: pure tests for the notification-bell view-model (the compute-on-read "who I follow published"
// feed). No DOM, no client. Mirrors the test/activity-bell.test.mjs precedent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowingBell, unreadLabel, NOTIFY_ACTION, MAX_BELL_ROWS } from '../client-ui/src/notification-bell-core.mjs';

const ms = (iso) => Date.parse(iso);

const FOLLOWS = [{ username: 'naresh' }, { username: 'Hudson' }, { username: 'ali' }];
const ENTRIES = [
  { author: 'naresh', type: 'project', title: 'Radle 2.2', url: '/projects/radle/', publishedAt: '2026-08-20T10:00:00Z' },
  { author: 'hudson', type: 'article', title: 'The Shai-Hulud Worm', url: '/articles/shai-hulud/', publishedAt: '2026-08-22T12:00:00Z' },
  { author: 'ali', type: 'share', title: 'LinkedIn headshot', url: '/shares/ali/1/', publishedAt: '2026-08-19T08:00:00Z' },
  { author: 'stranger', type: 'article', title: 'Not followed', url: '/articles/x/', publishedAt: '2026-08-25T00:00:00Z' },
];

test('no follows -> empty view-model', () => {
  const r = buildFollowingBell({ follows: [], entries: ENTRIES, watermark: 0 });
  assert.deepEqual(r, { rows: [], unread: 0, followCount: 0 });
});

test('keeps only entries whose author is followed, case-insensitively', () => {
  const r = buildFollowingBell({ follows: FOLLOWS, entries: ENTRIES, watermark: 0 });
  assert.equal(r.followCount, 3);
  assert.equal(r.rows.length, 3); // stranger dropped
  assert.ok(!r.rows.some((x) => x.actor === 'stranger'));
  // 'Hudson' (follow) matches 'hudson' (entry author)
  assert.ok(r.rows.some((x) => x.actor === 'hudson'));
});

test('rows are newest-first', () => {
  const r = buildFollowingBell({ follows: FOLLOWS, entries: ENTRIES, watermark: 0 });
  assert.deepEqual(r.rows.map((x) => x.target), ['The Shai-Hulud Worm', 'Radle 2.2', 'LinkedIn headshot']);
});

test('action verb maps by content type; unknown -> published', () => {
  assert.equal(NOTIFY_ACTION.share, 'shared');
  assert.equal(NOTIFY_ACTION.news, 'curated');
  const r = buildFollowingBell({ follows: FOLLOWS, entries: ENTRIES, watermark: 0 });
  const byTitle = Object.fromEntries(r.rows.map((x) => [x.target, x.action]));
  assert.equal(byTitle['Radle 2.2'], 'published');          // product
  assert.equal(byTitle['The Shai-Hulud Worm'], 'published'); // article
  assert.equal(byTitle['LinkedIn headshot'], 'shared');      // share
  const unknown = buildFollowingBell({ follows: [{ username: 'a' }], entries: [{ author: 'a', type: 'zzz', title: 'T', publishedAt: '2026-01-01T00:00:00Z' }] });
  assert.equal(unknown.rows[0].action, 'published');
});

test('unread flag + count use the watermark (strictly greater-than)', () => {
  const wm = ms('2026-08-20T10:00:00Z'); // exactly Radle's ts
  const r = buildFollowingBell({ follows: FOLLOWS, entries: ENTRIES, watermark: wm });
  // Only the Shai-Hulud article (2026-08-22) is strictly after the watermark.
  assert.equal(r.unread, 1);
  const article = r.rows.find((x) => x.target === 'The Shai-Hulud Worm');
  const radle = r.rows.find((x) => x.target === 'Radle 2.2');
  assert.equal(article.unread, true);
  assert.equal(radle.unread, false); // equal to the watermark is NOT unread
});

test('watermark 0 marks everything unread', () => {
  const r = buildFollowingBell({ follows: FOLLOWS, entries: ENTRIES, watermark: 0 });
  assert.equal(r.unread, 3);
  assert.ok(r.rows.every((x) => x.unread === true));
});

test('caps at max, keeping the newest', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    author: 'naresh', type: 'article', title: `A${i}`, url: `/a/${i}/`,
    publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  const r = buildFollowingBell({ follows: [{ username: 'naresh' }], entries: many, watermark: 0, max: 5 });
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[0].target, 'A39'); // newest first
  const def = buildFollowingBell({ follows: [{ username: 'naresh' }], entries: many, watermark: 0 });
  assert.equal(def.rows.length, MAX_BELL_ROWS);
});

test('non-array inputs are treated as empty (fail-closed)', () => {
  assert.deepEqual(buildFollowingBell({ follows: null, entries: null }), { rows: [], unread: 0, followCount: 0 });
  const r = buildFollowingBell({ follows: FOLLOWS, entries: undefined, watermark: 0 });
  assert.deepEqual(r.rows, []);
  assert.equal(r.followCount, 3);
});

test('row carries actor, target and a site-relative url', () => {
  const r = buildFollowingBell({ follows: [{ username: 'naresh' }], entries: ENTRIES, watermark: 0 });
  const row = r.rows[0];
  assert.equal(row.actor, 'naresh');
  assert.equal(row.target, 'Radle 2.2');
  assert.equal(row.url, '/projects/radle/');
});

test('unreadLabel caps at 9+', () => {
  assert.equal(unreadLabel(0), '0');
  assert.equal(unreadLabel(5), '5');
  assert.equal(unreadLabel(9), '9');
  assert.equal(unreadLabel(10), '9+');
  assert.equal(unreadLabel(999), '9+');
});

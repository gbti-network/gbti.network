// sow-386: both notification bells obey the member's In app settings, and carry public shares from people you
// follow plus (members only) news from the sources you follow. Pure tests over selectBellEntries and
// buildFollowingBell. FIXTURES USE THE REAL LIST TYPES (`post`, not `article`): the activity index calls an article
// `post`, and a filter keyed on the raw type passed every test written with `article` while every real muted
// article kept showing. That was the audit's correction, and this file is where it is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBellEntries, buildFollowingBell, bellEventFor, BELL_EVENT_FOR_TYPE, inAppOn,
} from '../client-ui/src/notification-bell-core.mjs';
import { NOTIFY_EVENT_FOR_TYPE } from '../membership/mail-notify.mjs';

const at = (iso) => Date.parse(iso);

// alice: articles muted for her alone. bob: no override. The page-wide default mutes prompts.
const FOLLOWS = [
  { username: 'alice', notify: { article: { api: false } } },
  { username: 'Bob' },
];
const GLOBAL = { prompt: { api: false } };
const ENTRIES = [
  { author: 'alice', type: 'post', title: 'Alice article', url: '/articles/a/', path: 'members/alice/posts/a/index.md', publishedAt: at('2026-09-20T10:00:00Z') },
  { author: 'alice', type: 'project', title: 'Alice project', url: '/projects/a/', path: 'members/alice/products/a.md', publishedAt: at('2026-09-19T10:00:00Z') },
  { author: 'bob', type: 'post', title: 'Bob article', url: '/articles/b/', path: 'members/bob/posts/b/index.md', publishedAt: at('2026-09-18T10:00:00Z') },
  { author: 'bob', type: 'prompt', title: 'Bob prompt', url: '/prompts/b/', path: 'members/bob/prompts/b.md', publishedAt: at('2026-09-17T10:00:00Z') },
  { author: 'carol', type: 'post', title: 'Carol article', url: '/articles/c/', path: 'members/carol/posts/c/index.md', publishedAt: at('2026-09-21T10:00:00Z') },
];
const SHARES = [
  { author: 'bob', type: 'share', title: 'Bob share', url: '/shares/bob/1/', publishedAt: at('2026-09-16T10:00:00Z') },
  { author: 'carol', type: 'share', title: 'Carol share', url: '/shares/carol/1/', publishedAt: at('2026-09-22T10:00:00Z') },
];
const NEWS = [
  { guid: 'g1', source: 'techcrunch', sourceName: 'TechCrunch', title: 'A story', link: 'https://techcrunch.com/a', publishedAt: at('2026-09-21T09:00:00Z') },
];
const titles = (rows) => rows.map((r) => r.target);

test('the list type maps to the settings row: post is an article', () => {
  assert.equal(bellEventFor('post'), 'article');
  assert.equal(bellEventFor('share'), 'share');
  assert.equal(bellEventFor('news'), 'news');
  assert.equal(bellEventFor('future-type'), 'future-type', 'an unknown type resolves as itself, so it falls to the system default');
});

test('the bell map and the email map agree on every type they share, so they cannot drift', () => {
  for (const [type, event] of Object.entries(NOTIFY_EVENT_FOR_TYPE)) {
    assert.equal(BELL_EVENT_FOR_TYPE[type], event, `type ${type}`);
  }
});

test('a per-person mute drops only that person\'s articles', () => {
  const rows = selectBellEntries({ follows: FOLLOWS, entries: ENTRIES, global: GLOBAL });
  assert.ok(!titles(rows).includes('Alice article'), 'alice muted her articles');
  assert.ok(titles(rows).includes('Alice project'), 'her other types still arrive');
  assert.ok(titles(rows).includes('Bob article'), 'bob\'s articles are not affected by alice\'s setting');
});

test('a page-wide mute drops that type from everyone without an override', () => {
  const rows = selectBellEntries({ follows: FOLLOWS, entries: ENTRIES, global: GLOBAL });
  assert.ok(!titles(rows).includes('Bob prompt'));
});

test('a per-person setting beats the page-wide one', () => {
  const follows = [{ username: 'bob', notify: { prompt: { api: true } } }];
  const rows = selectBellEntries({ follows, entries: ENTRIES, global: GLOBAL });
  assert.ok(titles(rows).includes('Bob prompt'));
});

test('a failed settings read (no global) shows everything the follows allow', () => {
  const rows = selectBellEntries({ follows: [{ username: 'alice' }, { username: 'bob' }], entries: ENTRIES, global: undefined });
  assert.deepEqual(titles(rows), ['Alice article', 'Alice project', 'Bob article', 'Bob prompt']);
});

test('people you do not follow never appear, entries or shares', () => {
  const rows = selectBellEntries({ follows: FOLLOWS, entries: ENTRIES, shares: SHARES, global: GLOBAL });
  assert.ok(!rows.some((r) => r.actor === 'carol'));
});

test('shares from people you follow arrive as "shared", and the Shares switch controls them', () => {
  const on = selectBellEntries({ follows: FOLLOWS, entries: [], shares: SHARES, global: {} });
  assert.deepEqual(on.map((r) => [r.target, r.action, r.kind]), [['Bob share', 'shared', 'person']]);
  const off = selectBellEntries({ follows: FOLLOWS, entries: [], shares: SHARES, global: { share: { api: false } } });
  assert.equal(off.length, 0);
});

test('news rows arrive under the page-wide News setting, named by the publication', () => {
  const rows = selectBellEntries({ follows: [], news: NEWS, global: {} });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].actor, rows[0].action, rows[0].url], ['news', 'TechCrunch', 'published', 'https://techcrunch.com/a']);
  assert.equal(selectBellEntries({ follows: [], news: NEWS, global: { news: { api: false } } }).length, 0);
});

test('a person\'s own settings never touch news, which comes from sources', () => {
  const follows = [{ username: 'alice', notify: { news: { api: false }, default: { api: false } } }];
  const rows = selectBellEntries({ follows, news: NEWS, global: {} });
  assert.equal(rows.filter((r) => r.kind === 'news').length, 1);
});

test('a news row needs a guid and an http(s) link', () => {
  const bad = [
    { guid: '', source: 's', title: 'no guid', link: 'https://x.test/', publishedAt: 1 },
    { guid: 'g2', source: 's', title: 'script', link: 'javascript:alert(1)', publishedAt: 1 },
    { guid: 'g3', source: 's', title: 'data', link: 'data:text/html,x', publishedAt: 1 },
  ];
  assert.equal(selectBellEntries({ news: bad, global: {} }).length, 0);
});

test('the rows interleave newest first across people, shares and news', () => {
  const rows = selectBellEntries({ follows: FOLLOWS, entries: ENTRIES, shares: SHARES, news: NEWS, global: GLOBAL });
  assert.deepEqual(titles(rows), ['A story', 'Alice project', 'Bob article', 'Bob share']);
});

test('the website bell counts only what it shows: a muted item is not unread', () => {
  const r = buildFollowingBell({ follows: FOLLOWS, entries: ENTRIES, global: GLOBAL, watermark: 0 });
  assert.equal(r.unread, r.rows.length);
  assert.equal(r.rows.length, 2); // Alice project, Bob article
  assert.equal(r.followCount, 2);
});

test('the cap applies after filtering, so muted items never crowd out real ones', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ author: 'alice', type: 'post', title: `muted ${i}`, url: `/a/${i}/`, publishedAt: at('2026-09-21T00:00:00Z') + i }));
  const real = { author: 'bob', type: 'post', title: 'real', url: '/b/', publishedAt: at('2026-01-01T00:00:00Z') };
  const r = buildFollowingBell({ follows: FOLLOWS, entries: [...many, real], global: {}, max: 5 });
  assert.deepEqual(titles(r.rows), ['real']);
});

test('news reaches the bell even for a member who follows nobody', () => {
  const r = buildFollowingBell({ follows: [], news: NEWS, global: {} });
  assert.equal(r.rows.length, 1);
  assert.equal(r.followCount, 0);
});

test('inAppOn follows the settings page precedence and reads the system default when nothing is stored', () => {
  assert.equal(inAppOn({ event: 'article' }), true);
  assert.equal(inAppOn({ event: 'article', global: { article: { api: false } } }), false);
  assert.equal(inAppOn({ event: 'article', follow: { article: { api: true } }, global: { article: { api: false } } }), true);
});

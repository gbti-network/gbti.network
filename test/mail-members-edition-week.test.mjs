// sow-312 defect (owner report, 2026-09-14): the members edition is ONE WEEK, like the issue it replaces.
//
// What happened in production. The public weekly had gone out every Monday since 24 August. On 14 September a
// subscriber became entitled for the first time, so the first members edition was composed. Its family had no
// history of its own, so the window resolver took it for the newsletter's LAUNCH and used the 90-day window:
// 27 items, three articles the reader had already had, under "This is the first issue". The public issue
// composed in the same run was correct, 12 items.
//
// A members recipient gets exactly one email a week, the members edition when there is one and the public
// issue when there is not. So the week an edition covers is measured from the last issue its recipients
// actually RECEIVED, in either family. The scenarios below replay runs of real Monday compiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileWeeklyIssue } from '../workers/signup/mail-compile.mjs';
import { getIssue } from '../workers/signup/mail-store.mjs';
import { subscriberKey } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { buildDigestEntitlement } from '../membership/digest-entitlement.mjs';

const DAY = 86400000;
const monday = (m, d) => Date.UTC(2026, m - 1, d, 12, 0, 0);
const W1 = monday(8, 24);
const W2 = monday(8, 31);
const W3 = monday(9, 7);
const W4 = monday(9, 14);
const W5 = monday(9, 21);

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      const e = m.get(key);
      if (e == null) return null;
      if (type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
      return e.value;
    },
    async put(key, value) { m.set(key, { value: String(value) }); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true };
    },
  };
}

function seed(kv, hash, githubId) {
  const base = githubId
    ? buildSubscriber({ hash, source: 'member', githubId }, { now: () => 0 })
    : buildSubscriber({ hash, source: 'anon', emailEnc: `enc:${hash}` }, { now: () => 0 });
  kv.m.set(subscriberKey(hash), { value: JSON.stringify({ ...base, welcomedAt: 1 }) });
}

// Every item ever, served every week: composeIssue itself withholds anything dated after the compile, so each
// week sees exactly what existed by then.
const article = (slug, at) => ({ type: 'post', slug, title: `Article ${slug}`, url: `/articles/${slug}/`, author: 'ann', publishedAt: at, visibility: 'public' });
const ARTICLES = [
  article('p1', monday(8, 20)), // before the launch issue, inside its 90 days
  article('p2', monday(8, 27)),
  article('p3', monday(9, 3)),
  article('p4', monday(9, 10)),
  article('p5', monday(9, 18)),
];
const memberShare = (id, at) => ({ id, author: 'ann', title: `Member share ${id}`, shortDescription: 'members only', visibility: 'members', createdAt: new Date(at).toISOString(), body: '' });
const MEMBER_SHARES = [
  memberShare('m2', monday(8, 28)), // posted while nobody was entitled to a members edition
  memberShare('m3', monday(9, 5)),
  memberShare('m5', monday(9, 17)),
];

const entitlement = buildDigestEntitlement([{ githubId: '10', effective: { status: 'paid' } }]);

async function compileAt(kv, nowMs, { entitled, extraShares = [] }) {
  return compileWeeklyIssue({}, {
    kv,
    now: () => nowMs,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/activity-index.json')) return { ok: true, json: async () => ({ entries: ARTICLES }) };
      if (String(url).endsWith('/shares-index.json')) return { ok: true, json: async () => ({ entries: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
    queryItems: async () => ({ items: [] }),
    siteUrl: 'https://gbti.network',
    readMemberShares: async () => [...MEMBER_SHARES, ...extraShares],
    readEntitlement: async () => (entitled ? entitlement : null),
  });
}

const urlsOf = (issue) => Object.values(issue?.sections ?? {}).flatMap((s) => (Array.isArray(s) ? s : []).map((it) => it.url));

async function replayToWeek3() {
  const kv = makeKV();
  seed(kv, 'anonhash', null);
  seed(kv, 'paidhash', '10');
  await compileAt(kv, W1, { entitled: false }); // the launch issue: 90 days, correctly
  await compileAt(kv, W2, { entitled: false });
  const w3 = await compileAt(kv, W3, { entitled: true }); // the first week anybody is entitled
  return { kv, w3 };
}

test('the FIRST members edition covers one week, not the 90-day launch window', async () => {
  const { kv, w3 } = await replayToWeek3();
  assert.ok(w3.membersEdition, 'the fixture is wrong: no members edition was sent in the first entitled week');

  const pub = await getIssue(kv, 'weekly-2026-09-07');
  const mem = await getIssue(kv, 'members-2026-09-07');
  assert.equal(pub.launchNote ?? null, null, 'the fixture is wrong: the public issue in week three is not a launch issue');
  assert.equal(mem.launchNote ?? null, null, 'the members edition was composed as the newsletter launch issue');

  const urls = urlsOf(mem);
  assert.ok(urls.includes('/articles/p3/'), "the members edition is missing the week's article");
  assert.ok(urls.some((u) => u.includes('m3')), "the members edition is missing the week's member share");
  for (const old of ['/articles/p1/', '/articles/p2/']) {
    assert.ok(!urls.includes(old), `${old} was mailed in an earlier public issue and came round again`);
  }
  assert.ok(!urls.some((u) => u.includes('m2')), 'a member share from before the last issue was treated as new this week');
  // The public half of this edition is exactly the public issue's week.
  assert.deepEqual(urls.filter((u) => u.startsWith('/articles/')), urlsOf(pub).filter((u) => u.startsWith('/articles/')));
});

test('after a week with no members edition, the next one does not repeat the public issue members received', async () => {
  const { kv } = await replayToWeek3();
  const w4 = await compileAt(kv, W4, { entitled: true });
  assert.equal(w4.membersEdition, null, 'the fixture is wrong: week four has no new member share, so members get the public issue');
  assert.ok(urlsOf(await getIssue(kv, 'weekly-2026-09-14')).includes('/articles/p4/'), 'the fixture is wrong: the public issue should carry p4');

  const w5 = await compileAt(kv, W5, { entitled: true });
  assert.ok(w5.membersEdition, 'the fixture is wrong: week five has a new member share');
  const urls = urlsOf(await getIssue(kv, 'members-2026-09-21'));
  assert.ok(urls.includes('/articles/p5/'), "the members edition is missing the week's article");
  assert.ok(urls.some((u) => u.includes('m5')), "the members edition is missing the week's member share");
  assert.ok(!urls.includes('/articles/p4/'), 'p4 reached members in last week\'s public issue and was mailed to them again');
  assert.ok(!urls.includes('/articles/p3/') && !urls.some((u) => u.includes('m3')), 'an item from the previous members edition came round again');
});

test('two editions in a row: the second measures its week from the first, not from an older public issue', async () => {
  // The received history mixes two prefixes, and 'members-' sorts before 'weekly-' as a plain string. Sorted
  // that way, last week's edition would sort OLDER than the public issue of the week before it, and this week
  // would be measured against a pool two weeks stale.
  const { kv } = await replayToWeek3();
  await compileAt(kv, W4, { entitled: true });
  await compileAt(kv, W5, { entitled: true });
  const W6 = monday(9, 28);
  const r6 = await compileAt(kv, W6, { entitled: true, extraShares: [memberShare('m6', monday(9, 24))] });
  assert.ok(r6.membersEdition, 'the fixture is wrong: week six has a new member share');
  const w5 = await getIssue(kv, 'members-2026-09-21');
  const w6 = await getIssue(kv, 'members-2026-09-28');
  assert.equal(w6.window.seen, w5.pool.length, 'week six was not measured against the pool of the edition members received last week');
});

test('the public issue is composed identically whether or not a members edition exists', async () => {
  const withMembers = makeKV();
  const withoutMembers = makeKV();
  for (const kv of [withMembers, withoutMembers]) { seed(kv, 'anonhash', null); seed(kv, 'paidhash', '10'); }
  for (const t of [W1, W2, W3, W4, W5]) {
    await compileAt(withMembers, t, { entitled: t >= W3 });
    await compileAt(withoutMembers, t, { entitled: false });
  }
  for (const id of ['weekly-2026-09-07', 'weekly-2026-09-14', 'weekly-2026-09-21']) {
    const a = await getIssue(withMembers, id);
    const b = await getIssue(withoutMembers, id);
    assert.deepEqual({ sections: a.sections, window: a.window, pool: a.pool }, { sections: b.sections, window: b.window, pool: b.pool }, `${id} changed because a members edition exists`);
  }
  assert.ok(await getIssue(withMembers, 'members-2026-09-21'), 'the fixture is wrong: no members edition was ever composed');
});

test('a brand new newsletter still opens with the 90-day launch issue in both editions', async () => {
  const kv = makeKV();
  seed(kv, 'anonhash', null);
  seed(kv, 'paidhash', '10');
  const r = await compileAt(kv, W2, { entitled: true });
  assert.ok(r.membersEdition, 'the fixture is wrong: no members edition at launch');
  assert.ok((await getIssue(kv, 'weekly-2026-08-31')).launchNote, 'the public launch issue lost its launch note');
  const mem = await getIssue(kv, 'members-2026-08-31');
  assert.ok(mem.launchNote, 'with no issue ever sent, the members edition is a launch issue too');
  assert.equal(mem.window.since, W2 - 90 * DAY);
});

// sow-384: a news query with `since` stops reading day files once it is past the window.
//
// The digest now asks the store for a week of news. The store keeps thirty days, one file per collection day, and
// its only early exit was "enough items collected", which a week-long query with a high ceiling never reaches, so it
// read all thirty files every compile. These tests COUNT the day files read, with a control proving the counter sees
// the full thirty when no window is given, and check removed stories and blocked words still drop out inside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryItems, dayOf } from '../workers/signup/news/src/store.mjs';

const DAY = 86400;
const NOW = 1_790_000_000; // 2026-09-21, epoch seconds like the store

/** A NEWS_KV double seeded with thirty day files, one story per day, counting the day files it serves. */
function thirtyDays({ removed = {}, banwords = [] } = {}) {
  const m = new Map();
  const days = [];
  for (let back = 0; back < 30; back += 1) {
    const t = NOW - back * DAY;
    const d = dayOf(t);
    days.push(d);
    m.set(`feed:v2:day:${d}`, JSON.stringify([{ guid: `d${back}`, source: 's', category: 'Other', title: `story ${back} days old`, link: `https://x/${back}`, publishedAt: t, fetchedAt: t }]));
  }
  m.set('feed:v2:index', JSON.stringify({ days, counts: {}, total: 30, updatedAt: NOW }));
  m.set('feed:v2:removed', JSON.stringify(removed));
  m.set('feed:v2:banwords', JSON.stringify(banwords));
  const env = { dayReads: 0, NEWS_KV: { get: async (k) => { if (k.startsWith('feed:v2:day:')) env.dayReads += 1; return m.get(k) ?? null; } } };
  return env;
}

test('control: with no window a high-ceiling query reads all thirty day files', async () => {
  const env = thirtyDays();
  const { items } = await queryItems(env, { limit: 2000 });
  assert.equal(items.length, 30);
  assert.equal(env.dayReads, 30, 'the counter sees every file, so the next test measuring fewer means something');
});

test('sow-384: a week query reads the week plus one day of slack, and returns exactly the week', async () => {
  const env = thirtyDays();
  const since = NOW - 7 * DAY;
  const { items } = await queryItems(env, { limit: 2000, since });
  assert.deepEqual(items.map((i) => i.guid), ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'], 'seven days back, inclusive of the boundary story');
  assert.ok(env.dayReads <= 9, `read ${env.dayReads} day files, expected at most the week plus slack`);
  assert.ok(env.dayReads >= 8, 'and it did read every file that can hold a story inside the window');
});

test('sow-384: removed stories and blocked words still drop out inside the window', async () => {
  const env = thirtyDays({ removed: { d2: { at: NOW * 1000 } }, banwords: ['story 4'] });
  const { items } = await queryItems(env, { limit: 2000, since: NOW - 7 * DAY });
  const guids = items.map((i) => i.guid);
  assert.ok(!guids.includes('d2'), 'a removed story stays removed');
  assert.ok(!guids.includes('d4'), 'a blocked word still blocks');
  assert.equal(guids.length, 6);
});

test('sow-384: the one day of slack keeps a story whose feed dates it after the day we collected it', async () => {
  // A publisher clock running ahead: collected into the file eight days back, dated six and a half days back. It is
  // inside the window by its date, so it must be returned even though its file is older than the window.
  const env = thirtyDays();
  const eight = dayOf(NOW - 8 * DAY);
  const orig = env.NEWS_KV.get;
  env.NEWS_KV.get = async (k) => (k === `feed:v2:day:${eight}`
    ? JSON.stringify([{ guid: 'ahead', source: 's', category: 'Other', title: 'dated ahead', link: 'https://x/a', publishedAt: NOW - 6.5 * DAY, fetchedAt: NOW - 8 * DAY }])
    : orig(k));
  const { items } = await queryItems(env, { limit: 2000, since: NOW - 7 * DAY });
  assert.ok(items.some((i) => i.guid === 'ahead'));
});

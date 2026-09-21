// sow-384: the digest's news gather covers a WEEK and reads open counts only for stories somebody opened.
//
// Before, the gather asked for the 60 newest stories (about seven hours of news) and read one open record per story.
// A week is about 1,200 stories, and 1,200 reads in one Worker invocation is not affordable, so the open records are
// listed once and only the stories that have one are read. These tests COUNT the reads, because a gather that
// quietly went back to reading every story would still rank correctly and every ranking test would stay green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherNewsEntries, listOpenedNews, NEWS_WINDOW_DAYS } from '../workers/signup/mail-compile.mjs';
import { NEWS_OPENS_KEY } from '../workers/signup/membership-news-opened.mjs';
import { applyOpen, normalizeNewsOpens } from '../membership/news-opens.mjs';

const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);

/** A SIGNUP_KV double that counts gets and can page its listing. */
function countingKV({ pageSize = 1000, listThrows = false } = {}) {
  const m = new Map();
  const kv = {
    m,
    gets: 0,
    lists: 0,
    async get(key, type) {
      kv.gets += 1;
      const v = m.get(key);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async list({ prefix = '', cursor } = {}) {
      kv.lists += 1;
      if (listThrows) throw new Error('list unavailable');
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + pageSize);
      const next = start + pageSize;
      return { keys: page.map((name) => ({ name })), list_complete: next >= all.length, cursor: next >= all.length ? undefined : String(next) };
    },
  };
  return kv;
}

const opened = (kv, guid, openers) => {
  let r = normalizeNewsOpens(null);
  for (const id of openers) r = applyOpen(r, { openerId: id }, { now: () => 0 });
  kv.m.set(NEWS_OPENS_KEY(guid), JSON.stringify(r));
};

const story = (i) => ({ guid: `g${i}`, title: `Story ${i}`, link: `https://n.example/${i}`, source: `s${i}`, category: i % 2 ? 'AI/ML' : 'Security', publishedAt: 1_790_000_000 - i });
const WEEK = Array.from({ length: 1200 }, (_, i) => story(i));
const noSources = async () => ({ sources: [] });

test('sow-384: a week of 1,200 stories costs one listing and one read per OPENED story, not 1,200 reads', async () => {
  const kv = countingKV();
  opened(kv, 'g7', ['u1', 'u2', 'u3']);
  opened(kv, 'g900', ['u1']);
  opened(kv, 'gone-from-the-window', ['u9']); // an old story's record: listed, never read
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, nowMs: NOW_MS, sourceList: noSources, queryItems: async () => ({ items: WEEK }) });
  assert.equal(out.length, 1200, 'the whole week is gathered');
  assert.equal(kv.lists, 1, 'one listing page');
  assert.equal(kv.gets, 2, 'reads only for the two stories in the window that have opens');
  assert.equal(out.find((e) => e.url.endsWith('/7')).opens, 3);
  assert.equal(out.find((e) => e.url.endsWith('/900')).opens, 1);
  assert.equal(out.filter((e) => e.opens > 0).length, 2, 'every other story is zero');
});

test('sow-384: the gather passes each story\'s category through, for the one-per-category pick', async () => {
  const kv = countingKV();
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, nowMs: NOW_MS, sourceList: noSources, queryItems: async () => ({ items: WEEK.slice(0, 2) }) });
  assert.deepEqual(out.map((e) => e.category), ['Security', 'AI/ML']);
});

test('sow-384: the store is asked for the last seven days from the compile clock, with a ceiling not a slice', async () => {
  const kv = countingKV();
  let asked = null;
  await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, nowMs: NOW_MS, sourceList: noSources, queryItems: async (_e, f) => { asked = f; return { items: [] }; } });
  assert.equal(NEWS_WINDOW_DAYS, 7);
  assert.equal(asked.since, Math.floor(NOW_MS / 1000) - 7 * 86400);
  assert.ok(asked.limit >= 2000, 'a runaway bound well above a week (~1,200), never the old 60');
});

test('sow-384: a listing that fails leaves every story at zero opens and the issue still gathers', async () => {
  const kv = countingKV({ listThrows: true });
  opened(kv, 'g1', ['u1', 'u2']);
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, nowMs: NOW_MS, sourceList: noSources, queryItems: async () => ({ items: WEEK.slice(0, 50) }) });
  assert.equal(out.length, 50, 'the news still gathers');
  assert.ok(out.every((e) => e.opens === 0), 'zero opens: a missing count lowers rank, never breaks the issue');
  assert.equal(kv.gets, 0, 'and it does not fall back to reading every story one by one');
});

test('sow-384: listOpenedNews pages through every open record, and reports an incomplete walk', async () => {
  const kv = countingKV({ pageSize: 2 });
  for (const g of ['a', 'b', 'c', 'd', 'e']) opened(kv, g, ['u1']);
  kv.m.set('mail:subscriber:x', '{}'); // another prefix: never listed as an open
  const all = await listOpenedNews(kv);
  assert.equal(all.complete, true);
  assert.deepEqual([...all.keys].sort(), ['a', 'b', 'c', 'd', 'e'].map(NEWS_OPENS_KEY).sort());
  assert.equal(kv.lists, 3, 'three pages of two');

  const partial = await listOpenedNews(countingKV({ pageSize: 2 }), { pageBudget: 1 });
  assert.equal(partial.complete, true, 'an empty store is complete on page one');
  const kv2 = countingKV({ pageSize: 2 });
  for (const g of ['a', 'b', 'c']) opened(kv2, g, ['u1']);
  const cut = await listOpenedNews(kv2, { pageBudget: 1 });
  assert.equal(cut.complete, false, 'a walk that runs out of pages says so');
  assert.equal(cut.keys.size, 2);
  assert.equal(await listOpenedNews({ get: async () => null }), null, 'a store that cannot list returns null');
});

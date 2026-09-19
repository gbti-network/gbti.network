// sow-338 Phase 1: a superadmin pulls one story out of the news index, and puts it back.
//
// Requested by the owner on 2026-09-15: until now nothing could remove a single item, so a bad story sat in the
// feed for its full thirty days. The mechanism is a TOMBSTONE rather than a deletion, and these pin why that is
// not a detail: delete the item and its guid, and the next fetch of that source stores it again; keep the guid
// alone, and it leaves with its day after thirty days while feeds list some items for longer. So the tombstone
// has to outlive both, be skipped on the way in, filtered on the way out, and carry the item for an exact undo.
//
// The other half is the gate: the page only reveals the control, and an admin must get 403 here and change
// nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dropFromShard, expiredTombstones, removeItem, restoreItem, queryItems, commitIngest, loadRemoved, loadIndex,
  loadDay, saveIndex, saveDay, dayOf, TOMBSTONE_DAYS,
} from '../workers/signup/news/src/store.mjs';
import { newsItemDecide, newsRemovedList, readGuid } from '../workers/signup/membership-admin-news.mjs';
import { isNewItem } from '../workers/signup/news/src/ingest.mjs';

const NOW = 1_750_000_000;
const DAY = 86400;
const item = (guid, publishedAt, extra = {}) => ({ guid, source: 's', category: 'Other', title: `t-${guid}`, publishedAt, fetchedAt: publishedAt, ...extra });

/** A NEWS_KV double backed by a Map, plus a note of every write, so "changed nothing" is assertable. */
function newsEnv(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  return {
    map: m,
    writes,
    NEWS_KV: {
      get: async (k) => m.get(k) ?? null,
      put: async (k, v) => { writes.push(k); m.set(k, v); },
      delete: async (k) => { writes.push(`delete:${k}`); m.delete(k); },
    },
  };
}
const read = (env, k) => JSON.parse(env.map.get(k) ?? 'null');

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

test('sow-338: dropFromShard takes one story out and hands it back, or reports it was not there', () => {
  const shard = [item('a', NOW), item('b', NOW - 10)];
  const hit = dropFromShard(shard, 'a');
  assert.deepEqual(hit.shard.map((i) => i.guid), ['b']);
  assert.equal(hit.item.guid, 'a', 'the item comes back, which is what an undo restores from');
  const miss = dropFromShard(shard, 'nope');
  assert.equal(miss.item, null);
  assert.equal(miss.shard, shard, 'and a miss does not copy the shard');
});

test('sow-338: tombstones expire on their OWN window, well past the feed retention', () => {
  const removed = {
    fresh: { at: (NOW - 10 * DAY) * 1000 },
    old: { at: (NOW - 100 * DAY) * 1000 },
    malformed: { at: 'nonsense' },
    empty: {},
  };
  assert.deepEqual(expiredTombstones(removed, TOMBSTONE_DAYS, NOW).sort(), ['empty', 'malformed', 'old']);
  assert.equal(TOMBSTONE_DAYS > 30, true, 'longer than the 30-day feed window, or a story could come back');
  // A record with no readable timestamp is forgotten rather than kept for ever: it cannot be reasoned about,
  // and the story it hides is long past the window by the time anyone notices.
  assert.deepEqual(expiredTombstones({ fresh: { at: NOW * 1000 } }, TOMBSTONE_DAYS, NOW), []);
});

// ---------------------------------------------------------------------------
// Remove and restore
// ---------------------------------------------------------------------------

const seedOne = (guid = 'g1', now = NOW) => {
  const d = dayOf(now);
  const env = newsEnv();
  env.map.set(`feed:v2:day:${d}`, JSON.stringify([item(guid, now), item('other', now - 5)]));
  env.map.set('feed:v2:guids', JSON.stringify({ [guid]: d, other: d }));
  env.map.set('feed:v2:index', JSON.stringify({
    days: [d], counts: { category: { Other: 2 }, source: { s: 2 } }, contentStats: { s: { full: 1, thin: 1 } }, total: 2, updatedAt: now,
  }));
  return { env, day: d };
};

test('sow-338: removing a story takes it out of its day and its counts, and KEEPS the guid', async () => {
  const { env, day } = seedOne();
  const r = await removeItem(env, { guid: 'g1', by: 'atwellpub', now: NOW });
  assert.deepEqual(r, { ok: true, removed: true, restorable: true });

  assert.deepEqual(read(env, `feed:v2:day:${day}`).map((i) => i.guid), ['other']);
  const index = read(env, 'feed:v2:index');
  assert.equal(index.total, 1);
  assert.equal(index.counts.category.Other, 1);
  assert.equal(index.counts.source.s, 1);
  // The guid map is NOT touched: dropping the guid would let the next fetch of that source store it again.
  assert.deepEqual(Object.keys(read(env, 'feed:v2:guids')).sort(), ['g1', 'other']);
  // contentStats records what the feeds SENT us, not what we kept, so a removal leaves it alone.
  assert.deepEqual(index.contentStats, { s: { full: 1, thin: 1 } });

  const tomb = read(env, 'feed:v2:removed').g1;
  assert.equal(tomb.by, 'atwellpub');
  assert.equal(tomb.day, day);
  assert.equal(tomb.item.guid, 'g1', 'the story is copied, which is what makes undo exact');
});

test('sow-338: removing is idempotent, and an unknown story is not found', async () => {
  const { env } = seedOne();
  await removeItem(env, { guid: 'g1', now: NOW });
  const writesBefore = env.writes.length;
  const again = await removeItem(env, { guid: 'g1', now: NOW + 5 });
  assert.deepEqual(again, { ok: true, already: true });
  assert.equal(env.writes.length, writesBefore, 'and a second removal writes nothing');
  assert.deepEqual(await removeItem(env, { guid: 'never-seen', now: NOW }), { ok: false, error: 'not_found' });
});

test('sow-338: a story whose shard no longer holds it is still tombstoned, so it cannot come back', async () => {
  // The guid map knows the day, but the item is gone from that shard (an earlier prune, a rewrite). There is
  // nothing to restore, and the removal still has to stop the next fetch storing it again.
  const { env, day } = seedOne();
  env.map.set(`feed:v2:day:${day}`, JSON.stringify([item('other', NOW - 5)]));
  const r = await removeItem(env, { guid: 'g1', now: NOW });
  assert.deepEqual(r, { ok: true, removed: true, restorable: false });
  assert.equal(read(env, 'feed:v2:removed').g1.item, null);
  const index = read(env, 'feed:v2:index');
  assert.equal(index.total, 2, 'and nothing was subtracted for an item that was not there');
});

test('sow-338: restoring puts the story back exactly where it was', async () => {
  const { env, day } = seedOne();
  await removeItem(env, { guid: 'g1', now: NOW });
  const r = await restoreItem(env, { guid: 'g1', now: NOW + 60 });
  assert.deepEqual(r, { ok: true, restored: true });
  assert.deepEqual(read(env, `feed:v2:day:${day}`).map((i) => i.guid), ['g1', 'other'], 'back in its day, newest-first');
  const index = read(env, 'feed:v2:index');
  assert.equal(index.total, 2);
  assert.equal(index.counts.source.s, 2);
  assert.deepEqual(read(env, 'feed:v2:removed'), {}, 'and the tombstone is gone, so ingest stops skipping it');
});

test('sow-338: restoring answers plainly when there is nothing to put back', async () => {
  const { env, day } = seedOne();
  assert.deepEqual(await restoreItem(env, { guid: 'g1', now: NOW }), { ok: false, error: 'not_found' });
  await removeItem(env, { guid: 'g1', now: NOW });
  // Its day has since left the window, so there is no shard to restore into.
  const index = read(env, 'feed:v2:index');
  await saveIndex(env, { ...index, days: [] });
  assert.deepEqual(await restoreItem(env, { guid: 'g1', now: NOW }), { ok: false, error: 'expired' });
  assert.ok(read(env, 'feed:v2:removed').g1, 'and the tombstone stays, because the story must not return');
});

// ---------------------------------------------------------------------------
// The two guards: reads and ingest
// ---------------------------------------------------------------------------

test('sow-338: a removed story is filtered out of reads', async () => {
  const { env } = seedOne();
  assert.deepEqual((await queryItems(env, { limit: 10 })).items.map((i) => i.guid), ['g1', 'other']);
  await removeItem(env, { guid: 'g1', now: NOW });
  assert.deepEqual((await queryItems(env, { limit: 10 })).items.map((i) => i.guid), ['other']);
});

test('sow-338: the read filter covers a story written back by an ingest run mid-removal', async () => {
  // Removal and ingest can touch the same day at the same time. The tombstone is checked on the way out as well
  // as on the way in, so a re-written item is still invisible; this asserts that second guard alone.
  const { env, day } = seedOne();
  await removeItem(env, { guid: 'g1', now: NOW });
  await saveDay(env, day, [item('g1', NOW), item('other', NOW - 5)]); // as if ingest had just re-written the shard
  assert.deepEqual((await queryItems(env, { limit: 10 })).items.map((i) => i.guid), ['other']);
});

test('sow-338: tombstones are pruned by ingest on their own, longer window', async () => {
  const { env } = seedOne();
  env.map.set('feed:v2:removed', JSON.stringify({
    recent: { at: (NOW - 10 * DAY) * 1000, item: null, day: null },
    ancient: { at: (NOW - 100 * DAY) * 1000, item: null, day: null },
  }));
  await commitIngest(env, { retentionDays: 30, now: NOW, freshItems: [] });
  assert.deepEqual(Object.keys(read(env, 'feed:v2:removed')), ['recent']);
});

test('sow-338: ingest skips a removed story, for as long as the tombstone lives', () => {
  // The third guard, and the one that makes a removal stick. Without it the next fetch of that source stores the
  // story again as soon as its guid ages out of the window with its day.
  const removed = { pulled: { at: NOW * 1000 } };
  assert.equal(isNewItem('pulled', { removed }), false, 'a removed story is never fresh again');
  assert.equal(isNewItem('pulled', {}), true, 'and it IS fresh once the tombstone is forgotten, 90 days on');
  // The other two reasons still hold, so the new check is an addition rather than a replacement.
  assert.equal(isNewItem('stored', { guids: { stored: '2026-09-18' } }), false);
  assert.equal(isNewItem('twice', { localSeen: new Set(['twice']) }), false);
  assert.equal(isNewItem('brand-new', { guids: { other: '2026-09-18' }, localSeen: new Set(['x']), removed }), true);
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

const req = (body) => ({ json: async () => body, method: 'POST', headers: { get: () => null } });
const allow = async () => ({ ok: true, githubId: '12345', login: 'atwellpub' });
const deny = async () => ({ ok: false, status: 403, body: { ok: false, error: 'forbidden' } });

test('sow-338: the route refuses anyone who is not a superadmin, and writes nothing', async () => {
  // The page reveals the control from the member signal, which is presentation only. This is the enforcement.
  const { env } = seedOne();
  const before = env.writes.length;
  const r = await newsItemDecide(req({ action: 'remove', guid: 'g1' }), env, { authorize: deny });
  assert.equal(r.status, 403);
  assert.equal(env.writes.length, before, 'an admin changes nothing');
  assert.ok(read(env, 'feed:v2:day:' + dayOf(NOW)).some((i) => i.guid === 'g1'), 'and the story is still there');
  const list = await newsRemovedList({ method: 'GET', headers: { get: () => null } }, env, { authorize: deny });
  assert.equal(list.status, 403, 'the list is superadmin-only too');
});

test('sow-338: the route removes, restores and reports what it did', async () => {
  const { env } = seedOne();
  const removed = await newsItemDecide(req({ action: 'remove', guid: 'g1' }), env, { authorize: allow, now: NOW });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { ok: true, guid: 'g1', already: false, restorable: true });
  assert.equal(read(env, 'feed:v2:removed').g1.by, 'atwellpub', 'the acting superadmin is recorded');

  const list = await newsRemovedList({ method: 'GET', headers: { get: () => null } }, env, { authorize: allow });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((i) => i.guid), ['g1']);
  assert.equal(list.body.items[0].title, 't-g1');

  const back = await newsItemDecide(req({ action: 'restore', guid: 'g1' }), env, { authorize: allow, now: NOW });
  assert.equal(back.status, 200);
  assert.deepEqual(back.body, { ok: true, guid: 'g1', restored: true });
});

test('sow-338: the route refuses a request that is not one', async () => {
  const { env } = seedOne();
  const cases = [
    [{ action: 'delete', guid: 'g1' }, 400, 'bad_request'],
    [{ guid: 'g1' }, 400, 'bad_request'],
    [{ action: 'remove' }, 400, 'bad_request'],
    [{ action: 'remove', guid: '   ' }, 400, 'bad_request'],
    [{ action: 'remove', guid: 'a'.repeat(513) }, 400, 'bad_request'],
    [{ action: 'remove', guid: 'bad guid' }, 400, 'bad_request'],
    [{ action: 'remove', guid: 'never-seen' }, 404, 'not_found'],
    [{ action: 'restore', guid: 'never-removed' }, 404, 'not_found'],
  ];
  for (const [body, status, error] of cases) {
    const r = await newsItemDecide(req(body), env, { authorize: allow, now: NOW });
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(r.body.error, error, JSON.stringify(body));
  }
  assert.equal(read(env, 'feed:v2:removed'), null, 'and none of them wrote a tombstone');
});

test('sow-338: readGuid takes a real feed guid and refuses the rest', () => {
  assert.equal(readGuid({ guid: 'https://example.com/a?b=1' }), 'https://example.com/a?b=1');
  assert.equal(readGuid({ guid: '  spaced  ' }), 'spaced');
  for (const bad of [{}, { guid: '' }, { guid: 42 }, { guid: null }, { guid: 'x'.repeat(513) }, { guid: 'a\nb' }]) {
    assert.equal(readGuid(bad), null, JSON.stringify(bad));
  }
});

test('sow-338: a store that will not answer reads as a failure, never as done', async () => {
  // A KV outage that answered 200 would leave a superadmin believing a story was pulled when it is still live.
  const env = { NEWS_KV: { get: async () => { throw new Error('kv down'); }, put: async () => {}, delete: async () => {} } };
  const r = await newsItemDecide(req({ action: 'remove', guid: 'g1' }), env, { authorize: allow, now: NOW });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  const missing = await newsItemDecide(req({ action: 'remove', guid: 'g1' }), {}, { authorize: allow });
  assert.equal(missing.status, 503, 'and so does a Worker with no news store bound');
});

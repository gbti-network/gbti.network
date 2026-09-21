// Persistence for the polled news collection — day-sharded KV.
//
// "No database", and built for the free tier: instead of one ever-growing JSON blob (which would blow
// the free plan's 10ms-CPU-per-request budget once it hit several MB), items are sharded by UTC day:
//
//   feed:v2:day:<YYYY-MM-DD>  -> item[] for that day (sorted newest-first)
//   feed:v2:guids             -> { "<guid>": "<YYYY-MM-DD>" }  dedupe map across the whole window
//   feed:v2:index             -> { days:[...], counts:{category:{},source:{}}, total, updatedAt }
//   feed:v2:removed           -> { "<guid>": { at, by, source, day, item } }  sow-338 tombstones
//   feed:v2:banwords          -> ["trump", ...]  sow-372, refreshed from the published artifact by each ingest
//
// 30-day retention = keep the last 30 day-shards (prune older). /feed reads newest shards first and
// stops once it has enough items, so the common case parses only a shard or two. All KV access is
// isolated here, so swapping to R2 later is a one-file change. Pure helpers are exported for tests.

import { matchesFilter } from './api.mjs';
import { banwordMatcher, blockedBy } from '../../../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out

const PREFIX = 'feed:v2';
const K_INDEX = `${PREFIX}:index`;
const K_GUIDS = `${PREFIX}:guids`;
const kDay = (d) => `${PREFIX}:day:${d}`;
const K_REMOVED = `${PREFIX}:removed`;
const K_BANWORDS = `${PREFIX}:banwords`;

// sow-372: the blocked words, mirrored into KV by each ingest run from the published artifact it already fetches.
// The READ path needs them and cannot afford the artifact fetch on every feed request, and it has to see them at
// all: without a read-side filter, seeding the list would leave a month of matching stories in the window.
export const loadBanwords = (env) => getJSON(env, K_BANWORDS, []);
export const saveBanwords = (env, words) => env.NEWS_KV.put(K_BANWORDS, JSON.stringify(words));

// sow-338: a superadmin pulling a story writes a TOMBSTONE rather than deleting the record, for two reasons.
// Removing the item and its guid would let the next fetch of that source store it again (ingest skips only what
// the guid map already holds), and keeping the guid alone would not last either, because a guid leaves with its
// day after 30 days while some feeds list an item for longer. The tombstone outlives both: ingest skips it, every
// read filters it, and it carries a copy of the item so an undo restores exactly what was there.
//
// They are kept for 90 days, well past retention, and pruned by the same ingest pass that prunes day shards.
export const TOMBSTONE_DAYS = 90;

/** UTC day string (YYYY-MM-DD) for an epoch-seconds timestamp. */
export const dayOf = (epochSec) => new Date(epochSec * 1000).toISOString().slice(0, 10);

const ts = (it) => it.publishedAt ?? it.fetchedAt ?? 0;

async function getJSON(env, key, fallback) {
  const raw = await env.NEWS_KV.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// contentStats (SOW-046 A diagnostics): cumulative per-source { full, thin } content-richness tallies, so /diag can
// report how many feeds are blurb-only (the Readability go/no-go signal). Defensive everywhere (older indexes lack it).
export const emptyIndex = () => ({ days: [], counts: { category: {}, source: {} }, contentStats: {}, total: 0, updatedAt: 0 });

export const loadIndex = (env) => getJSON(env, K_INDEX, emptyIndex());
export const loadRemoved = (env) => getJSON(env, K_REMOVED, {});
export const loadGuids = (env) => getJSON(env, K_GUIDS, {});
export const loadDay = (env, d) => getJSON(env, kDay(d), []);

// Exported so the SOW-050 image backfill can rewrite a shard in place (image/imgTried fields) + bump freshness,
// keeping ALL KV access isolated in this module (the R2-swap-is-one-file invariant).
export const saveIndex = (env, index) => env.NEWS_KV.put(K_INDEX, JSON.stringify(index));
const saveGuids = (env, guids) => env.NEWS_KV.put(K_GUIDS, JSON.stringify(guids));
const saveRemoved = (env, removed) => env.NEWS_KV.put(K_REMOVED, JSON.stringify(removed));
export const saveDay = (env, d, items) => env.NEWS_KV.put(kDay(d), JSON.stringify(items));

/** Merge incoming items into a day's array, dedupe by guid (incoming wins), sort newest-first. Pure. */
export function mergeDayItems(existing, incoming) {
  const m = new Map();
  for (const it of existing) m.set(it.guid, it);
  for (const it of incoming) m.set(it.guid, it);
  return [...m.values()].sort((a, b) => ts(b) - ts(a));
}

/** Increment/decrement a counts map in place. Pure. */
export function applyCounts(counts, item, delta) {
  counts.category[item.category] = Math.max(0, (counts.category[item.category] || 0) + delta);
  counts.source[item.source] = Math.max(0, (counts.source[item.source] || 0) + delta);
}

/** Take one guid out of a day's array. Returns { shard, item }, item null when it was not there. Pure. */
export function dropFromShard(shard, guid) {
  const item = shard.find((it) => it.guid === guid) || null;
  return { shard: item ? shard.filter((it) => it.guid !== guid) : shard, item };
}

/** Tombstone guids to forget, being older than the keep window. Pure. */
export function expiredTombstones(removed, keepDays, now) {
  const cutoff = (now - keepDays * 86400) * 1000;
  return Object.keys(removed).filter((g) => !(Number(removed[g]?.at) >= cutoff));
}

/** Day strings strictly older than the retention window (given current index.days). Pure. */
export function expiredDays(days, retentionDays, now) {
  const cutoff = dayOf(now - retentionDays * 86400);
  return days.filter((d) => d < cutoff);
}

/**
 * Persist a freshly-ingested batch into today's shard and update the guid map + index, then prune
 * day-shards outside the retention window. `items` already have a final category + fetchedAt.
 * `changedCategories` is an optional list of { guid, from, to } for items reclassified this run
 * (their counts are adjusted). Returns the updated index.
 */
export async function commitIngest(env, { freshItems = [], updatedItems = [], changedCategories = [], contentStatsDelta = {}, retentionDays, tombstoneDays = TOMBSTONE_DAYS, now, index, guids }) {
  const today = dayOf(now);
  index = index ?? (await loadIndex(env));
  guids = guids ?? (await loadGuids(env));

  // 1. Write fresh (new) + updated (reclassified, already-stored) items into today's shard.
  //    Only fresh items add to the guid map and counts; updated items are re-written in place.
  if (freshItems.length || updatedItems.length) {
    const shard = await loadDay(env, today);
    await saveDay(env, today, mergeDayItems(shard, [...freshItems, ...updatedItems]));
    if (!index.days.includes(today)) index.days.push(today);
    for (const it of freshItems) {
      guids[it.guid] = today;
      applyCounts(index.counts, it, +1);
      index.total += 1;
    }
  }

  // 2. Adjust counts for items whose category changed during this run's reclassification.
  for (const c of changedCategories) {
    if (c.from === c.to) continue;
    index.counts.category[c.from] = Math.max(0, (index.counts.category[c.from] || 0) - 1);
    index.counts.category[c.to] = (index.counts.category[c.to] || 0) + 1;
  }

  // 3. Prune expired day-shards (subtract their counts, drop their guids, delete the shard).
  for (const d of expiredDays(index.days, retentionDays, now)) {
    const shard = await loadDay(env, d);
    for (const it of shard) { applyCounts(index.counts, it, -1); index.total = Math.max(0, index.total - 1); }
    for (const g of Object.keys(guids)) if (guids[g] === d) delete guids[g];
    await env.NEWS_KV.delete(kDay(d));
    index.days = index.days.filter((x) => x !== d);
  }

  // 3b. sow-338: forget tombstones past their keep window. They outlive retention on purpose (a feed may list an
  //     item longer than we store it), so this is a separate, longer cutoff.
  const removed = await loadRemoved(env);
  const staleTombstones = expiredTombstones(removed, tombstoneDays, now);
  if (staleTombstones.length) {
    for (const g of staleTombstones) delete removed[g];
    await saveRemoved(env, removed);
  }

  // 4. Merge this run's content-richness tallies (SOW-046 A diagnostics) into the cumulative per-source stats.
  index.contentStats = index.contentStats || {};
  for (const [src, d] of Object.entries(contentStatsDelta)) {
    const prev = index.contentStats[src] || { full: 0, thin: 0 };
    index.contentStats[src] = { full: prev.full + (d.full || 0), thin: prev.thin + (d.thin || 0) };
  }

  index.updatedAt = now;
  await saveGuids(env, guids);
  await saveIndex(env, index);
  return index;
}

/**
 * sow-338: a superadmin pulls one story out of the index.
 *
 * The guid STAYS in the guid map and a tombstone is written, so the story is skipped on every later fetch and
 * filtered out of every read. The item is copied into the tombstone, which is what makes the undo exact.
 *
 * Idempotent: removing an already-removed guid answers `already`. A guid the window never held answers
 * `not_found`, and one whose day shard no longer carries the item is still tombstoned (so it cannot return),
 * with no copy to restore from.
 */
export async function removeItem(env, { guid, by = null, now = Math.floor(Date.now() / 1000) }) {
  const removed = await loadRemoved(env);
  if (removed[guid]) return { ok: true, already: true };
  const guids = await loadGuids(env);
  const day = guids[guid];
  if (!day) return { ok: false, error: 'not_found' };

  const shard = await loadDay(env, day);
  const { shard: left, item } = dropFromShard(shard, guid);
  if (item) {
    const index = await loadIndex(env);
    await saveDay(env, day, left);
    applyCounts(index.counts, item, -1);
    index.total = Math.max(0, index.total - 1);
    // contentStats is a CUMULATIVE diagnostic of what the feeds have been sending us (how many arrive as full
    // text rather than a blurb). It is a record of what we received, not of what we kept, so a removal leaves it.
    index.updatedAt = now;
    await saveIndex(env, index);
  }
  removed[guid] = { at: now * 1000, by, source: item?.source ?? null, day, item: item ?? null };
  await saveRemoved(env, removed);
  return { ok: true, removed: true, restorable: Boolean(item) };
}

/** sow-338: put a removed story back where it was. `expired` when its day has since left the window. */
export async function restoreItem(env, { guid, now = Math.floor(Date.now() / 1000) }) {
  const removed = await loadRemoved(env);
  const rec = removed[guid];
  if (!rec) return { ok: false, error: 'not_found' };
  const { item, day } = rec;
  if (item && day) {
    const index = await loadIndex(env);
    if (!index.days.includes(day)) return { ok: false, error: 'expired' };
    const shard = await loadDay(env, day);
    await saveDay(env, day, mergeDayItems(shard, [item]));
    applyCounts(index.counts, item, +1);
    index.total += 1;
    index.updatedAt = now;
    await saveIndex(env, index);
  }
  delete removed[guid];
  await saveRemoved(env, removed);
  return { ok: true, restored: Boolean(item) };
}

/**
 * Read items newest-first across day shards, applying filters, stopping once `limit` are collected.
 * Common (recent) queries parse only a shard or two. Returns { items, updatedAt }.
 */
export async function queryItems(env, filter = {}) {
  const { limit = 50 } = filter;
  const index = await loadIndex(env);
  // sow-338: removed stories are filtered on the way out as well as skipped on the way in. The two are not the
  // same guard: an ingest run can write the same day a removal is landing in, and this covers that window.
  const removed = await loadRemoved(env);
  // sow-372: the second of the two blocking points. Ingest refuses a matching story before it is stored, and this
  // refuses one on the way out, so a word added today hides the stories already inside the 30-day window instead
  // of waiting a month for them to age out. Built once per query, not per story.
  const banned = banwordMatcher(await loadBanwords(env));
  const days = [...index.days].sort().reverse(); // newest day first
  // sow-384: with a `since`, stop at the first day file older than it. The `limit` break below only helps a query
  // that fills up, and a week-long digest query never does, so without this it read all thirty retained days. A
  // day file is the day a story was COLLECTED, never before it was published, so nothing inside the window can sit
  // in an older file; one day of slack covers a feed whose clock runs ahead of ours.
  const sinceN = Number.parseInt(filter.since, 10);
  const oldestDay = Number.isFinite(sinceN) ? dayOf(sinceN - 86400) : null;
  const out = [];
  for (const d of days) {
    if (oldestDay && d < oldestDay) break;
    const shard = await loadDay(env, d);
    for (const it of shard) if (!removed[it.guid] && !blockedBy(it, banned) && matchesFilter(it, filter)) out.push(it);
    if (out.length >= limit) break; // enough recent matches; deeper shards not needed
  }
  out.sort((a, b) => ts(b) - ts(a));
  return { items: out.slice(0, limit), updatedAt: index.updatedAt };
}

// Hourly ingest pipeline: fetch the configured sources -> parse -> dedupe against the stored
// collection -> classify NEW items with Workers AI -> merge/prune -> save. Shared by the cron
// (scheduled handler) and the POST /refresh endpoint.
//
// Resilience: each source is fetched with a timeout and via Promise.allSettled, so one slow or broken
// feed can never abort the run. Classification failures fall back gracefully (see classify.mjs) and
// leave the item flagged `classified:false` so a later run retries it.

import { DEFAULT_CATEGORY } from '../config/categories.mjs';
import { parseFeed, contentRichness } from './feeds.mjs';
import { classifyItem, analyzeItem, keywordCategory } from './classify.mjs';
import { loadIndex, loadGuids, loadDay, loadRemoved, dayOf, commitIngest, saveBanwords } from './store.mjs';
import { loadSourceList, nextChunk, rotationOrder, fetchCap } from './sources.mjs'; // SOW-056: git-native pool + sequential KV cursor
import { banwordMatcher, blockedBy } from '../../../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out

const FETCH_TIMEOUT_MS = 8000;
// Free Workers plan allows 50 subrequests per invocation, and fetches + AI calls + KV ops all count.
// Budget: SOURCE_CHUNK fetches (~20) + MAX_CLASSIFY AI calls (~16) + ~9 KV ops stays under 50.
// Leftover new items are stored with a fallback label and reclassified on later hourly runs.
const DEFAULT_MAX_CLASSIFY = 16;
const CLASSIFY_CONCURRENCY = 5;

/** Fetch + parse one source. Never throws; returns [] on any failure. */
async function fetchSource(src) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'gbti-news-bot/0.1 (+https://gbti.network)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) {
      console.error(JSON.stringify({ at: 'fetchSource', source: src.id, status: res.status }));
      return [];
    }
    return parseFeed(await res.text(), src.id);
  } catch (err) {
    console.error(JSON.stringify({ at: 'fetchSource', source: src.id, error: String(err?.message || err) }));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Run async fn over items with a fixed concurrency limit; preserves order. */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Is this story new to us? Three reasons it is not, and the third is sow-338's:
 *   - the guid map already holds it (it is stored, somewhere in the window),
 *   - this same batch already carried it (two feeds, one story),
 *   - a superadmin removed it, and a tombstone says so. That check cannot be folded into the guid map, because
 *     a guid leaves with its day after thirty days while a feed may list the item for longer, which is exactly
 *     how a removed story would come back.
 * Pure, so each reason is assertable without running a cycle (ingest has no other test).
 */
export function isNewItem(guid, { guids = {}, localSeen = new Set(), removed = {} } = {}) {
  return !(guid in guids) && !localSeen.has(guid) && !removed[guid];
}

/**
 * Which of a batch's parsed stories we actually keep: the ones new to us, and no more of any one source than
 * its weight allows (sow-338). Neutral and above are uncapped, which is exactly today's behaviour, so nothing
 * changes for a source nobody has weighted.
 *
 * Feeds list newest first and the fetches preserve that order, so taking the first N of a capped source keeps
 * its NEWEST N. Pure, and separated from the cycle so the cap is assertable on its own.
 */
export function selectFresh(parsed, { guids = {}, removed = {}, capFor = new Map(), now = 0, banned = null, onBlock = null } = {}) {
  const localSeen = new Set();
  const keptPerSource = new Map();
  const fresh = [];
  for (const it of parsed) {
    if (!isNewItem(it.guid, { guids, localSeen, removed })) continue;
    // sow-372: BEFORE the cap is charged, so a blocked story never spends a down-weighted source's quota, and
    // before anything is stored, so it is never classified or summarised. No tombstone is written: nothing
    // records the refusal, so taking a word off the list lets the story in on the next run by itself.
    const word = blockedBy(it, banned);
    if (word) { if (onBlock) onBlock(word, it); continue; }
    const cap = capFor.get(it.source) ?? Infinity;
    const kept = keptPerSource.get(it.source) || 0;
    if (kept >= cap) continue;
    keptPerSource.set(it.source, kept + 1);
    localSeen.add(it.guid);
    fresh.push({ ...it, fetchedAt: now });
  }
  return fresh;
}

/**
 * Run one ingest cycle. `now` is epoch seconds (inject in tests; defaults to wall clock).
 * Returns a summary object (also logged) describing what happened.
 */
export async function ingest(env, { now = Math.floor(Date.now() / 1000) } = {}) {
  const retentionDays = Number(env.RETENTION_DAYS) || 30;
  const chunkSize = Number(env.SOURCE_CHUNK) || 0;
  const maxClassify = Number(env.MAX_CLASSIFY) || DEFAULT_MAX_CLASSIFY;

  // Load index + guid map once; pass both to commitIngest so it doesn't re-read them (subrequest budget).
  const index = await loadIndex(env);
  const guids = await loadGuids(env); // { guid: dayString } across the whole retention window
  // sow-338: stories a superadmin pulled. Skipped here as well as filtered on read, because the guid map alone
  // cannot hold a removal: a guid leaves with its day after 30 days, and feeds list some items for longer.
  const removed = await loadRemoved(env);

  // 1. Resolve the live pool (git-native artifact -> KV cache -> bundled seed) and pick the next sequential chunk
  //    via the persisted cursor, then fetch + parse in parallel (allSettled => one failure can't abort).
  const { sources: pool, banwords, origin: sourcesOrigin } = await loadSourceList(env);
  // sow-372: mirror the blocked words into KV so the FEED READ can see them without fetching the artifact on
  // every request. Best-effort: a failed write leaves the previous list in place, and ingest still blocks with the
  // list it just read, so a KV hiccup can never open the gate on this run.
  if (sourcesOrigin === 'remote') { try { await saveBanwords(env, banwords); } catch { /* the read path keeps the last list */ } }
  const banned = banwordMatcher(banwords);
  // sow-338: the cursor walks a WEIGHTED rotation rather than the pool itself, so a source a superadmin voted up
  // comes round more often and one voted down less. Every enabled source still appears in every cycle.
  // sow-384: `spread` deals each pass by the chunk size, so sources on one topic are collected in different runs.
  const sources = await nextChunk(env, rotationOrder(pool, { spread: chunkSize }), chunkSize);
  const settled = await Promise.allSettled(sources.map((s) => fetchSource(s)));
  const parsed = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // 2. Keep only items we've never seen (dedupe against the window + within this batch), and no more of any one
  //    source than its sow-338 weight allows.
  const capFor = new Map(sources.map((s) => [s.id, fetchCap(s.weight)]));
  // Every block is LOGGED with the word and the headline, because the cost of reading the summaries as well as
  // the headline is over-blocking a technology story that mentions a banned word in passing. That shows up here
  // rather than as stories quietly going missing.
  const blocked = [];
  const fresh = selectFresh(parsed, {
    guids, removed, capFor, now, banned,
    onBlock: (word, it) => { blocked.push({ word, source: it.source, title: String(it.title || '').slice(0, 120) }); },
  });
  if (blocked.length) console.log(JSON.stringify({ at: 'ingest.blocked', count: blocked.length, items: blocked.slice(0, 20) }));

  // 2b. SOW-046 A diagnostics: tally how many fresh items arrived with FULL inline article text vs only a THIN
  //     blurb (per source + overall), BEFORE contentText is stripped. This measures the blurb-only gap that a
  //     future Readability fetch would close, so the owner can decide from data, not a guess (see /diag).
  const contentStatsDelta = {};
  let contentFull = 0;
  let contentThin = 0;
  for (const it of fresh) {
    const r = contentRichness(it);
    if (r === 'full') contentFull += 1; else contentThin += 1;
    const d = (contentStatsDelta[it.source] ||= { full: 0, thin: 0 });
    d[r] += 1;
  }

  // 3. Classify + SUMMARIZE fresh items up to the per-run AI budget (one combined AI call each, SOW-046 A); the
  //    overflow gets a cheap keyword label + no digest now (the feed excerpt is its display fallback). The
  //    transient contentText (the article body fed to the summarizer) is STRIPPED here so it is never persisted.
  const toClassify = fresh.slice(0, maxClassify);
  const classified = await mapWithConcurrency(toClassify, CLASSIFY_CONCURRENCY, async (it) => {
    const { category, classified: ok, digest, summarized } = await analyzeItem(env, it);
    const { contentText, ...rest } = it;
    return { ...rest, category, classified: ok, summarized, ...(digest ? { digest } : {}) };
  });
  const overflowFresh = fresh.slice(toClassify.length).map((it) => {
    const { contentText, ...rest } = it;
    return { ...rest, category: keywordCategory(it) || DEFAULT_CATEGORY, classified: false, summarized: false };
  });
  const freshItems = [...classified, ...overflowFresh];

  // 4. If AI budget remains, retry today's still-unclassified items (recorded as category changes).
  const updatedItems = [];
  const changedCategories = [];
  let remaining = maxClassify - toClassify.length;
  if (remaining > 0) {
    const pending = (await loadDay(env, dayOf(now))).filter((it) => it.classified === false).slice(0, remaining);
    const redone = await mapWithConcurrency(pending, CLASSIFY_CONCURRENCY, async (it) => {
      const { category, classified: ok } = await classifyItem(env, it);
      return { item: it, category, ok };
    });
    for (const r of redone) {
      if (!r.ok) continue;
      if (r.category !== r.item.category) changedCategories.push({ guid: r.item.guid, from: r.item.category, to: r.category });
      updatedItems.push({ ...r.item, category: r.category, classified: true });
    }
  }

  // 5. Commit: write today's shard, update guid map + counts, prune shards outside retention.
  const updatedIndex = await commitIngest(env, { freshItems, updatedItems, changedCategories, contentStatsDelta, retentionDays, now, index, guids });

  const summary = {
    at: 'ingest',
    now,
    sources: sources.length,
    pool: pool.length, // SOW-056: total live pool size + where it came from (remote artifact / KV cache / bundled)
    sourcesOrigin,
    parsed: parsed.length,
    new: fresh.length,
    blocked: blocked.length, // sow-372: stories refused by the blocked-word list (never stored, never classified)
    banwords: banwords.length,
    classifiedOk: classified.filter((it) => it.classified).length,
    summarizedOk: classified.filter((it) => it.summarized).length,
    contentFull, // SOW-046 A: fresh items that arrived with full inline article text
    contentThin, // SOW-046 A: fresh items that arrived with only a short blurb (Readability-fetch candidates)
    reclassified: updatedItems.length,
    overflow: overflowFresh.length,
    total: updatedIndex.total,
    days: updatedIndex.days.length,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

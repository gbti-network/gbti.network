// SOW-056: resolve the live news source pool + drive sequential rotation.
//
// Git-native + portable: the canonical pool is house/news-sources.yml, published by the site build as
// /news-sources.json. This worker fetches that artifact (NEWS_SOURCES_URL) each cron — a public, CDN-cached URL, so
// no GitHub token is needed and a fork just repoints NEWS_SOURCES_URL at its own site. Fail-soft: remote -> KV cache
// -> the bundled config seed, so a deploy/network blip can never blank the pool.
//
// Rotation: a persisted KV cursor advances by chunkSize each run, so coverage is strictly SEQUENTIAL (every source
// polled over one cycle, never the same chunk two runs running) and stays correct as the list grows or shrinks —
// which it will, once superadmins curate house/news-sources.yml. Replaces the old wall-clock `now/3600` scheme.

import { SOURCES } from '../config/sources.mjs';
import { readBanwords } from '../../../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out

// sow-338: a superadmin's weight on a source, five steps. It changes how much we TAKE from that source (owner,
// 2026-09-18), never how its stories rank: the stream stays newest-first and every surface inherits the effect
// without knowing about it.
//
//   step | checked                     | new stories kept per check
//   +2   | twice per cycle             | all
//   +1   | three times per two cycles  | all
//    0   | once per cycle (today)      | all (today)
//   -1   | once per cycle              | 6
//   -2   | once every two cycles       | 3
//
// The bottom step is "rarely", never "off": muting is the explicit Disable toggle, so a weight can never silently
// drop a source. An unweighted source behaves EXACTLY as it did before this existed, which is why neutral has no
// cap: nothing changes until somebody votes.
export const WEIGHT_MIN = -2;
export const WEIGHT_MAX = 2;

/** A stored weight as a step: an integer in range, and 0 for anything unreadable. Pure. */
export function clampWeight(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return 0;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, n));
}

// Appearances per SUPERCYCLE (two cycles), which is how a half-step is expressed without a wall clock.
const APPEARANCES = { '-2': 1, '-1': 2, 0: 2, 1: 3, 2: 4 };
/** New stories one check may keep. Neutral and above keep everything, which is today's behaviour. */
const CAPS = { '-2': 3, '-1': 6 };

/** How many stories one fetch of this source may keep. Infinity for neutral and above. Pure. */
export function fetchCap(weight) {
  return CAPS[String(clampWeight(weight))] ?? Infinity;
}

/**
 * The rotation the cursor walks: every source once, then the ones weighted up again, in passes.
 *
 * Built in PASSES rather than by repeating each source in place, so a source's repeats are spread across the
 * supercycle instead of landing in the same chunk. With 125 sources and a chunk of 16 that puts any two
 * appearances of one source at least a full pass apart.
 *
 * Pure. Every enabled source keeps at least one appearance, whatever its weight.
 */
export function rotationOrder(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const times = (s) => APPEARANCES[String(clampWeight(s?.weight))] ?? 2;
  const out = [];
  for (let pass = 1; pass <= 4; pass += 1) for (const s of list) if (times(s) >= pass) out.push(s);
  return out;
}

const PREFIX = 'feed:v2';
const K_CURSOR = `${PREFIX}:source-cursor`;
const K_CACHE = `${PREFIX}:sources-cache`;

/** Normalize a raw source list to enabled, well-formed, de-duped entries. */
export function cleanSources(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const id = String(s?.id || '').trim();
    const url = String(s?.url || '').trim();
    if (!id || !/^https?:\/\//i.test(url) || s?.enabled === false || seen.has(id)) continue;
    seen.add(id);
    // sow-338: `weight` is kept, deliberately, where `enabled` is consumed as a filter and dropped. It is read on
    // every run (the rotation and the per-fetch cap), so it has to survive this normalization.
    out.push({ id, name: s?.name || id, url, description: s?.description || '', weight: clampWeight(s?.weight) });
  }
  return out;
}

/**
 * sow-372: the cached blob used to be a bare array of sources. It is now { sources, banwords }, and a deploy lands
 * while the old shape is still in KV, so both are read. An old cache simply carries no blocked words, which is the
 * behaviour that shape had, rather than a parse failure that would blank the pool.
 */
function readCache(raw) {
  let v; try { v = raw ? JSON.parse(raw) : null; } catch { return null; }
  if (Array.isArray(v)) return { sources: cleanSources(v), banwords: [] };
  if (v && Array.isArray(v.sources)) return { sources: cleanSources(v.sources), banwords: readBanwords({ words: v.banwords }) };
  return null;
}

/**
 * Resolve the live source pool. Prefers the published artifact (NEWS_SOURCES_URL), caches it to KV for fail-soft,
 * then falls back to the last cache, then the bundled config seed. Returns { sources, banwords, origin }.
 *
 * sow-372: `banwords` rides along rather than being fetched separately, because the free Workers plan counts every
 * fetch and KV operation against a 50-subrequest budget per ingest run. It is EMPTY on every fallback that cannot
 * see the artifact: a stale or bundled pool must not silently start blocking, or un-blocking, on its own.
 */
export async function loadSourceList(env, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = env?.NEWS_SOURCES_URL;
  if (url) {
    try {
      // SOW-056 FIX: the artifact fetch MUST be timed out (like fetchSource), or a slow/hung response blocks the
      // whole ingest forever (the cron never reaches the feed fetches -> zero new items). On abort/timeout this
      // throws and we fall through to the KV cache, then the bundled seed.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try { res = await fetchImpl(url, { signal: controller.signal, cf: { cacheTtl: 300, cacheEverything: true } }); }
      finally { clearTimeout(timer); }
      if (res && res.ok) {
        const data = await res.json();
        const list = cleanSources(data?.sources);
        const banwords = readBanwords({ words: data?.banwords });
        if (list.length) {
          try { await env.NEWS_KV.put(K_CACHE, JSON.stringify({ sources: list, banwords })); } catch { /* cache is best-effort */ }
          return { sources: list, banwords, origin: 'remote' };
        }
      }
    } catch { /* fall through to cache/bundled */ }
    try {
      const cached = readCache(await env.NEWS_KV.get(K_CACHE));
      if (cached && cached.sources.length) return { ...cached, origin: 'cache' };
    } catch { /* fall through to bundled */ }
  }
  return { sources: cleanSources(SOURCES), banwords: [], origin: 'bundled' };
}

/**
 * Pick the next chunk to poll, advancing a persisted cursor. Strictly sequential across runs; wraps at the end;
 * resets if the cursor is unset or out of range (list shrank). chunkSize<=0 or >= length => poll the whole pool.
 * `save:false` lets tests inspect the pick without mutating the cursor.
 */
export async function nextChunk(env, sources, chunkSize, { save = true } = {}) {
  const n = sources.length;
  if (!n) return [];
  if (!chunkSize || chunkSize <= 0 || chunkSize >= n) return sources;
  let cursor = 0;
  try { cursor = Number(await env.NEWS_KV.get(K_CURSOR)); } catch { cursor = 0; } // a KV read error must not abort ingest
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= n) cursor = 0; // unset or stale
  const picked = sources.slice(cursor, cursor + chunkSize);
  const next = cursor + chunkSize >= n ? 0 : cursor + chunkSize;
  if (save) { try { await env.NEWS_KV.put(K_CURSOR, String(next)); } catch { /* best-effort */ } }
  // sow-338: the list this walks can carry a weighted source more than once, so a chunk is deduped before it is
  // fetched. The passes put repeats a full pass apart, so this only ever fires on a pool smaller than a chunk.
  const seen = new Set();
  return picked.filter((s) => { const id = s?.id; if (!id || seen.has(id)) return false; seen.add(id); return true; });
}

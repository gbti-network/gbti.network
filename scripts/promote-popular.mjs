// SOW-126: the engagement-triggered auto-share PROMOTER (the `popular` engine). Run by the reconcile job on
// each --apply. For every PUBLISHED member content item whose matrix cell(s) are `popular` on some channel, it
// sums the DISTINCT-member engagement across the ENABLED signals and, once the threshold is met, ENQUEUES the
// item with `trigger:'popular'` so the drain delivers it to exactly its popular channels (SOW-125 seam). A KV
// watermark (`popular-promoted:<targetSlug>`) makes each item promote at most once, and the queue's own
// synd:dedupe backstops a double-enqueue.
//
// Signals (each admin-toggleable in content_engagement.signals):
//   opens     distinct members who opened the expanded reader view -> the content-opens:<type>:<slug> KV sets
//   favorites distinct favoriters -> house/favorite-counts.yml (post/product/prompt only; SOW-024 identity-free)
//   upvotes   distinct non-author upvoters of a share -> house/upvote-counts.yml (SOW-057)
//   comments  DEFERRED (a build-time distinct-commenter join; behind the config flag, not wired in this pass)
//
// Rule: an item is popular when the MAX distinct-member count across the enabled signals reaches the threshold
// (i.e. ANY enabled signal alone can trigger it). This avoids over-counting a member who did two actions, and
// matches "N members opened it" OR "N members favorited it". Fail-closed: disabled config, no enabled signal, no
// popular cell, or any error -> no promotion. Author self-engagement note: upvotes already exclude the author;
// opens/favorites may include the author's own action (a minor, bounded inflation on a small network).
//
// Requires (for --apply): CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN (KV read of opens + the watermark +
// the enqueue). A reported no-op without them (local dry-runs, tests).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseContentFile } from '../client/src/content-ops.mjs';
import { loadSyndicationConfig } from '../membership/syndication-config.mjs';
import { contentEngagement, popularChannelsForType } from '../membership/syndication-config-core.mjs';
import { buildSyndicationItem } from './lib/content-syndication.mjs';
import { toQueueInput } from './enqueue-syndication.mjs';
import { enqueueViaKvRest } from './lib/syndication-rest.mjs';
import { listKvByPrefix, putKvValue } from './lib/erase-member.mjs';
import { distinctOpenerCount, normalizeContentOpens } from '../membership/content-opens.mjs';
import { readCountsFromDisk as readFavoriteCountsFromDisk } from './lib/favorite-counts.mjs';
import { readCountsFromDisk as readUpvoteCountsFromDisk } from './lib/upvote-counts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POPULAR_PROMOTED_KEY = (targetSlug) => `popular-promoted:${targetSlug}`;

/** The DISTINCT-member engagement KEY for an item under each signal: `<type>:<bareSlug>` (bareSlug is the slug
 *  for content, the composite `<author>/<id>` for a share). This matches the content-opens KV key, the share
 *  upvote-counts key (`share:<author>/<id>`), and the favorite-counts key (`<type>:<slug>`). */
export function engagementKey(item) {
  const bare = item.type === 'share' ? `${item.author}/${item.slug}` : item.slug;
  return `${item.type}:${bare}`;
}

/**
 * PURE: given the published items + the per-signal count maps + the config + the already-promoted set, return
 * the items to promote now: those with a `popular` channel, a max enabled-signal count at/above the threshold,
 * and not yet promoted. Each result carries the engagement + the popular channels. No IO.
 */
export function selectPromotions({ items = [], opens = {}, favorites = {}, upvotes = {}, ce, cfg, promoted = new Set() } = {}) {
  const out = [];
  if (!ce?.enabled) return out;
  const threshold = Number.isFinite(Number(ce.threshold)) ? Math.max(1, Math.floor(Number(ce.threshold))) : 3;
  const useOpens = !!ce.signals?.opens;
  const useFav = !!ce.signals?.favorites;
  const useUp = !!ce.signals?.upvotes;
  for (const it of items) {
    if (!it || !it.targetSlug) continue;
    const channels = popularChannelsForType(cfg, it.type);
    if (!channels.length) continue; // no channel wants this type as `popular`
    if (promoted.has(it.targetSlug)) continue; // already promoted (the watermark)
    const key = engagementKey(it);
    let best = 0;
    if (useOpens) best = Math.max(best, Number(opens[key]) || 0);
    if (useFav) best = Math.max(best, Number(favorites[key]) || 0);
    if (useUp && it.type === 'share') best = Math.max(best, Number(upvotes[key]) || 0);
    if (best >= threshold) out.push({ item: it, engagement: best, channels });
  }
  return out;
}

/** List every published member content path (posts/products/prompts index.md + shares .md) under the repo. */
function listContentPaths(root) {
  const out = [];
  const membersDir = path.join(root, 'members');
  let members = [];
  try { members = fs.readdirSync(membersDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return out; }
  for (const u of members) {
    for (const sub of ['posts', 'products', 'prompts']) {
      const dir = path.join(membersDir, u, sub);
      let slugs = [];
      try { slugs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { slugs = []; }
      for (const s of slugs) {
        const rel = `members/${u}/${sub}/${s}/index.md`;
        if (fs.existsSync(path.join(root, rel))) out.push(rel);
      }
    }
    const sharesDir = path.join(membersDir, u, 'shares');
    let shares = [];
    try { shares = fs.readdirSync(sharesDir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(md|mdx)$/.test(e.name)).map((e) => e.name); } catch { shares = []; }
    for (const f of shares) out.push(`members/${u}/shares/${f}`);
  }
  return out;
}

/** Read the content-opens:* KV sets into a { `<type>:<slug>`: distinctOpeners } map. */
async function readOpenCounts({ env, fetchImpl }) {
  const listed = await listKvByPrefix({ prefix: 'content-opens:', env, fetchImpl });
  if (!listed.available) return { available: false, counts: {} };
  const counts = {};
  for (const { key, value } of listed.entries) {
    const suffix = key.slice('content-opens:'.length); // `<type>:<slug>`
    counts[suffix] = distinctOpenerCount(normalizeContentOpens(value));
  }
  return { available: true, counts };
}

export async function main({ argv = process.argv.slice(2), root = ROOT, env = process.env, fetchImpl = globalThis.fetch, deps = {} } = {}) {
  const apply = argv.includes('--apply');
  const cfg = deps.config ?? loadSyndicationConfig(root);
  const ce = contentEngagement(cfg);
  if (!ce.enabled) { console.log('promote-popular: content engagement auto-share is OFF (nothing to do).'); return { promoted: 0, reason: 'disabled' }; }

  const readFile = deps.readFile ?? ((rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } });

  // Build the published-item list with the count key + the queue targetSlug on each.
  const paths = deps.paths ?? listContentPaths(root);
  const items = [];
  for (const rel of paths) {
    const txt = readFile(rel);
    if (txt == null) continue;
    let fm; try { fm = parseContentFile(txt).frontmatter; } catch { continue; }
    const built = buildSyndicationItem(rel, fm);
    if (!built) continue;
    const input = toQueueInput({ item: built, fm, rel, mention: null, siteOrigin: env.SITE_ORIGIN || 'https://gbti.network' });
    items.push({ ...built, targetSlug: input.targetSlug, rel, fm, input });
  }

  // Gather the count sources for the enabled signals.
  const favorites = ce.signals.favorites ? (deps.favorites ?? readFavoriteCountsFromDisk(root)) : {};
  const upvotes = ce.signals.upvotes ? (deps.upvotes ?? readUpvoteCountsFromDisk(root)) : {};
  let opens = deps.opens ?? {};
  let kvAvailable = deps.opens !== undefined;
  if (ce.signals.opens && deps.opens === undefined) {
    const r = await readOpenCounts({ env, fetchImpl });
    opens = r.counts; kvAvailable = r.available;
  }

  // The watermark: which targetSlugs have already been promoted (KV, no TTL).
  const promoted = deps.promoted ?? new Set();
  if (deps.promoted === undefined) {
    const wm = await listKvByPrefix({ prefix: 'popular-promoted:', env, fetchImpl });
    if (wm.available) for (const { key } of wm.entries) promoted.add(key.slice('popular-promoted:'.length));
  }

  const selections = selectPromotions({ items, opens, favorites, upvotes, ce, cfg, promoted });
  console.log(`promote-popular: ${items.length} published item(s), ${selections.length} newly popular (threshold ${ce.threshold}, signals ${Object.entries(ce.signals).filter(([, v]) => v).map(([k]) => k).join('+') || 'none'})${apply ? '' : ' (dry-run)'}`);
  if (!selections.length) return { promoted: 0, items: items.length };
  if (!apply) {
    for (const s of selections) console.log(`  would promote ${s.item.targetSlug} (engagement ${s.engagement}) -> ${s.channels.join(', ')}`);
    return { promoted: 0, selections };
  }

  // Enqueue each promoted item with trigger:'popular'; record the watermark so it never re-promotes.
  const inputs = selections.map((s) => ({ ...s.item.input, trigger: 'popular' }));
  const r = await enqueueViaKvRest(inputs, { env, fetchImpl: deps.enqueueFetch ?? fetchImpl });
  if (!r.available) { console.error(`promote-popular: --apply needs CF creds (${r.reason})`); return { promoted: 0, reason: r.reason }; }
  let watermarked = 0;
  for (let i = 0; i < selections.length; i++) {
    // Watermark ONLY when the popular item is (or is already) in the queue. With the trigger-scoped dedupeKey a
    // 'duplicate' now means THIS popular promotion is already queued (never a collision with the publish item),
    // so both outcomes mean "promoted"; a refused/errored enqueue is retried next run. Store a JSON OBJECT so the
    // shared KV lister (listKvByPrefix keeps only object values) actually retains the watermark on read-back.
    if (r.results[i]?.enqueued || r.results[i]?.reason === 'duplicate') {
      try { await putKvValue({ key: POPULAR_PROMOTED_KEY(selections[i].item.targetSlug), value: JSON.stringify({ promotedAt: Date.now() }), env, fetchImpl }); watermarked++; } catch { /* retried next run */ }
    }
  }
  console.log(`promote-popular: enqueued ${r.enqueued}/${selections.length}, watermarked ${watermarked}`);
  return { promoted: r.enqueued, watermarked, selections };
}

// Direct-run entry (the reconcile imports main()).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((r) => process.exit(r?.reason === 'disabled' ? 0 : 0)).catch((e) => { console.error('promote-popular failed:', e?.message ?? e); process.exit(1); });
}

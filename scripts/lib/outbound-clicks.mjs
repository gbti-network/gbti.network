// sow-289 Phase 2: the daily click rollup for the outbound partner links, riding reconcile the way the favorite
// counts do (scripts/lib/favorite-counts.mjs). Cloudflare zone analytics see every 301 the redirects answer, but the
// zone caps a query at one day and keeps eight days of history, so history is accumulated HERE, in
// house/outbound-clicks.yml, one row per path per day, written through one auto-merged house PR.
//
// WHAT A NUMBER MEANS. The dataset is httpRequestsAdaptiveGroups, which is SAMPLED: every row is scaled by its
// sample interval, so every stored number is an estimate. `clicks` counts 301 answers only. Cloudflare's own Early
// Hints agents ("nginx-ssl early hints", "bastion early hints") hit these paths and answer 504; measured 2026-09-15
// they were nine of one day's twenty-two requests, and counting 301s alone removes them with no user-agent
// guessing. Everything that was not a 301 is kept as `other`, so a real fault would still show. `crawlers` is the
// SUBSET of clicks whose agent names a well-known crawler (owner decision 2026-09-15: split them out, do not drop
// them), so clicks stays the whole and a crawler this list does not know still counts as a click.
//
// A GAP IS NEVER A ZERO. `coverage` lists the dates that were queried; a covered date with no rows for a path is
// written as an explicit 0 (nobody clicked), and a date absent from coverage is "not measured". The board reads
// coverage, so a day the rollup missed can never render as a partner's bad day.
//
// THE PATHS COME FROM THE STORE, NEVER A PREFIX. Five of the ten paths sit outside /outbound/ (four of them
// Codeable), so a prefix filter would under-report the highest-volume partner and look correct doing it.
//
// Idempotent: a date's row is REPLACED, never added to, so a re-run backfills (the zone answers single-day windows
// up to seven days back) without double counting. A day whose query fails is left out, so it stays unmeasured.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const OUTBOUND_CLICKS_PATH = 'house/outbound-clicks.yml';
/** How many past days one run queries (the zone keeps eight). Today is never queried: it is not over. */
export const ROLLUP_DAYS = 7;
/** Rows older than this fall off the file, so it stays a document rather than an archive. */
export const KEEP_DAYS = 400;
export const DEFAULT_HOST = 'gbti.network';

/** Well-known crawler agents. A substring match, case-insensitive. Kept short: an unknown crawler is still a click. */
export const CRAWLER_PATTERNS = Object.freeze([
  'bingbot', 'googlebot', 'baiduspider', 'yandexbot', 'sogou', 'duckduckbot', 'applebot',
  'perplexitybot', 'claudebot', 'gptbot', 'chatgpt', 'amazonbot', 'oai-searchbot', 'bytespider', 'petalbot',
  'ahrefs', 'semrushbot', 'mj12bot', 'facebookexternalhit', // 'ahrefs' covers AhrefsBot AND AhrefsSiteAudit (seen live 2026-09-12)
]);

const HEADER = `# sow-289: daily click history for the outbound partner links in house/outbound-links.yml.
#
# WRITTEN BY RECONCILE (scripts/lib/outbound-clicks.mjs), one auto-merged PR per day; do not edit by hand. Each
# number is an ESTIMATE from Cloudflare zone analytics, which samples: clicks = 301 answers, crawlers = the subset
# of clicks whose agent names a well-known crawler, other = every answer that was not a 301 (Cloudflare's own Early
# Hints probes land here). A date in \`coverage\` was queried; a date absent from it was NOT measured and must never
# be read as zero. Request counts per path per day only: no personal data of any kind.
`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YAML key or value that should be a calendar date, as 'YYYY-MM-DD'; null when it is not one. */
export function dateKey(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim().slice(0, 10);
  return DATE_RE.test(s) ? s : null;
}

/** The UTC calendar date `n` days before `now`. */
export function dayBefore(now, n) {
  return new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);
}

export function isCrawler(userAgent, patterns = CRAWLER_PATTERNS) {
  const ua = String(userAgent ?? '').toLowerCase();
  return Boolean(ua) && patterns.some((p) => ua.includes(p));
}

/** An empty store. */
export function emptyClicks() {
  return { coverage: [], clicks: {} };
}

const cell = (c) => ({ clicks: Math.max(0, Math.round(Number(c?.clicks) || 0)), crawlers: Math.max(0, Math.round(Number(c?.crawlers) || 0)), other: Math.max(0, Math.round(Number(c?.other) || 0)) });

/** Coerce a parsed file to the canonical shape: sorted coverage of real dates, per-path rows keyed by date. */
export function normalizeClicks(parsed) {
  const out = emptyClicks();
  const coverage = new Set();
  for (const d of Array.isArray(parsed?.coverage) ? parsed.coverage : []) { const k = dateKey(d); if (k) coverage.add(k); }
  const clicks = parsed?.clicks && typeof parsed.clicks === 'object' ? parsed.clicks : {};
  for (const p of Object.keys(clicks).sort()) {
    if (!p.startsWith('/')) continue;
    const days = clicks[p] && typeof clicks[p] === 'object' ? clicks[p] : {};
    const row = {};
    for (const d of Object.keys(days)) { const k = dateKey(d); if (k) row[k] = cell(days[d]); }
    const keys = Object.keys(row).sort();
    if (keys.length) out.clicks[p] = Object.fromEntries(keys.map((k) => [k, row[k]]));
  }
  out.coverage = [...coverage].sort();
  return out;
}

/** A row's estimated request count: the sampled count scaled by its sample interval. */
export function estimateOf(row) {
  const count = Number(row?.count) || 0;
  const interval = Number(row?.avg?.sampleInterval) || 1;
  return count * interval;
}

/**
 * One day's rows, reduced to { <path>: { clicks, crawlers, other } } for EVERY path in `paths` (explicit zeros for a
 * path with no rows). Pure. A row for a path outside the list is ignored.
 */
export function summarizeDay(rows, paths, { patterns = CRAWLER_PATTERNS } = {}) {
  const out = {};
  for (const p of paths) out[p] = { clicks: 0, crawlers: 0, other: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const d = row?.dimensions || {};
    const p = String(d.clientRequestPath ?? '');
    if (!(p in out)) continue;
    const n = estimateOf(row);
    if (Number(d.edgeResponseStatus) === 301) {
      out[p].clicks += n;
      if (isCrawler(d.userAgent, patterns)) out[p].crawlers += n;
    } else {
      out[p].other += n;
    }
  }
  for (const p of paths) out[p] = cell(out[p]);
  return out;
}

/**
 * Merge one day's summary into the store: the date's row is REPLACED for every path in the summary, coverage gains
 * the date, and rows older than keepDays (measured from `now`) fall off. Returns a NEW store. Pure.
 */
export function mergeClicks(current, { date, byPath }, { now = new Date(), keepDays = KEEP_DAYS } = {}) {
  const k = dateKey(date);
  if (!k) throw new Error(`outbound-clicks: not a date: ${date}`);
  const next = normalizeClicks(current);
  for (const [p, c] of Object.entries(byPath || {})) {
    next.clicks[p] = { ...(next.clicks[p] || {}), [k]: cell(c) };
  }
  if (!next.coverage.includes(k)) next.coverage.push(k);
  const floor = dayBefore(now, keepDays);
  next.coverage = next.coverage.filter((d) => d >= floor).sort();
  for (const p of Object.keys(next.clicks)) {
    const kept = Object.keys(next.clicks[p]).filter((d) => d >= floor).sort();
    if (!kept.length) delete next.clicks[p];
    else next.clicks[p] = Object.fromEntries(kept.map((d) => [d, next.clicks[p][d]]));
  }
  return next;
}

export function clicksEqual(a, b) {
  return JSON.stringify(normalizeClicks(a)) === JSON.stringify(normalizeClicks(b));
}

/** Read the current store from disk. Fail-safe: a missing or malformed file reads as empty. */
export function readClicksFromDisk(root) {
  try { return normalizeClicks(yaml.load(fs.readFileSync(path.join(root, OUTBOUND_CLICKS_PATH), 'utf8'))); } catch { return emptyClicks(); }
}

/** The file body: the header comment plus the YAML. Date keys are quoted by js-yaml, so they read back as strings. */
export function renderClicksFile(store, now = new Date()) {
  const s = normalizeClicks(store);
  return HEADER + yaml.dump({ generatedAt: now.toISOString(), coverage: s.coverage, clicks: s.clicks }, { lineWidth: 120, noRefs: true, flowLevel: 3 });
}

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const QUERY = `query($zone: String!, $date: Date!, $paths: [String!]) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(limit: 2000, filter: { date: $date, clientRequestPath_in: $paths }) {
      count avg { sampleInterval } dimensions { clientRequestPath edgeResponseStatus userAgent } } } } }`;

/** The zone id for a host name, through the analytics token. Null when the token cannot see it. */
export async function resolveZone({ token, host = DEFAULT_HOST, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(host)}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => null);
  const id = json?.result?.[0]?.id;
  return typeof id === 'string' && id ? id : null;
}

/** One day's raw rows for the listed paths. Throws on a transport or GraphQL error (the caller records the date as failed). */
export async function queryOutboundDay({ token, zone, date, paths, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { zone, date, paths } }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`analytics request failed (${res.status})`);
  if (json?.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  const rows = json?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups;
  if (!Array.isArray(rows)) throw new Error('analytics answered without rows');
  return rows;
}

/**
 * Query the last ROLLUP_DAYS complete days for the store's paths, merge them, and when anything changed write
 * house/outbound-clicks.yml through ONE auto-merged PR (the favorite-counts write path). Returns a status object:
 *   { synced: false, reason }                      no token, no zone, nothing changed, or no GitHub client
 *   { synced: true, prNumber, dates, failedDates }  a PR was opened and merged
 * A day whose query fails is recorded in failedDates and left unmeasured; it never becomes a row of zeros.
 * Throws only on a real GitHub error. With no GitHub client the merged store is returned as `next` (a dry read).
 */
export async function syncOutboundClicks({
  env = process.env, fetchImpl = globalThis.fetch, github = null, base = 'main', now = new Date(),
  paths = [], readCurrent = () => emptyClicks(), days = ROLLUP_DAYS, host = env.OUTBOUND_HOST || DEFAULT_HOST,
  query = queryOutboundDay, zoneOf = resolveZone,
} = {}) {
  const token = env.CF_ANALYTICS_TOKEN;
  if (!token) return { synced: false, reason: 'CF_ANALYTICS_TOKEN not set' };
  if (!paths.length) return { synced: false, reason: 'no outbound paths to query' };
  const zone = env.CF_ZONE_ID || await zoneOf({ token, host, fetchImpl });
  if (!zone) return { synced: false, reason: `the analytics token cannot see the zone for ${host}` };

  const current = normalizeClicks(await readCurrent());
  let next = current;
  const dates = [];
  const failedDates = [];
  for (let n = days; n >= 1; n -= 1) {
    const date = dayBefore(now, n);
    let rows;
    try { rows = await query({ token, zone, date, paths, fetchImpl }); } catch (err) { failedDates.push({ date, reason: err?.message || String(err) }); continue; }
    next = mergeClicks(next, { date, byPath: summarizeDay(rows, paths) }, { now });
    dates.push(date);
  }
  if (clicksEqual(current, next)) return { synced: false, reason: 'clicks unchanged', dates, failedDates, next };
  if (!github) return { synced: false, reason: 'no github client to write the clicks PR', changed: true, dates, failedDates, next };

  const branch = `gbti/outbound-clicks-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`outbound-clicks sync: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);
  const existing = await github.getContent(OUTBOUND_CLICKS_PATH, branch);
  await github.putContent(OUTBOUND_CLICKS_PATH, {
    message: 'reconcile: roll up outbound link clicks (sow-289)',
    content: Buffer.from(renderClicksFile(next, now), 'utf8').toString('base64'),
    branch,
    sha: existing?.sha,
  });
  const pull = await github.createPull({
    title: 'reconcile: roll up outbound link clicks',
    head: branch,
    base,
    body: 'Automated daily rollup of estimated clicks per outbound partner path from Cloudflare zone analytics (sow-289). Request counts per path per day only; no personal data.',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, dates, failedDates };
}

// SOW-024: sync the MEMBER-IDENTITY-FREE favorite counts (house/favorite-counts.yml) from the deletable edge
// store (Cloudflare KV) into git, so the static build can show aggregate favorite counts WITHOUT committing any
// who-favorited-what data. The favorites themselves live in KV (key activity:<github_id>), erasable; only the
// per-target totals reach the public repo.
//
// Mirrors scripts/lib/kv-mirror.mjs: reads via the Cloudflare KV REST API, gated behind
// CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN. If those are not set (local dry-runs, tests) it is a
// reported no-op, not a throw. The pure aggregator + the KV reader take an injected fetch, so both are
// unit-tested with fakes (no network, no secrets). The reconcile calls syncFavoriteCounts on each --apply run.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const FAVORITE_COUNTS_PATH = 'house/favorite-counts.yml';

const FAVORITE_TYPES = new Set(['post', 'product', 'prompt']);
const SLUG_RE = /^[a-z0-9-]+$/;

const HEADER = `# SOW-024: aggregate favorite counts, member-identity-free.
#
# The favorites THEMSELVES (who favorited what) live in the deletable edge store (Cloudflare KV), keyed by
# github_id, so a member's right to erasure is a hard delete and no behavioral personal data is ever committed
# to the immutable public repo. The git-native SOW-013 favorites.yml is RETIRED.
#
# This file is the ONLY favorites artifact in git: a flat map of "<targetType>:<slug>" -> count, with NO member
# identity (no who-favorited-what). It is safe to publish, and erasing a member (a KV delete) is reflected here
# on the next sync without rewriting history.
#
# Auto-generated: written by \`npm run reconcile --apply\` from the edge store. Hand edits are overwritten. The
# static build reads it via src/lib/favorites.ts; counts refresh on the next reconcile + batched build (the
# same two-tier freshness model as comments). Empty pre-launch.
`;

/**
 * Pure: fold an array of per-member activity objects ({ favorites: [{ type, slug }] }) into a member-identity-
 * free count map { "<type>:<slug>": N }. A member counts AT MOST ONCE per target (defensive dedupe; the KV
 * store already dedupes). Malformed entries (bad type/slug) are skipped. Keys are sorted for a stable, diff-
 * friendly file. NO github_id, addedAt, or any per-member field is carried through.
 */
export function aggregateFavoriteCounts(activities) {
  const m = new Map();
  for (const a of Array.isArray(activities) ? activities : []) {
    const list = Array.isArray(a?.favorites) ? a.favorites : [];
    const seen = new Set();
    for (const f of list) {
      if (!f || !FAVORITE_TYPES.has(f.type) || typeof f.slug !== 'string' || !SLUG_RE.test(f.slug)) continue;
      const k = `${f.type}:${f.slug}`;
      if (seen.has(k)) continue; // a member counts at most once per target
      seen.add(k);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  const out = {};
  for (const k of [...m.keys()].sort()) out[k] = m.get(k);
  return out;
}

/** Normalize a parsed counts map to the canonical shape (positive integers only) for a stable comparison. */
function normalizeCounts(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of Object.keys(raw).sort()) {
      const v = Math.floor(Number(raw[k]));
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
  }
  return out;
}

/** Are two count maps equal (after normalization)? */
export function countsEqual(a, b) {
  return JSON.stringify(normalizeCounts(a)) === JSON.stringify(normalizeCounts(b));
}

/** Read the current counts ({ "<type>:<slug>": N }) from house/favorite-counts.yml on disk. Fail-safe -> {}. */
export function readCountsFromDisk(root) {
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(root, FAVORITE_COUNTS_PATH), 'utf8'));
    return normalizeCounts(parsed?.counts);
  } catch {
    return {};
  }
}

/** Render the file body (header comment + YAML). counts must already be the canonical sorted map. */
export function renderCountsFile(counts, now = new Date()) {
  const body = yaml.dump({ generatedAt: now.toISOString(), counts }, { lineWidth: 100, noRefs: true });
  return HEADER + body;
}

/**
 * Read ALL per-member activity from the Cloudflare KV namespace via the REST API (list activity:* keys,
 * paginate, then get each value). Gated on CF creds. Returns { available, reason, activities }. Throws only on
 * a real API error (so the reconcile can fail the run); missing creds is a reported no-op.
 */
export async function listAllActivityFromKv({ env = process.env, fetchImpl = globalThis.fetch, prefix = 'activity:' } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { available: false, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set', activities: [] };
  }
  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };

  // 1. List all keys with the activity: prefix (cursor-paginated; a non-empty cursor means another page).
  const keys = [];
  let cursor = '';
  for (let page = 0; page < 100000; page++) {
    const url = `${apiBase}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(url, { headers });
    if (!res || !res.ok) {
      const detail = res && res.text ? await res.text().catch(() => '') : '';
      throw new Error(`KV key list failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
    }
    const json = await res.json();
    for (const k of json?.result ?? []) if (k?.name) keys.push(k.name);
    cursor = json?.result_info?.cursor || '';
    if (!cursor) break;
  }

  // 2. Read each value. A key that vanished mid-list or holds non-JSON is skipped (never crash a sync).
  const activities = [];
  for (const key of keys) {
    const res = await fetchImpl(`${apiBase}/values/${encodeURIComponent(key)}`, { headers });
    if (!res || !res.ok) continue;
    let val = null;
    try { val = await res.json(); } catch { val = null; }
    if (val && typeof val === 'object') activities.push(val);
  }
  return { available: true, count: keys.length, activities };
}

/**
 * Sync the favorite counts from KV into house/favorite-counts.yml via an auto-merged PR. Idempotent: when the
 * computed counts equal the current file, it is a no-op (no churn PR). Returns a status object; throws only on a
 * real KV/GitHub error.
 *   - { synced: false, reason } when KV is unavailable, counts are unchanged, or no github client is present.
 *   - { synced: true, prNumber, total } when a PR was opened + merged.
 */
export async function syncFavoriteCounts({
  env = process.env,
  fetchImpl = globalThis.fetch,
  github = null,
  base = 'main',
  now = new Date(),
  listActivities = listAllActivityFromKv,
  readCurrentCounts = () => ({}),
} = {}) {
  const kv = await listActivities({ env, fetchImpl });
  if (!kv.available) return { synced: false, reason: kv.reason };

  const counts = aggregateFavoriteCounts(kv.activities);
  const total = Object.keys(counts).length;
  const current = await readCurrentCounts();
  if (countsEqual(current, counts)) return { synced: false, reason: 'counts unchanged', total };
  if (!github) return { synced: false, reason: 'no github client to write the counts PR', changed: true, total };

  // Write via an auto-merged PR (house/** is admin-owned; the reconcile bot is admin, so it auto-merges). A
  // timestamped branch avoids collisions with a lingering prior head.
  const branch = `gbti/favorite-counts-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`favorite-counts sync: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);

  const existing = await github.getContent(FAVORITE_COUNTS_PATH, branch);
  const content = renderCountsFile(counts, now);
  await github.putContent(FAVORITE_COUNTS_PATH, {
    message: 'reconcile: sync favorite counts (SOW-024)',
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    sha: existing?.sha,
  });
  const pull = await github.createPull({
    title: 'reconcile: sync favorite counts',
    head: branch,
    base,
    body:
      'Automated SOW-024 sync of the member-identity-free favorite counts from the deletable edge store (KV). ' +
      'No member identity is committed: only per-target totals.',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, total };
}

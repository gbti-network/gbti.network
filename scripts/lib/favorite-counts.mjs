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
export const FAVORITED_BY_PATH = 'house/favorited-by.yml'; // SOW-114: the OPT-IN public favoriter lists

const FAVORITE_TYPES = new Set(['post', 'product', 'prompt']);
const SLUG_RE = /^[a-z0-9-]+$/;
const USERNAME_RE = /^[a-z0-9-]+$/i;

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

const FAVORITED_BY_HEADER = `# SOW-114: the public "Favorited by" lists, OPT-IN ONLY.
#
# A member appears here ONLY while their publicFavorites preference (prefs:<github_id> in the deletable edge
# store) is true; the default is false, so absence is the norm. Opting out, or erasing the member's KV data
# (SOW-024), drops them from this file on the next sync. The anonymous per-target totals live separately in
# favorite-counts.yml and include everyone.
#
# Auto-generated: written by \`npm run reconcile --apply\` from the edge store. Hand edits are overwritten. The
# static build reads it via src/lib/favorites.ts (the "Favorited by" block in the content aside).
`;

/**
 * Pure (SOW-114): fold per-member activity ENTRIES ([{ githubId, activity }]) into the opt-in public
 * favoriter map { "<type>:<slug>": [username, ...] }. A member is included ONLY when their githubId is in
 * optedIn (the publicFavorites === true set) AND resolves to a username via membersIndex
 * (github_id -> username); everyone else contributes nothing here (they still count in the anonymous
 * totals). Usernames are deduped + sorted per target; keys sorted; malformed favorites skipped.
 */
export function aggregateFavoritedBy(entries, { optedIn, membersIndex } = {}) {
  const opted = optedIn instanceof Set ? optedIn : new Set(optedIn || []);
  const index = membersIndex && typeof membersIndex === 'object' ? membersIndex : {};
  const m = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const id = String(e?.githubId ?? '');
    if (!id || !opted.has(id)) continue;
    const username = index[id];
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) continue;
    const list = Array.isArray(e?.activity?.favorites) ? e.activity.favorites : [];
    for (const f of list) {
      if (!f || !FAVORITE_TYPES.has(f.type) || typeof f.slug !== 'string' || !SLUG_RE.test(f.slug)) continue;
      const k = `${f.type}:${f.slug}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(username);
    }
  }
  const out = {};
  for (const k of [...m.keys()].sort()) out[k] = [...m.get(k)].sort();
  return out;
}

/** Normalize a parsed favorited-by map ({ key: [usernames] }) for a stable comparison / render. */
function normalizeFavoritedBy(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of Object.keys(raw).sort()) {
      const v = Array.isArray(raw[k]) ? [...new Set(raw[k].filter((u) => typeof u === 'string' && USERNAME_RE.test(u)))].sort() : [];
      if (v.length) out[k] = v;
    }
  }
  return out;
}

/** Are two favorited-by maps equal (after normalization)? */
export function favoritedByEqual(a, b) {
  return JSON.stringify(normalizeFavoritedBy(a)) === JSON.stringify(normalizeFavoritedBy(b));
}

/** Read the current favorited-by map from house/favorited-by.yml on disk. Fail-safe -> {}. */
export function readFavoritedByFromDisk(root) {
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(root, FAVORITED_BY_PATH), 'utf8'));
    return normalizeFavoritedBy(parsed?.favoritedBy);
  } catch {
    return {};
  }
}

/** Render the favorited-by file body (header comment + YAML). */
export function renderFavoritedByFile(favoritedBy, now = new Date()) {
  const body = yaml.dump({ generatedAt: now.toISOString(), favoritedBy }, { lineWidth: 100, noRefs: true });
  return FAVORITED_BY_HEADER + body;
}

/** Load house/members-index.yml (the reconcile-maintained github_id -> username map) from the working clone.
 *  Tolerates the flat shape or a `members:` wrapper. Fail-safe -> {}. */
export function readMembersIndexFromDisk(root) {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, 'house/members-index.yml'), 'utf8')) ?? {};
    const map = doc && typeof doc === 'object' && doc.members && typeof doc.members === 'object' ? doc.members : doc;
    const out = {};
    for (const [k, v] of Object.entries(map || {})) if (v && typeof v === 'string') out[String(k)] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * SOW-114: read the publicFavorites opt-in flags for a set of github_ids from KV (prefs:<github_id>).
 * Returns a Set of the ids whose stored prefs carry publicFavorites === true. Fail-CLOSED per key: a missing
 * key, a fetch error, or non-JSON all read as NOT opted in (a member is never published by accident).
 */
export async function readPublicFavoritesOptIns({ env = process.env, fetchImpl = globalThis.fetch, ids = [] } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  const opted = new Set();
  if (!accountId || !namespaceId || !apiToken) return opted;
  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };
  for (const id of ids) {
    try {
      const res = await fetchImpl(`${apiBase}/values/${encodeURIComponent(`prefs:${id}`)}`, { headers });
      if (!res || !res.ok) continue;
      const val = await res.json().catch(() => null);
      if (val && typeof val === 'object' && val.publicFavorites === true) opted.add(String(id));
    } catch { /* fail closed: not opted in */ }
  }
  return opted;
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
  // SOW-114: `entries` additionally carries each value's github_id (from the key suffix) so the opt-in
  // favorited-by aggregation can resolve members; `activities` stays for the identity-free consumers.
  const activities = [];
  const entries = [];
  for (const key of keys) {
    const res = await fetchImpl(`${apiBase}/values/${encodeURIComponent(key)}`, { headers });
    if (!res || !res.ok) continue;
    let val = null;
    try { val = await res.json(); } catch { val = null; }
    if (val && typeof val === 'object') {
      activities.push(val);
      entries.push({ githubId: key.slice(prefix.length), activity: val });
    }
  }
  return { available: true, count: keys.length, activities, entries };
}

/**
 * Sync the favorite counts (house/favorite-counts.yml) AND the opt-in favorited-by lists
 * (house/favorited-by.yml, SOW-114) from KV via ONE auto-merged PR. Idempotent: when both computed maps
 * equal the current files, it is a no-op (no churn PR). Returns a status object; throws only on a real
 * KV/GitHub error.
 *   - { synced: false, reason } when KV is unavailable, nothing changed, or no github client is present.
 *   - { synced: true, prNumber, total, publicTargets } when a PR was opened + merged.
 */
export async function syncFavoriteCounts({
  env = process.env,
  fetchImpl = globalThis.fetch,
  github = null,
  base = 'main',
  now = new Date(),
  listActivities = listAllActivityFromKv,
  readCurrentCounts = () => ({}),
  readCurrentFavoritedBy = () => ({}),
  readMembersIndex = () => ({}),
  readOptIns = readPublicFavoritesOptIns,
} = {}) {
  const kv = await listActivities({ env, fetchImpl });
  if (!kv.available) return { synced: false, reason: kv.reason };

  const counts = aggregateFavoriteCounts(kv.activities);
  const total = Object.keys(counts).length;

  // SOW-114: the opt-in public lists. Prefs are read ONLY for members that actually have favorites; a
  // missing/failed prefs read is NOT opted in (fail closed on the privacy side).
  const entries = Array.isArray(kv.entries) ? kv.entries : [];
  const candidates = entries.filter((e) => Array.isArray(e?.activity?.favorites) && e.activity.favorites.length).map((e) => String(e.githubId));
  const optedIn = candidates.length ? await readOptIns({ env, fetchImpl, ids: candidates }) : new Set();
  const membersIndex = await readMembersIndex();
  const favoritedBy = aggregateFavoritedBy(entries, { optedIn, membersIndex });
  const publicTargets = Object.keys(favoritedBy).length;

  const currentCounts = await readCurrentCounts();
  const currentFavBy = await readCurrentFavoritedBy();
  const countsChanged = !countsEqual(currentCounts, counts);
  const favByChanged = !favoritedByEqual(currentFavBy, favoritedBy);
  if (!countsChanged && !favByChanged) return { synced: false, reason: 'counts unchanged', total, publicTargets };
  if (!github) return { synced: false, reason: 'no github client to write the counts PR', changed: true, total, publicTargets };

  // Write via an auto-merged PR (house/** is admin-owned; the reconcile bot is admin, so it auto-merges). A
  // timestamped branch avoids collisions with a lingering prior head. Both files ride the one branch/PR.
  const branch = `gbti/favorite-counts-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`favorite-counts sync: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);

  if (countsChanged) {
    const existing = await github.getContent(FAVORITE_COUNTS_PATH, branch);
    await github.putContent(FAVORITE_COUNTS_PATH, {
      message: 'reconcile: sync favorite counts (SOW-024)',
      content: Buffer.from(renderCountsFile(counts, now), 'utf8').toString('base64'),
      branch,
      sha: existing?.sha,
    });
  }
  if (favByChanged) {
    const existing = await github.getContent(FAVORITED_BY_PATH, branch);
    await github.putContent(FAVORITED_BY_PATH, {
      message: 'reconcile: sync opt-in favorited-by lists (SOW-114)',
      content: Buffer.from(renderFavoritedByFile(favoritedBy, now), 'utf8').toString('base64'),
      branch,
      sha: existing?.sha,
    });
  }
  const pull = await github.createPull({
    title: 'reconcile: sync favorite counts',
    head: branch,
    base,
    body:
      'Automated sync from the deletable edge store (KV). favorite-counts.yml (SOW-024) carries only ' +
      'member-identity-free per-target totals; favorited-by.yml (SOW-114) lists ONLY members whose ' +
      'publicFavorites preference is on (opt-in consent; opting out or erasure drops them on the next sync).',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, total, publicTargets };
}

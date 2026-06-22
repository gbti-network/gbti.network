// SOW-057: sync the MEMBER-IDENTITY-FREE share upvote counts (house/upvote-counts.yml) from the deletable edge
// store (Cloudflare KV) into git, so a view can show aggregate upvote totals WITHOUT committing any
// who-upvoted-what data. Mirrors scripts/lib/favorite-counts.mjs (SOW-024); reuses its KV REST reader.
//
// NOTE: this folds only the per-MEMBER `upvotes` arrays from `activity:<github_id>`. The per-TARGET voter SETS
// (`upvotes:share:<author>/<id>`), which drive the syndication threshold, are NEVER aggregated here, so this
// file is member-identity-free by construction. v1 counts share upvotes only.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { listAllActivityFromKv } from './favorite-counts.mjs';

export const UPVOTE_COUNTS_PATH = 'house/upvote-counts.yml';

const UPVOTE_TYPES = new Set(['share']);
// A share slug is the composite "<author>/<id>"; other types stay single-segment.
const SLUG_RE = /^[a-z0-9-]+$/;
const SHARE_SLUG_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const slugOk = (type, slug) => (type === 'share' ? SHARE_SLUG_RE : SLUG_RE).test(slug);

const HEADER = `# SOW-057: aggregate share upvote counts, member-identity-free.
#
# The upvotes THEMSELVES (who upvoted what) live in the deletable edge store (Cloudflare KV), keyed by github_id
# (the per-member activity: record), so a member's right to erasure is a hard delete and no behavioral personal
# data is committed to the immutable public repo.
#
# This file is a flat map of "share:<author>/<id>" -> count, with NO member identity. The per-target voter sets
# that drive the SOW-058 syndication threshold are a separate KV structure and are never written here.
#
# Auto-generated: written by \`npm run reconcile --apply\` from the edge store. Hand edits are overwritten.
# Empty pre-launch.
`;

/**
 * Pure: fold an array of per-member activity objects ({ upvotes: [{ type, slug }] }) into a member-identity-free
 * count map { "<type>:<slug>": N }. A member counts AT MOST ONCE per target. Malformed entries and non-share
 * types are skipped. Keys are sorted for a stable, diff-friendly file.
 */
export function aggregateUpvoteCounts(activities) {
  const m = new Map();
  for (const a of Array.isArray(activities) ? activities : []) {
    const list = Array.isArray(a?.upvotes) ? a.upvotes : [];
    const seen = new Set();
    for (const u of list) {
      if (!u || !UPVOTE_TYPES.has(u.type) || typeof u.slug !== 'string' || !slugOk(u.type, u.slug)) continue;
      const k = `${u.type}:${u.slug}`;
      if (seen.has(k)) continue;
      seen.add(k);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  const out = {};
  for (const k of [...m.keys()].sort()) out[k] = m.get(k);
  return out;
}

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

export function countsEqual(a, b) {
  return JSON.stringify(normalizeCounts(a)) === JSON.stringify(normalizeCounts(b));
}

export function readCountsFromDisk(root) {
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(root, UPVOTE_COUNTS_PATH), 'utf8'));
    return normalizeCounts(parsed?.counts);
  } catch {
    return {};
  }
}

export function renderCountsFile(counts, now = new Date()) {
  const body = yaml.dump({ generatedAt: now.toISOString(), counts }, { lineWidth: 100, noRefs: true });
  return HEADER + body;
}

/**
 * Sync the upvote counts from KV into house/upvote-counts.yml via an auto-merged PR. Idempotent: a no-op when the
 * computed counts equal the current file. Mirrors syncFavoriteCounts.
 */
export async function syncUpvoteCounts({
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

  const counts = aggregateUpvoteCounts(kv.activities);
  const total = Object.keys(counts).length;
  const current = await readCurrentCounts();
  if (countsEqual(current, counts)) return { synced: false, reason: 'counts unchanged', total };
  if (!github) return { synced: false, reason: 'no github client to write the counts PR', changed: true, total };

  const branch = `gbti/upvote-counts-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`upvote-counts sync: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);

  const existing = await github.getContent(UPVOTE_COUNTS_PATH, branch);
  const content = renderCountsFile(counts, now);
  await github.putContent(UPVOTE_COUNTS_PATH, {
    message: 'reconcile: sync share upvote counts (SOW-057)',
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    sha: existing?.sha,
  });
  const pull = await github.createPull({
    title: 'reconcile: sync share upvote counts',
    head: branch,
    base,
    body:
      'Automated SOW-057 sync of the member-identity-free share upvote counts from the deletable edge store (KV). ' +
      'No member identity is committed: only per-target totals.',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, total };
}

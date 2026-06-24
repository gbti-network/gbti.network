// SOW-057 P4 (forward-compatible): build-time upvote-count read. UNUSED today — Shares are extension-only, so no
// public page renders an upvote count yet; this ships so a future public Share page can read counts the same way
// favorites.ts does. The upvotes THEMSELVES (who upvoted what) live in the deletable edge store (Cloudflare KV)
// keyed by github_id, so erasure is a hard delete and no behavioral personal data reaches the immutable repo. The
// ONLY git artifact is house/upvote-counts.yml, a MEMBER-IDENTITY-FREE aggregate ({ counts: { "share:<author>/<id>":
// N } }) synced KV -> git by reconcile (SOW-057 P6). Fail-safe: any missing/parse error yields 0, never a crash.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

let counts: Map<string, number> | null = null;

function load(): Map<string, number> {
  if (counts) return counts;
  const m = new Map<string, number>();
  const file = path.resolve(process.cwd(), 'house', 'upvote-counts.yml');
  try {
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { counts?: Record<string, unknown> } | null;
    const c = parsed?.counts;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      for (const [key, n] of Object.entries(c)) {
        const v = Math.floor(Number(n));
        if (Number.isFinite(v) && v > 0) m.set(key, v); // ignore 0/negative/NaN defensively
      }
    }
  } catch { /* no file or bad YAML: leave empty */ }
  counts = m;
  return m;
}

/** How many distinct members have upvoted this share. 0 when none (or pre-launch). `targetSlug` is "<author>/<id>".
 *  Reads house/upvote-counts.yml, the member-identity-free aggregate synced from the deletable edge store (SOW-057 P6). */
export function upvoteCount(targetSlug: string): number {
  return load().get(`share:${targetSlug}`) ?? 0;
}

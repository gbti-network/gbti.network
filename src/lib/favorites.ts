// SOW-024: build-time favorite-count read. The favorites THEMSELVES (who favorited what) live in the deletable
// edge store (Cloudflare KV), keyed by github_id, so a member's right to erasure is a hard delete and no
// behavioral personal data is ever committed to the immutable public repo. SOW-013's git-native favorites.yml
// is RETIRED. The ONLY favorites artifact in git is house/favorite-counts.yml, a MEMBER-IDENTITY-FREE aggregate
// ({ counts: { "<type>:<slug>": N } }) synced KV -> git by reconcile. We read it once at build, the same way
// house/taxonomy.yml and the referral config are read. Fail-safe: any missing/parse error yields 0, never a
// build crash (and pre-launch the file is empty, so every count is 0).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

let counts: Map<string, number> | null = null;

function load(): Map<string, number> {
  if (counts) return counts;
  const m = new Map<string, number>();
  const file = path.resolve(process.cwd(), 'house', 'favorite-counts.yml');
  try {
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { counts?: Record<string, unknown> } | null;
    const c = parsed?.counts;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      for (const [key, n] of Object.entries(c)) {
        const v = Math.floor(Number(n));
        if (Number.isFinite(v) && v > 0) m.set(key, v); // ignore 0/negative/NaN entries defensively
      }
    }
  } catch { /* no file or bad YAML: leave empty */ }
  counts = m;
  return m;
}

/** How many members have favorited this target. 0 when none (or pre-launch). Reads house/favorite-counts.yml,
 *  the member-identity-free aggregate synced from the deletable edge store by reconcile (SOW-024).
 *  SOW-112: `aliases` are the item's pre-rename slugs; their counts sum in (members favorited the old slug). */
export function favoriteCount(targetType: string, targetSlug: string, aliases: string[] = []): number {
  const m = load();
  return [targetSlug, ...aliases].reduce((n, s) => n + (m.get(`${targetType}:${s}`) ?? 0), 0);
}

// SOW-114: the OPT-IN public favoriter lists (house/favorited-by.yml). A member appears only while their
// publicFavorites preference is true (default false); opting out or a KV erasure drops them on the next
// reconcile sync. Same fail-safe read model as the counts.
let favBy: Map<string, string[]> | null = null;

function loadFavoritedBy(): Map<string, string[]> {
  if (favBy) return favBy;
  const m = new Map<string, string[]>();
  const file = path.resolve(process.cwd(), 'house', 'favorited-by.yml');
  try {
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { favoritedBy?: Record<string, unknown> } | null;
    const f = parsed?.favoritedBy;
    if (f && typeof f === 'object' && !Array.isArray(f)) {
      for (const [key, v] of Object.entries(f)) {
        const list = Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && /^[a-z0-9-]+$/i.test(u)) : [];
        if (list.length) m.set(key, list);
      }
    }
  } catch { /* no file or bad YAML: leave empty */ }
  favBy = m;
  return m;
}

/** The usernames of members who OPTED IN to appear on this target's "Favorited by" list (deduped, sorted).
 *  Empty when nobody opted in (the common case: the preference defaults off). SOW-112: alias slugs union in. */
export function favoritedBy(targetType: string, targetSlug: string, aliases: string[] = []): string[] {
  const m = loadFavoritedBy();
  const seen = new Set<string>();
  for (const s of [targetSlug, ...aliases]) for (const u of m.get(`${targetType}:${s}`) ?? []) seen.add(u);
  return [...seen].sort();
}

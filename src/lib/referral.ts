import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// Referral attribution for content (SOW-007). A published post or product renders a join CTA carrying
// its author's referral code, and sets a first-touch cookie when a visitor lands on the page, so a
// reader who converts later still credits that author. The referral code is the author's IMMUTABLE
// github_id (the same key the signup Worker stores as Stripe `referred_by`), resolved at build time
// from house/members-index.yml. Using github_id (not the username) means a later GitHub rename never
// breaks attribution, and the Worker's identity resolver stores the code verbatim.

/** First-touch cookie names. The Worker / membership page read these to seed ?ref at signup. */
export const REF_COOKIE = 'gbti_ref';
export const REF_VIA_COOKIE = 'gbti_ref_via';

/** Days the first-touch referral cookie persists (matches the conversion window we care about). */
export const REF_COOKIE_DAYS = 90;

let cachedByUsername: Map<string, string> | null = null;

/** username (lowercase) -> referrer github_id, inverted from house/members-index.yml. Built once. */
function usernameToGithubId(): Map<string, string> {
  if (cachedByUsername) return cachedByUsername;
  const map = new Map<string, string>();
  try {
    const file = path.join(process.cwd(), 'house', 'members-index.yml');
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { members?: Record<string, string> };
    for (const [githubId, username] of Object.entries(parsed?.members ?? {})) {
      if (githubId && username) map.set(String(username).toLowerCase(), String(githubId));
    }
  } catch {
    // No index yet (pre-M0): no codes resolve, so the CTA omits ?ref. Fail safe (no wrong attribution).
  }
  cachedByUsername = map;
  return map;
}

/**
 * The referral code for a content author = their immutable github_id. Returns undefined for the house
 * account ('gbti'/'house') and for any author not yet in the members index, so the CTA omits ?ref
 * rather than attributing a conversion to the wrong person (or to no real member).
 */
export function refCodeForAuthor(username?: string): string | undefined {
  if (!username) return undefined;
  const u = username.toLowerCase();
  if (u === 'gbti' || u === 'house') return undefined;
  return usernameToGithubId().get(u);
}

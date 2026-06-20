// SOW-029: pure builder for /members-index.json, the minimized member directory the extension welcome view
// (<gbti-welcome>) fetches for its randomized "follow members" list, AND (SOW-050) the in-extension reader's
// right-hand author drawer (avatar, name, headline, Follow, social links incl. Discord). Still NO github_id,
// email, or location. We DO now carry the profile's public `links` (github, website, x, discord, etc.): the
// member directory + each profile page already render these on the public site, so this surface adds no new
// exposure, and the reader's "show this author's Discord on inspection" need is exactly that public data. Plain
// .mjs so the Astro endpoint maps the collection into it and `node --test` imports the pure builder directly.

// The public social link keys we surface (the profile schema's links subset). Discord is included by design so the
// reader can reveal the author's Discord handle on inspection.
const LINK_KEYS = ['github', 'website', 'x', 'bluesky', 'youtube', 'devto', 'reddit', 'mastodon', 'linkedin', 'discord'];

/** Parse a lowercase github login from a profile links.github value (a URL or a bare handle), else undefined. */
function githubLoginFromLinks(github) {
  if (!github) return undefined;
  const m = String(github).match(/github\.com\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  const h = String(github).trim().replace(/^@/, '');
  return /^[a-z0-9-]+$/i.test(h) ? h.toLowerCase() : undefined;
}

/** Keep only the known, non-empty public link keys (drops unknown keys + blanks). Returns undefined when none. */
function publicLinks(links) {
  if (!links || typeof links !== 'object') return undefined;
  const out = {};
  for (const k of LINK_KEYS) {
    const v = links[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * @param {{ data: { username:string, displayName?:string, avatar?:string, headline?:string, tier?:string, links?:Record<string,string> } }[]} profiles
 *   ALREADY filtered to public + directory profiles by the caller.
 * @param {(login?:string)=>(string|undefined)} [avatarFallback]  github avatar by login, for profiles without a gravatar.
 * @returns {{ username:string, displayName:string, avatar:string|null, headline:string|null, tier:string, links?:Record<string,string> }[]}
 */
export function buildMembersDirectory(profiles, avatarFallback = () => undefined) {
  return (profiles || []).map((p) => {
    const d = p.data || {};
    const login = githubLoginFromLinks(d.links?.github) || d.username;
    const links = publicLinks(d.links);
    return {
      username: d.username,
      displayName: d.displayName || d.username,
      avatar: d.avatar || avatarFallback(login) || null,
      headline: d.headline || null,
      tier: d.tier || 'trial',
      ...(links ? { links } : {}),
    };
  });
}

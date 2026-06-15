// SOW-029: pure builder for /members-index.json, the minimized member directory the extension welcome view
// (<gbti-welcome>) fetches for its randomized "follow members" list. DATA-MINIMIZED: only the fields a follow
// card needs (username, displayName, avatar, headline, tier). NO github_id, email, location, or links — the
// member directory is already public on the site, so this surface adds no new exposure. Plain .mjs so the
// Astro endpoint maps the collection into it and `node --test` imports the pure builder directly.

/** Parse a lowercase github login from a profile links.github value (a URL or a bare handle), else undefined. */
function githubLoginFromLinks(github) {
  if (!github) return undefined;
  const m = String(github).match(/github\.com\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  const h = String(github).trim().replace(/^@/, '');
  return /^[a-z0-9-]+$/i.test(h) ? h.toLowerCase() : undefined;
}

/**
 * @param {{ data: { username:string, displayName?:string, avatar?:string, headline?:string, tier?:string, links?:{github?:string} } }[]} profiles
 *   ALREADY filtered to public + directory profiles by the caller.
 * @param {(login?:string)=>(string|undefined)} [avatarFallback]  github avatar by login, for profiles without a gravatar.
 * @returns {{ username:string, displayName:string, avatar:string|null, headline:string|null, tier:string }[]}
 */
export function buildMembersDirectory(profiles, avatarFallback = () => undefined) {
  return (profiles || []).map((p) => {
    const d = p.data || {};
    const login = githubLoginFromLinks(d.links?.github) || d.username;
    return {
      username: d.username,
      displayName: d.displayName || d.username,
      avatar: d.avatar || avatarFallback(login) || null,
      headline: d.headline || null,
      tier: d.tier || 'trial',
    };
  });
}

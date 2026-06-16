// SOW-034: resolve a content author's github login to a Discord mention. Priority:
//   1. an explicit override (github_login -> discord_user_id), for staff/grandfathered members who never ran
//      signup (kept OUT of the public repo: a workflow env JSON).
//   2. Stripe customer metadata.discord_user_id (captured at signup), found by github_id via members-index.
//   3. plain "@login" text fallback (no ping) when neither resolves.
// The house author ("gbti"/"house") is not a member -> a plain "GBTI Network" label, no ping. Never throws (a
// Stripe error / lag falls back to text), and caches per run so each author is looked up at most once.

const HOUSE = new Set(['gbti', 'house']);

/** Build login -> github_id from a members-index map (github_id -> username). Lowercased logins. */
export function reverseMembersIndex(indexByGithubId = {}) {
  const m = new Map();
  for (const [githubId, username] of Object.entries(indexByGithubId || {})) {
    if (username) m.set(String(username).toLowerCase(), String(githubId));
  }
  return m;
}

/**
 * @param {object} a
 * @param {Map<string,string>} a.reverseIndex  login(lower) -> github_id
 * @param {object} [a.stripe]                  a client with searchCustomerByGithubId(githubId) -> { metadata }
 * @param {Object<string,string>} [a.overrides] login(any case) -> discord_user_id
 * @returns {(login: string) => Promise<string>} resolves to "<@id>" or "@login" / "GBTI Network"
 */
export function createMentionResolver({ reverseIndex = new Map(), stripe = null, overrides = {} } = {}) {
  const lowerOverrides = new Map(Object.entries(overrides || {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  const cache = new Map();
  return async function resolveMention(login) {
    const key = String(login || '').toLowerCase();
    if (!key) return 'a network member';
    if (cache.has(key)) return cache.get(key);
    let mention;
    if (HOUSE.has(key)) {
      mention = 'GBTI Network';
    } else if (lowerOverrides.has(key)) {
      mention = `<@${lowerOverrides.get(key)}>`;
    } else {
      let discordId = null;
      const githubId = reverseIndex.get(key);
      if (githubId && stripe?.searchCustomerByGithubId) {
        try {
          const customer = await stripe.searchCustomerByGithubId(githubId);
          const id = customer?.metadata?.discord_user_id;
          if (id) discordId = String(id);
        } catch { /* Stripe lag/error -> text fallback */ }
      }
      mention = discordId ? `<@${discordId}>` : `@${login}`;
    }
    cache.set(key, mention);
    return mention;
  };
}

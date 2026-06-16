// The GbtiClient contract (SOW-006 v2). The web components NEVER import the core or a transport; they are
// handed a `client` object with these async methods and render its results. Two hosts implement it:
//   - the npm server: createHttpClient() below (fetch the local hardened /api/* routes with the bearer token);
//   - the Chrome extension: a messaging adapter (content script -> background worker) built in P4 with the
//     SAME method names + shapes, so the components are identical on both.
// The method set mirrors client/src/api.mjs exactly, so the contract is the existing surface, not new API.
//
// GbtiClient = {
//   status(), listContent({type?}), getContentItem({path}), validateContent({type,input,body}),
//   publish({type,input,body,message?,title?,prBody?}), listPRs(), prStatus({number}),
//   formFields({type}), preview({body}), stageImage({filename,dataBase64}), listMembersOnly(),
//   decrypt({encPath}) -> { text }  // SOW-016: the host reads the .enc + decrypts via the Worker (key stays in the host),
//   getSettings(), updateSettings(patch), getBilling(), getReferral(), admin(action, args),
//   login?(onPrompt)   // optional host capability (device flow); not an HTTP route
// }

class GbtiClientError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'GbtiClientError';
    this.code = code;
  }
}

/**
 * The fetch-based GbtiClient for the npm host (talks to the local hardened server's /api/* routes).
 * @param {object} a
 * @param {string} [a.baseUrl]  origin of the local server, '' = same origin.
 * @param {string} a.token      the per-install bearer token.
 * @param {Function} [a.fetch]  injected for tests (defaults to globalThis.fetch).
 */
export function createHttpClient({ baseUrl = '', token, fetch = globalThis.fetch } = {}) {
  async function request(method, path, body) {
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, init);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new GbtiClientError(json?.error || `http-${res.status}`, json?.message || json?.error || `request failed (${res.status})`);
    }
    return json;
  }
  const qs = (params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return {
    status: () => request('GET', '/api/status'),
    listContent: ({ type } = {}) => request('GET', `/api/content${qs({ type })}`),
    getContentItem: ({ path }) => request('GET', `/api/content/item${qs({ path })}`),
    readItem: ({ path }) => request('GET', `/api/read${qs({ path })}`), // SOW-031: read ANY published index.md for the in-extension reader -> { path, frontmatter, body }
    validateContent: (b) => request('POST', '/api/validate', b),
    publish: (b) => request('POST', '/api/publish', b),
    postShare: (b) => request('POST', '/api/share', b), // SOW-018: returns { id, path, visibility, encrypted }
    listShares: ({ limit } = {}) => request('GET', `/api/shares${qs({ limit })}`), // SOW-018: returns { items: [share summaries] }
    listShareComments: ({ targetSlug, limit } = {}) => request('GET', `/api/share-comments${qs({ targetSlug, limit })}`), // SOW-032: a Share's discussion -> { items: [comment summaries] }
    discordInvite: () => request('GET', '/api/discord-invite'), // on-demand Discord invite -> { url, source }
    postComment: (b) => request('POST', '/api/comment', b), // SOW-027: { targetType, targetSlug, body, authorNote?, parentId?, visibility? } -> { id, path }
    editComment: (b) => request('POST', '/api/comment/edit', b), // SOW-027: { id, body, authorNote? } -> { id, edited }
    getComment: ({ id }) => request('GET', `/api/comment${qs({ id })}`), // SOW-027: edit prefill -> { path, frontmatter, body }
    listPRs: () => request('GET', '/api/prs'),
    prStatus: ({ number }) => request('GET', `/api/pr-status${qs({ number })}`),
    listContributions: () => request('GET', '/api/contributions'), // SOW-028: incoming contributions to review -> { contributions: [...] }
    formFields: ({ type }) => request('GET', `/api/form-fields${qs({ type })}`),
    preview: ({ body }) => request('POST', '/api/preview', { body }),
    stageImage: (b) => request('POST', '/api/image', b),
    listMembersOnly: () => request('GET', '/api/members-content'),
    decrypt: ({ encPath }) => request('POST', '/api/member-decrypt', { encPath }), // SOW-016: returns { text }
    // SOW-024: favorites live in the deletable edge store (KV), NOT git. toggleFavorite SETS the favorite to
    // `on` via the activity store and derives the resulting `favorited` from the returned activity (no global
    // count: the public aggregate count comes from house/favorite-counts.yml on the next build).
    toggleFavorite: async ({ targetType, targetSlug, on }) => {
      const r = await request('POST', '/api/activity', { action: 'favorite', targetType, targetSlug, on });
      const favs = (r && r.activity && r.activity.favorites) || [];
      return { favorited: favs.some((f) => f.type === targetType && f.slug === targetSlug) };
    },
    // SOW-024: member activity (favorites + collections) in the deletable edge store.
    getActivity: () => request('GET', '/api/activity'), // returns { favorites, collections }
    createCollection: ({ name }) => request('POST', '/api/activity', { action: 'collection.create', name }), // returns { id, activity }
    addToCollection: ({ id, targetType, targetSlug, on = true }) => request('POST', '/api/activity', { action: 'collection.item', id, targetType, targetSlug, on }),
    // SOW-023: the follow graph (subscriptions) in the deletable edge store (paid-only).
    getFollows: () => request('GET', '/api/follows'), // returns { following: [{ username, addedAt }] }
    setFollow: ({ username, on = true }) => request('POST', '/api/follows', { username, on }), // returns { following }
    // SOW-026: first-run onboarding readiness (token/fork/install) from durable GitHub state.
    onboardingStatus: () => request('GET', '/api/onboarding-status'), // returns { appMode, signedIn, forkReady, installReady, activeStep, ready, ... }
    getSettings: () => request('GET', '/api/settings'),
    updateSettings: (patch) => request('POST', '/api/settings', patch),
    getBilling: () => request('GET', '/api/billing'),
    getReferral: () => request('GET', '/api/referral'),
    admin: (action, args = {}) => request('POST', '/api/admin', { action, ...args }),
  };
}

export { GbtiClientError };

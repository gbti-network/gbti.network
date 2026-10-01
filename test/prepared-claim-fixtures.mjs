// sow-427 C4: shared fixtures for the claim tests (prepared-claim*.test.mjs). Not a test file itself (no `.test.`),
// so the suite glob does not run it. No network, no secrets: a fake KV, a URL-matching fake GitHub that records every
// write, and records seeded through the REAL pure core (validatePreparedDraft, newListing, newInvite), so a fixture
// can never drift from what the admin route actually stores.
import yaml from 'js-yaml';
import { validatePreparedDraft, newListing, listingKey, listingImageKey } from '../membership/prepared-listings.mjs';
import { newInvite, inviteKey } from '../membership/invites.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';

export const NOW = new Date('2026-10-01T12:00:00.000Z');
export const PREPARER = '2002207'; // a superadmin (login atwellpub, folder hudson in the index)
export const CLAIMANT = '5551234'; // the person the listing was prepared for (login Sam-Dev, GBTI name sam)
export const STRANGER = '8880001'; // somebody else holding the link
export const MODERATOR = '7770001';
export const LISTING_ID = '23456789ABCDEFGH';
export const CODE = 'CODEABLE7K3M9Q2RXT';
export const CAMPAIGN = 'CODEABLEYEAR';
export const UPSTREAM = 'gbti-network/gbti.network';
export const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
export const IMG = { 'icon.png': Buffer.alloc(40, 1).toString('base64'), 'cover.webp': Buffer.alloc(60, 2).toString('base64'), 'shot-1.png': Buffer.alloc(80, 3).toString('base64') };

export const INDEX_YML = `members:\n  "${PREPARER}": hudson\n  "${CLAIMANT}": sam\n  "${MODERATOR}": mod-person\n`;
export const TAXONOMY = { tree: { devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks' } } }, ai: { label: 'AI' } } };
export const LICENSES = { licenses: { MIT: { url: 'https://spdx.org/licenses/MIT.html' } } };

export const env = (over = {}) => ({
  UPSTREAM_REPO: UPSTREAM, MEMBERSHIP_AUTHOR_ENABLED: 'true', SITE_BASE_URL: 'https://gbti.network',
  REGATE_DISPATCH_TOKEN: 'dispatch-token', GITHUB_CONTENT_REPO: UPSTREAM, GITHUB_APP_INSTALLATION_ID: '999', ...over,
});

/** The overrides mirror as reconcile writes it. `superadmins`/`moderators` are account numbers. */
export function mirror({ superadmins = [PREPARER], moderators = [MODERATOR], bans = [], at = NOW } = {}) {
  return {
    generatedAt: at.toISOString(),
    roles: { superadmins: superadmins.map((github_id) => ({ github_id, login: 'x' })), moderators: moderators.map((github_id) => ({ github_id })) },
    bans: { bans: bans.map((github_id) => ({ github_id })) },
    grandfathered: { grandfathered: [] },
  };
}

/** A KV double with list(), recording puts; `failPut(key)` makes a put throw. */
export function fakeKv(seed = {}, { failPut = null, failDelete = null } = {}) {
  const store = new Map(Object.entries(seed));
  const puts = [];
  return {
    store, puts,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      if (failPut && failPut(key)) throw new Error('kv put failed');
      puts.push(key);
      store.set(key, value);
    },
    async delete(key) {
      if (failDelete && failDelete(key)) throw new Error('kv delete failed');
      store.delete(key);
    },
    async list({ prefix, cursor } = {}) {
      void cursor;
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
    json(key) { const v = store.get(key); return v === undefined ? undefined : JSON.parse(v); },
  };
}

export const DRAFT = (fmOver = {}, bodyOver = null) => ({
  type: 'project', slug: 'surfacedby',
  frontmatter: {
    title: 'SurfacedBy', shortDescription: 'Finds where a product is mentioned.', icon: './images/icon.png',
    featuredImage: './images/cover.webp', categories: ['devops'], ...fmOver,
  },
  body: bodyOver ?? 'It watches the web for mentions.\n\n![The dashboard](./images/shot-1.png)',
});

/**
 * Seed one prepared listing, its invite and its images into a fresh KV (plus the overrides mirror). Options:
 * `bound` (an account number the invitation is tied to), `redeemedBy`, `listingOver`/`inviteOver` (raw field
 * overrides), `images` (false to leave them out), `mirrorOpts`, `extra` (more KV seed).
 */
export function seed({ bound = null, redeemedBy = null, listingOver = {}, inviteOver = {}, images = true, mirrorOpts = {}, extra = {}, kvOpts = {} } = {}) {
  const v = validatePreparedDraft(DRAFT());
  if (!v.ok) throw new Error(`fixture draft invalid: ${v.issues.join(' ')}`);
  const listing = {
    ...newListing({
      id: LISTING_ID, draft: v.draft, recipientName: 'Sam', message: 'We built this page for you.\nClaim it any time.',
      campaign: CAMPAIGN, code: CODE, boundGithubId: bound, boundLogin: bound ? 'Sam-Dev' : null,
      preparedBy: PREPARER, preparedByLogin: 'atwellpub', now: new Date(NOW.getTime() - 86400e3),
    }),
    ...listingOver,
  };
  let invite = newInvite({
    campaign: CAMPAIGN, code: CODE, issuedBy: PREPARER, issuedByLogin: 'atwellpub', expiresAt: null,
    now: new Date(NOW.getTime() - 86400e3), listingId: LISTING_ID, boundGithubId: bound, boundLogin: bound ? 'Sam-Dev' : null,
  });
  if (redeemedBy) invite = { ...invite, redeemedBy, redeemedByLogin: 'x', redeemedAt: new Date(NOW.getTime() - 3600e3).toISOString() };
  invite = { ...invite, ...inviteOver };
  const kvSeed = {
    [OVERRIDES_KV_KEY]: JSON.stringify(mirror(mirrorOpts)),
    [inviteKey(CODE)]: JSON.stringify(invite),
    [listingKey(LISTING_ID)]: JSON.stringify(listing),
    ...extra,
  };
  if (images) {
    for (const [name, data] of Object.entries(IMG)) {
      kvSeed[listingImageKey(LISTING_ID, name)] = JSON.stringify({ dataBase64: data, contentType: 'image/png', bytes: 10, at: 0 });
    }
  }
  return { kv: fakeKv(kvSeed, kvOpts), listing, invite };
}

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

/**
 * A URL-matching GitHub double covering the claim end to end; every write is pushed onto `rec`. Options:
 * `index` (members-index text), `profile` (true: profile.md exists on main), `treeSlugs` (projects on main),
 * `prCreate` ('ok' | 422 | 500), `pulls` (Map number -> pull body, for GET /pulls/<n>), `byBranch` (array for
 * GET /pulls?head=), `failIndex`, `failPullRead`.
 */
export function ghFake(rec, opts = {}) {
  const {
    index = INDEX_YML, profile = false, treeSlugs = [], prCreate = 'ok', pulls = new Map(), byBranch = [],
    failIndex = false, failPullRead = false, user = { id: Number(CLAIMANT), login: 'Sam-Dev', name: 'Sam Rivera', type: 'User' },
  } = opts;
  const fn = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = String(url);
    fn.calls.push({ method, url: u });
    if (/\/access_tokens$/.test(u)) return res(201, { token: 'inst-token', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    if (/\/dispatches$/.test(u)) { rec.push({ method, url: u, body: JSON.parse(init.body) }); return res(204, {}); }
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(u)) return failIndex ? res(502, {}) : res(200, { content: b64(index) });
    if (/\/contents\/house\/taxonomy\.yml\?ref=main$/.test(u)) return res(200, { content: b64(yaml.dump(TAXONOMY)) });
    if (/\/contents\/house\/licenses\.yml\?ref=main$/.test(u)) return res(200, { content: b64(yaml.dump(LICENSES)) });
    if (/\/contents\/members\/[^/]+\/profile\.md\?ref=main$/.test(u)) return profile ? res(200, { content: b64('---\nusername: sam\n---\n') }) : res(404, {});
    if (/\/git\/trees\/main\?recursive=1$/.test(u)) {
      return res(200, { tree: treeSlugs.map((s) => ({ type: 'blob', path: `members/hudson/projects/${s}/index.md` })) });
    }
    if (/\/user\/\d+$/.test(u)) return res(200, user);
    if (/\/git\/ref\/heads\/main$/.test(u)) return res(200, { object: { sha: 'mainsha' } });
    if (/\/git\/refs$/.test(u) && method === 'POST') { rec.push({ method, url: u, body: JSON.parse(init.body) }); return res(201, {}); }
    if (/\/git\/refs\/heads\//.test(u) && method === 'PATCH') { rec.push({ method, url: u, body: JSON.parse(init.body) }); return res(200, {}); }
    if (/\/contents\//.test(u) && method === 'GET') return res(404, {});
    if (/\/contents\//.test(u) && (method === 'PUT' || method === 'DELETE')) { rec.push({ method, url: u, body: JSON.parse(init.body) }); return res(201, {}); }
    if (/\/pulls$/.test(u) && method === 'POST') {
      rec.push({ method, url: u, body: JSON.parse(init.body) });
      if (prCreate === 422) return res(422, {});
      if (prCreate === 500) return res(500, {});
      return res(201, { number: 77, html_url: `https://github.com/${UPSTREAM}/pull/77` });
    }
    const one = /\/pulls\/(\d+)$/.exec(u);
    if (one && method === 'GET') {
      if (failPullRead) return res(502, {});
      const p = pulls.get(Number(one[1]));
      return p ? res(200, p) : res(404, {});
    }
    if (/\/pulls\?head=/.test(u) && method === 'GET') { fn.headQueries.push(decodeURIComponent(u)); return res(200, byBranch); }
    return res(500, {});
  };
  fn.calls = [];
  fn.headQueries = [];
  return fn;
}

/** A pull request body as GitHub returns it. */
export function pull(number, { state = 'open', merged = false, branch = `hosted/${CLAIMANT}/project-surfacedby`, createdAt = NOW.toISOString() } = {}) {
  return { number, state, merged, merged_at: merged ? NOW.toISOString() : null, head: { ref: branch }, base: { ref: 'main' }, html_url: `https://github.com/${UPSTREAM}/pull/${number}`, created_at: createdAt };
}

/** A resolveEffective stand-in: the caller's verified identity and effective status. */
export const as = (githubId, status = 'paid', source = 'stripe', login = 'Sam-Dev') => async () => ({ ok: true, githubId, login, via: 'bearer', status, source, tier: 'member' });
export const allow = async () => ({ allowed: true, count: 1, limit: 10 });

/** A GET or POST request for /membership/claim. */
export const getReq = (code = CODE) => new Request(`https://signup.gbti.network/membership/claim?code=${encodeURIComponent(code)}`, { headers: { Authorization: 'Bearer t' } });
export const postReq = (body) => new Request('https://signup.gbti.network/membership/claim', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** The claim deps for a test, every network edge faked. */
export function claimDeps({ kv, fetchImpl, resolve = as(CLAIMANT), limiter = allow, dispatch = null, ...over }) {
  return {
    kv, fetchImpl, resolve, limiter, now: NOW, getToken: async () => 'inst-token',
    ...(dispatch ? { dispatch } : {}), ...over,
  };
}

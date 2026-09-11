// sow-158 Part 3: the tier-gated community Shares feed for the website /account hub. The members-only Shares
// stream can NEVER be a public build artifact (the build guard forbids members-share titles/metadata in dist),
// so it is served HERE, gated server-side: a paid or trialing caller sees the members + public stream; every
// other signed-in tier (free / expired / banned) sees ONLY public shares. Members bodies stay POINTER-ONLY
// (encryptedBody); the client decrypts on expand via /membership/decrypt, so the AES key never leaves the
// Worker. Enumeration is one GitHub Trees call (the share id is a timestamp-slug, lexically = chronologically
// sortable) + reading the newest N stub files, cached ~60s in SIGNUP_KV so repeat loads are cheap.
//
// Returns { status, body } for the router. Pure over injected fetch + kv, so it is unit-tested with fakes.

import { getInstallationToken } from './github-app.mjs';
import { authorizeSignedIn } from './membership-content.mjs';
import { parseContentFile, shareSummary, byShareNewest } from '../../client/src/content-ops.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const SHARE_PATH = /^members\/[^/]+\/shares\/([^/]+)\.(?:md|mdx)$/;
const READ_MEMBERS = new Set(['paid', 'trialing']); // who may see the members-only stream (mirror READ_TRIAL_OK)
const CACHE_KEY = 'shares:feed:v1';
const CACHE_TTL_SECONDS = 60;
const CACHE_N = 60; // cache the newest N summaries (3 pages of 20); older pages read live
const MAX_LIMIT = 40;

/** Decode a GitHub Contents API base64 blob to a UTF-8 string (mirrors reviewFileContent). */
function decodeContent(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---- 2026-09-10: ONE GraphQL call instead of one REST read per file -----------------------------------------
//
// The owner's WorkBench Shares tab took 8 to 10 seconds. Measured: the folder listing is ~300 ms and then each
// of their 46 share files was read with its own Contents call, ~135 ms each, one after another. GitHub's
// GraphQL API returns a whole folder's files, text included, in one round trip (~1 s for the same 46), and
// the cross-member feed can name up to `cacheN` blobs by path in one query through aliases. Both readers below
// try GraphQL first and FALL BACK to the per-file REST path when GraphQL is unavailable (a network error, a
// non-2xx, or an answer without a repository), so the worst case is today's speed, never a broken tab. The
// REST fallback reads in parallel now too, capped, instead of one at a time.
//
// The one-call shape also matters for the Worker's per-request subrequest budget: the old path spent one
// subrequest per share, so a member with a large folder was heading for the cap, silently.

const GQL_ALIAS = (i) => `b${i}`;
const REST_PARALLEL = 8;

/** POST one GraphQL query. Returns the `repository` object or null when GraphQL cannot be used. */
async function graphqlRepository(query, { fetchImpl, token }) {
  let res;
  try {
    res = await fetchImpl(`${GH}/graphql`, { method: 'POST', headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  } catch { return null; }
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  const repo = data?.data?.repository;
  return repo && typeof repo === 'object' ? repo : null;
}

const repoParts = (upstream) => { const [owner, name] = String(upstream).split('/'); return { owner, name }; };

/**
 * Every file of ONE folder, text included, in one call. Returns [{ name, text }] for the blobs, [] for a folder
 * that does not exist, or null when GraphQL could not answer (caller falls back to REST).
 */
export async function readFolderGraphQL(dir, { fetchImpl, token, upstream }) {
  const { owner, name } = repoParts(upstream);
  const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { object(expression: ${JSON.stringify(`main:${dir}`)}) { ... on Tree { entries { name type object { ... on Blob { text isBinary } } } } } } }`;
  const repo = await graphqlRepository(query, { fetchImpl, token });
  if (!repo) return null;
  if (!repo.object) return []; // the folder does not exist on main: a definitive empty, not a failure
  const entries = Array.isArray(repo.object.entries) ? repo.object.entries : [];
  return entries
    .filter((e) => e && e.type === 'blob' && typeof e.name === 'string' && e.object && typeof e.object.text === 'string' && !e.object.isBinary)
    .map((e) => ({ name: e.name, text: e.object.text }));
}

/**
 * Many blobs by path in one call. Returns Map path -> text (a missing path is simply absent), or null when
 * GraphQL could not answer.
 */
export async function readBlobsGraphQL(paths, { fetchImpl, token, upstream }) {
  if (!paths.length) return new Map();
  const { owner, name } = repoParts(upstream);
  const fields = paths.map((p, i) => `${GQL_ALIAS(i)}: object(expression: ${JSON.stringify(`main:${p}`)}) { ... on Blob { text isBinary } }`).join(' ');
  const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`;
  const repo = await graphqlRepository(query, { fetchImpl, token });
  if (!repo) return null;
  const out = new Map();
  paths.forEach((p, i) => { const b = repo[GQL_ALIAS(i)]; if (b && typeof b.text === 'string' && !b.isBinary) out.set(p, b.text); });
  return out;
}

/** The REST fallback: one Contents read per path, `REST_PARALLEL` at a time. Returns Map path -> text. */
export async function readBlobsRest(paths, { fetchImpl, token, upstream }) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += REST_PARALLEL) {
    const batch = paths.slice(i, i + REST_PARALLEL);
    await Promise.all(batch.map(async (p) => {
      let res;
      try { res = await fetchImpl(`${GH}/repos/${upstream}/contents/${p}?ref=main`, { headers: GH_HEADERS(token) }); } catch { return; }
      if (!res || !res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data || Array.isArray(data) || !data.content) return;
      try { out.set(p, decodeContent(data.content)); } catch { /* skip an undecodable file */ }
    }));
  }
  return out;
}

/**
 * Enumerate + read the newest shares across every member folder, newest-first. Returns share SUMMARIES (public
 * bodies inline; a members share's body is '' with an encryptedBody pointer — the plaintext never travels here).
 * One Trees call selects the files (id desc = newest), then the newest `cacheN` stub files are read. Cached in
 * SIGNUP_KV for CACHE_TTL_SECONDS. Throws on a Trees failure so the route can 502 (never a partial silent open).
 */
export async function enumerateShares(env, { fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network', cacheN = CACHE_N, useCache = true, getToken = getInstallationToken } = {}) {
  if (useCache && kv) {
    try { const cached = await kv.get(CACHE_KEY, 'json'); if (cached && Array.isArray(cached.items)) return cached.items; } catch { /* cold read */ }
  }
  const instToken = await getToken(env, { fetchImpl, kv });
  const treeRes = await fetchImpl(`${GH}/repos/${upstream}/git/trees/main?recursive=1`, { headers: GH_HEADERS(instToken) });
  if (!treeRes || !treeRes.ok) throw new Error(`git trees ${treeRes ? treeRes.status : 'no response'}`);
  const tree = await treeRes.json().catch(() => null);
  const nodes = Array.isArray(tree?.tree) ? tree.tree : [];
  const files = nodes
    .filter((n) => n && n.type === 'blob' && typeof n.path === 'string' && SHARE_PATH.test(n.path))
    .map((n) => ({ path: n.path, id: n.path.match(SHARE_PATH)[1] }))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)) // id desc = newest first (the id is a timestamp-slug)
    .slice(0, Math.max(0, cacheN));

  const paths = files.map((f) => f.path);
  const io = { fetchImpl, token: instToken, upstream };
  const texts = (await readBlobsGraphQL(paths, io)) ?? (await readBlobsRest(paths, io));
  const items = [];
  for (const f of files) {
    const text = texts.get(f.path);
    if (typeof text !== 'string') continue;
    let parsed;
    try { parsed = parseContentFile(text); } catch { continue; }
    if ((parsed.frontmatter?.status ?? 'published') !== 'published') continue; // missing status = published (schema default)
    items.push(shareSummary(f.path, parsed.frontmatter, parsed.body));
  }
  items.sort(byShareNewest);

  if (useCache && kv) {
    try { await kv.put(CACHE_KEY, JSON.stringify({ generatedAt: new Date().toISOString(), items }), { expirationTtl: CACHE_TTL_SECONDS }); } catch { /* best-effort */ }
  }
  return items;
}

/**
 * GET /membership/shares?limit=20&before=<id> — the tier-gated community Shares feed. Cookie-or-bearer via
 * authorizeSignedIn (admits every signed-in tier, INCLUDING banned, so free/banned still read PUBLIC shares).
 * A paid/trialing caller additionally sees the members-only stream; everyone else is filtered to public shares.
 * `before` is a share id cursor (return strictly-older items) for the "load older" pager.
 */
export async function listSharesFeed(request, env, deps = {}) {
  const { authorize = authorizeSignedIn } = deps;
  const auth = await authorize(request, env, { ...deps, allowCookie: true });
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : 20;
  const before = url.searchParams.get('before') || null;

  let all;
  try { all = await enumerateShares(env, deps); } catch { return { status: 502, body: { error: 'shares_failed', message: 'could not load shares right now' } }; }

  const canSeeMembers = READ_MEMBERS.has(auth.status);
  let items = canSeeMembers ? all : all.filter((s) => String(s?.visibility || 'members').toLowerCase() === 'public');
  if (before) items = items.filter((s) => String(s?.id || '') < before); // strictly older than the cursor
  const page = items.slice(0, limit);
  const nextBefore = page.length === limit ? String(page[page.length - 1]?.id || '') || null : null;
  return { status: 200, body: { ok: true, items: page, canSeeMembers, nextBefore } };
}

// ---- sow-304: the member's OWN shares, for the WorkBench Shares tab ------------------------------------------
const MY_SHARES_MAX = 100;
const SHARE_FILE_RE = /^([a-z0-9][a-z0-9-]*)\.(?:md|mdx)$/;

/**
 * Every share in ONE member's folder, newest first, drafts INCLUDED (an unpublished share must still show in the
 * WorkBench so the member can edit or republish it). One Contents listing of members/<login>/shares/ (a member
 * with no shares folder yet gets an empty list, not an error), then the newest MY_SHARES_MAX stubs are read.
 * Members bodies stay pointer-only exactly as in the feed. Not cached: it is the caller's own folder and the
 * list must reflect an edit as soon as its pull request merges. Since 2026-09-10 the listing and the texts
 * come from ONE GraphQL call (see readFolderGraphQL); the two-step REST read is the fallback.
 */
export async function listMemberShares(env, login, { fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network', getToken = getInstallationToken } = {}) {
  const who = String(login || '');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(who)) return [];
  const instToken = await getToken(env, { fetchImpl, kv });
  const dir = `members/${who.toLowerCase()}/shares`;
  const io = { fetchImpl, token: instToken, upstream };
  const byName = (a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  // ONE call: the folder's files with their text. Null means GraphQL could not answer; the REST path below is
  // the same two-step read as before, with the per-file reads in parallel.
  const folder = await readFolderGraphQL(dir, io);
  let texts;
  let files;
  if (folder) {
    files = folder
      .filter((e) => SHARE_FILE_RE.test(e.name))
      .map((e) => ({ path: `${dir}/${e.name}`, id: e.name.match(SHARE_FILE_RE)[1], text: e.text }))
      .sort(byName)
      .slice(0, MY_SHARES_MAX);
    texts = new Map(files.map((f) => [f.path, f.text]));
  } else {
    const res = await fetchImpl(`${GH}/repos/${upstream}/contents/${dir}?ref=main`, { headers: GH_HEADERS(instToken) });
    if (res && res.status === 404) return [];
    if (!res || !res.ok) throw new Error(`contents ${res ? res.status : 'no response'}`);
    const listing = await res.json().catch(() => null);
    if (!Array.isArray(listing)) return [];
    files = listing
      .filter((e) => e && e.type === 'file' && typeof e.name === 'string' && SHARE_FILE_RE.test(e.name))
      .map((e) => ({ path: `${dir}/${e.name}`, id: e.name.match(SHARE_FILE_RE)[1] }))
      .sort(byName)
      .slice(0, MY_SHARES_MAX);
    texts = await readBlobsRest(files.map((f) => f.path), io);
  }
  const items = [];
  for (const f of files) {
    const text = texts.get(f.path);
    if (typeof text !== 'string') continue;
    let parsed;
    try { parsed = parseContentFile(text); } catch { continue; }
    items.push(shareSummary(f.path, parsed.frontmatter, parsed.body));
  }
  items.sort(byShareNewest);
  return items;
}

/**
 * GET /membership/my-shares: the caller's own shares (see listMemberShares). Cookie-or-bearer via
 * authorizeSignedIn; the login comes from the verified session, never from a query parameter, so the route can
 * only ever list the caller's own folder.
 */
export async function listMyShares(request, env, deps = {}) {
  const { authorize = authorizeSignedIn } = deps;
  const auth = await authorize(request, env, { ...deps, allowCookie: true });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const login = String(auth.login || '');
  if (!login) return { status: 401, body: { error: 'unauthorized', message: 'could not resolve the member login' } };
  let items;
  try { items = await listMemberShares(env, login, deps); } catch { return { status: 502, body: { error: 'shares_failed', message: 'could not load your shares right now' } }; }
  return { status: 200, body: { ok: true, items } };
}

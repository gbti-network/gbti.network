// sow-317: EVERY member's content, for a superadmin, from the WorkBench's Network content scope.
//
//   GET /membership/network-content?type=post|prompt|project -> { ok, items }
//   GET /membership/network-shares                            -> { ok, items }
//
// The owner's ruling (2026-09-10): a superadmin has total access across all content through the WorkBench. The
// site's per-type index already lists every member's PUBLISHED item, so this route adds the one thing the index
// cannot carry, the items sitting on main UNPUBLISHED (a draft-status article the site never built), and labels
// every row with its author. Both routes are superadmin-only (authorizeSuperadmin, the sow-183 targets pattern);
// the Worker re-verifies the caller on every write regardless of what this listing showed them.
//
// COST. One recursive Trees call on main (the repo is ~2,300 entries), cached for a minute in SIGNUP_KV as the
// content and share paths only, shared by every type and by the shares route. Then one GraphQL batch for the
// unlisted files (usually a handful) or, for shares, for every share stub (small files), through the same
// readBlobsGraphQL that took the Shares tab from 8 seconds to one. The REST reader is the fallback.

import { getInstallationToken } from './github-app.mjs';
import { authorizeSuperadmin } from './membership-admin.mjs';
import { readBlobsGraphQL, readBlobsRest } from './membership-shares.mjs';
import { parseContentFile, shareSummary, byShareNewest } from '../../client/src/content-ops.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

export const TREE_CACHE_KEY = 'network:tree:v1';
export const TREE_CACHE_TTL_SECONDS = 60;
export const NETWORK_SHARES_MAX = 300;

/** Folder -> content type, the same map the WorkBench and the hosted gate use. */
export const FOLDER_TYPE = Object.freeze({ posts: 'post', projects: 'project', products: 'project', prompts: 'prompt' });
/** Content type -> the public per-type index the site builds (published items only). */
export const TYPE_INDEX = Object.freeze({ post: 'blog-index.json', project: 'projects-index.json', prompt: 'prompts-index.json' });

// Case-insensitive on purpose: repo paths are lowercase, but a path typed or pasted by a superadmin need not be.
const CONTENT_PATH = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|projects|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/i;
const SHARE_PATH = /^members\/([a-z0-9][a-z0-9-]*)\/shares\/([a-z0-9][a-z0-9-]*)\.(?:md|mdx)$/i;

/** The author of a canonical content or share path is the folder it lives in. '' for anything else. */
export function authorFromContentPath(path) {
  const m = CONTENT_PATH.exec(String(path || '')) || SHARE_PATH.exec(String(path || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Every canonical content item in a Trees listing: { path, author, type, slug }. Pure. */
export function contentPathsFromTree(nodes) {
  const out = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || n.type !== 'blob' || typeof n.path !== 'string') continue;
    const m = CONTENT_PATH.exec(n.path);
    if (!m) continue;
    out.push({ path: n.path, author: m[1].toLowerCase(), type: FOLDER_TYPE[m[2].toLowerCase()], slug: m[3] });
  }
  return out;
}

/** Every share stub in a Trees listing, newest first (the id is a timestamp slug): { path, author, id }. Pure. */
export function sharePathsFromTree(nodes) {
  const out = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || n.type !== 'blob' || typeof n.path !== 'string') continue;
    const m = SHARE_PATH.exec(n.path);
    if (!m) continue;
    out.push({ path: n.path, author: m[1].toLowerCase(), id: m[2] });
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const toMs = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : null;
};

/**
 * The listing for one type: the index's published items (author from the path, status published) plus the
 * unlisted items on main with the status their frontmatter carries. Newest first, dateless last. Pure.
 */
export function mergeIndexAndUnlisted(indexItems, unlisted) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(indexItems) ? indexItems : []) {
    const path = typeof it?.path === 'string' ? it.path : '';
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ ...it, author: it.author || authorFromContentPath(path), status: 'published' });
  }
  for (const it of Array.isArray(unlisted) ? unlisted : []) {
    const path = typeof it?.path === 'string' ? it.path : '';
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ ...it, author: it.author || authorFromContentPath(path) });
  }
  out.sort((a, b) => {
    const av = toMs(a.publishedAt) ?? toMs(a.updatedAt) ?? -Infinity;
    const bv = toMs(b.publishedAt) ?? toMs(b.updatedAt) ?? -Infinity;
    if (bv !== av) return bv - av;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  return out;
}

/** One row for an unlisted item, from its frontmatter. A missing status on main is published by schema default. */
export function unlistedItemFrom(entry, text) {
  let parsed;
  try { parsed = parseContentFile(text); } catch { return null; }
  const fm = parsed.frontmatter || {};
  const status = typeof fm.status === 'string' ? fm.status : 'published';
  return {
    path: entry.path, type: entry.type, slug: entry.slug, author: entry.author,
    title: typeof fm.title === 'string' && fm.title ? fm.title : entry.slug,
    status,
    visibility: fm.visibility === 'members' ? 'members' : 'public',
    publishedAt: toMs(fm.publishedAt ?? fm.date),
    updatedAt: toMs(fm.updatedAt),
    unlisted: true,
  };
}

/**
 * The repo's content + share paths from ONE recursive Trees call, cached a minute. Throws on a Trees failure so
 * the routes 502 rather than answering with a partial list.
 */
export async function readContentTree(env, { fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network', getToken = getInstallationToken, useCache = true } = {}) {
  if (useCache && kv) {
    try { const cached = await kv.get(TREE_CACHE_KEY, 'json'); if (cached && Array.isArray(cached.content) && Array.isArray(cached.shares)) return cached; } catch { /* cold */ }
  }
  const instToken = await getToken(env, { fetchImpl, kv });
  const res = await fetchImpl(`${GH}/repos/${upstream}/git/trees/main?recursive=1`, { headers: GH_HEADERS(instToken) });
  if (!res || !res.ok) throw new Error(`git trees ${res ? res.status : 'no response'}`);
  const tree = await res.json().catch(() => null);
  const nodes = Array.isArray(tree?.tree) ? tree.tree : [];
  const out = { generatedAt: new Date().toISOString(), content: contentPathsFromTree(nodes), shares: sharePathsFromTree(nodes) };
  if (useCache && kv) {
    try { await kv.put(TREE_CACHE_KEY, JSON.stringify(out), { expirationTtl: TREE_CACHE_TTL_SECONDS }); } catch { /* best-effort */ }
  }
  return out;
}

/** GET /membership/network-content?type=<post|prompt|project>. */
export async function listNetworkContent(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
    getToken = getInstallationToken, authorizeSuper = authorizeSuperadmin, site = env?.SITE_ORIGIN || 'https://gbti.network',
  } = deps;
  const superadmin = await authorizeSuper(request, env, deps);
  if (!superadmin.ok) return { status: superadmin.status, body: superadmin.body };
  const type = new URL(request.url).searchParams.get('type') || '';
  if (!TYPE_INDEX[type]) return { status: 400, body: { error: 'bad_request', message: 'type must be post, prompt or project' } };

  let tree;
  try { tree = await readContentTree(env, { fetchImpl, kv, upstream, getToken }); }
  catch { return { status: 502, body: { error: 'listing_failed', message: 'could not read the content tree right now' } }; }

  // The published set, from the site's own index. Unreachable reads as an empty index: everything on main is then
  // read live and carries its real status, which is slower but never wrong.
  let indexItems = [];
  try {
    const r = await fetchImpl(`${site}/${TYPE_INDEX[type]}`, { headers: { Accept: 'application/json', 'User-Agent': 'gbti-network' } });
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (Array.isArray(j?.items)) indexItems = j.items;
  } catch { indexItems = []; }
  const listed = new Set(indexItems.map((it) => it?.path).filter((p) => typeof p === 'string'));
  const unlistedEntries = tree.content.filter((e) => e.type === type && !listed.has(e.path));

  let unlisted = [];
  if (unlistedEntries.length) {
    let instToken;
    try { instToken = await getToken(env, { fetchImpl, kv }); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
    const io = { fetchImpl, token: instToken, upstream };
    const paths = unlistedEntries.map((e) => e.path);
    const texts = (await readBlobsGraphQL(paths, io)) ?? (await readBlobsRest(paths, io));
    unlisted = unlistedEntries.map((e) => { const t = texts.get(e.path); return typeof t === 'string' ? unlistedItemFrom(e, t) : null; }).filter(Boolean);
  }
  return { status: 200, body: { ok: true, items: mergeIndexAndUnlisted(indexItems, unlisted), type } };
}

/** GET /membership/network-shares: every member's shares, drafts included, newest first, capped. */
export async function listNetworkShares(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
    getToken = getInstallationToken, authorizeSuper = authorizeSuperadmin, cap = NETWORK_SHARES_MAX,
  } = deps;
  const superadmin = await authorizeSuper(request, env, deps);
  if (!superadmin.ok) return { status: superadmin.status, body: superadmin.body };
  let tree;
  try { tree = await readContentTree(env, { fetchImpl, kv, upstream, getToken }); }
  catch { return { status: 502, body: { error: 'listing_failed', message: 'could not read the content tree right now' } }; }
  const entries = tree.shares.slice(0, Math.max(0, cap));
  let instToken;
  try { instToken = await getToken(env, { fetchImpl, kv }); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const io = { fetchImpl, token: instToken, upstream };
  const paths = entries.map((e) => e.path);
  const texts = paths.length ? ((await readBlobsGraphQL(paths, io)) ?? (await readBlobsRest(paths, io))) : new Map();
  const items = [];
  for (const e of entries) {
    const text = texts.get(e.path);
    if (typeof text !== 'string') continue;
    let parsed;
    try { parsed = parseContentFile(text); } catch { continue; }
    items.push(shareSummary(e.path, parsed.frontmatter, parsed.body)); // drafts INCLUDED: this is the superadmin view
  }
  items.sort(byShareNewest);
  return { status: 200, body: { ok: true, items } };
}

// SOW-043 P2: the members-only NEWS proxy. The news worker (gbti-news, deployed from the gbti-news-api repo)
// serves a bearer-authenticated /feed; that NEWS_API_KEY must NEVER reach the client. This proxy is EFFECTIVE-PAID
// gated (authorizePaid: ban > staff > grandfather > Stripe, fail-closed, from the SIGNUP_KV mirror — same posture
// as decrypt/follows), calls the news worker with the server-held key, and returns the items. NEWS_API_BASE +
// NEWS_API_KEY are Worker env (set at deploy); until they are set this returns 502 (the client renders "news
// unavailable"), never a key leak. Pure over the injected `authorize`/`fetch`, so it unit-tests with no network.

// SOW-060: NEWS is a FREE-tier perk (browse + follow channels). It is gated to any signed-in, non-banned caller
// (authorizeMember), NOT effective-paid. The server-held NEWS_API_KEY still never reaches the client. Member-only
// content (decrypt/encrypt/Shares/publishing) stays on authorizePaid.
import { authorizeMember } from './membership-content.mjs';
import { recordAuthedUsage } from './analytics.mjs'; // SOW-061 P3: news_view usage by tier

// A category label is config-defined (gbti-news-api/config/categories.mjs); bound the proxied query to a safe
// token set so the proxy can never be pointed at an arbitrary upstream path/query.
const SAFE_CATEGORY = /^[a-z0-9][a-z0-9 &/+.-]{0,40}$/i;

function clampLimit(raw, def = 50, max = 100) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export function newsEnv(env) {
  const base = String(env?.NEWS_API_BASE || '').replace(/\/$/, '');
  const key = env?.NEWS_API_KEY;
  return base && key ? { base, key } : null;
}

export async function callNews(cfg, path, fetchImpl) {
  let res;
  try { res = await fetchImpl(`${cfg.base}${path}`, { headers: { Authorization: `Bearer ${cfg.key}` } }); }
  catch { return { status: 502, body: { error: 'news_unavailable', message: 'could not reach the news service' } }; }
  if (!res.ok) return { status: 502, body: { error: 'news_unavailable', message: `news service returned ${res.status}` } };
  let data; try { data = await res.json(); } catch { data = null; }
  return { ok: true, data };
}

// A source id is config-defined (gbti-news-api/config/sources.mjs); bound it to a safe token set so it can never
// be used to point the proxied query at an arbitrary upstream path.
const SAFE_SOURCE = /^[a-z0-9][a-z0-9 _.-]{0,60}$/i;

/**
 * SOW-046 C: resolve a news item to its CANONICAL upstream record by guid, so the news->Discord publish posts the
 * real feed metadata (title/link/source/category) rather than anything the client supplied. Fetches the upstream
 * /feed (newest-first, capped) and matches by the globally-unique guid; an optional source hint narrows the window
 * to that publication's deeper history (a wrong/forged source just yields a miss -> fail closed). Returns the
 * canonical item or null (not configured, upstream error, or the guid is not in the current feed window).
 */
export async function findNewsItemByGuid(env, { guid, source, fetch = globalThis.fetch, limit = 100 } = {}) {
  const cfg = newsEnv(env);
  if (!cfg || !guid) return null;
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  if (source && SAFE_SOURCE.test(source)) q.set('source', source);
  const r = await callNews(cfg, `/feed?${q.toString()}`, fetch);
  if (!r.ok) return null;
  const items = Array.isArray(r.data?.items) ? r.data.items : [];
  return items.find((it) => String(it?.guid) === String(guid)) ?? null;
}

/** GET /membership/news?category&since&limit -> { items } for any signed-in member (SOW-060). The key never leaves. */
export async function membershipNews(request, env, { authorize = authorizeMember, fetch = globalThis.fetch, ...authDeps } = {}) {
  const auth = await authorize(request, env, authDeps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const cfg = newsEnv(env);
  if (!cfg) return { status: 502, body: { error: 'news_unavailable', message: 'the news service is not configured yet' } };

  const url = new URL(request.url);
  const q = new URLSearchParams();
  const cat = url.searchParams.get('category');
  if (cat && SAFE_CATEGORY.test(cat)) q.set('category', cat);
  const since = url.searchParams.get('since');
  if (since && /^[0-9]{1,12}$/.test(since)) q.set('since', since);
  q.set('limit', String(clampLimit(url.searchParams.get('limit'))));

  recordAuthedUsage(env, auth, 'news_view', request); // SOW-061 P3: a news feed view, recorded by effective tier
  const r = await callNews(cfg, `/feed?${q.toString()}`, fetch);
  if (!r.ok) return r;
  const items = Array.isArray(r.data?.items) ? r.data.items : [];
  return { status: 200, body: { ok: true, updatedAt: r.data?.updatedAt ?? null, count: items.length, items } };
}

/** GET /membership/news-categories -> { categories } (the classifier label set + live counts). Same paid gate. */
export async function membershipNewsCategories(request, env, { authorize = authorizeMember, fetch = globalThis.fetch, ...authDeps } = {}) {
  const auth = await authorize(request, env, authDeps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const cfg = newsEnv(env);
  if (!cfg) return { status: 502, body: { error: 'news_unavailable', message: 'the news service is not configured yet' } };
  const r = await callNews(cfg, '/categories', fetch);
  if (!r.ok) return r;
  return { status: 200, body: { ok: true, categories: Array.isArray(r.data?.categories) ? r.data.categories : [] } };
}

/** GET /membership/news-sources -> { sources } (the channels a member can follow: id, name, description, count).
 *  SOW-046 E. Same paid gate; the key never leaves the Worker. */
export async function membershipNewsSources(request, env, { authorize = authorizeMember, fetch = globalThis.fetch, ...authDeps } = {}) {
  const auth = await authorize(request, env, authDeps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const cfg = newsEnv(env);
  if (!cfg) return { status: 502, body: { error: 'news_unavailable', message: 'the news service is not configured yet' } };
  const r = await callNews(cfg, '/sources', fetch);
  if (!r.ok) return r;
  return { status: 200, body: { ok: true, sources: Array.isArray(r.data?.sources) ? r.data.sources : [] } };
}

// sow-386: GET /membership/news-following -> { ok, items }. The recent stories from the news sources the CALLER
// follows, for the notification bells (the website header bell and the extension new-tab bell). Owner ruling
// 2026-09-22: news alerts are a MEMBERS-only feature, "not available for the free tier users", and there is no
// trial tier any more, so the gate is authorizePaid (effective paid: Stripe paid, staff, grandfathered, a fresh
// coupon), fail closed. A free, banned, signed-out or unresolvable caller gets the gate's refusal and the bell shows
// no news rows. The stories themselves are the same public metadata /news/feed serves anonymously; what is gated is
// the alert, not the data, but the gate still lives here so it cannot be switched on from a page.
//
// Cost per call, measured against the store: the index, the removed list and the banword list (three KV reads,
// the same as every news query), plus one day file per day in the window (WINDOW_DAYS + 1 of slack, because
// queryItems stops one day past `since`). The followed sources come from the caller's own prefs record, one more
// read. The route is served `private, max-age=300`, so a member moving between pages reuses the answer instead of
// asking again.

import { authorizePaid } from './membership-content.mjs';
import { PREFS_KEY } from './membership-prefs.mjs';
import { normalizePrefs } from '../../membership/member-prefs.mjs';
import { queryItems as kvQueryItems } from './news/src/store.mjs';
import { loadSourceList } from './news/src/sources.mjs';

export const FOLLOWED_NEWS_WINDOW_DAYS = 3; // a bell is "what is new": a story older than this is not an alert
export const FOLLOWED_NEWS_MAX = 30;        // the bell's own cap (MAX_BELL_ROWS in client-ui/src/notification-bell-core.mjs)
const SCAN_LIMIT = 1000;                    // stories read from the window before narrowing to the followed sources

// The store keeps publishedAt in SECONDS; the bells sort and compare in MILLISECONDS (the activity and shares lists
// are ms). Convert here, once, so no client has to know the news store's unit.
const toMs = (sec) => (Number.isFinite(Number(sec)) && Number(sec) > 0 ? Number(sec) * 1000 : 0);

/** The bell-shaped news rows for one set of followed source ids. Pure over its inputs, so the narrowing, the
 *  window, the order and the cap are tested without a Worker. `items` are stored news records (publishedAt in
 *  seconds); `names` maps a source id to its publication name. */
export function followedNewsRows(items, followed, { names = new Map(), sinceSec = 0, max = FOLLOWED_NEWS_MAX } = {}) {
  const want = new Set([...(followed || [])].map((s) => String(s).toLowerCase()).filter(Boolean));
  if (!want.size) return [];
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && want.has(String(it.source || '').toLowerCase()))
    // A bell row is a link, so a story whose link is not http(s) (a javascript: or data: URL from a hostile feed)
    // never becomes one.
    .filter((it) => /^https?:\/\//i.test(String(it.link || '')))
    .filter((it) => Number(it.publishedAt ?? it.fetchedAt ?? 0) >= sinceSec)
    .filter((it) => { const g = String(it.guid || ''); if (!g || seen.has(g)) return false; seen.add(g); return true; })
    .sort((a, b) => Number(b.publishedAt ?? b.fetchedAt ?? 0) - Number(a.publishedAt ?? a.fetchedAt ?? 0))
    .slice(0, max)
    .map((it) => ({
      guid: String(it.guid),
      source: String(it.source),
      sourceName: names.get(it.source) || String(it.source),
      title: String(it.title || ''),
      link: String(it.link || ''),
      publishedAt: toMs(it.publishedAt ?? it.fetchedAt),
    }));
}

export async function membershipNewsFollowing(request, env, {
  authorize = authorizePaid, queryItems = kvQueryItems, sourceList = loadSourceList, kv = env?.SIGNUP_KV, now = Date.now, ...authDeps
} = {}) {
  // The route opts in to the session cookie (the website bell); kv is passed so the gate reads the overrides mirror
  // from the same namespace as the prefs record.
  const auth = await authorize(request, env, { ...authDeps, kv });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!env?.NEWS_KV) return { status: 502, body: { error: 'news_unavailable', message: 'the news service is not configured yet' } };
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the prefs store is not configured' } };

  // The caller's OWN followed sources, read from their prefs record by the verified github id. A malformed record
  // normalizes to no follows, so it answers empty rather than failing.
  let followed = [];
  try { followed = normalizePrefs(await kv.get(PREFS_KEY(auth.githubId), 'json')).followedChannels; }
  catch { followed = []; }
  if (!followed.length) return { status: 200, body: { ok: true, items: [] } };

  const sinceSec = Math.floor(now() / 1000) - FOLLOWED_NEWS_WINDOW_DAYS * 86400;
  const { items } = await queryItems(env, { since: String(sinceSec), limit: SCAN_LIMIT });

  // Publication names the way the digest resolves them. A list that cannot load falls back to the source id, so
  // a name outage never empties the bell.
  let names = new Map();
  try {
    const loaded = await sourceList(env);
    for (const src of loaded?.sources ?? []) if (src?.id) names.set(src.id, src.name || src.id);
  } catch { names = new Map(); }

  return { status: 200, body: { ok: true, items: followedNewsRows(items, followed, { names, sinceSec }) } };
}

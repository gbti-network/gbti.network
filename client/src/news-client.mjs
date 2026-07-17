// SOW-043: the client/extension read path for the members-only news proxy. GETs the signup Worker's
// /membership/news (+ /membership/news-categories), which is effective-paid gated and holds the NEWS_API_KEY (the
// key never reaches us). Node-free (fetch only), so it runs in the npm host + the MV3 worker; unit-tested with a
// fake fetch.

export class NewsClientError extends Error {}

const base = (signupBase) => String(signupBase || '').replace(/\/$/, '');
const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export async function workerGetNews({ token, signupBase, fetch = globalThis.fetch, category, since, limit } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/news${qs({ category, since, limit })}`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news requires sign-in');
  if (!res.ok) throw new NewsClientError('news unavailable (' + res.status + ')');
  const data = await res.json();
  return { items: Array.isArray(data?.items) ? data.items : [], updatedAt: data?.updatedAt ?? null };
}

export async function workerGetNewsCategories({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/news-categories`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news requires sign-in');
  if (!res.ok) throw new NewsClientError('news categories unavailable (' + res.status + ')');
  const data = await res.json();
  return { categories: Array.isArray(data?.categories) ? data.categories : [] };
}

// SOW-046 E: the followable news channels (sources) + the member's prefs (categories + followed channels).
export async function workerGetNewsSources({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/news-sources`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news requires sign-in');
  if (!res.ok) throw new NewsClientError('news sources unavailable (' + res.status + ')');
  const data = await res.json();
  return { sources: Array.isArray(data?.sources) ? data.sources : [] };
}

export async function workerGetPrefs({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/prefs`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('prefs require sign-in');
  if (!res.ok) throw new NewsClientError('prefs unavailable (' + res.status + ')');
  const data = await res.json();
  return data?.prefs ?? { categories: [], followedChannels: [] };
}

export async function workerSetPrefs({ token, signupBase, fetch = globalThis.fetch, patch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/prefs`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(patch || {}) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('prefs require sign-in');
  if (!res.ok) throw new NewsClientError('could not save prefs (' + res.status + ')');
  const data = await res.json();
  return data?.prefs ?? { categories: [], followedChannels: [] };
}

// SOW-046 C: curator-only "Add to Discord" publish. The Worker re-checks the curator capability server-side, holds
// the Discord bot token, and resolves the CANONICAL item from the upstream feed itself, so we POST only the item's
// IDENTITY (guid + a source hint to widen the server-side lookup) — never the display metadata (the Worker does not
// trust client-supplied title/link/category). The 403 path is normal for a non-curator, so we surface it clearly.
export async function workerPublishNews({ token, signupBase, fetch = globalThis.fetch, item } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const guid = String(item?.guid || '').trim();
  if (!guid) throw new NewsClientError('a news item is required');
  const payload = { guid, source: item?.source ?? '' };
  const res = await fetch(`${base(signupBase)}/membership/news-publish`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('publishing to Discord requires a news curator role');
  if (!res.ok) throw new NewsClientError('could not publish to Discord (' + res.status + ')');
  return res.json();
}

// SOW-046 D: tell the Worker a member started discussing a news item, so it appends a one-time "members are
// discussing this" notice to the curator-posted Discord message. Best-effort + idempotent server-side; a non-paid
// caller or an item that was never posted is a clean no-op (reflected:false), never surfaced as a hard error.
export async function workerNewsDiscussed({ token, signupBase, fetch = globalThis.fetch, guid } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const g = String(guid || '').trim();
  if (!g) throw new NewsClientError('a news item is required');
  const res = await fetch(`${base(signupBase)}/membership/news-discussed`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ guid: g }) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news discussion requires a paid membership');
  if (!res.ok) throw new NewsClientError('could not reflect the discussion (' + res.status + ')');
  return res.json();
}

// SOW-111: the news detail-open engagement beacon. Best-effort: a caller outside the configured tier, a
// disabled config, or an unposted/unmapped item is a clean { counted:false } no-op server-side; only auth and
// transport failures throw (the reader swallows them; an open must never surface an error).
export async function workerNewsOpened({ token, signupBase, fetch = globalThis.fetch, guid, source } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const g = String(guid || '').trim();
  if (!g) throw new NewsClientError('a news item is required');
  const res = await fetch(`${base(signupBase)}/membership/news-opened`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ guid: g, ...(source ? { source: String(source) } : {}) }) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('not signed in');
  if (!res.ok) throw new NewsClientError('could not record the open (' + res.status + ')');
  return res.json();
}

/** SOW-126: the member-content detail-open engagement beacon. Best-effort tally; the reconcile promotes a
 *  `popular` item past the threshold. Mirrors workerNewsOpened. */
export async function workerContentOpened({ token, signupBase, fetch = globalThis.fetch, type, slug } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const t = String(type || '').trim();
  const s = String(slug || '').trim();
  if (!t || !s) throw new NewsClientError('a content type + slug is required');
  const res = await fetch(`${base(signupBase)}/membership/content-opened`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: t, slug: s }) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('not signed in');
  if (!res.ok) throw new NewsClientError('could not record the open (' + res.status + ')');
  return res.json();
}

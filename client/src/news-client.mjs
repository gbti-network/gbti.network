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
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news requires a paid membership');
  if (!res.ok) throw new NewsClientError('news unavailable (' + res.status + ')');
  const data = await res.json();
  return { items: Array.isArray(data?.items) ? data.items : [], updatedAt: data?.updatedAt ?? null };
}

export async function workerGetNewsCategories({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/news-categories`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news requires a paid membership');
  if (!res.ok) throw new NewsClientError('news categories unavailable (' + res.status + ')');
  const data = await res.json();
  return { categories: Array.isArray(data?.categories) ? data.categories : [] };
}

// SOW-046 E: the followable news channels (sources) + the member's prefs (categories + followed channels).
export async function workerGetNewsSources({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/news-sources`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('news requires a paid membership');
  if (!res.ok) throw new NewsClientError('news sources unavailable (' + res.status + ')');
  const data = await res.json();
  return { sources: Array.isArray(data?.sources) ? data.sources : [] };
}

export async function workerGetPrefs({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/prefs`, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('prefs require a paid membership');
  if (!res.ok) throw new NewsClientError('prefs unavailable (' + res.status + ')');
  const data = await res.json();
  return data?.prefs ?? { categories: [], followedChannels: [] };
}

export async function workerSetPrefs({ token, signupBase, fetch = globalThis.fetch, patch } = {}) {
  if (!token || !signupBase) throw new NewsClientError('not signed in');
  const res = await fetch(`${base(signupBase)}/membership/prefs`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(patch || {}) });
  if (res.status === 401 || res.status === 403) throw new NewsClientError('prefs require a paid membership');
  if (!res.ok) throw new NewsClientError('could not save prefs (' + res.status + ')');
  const data = await res.json();
  return data?.prefs ?? { categories: [], followedChannels: [] };
}

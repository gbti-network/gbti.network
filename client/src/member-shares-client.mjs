// 2026-10-22: the community Shares stream through the signup Worker's GET /membership/shares, the route the website
// has used since 2026-09-10. The extension listed shares itself, one GitHub read per file after a whole-repo tree
// call, which took 8 to 10 seconds; the Worker reads them in one GitHub call, decides the caller's tier, and caches
// the list. Thin, injectable-fetch wrapper that sends the GitHub bearer token, like member-bell-seen-client.mjs.
// Unit-tested with a fake fetch (no network).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class SharesClientError extends Error {}

/** One page of the stream: { items, nextBefore }. `before` is the id cursor the previous page answered. Throws on
 *  anything but a 2xx with an items array, so the caller can fall back rather than show a partial answer. */
export async function workerListShares({ token, signupBase, fetch = globalThis.fetch, limit, before } = {}) {
  if (!token || !signupBase) throw new SharesClientError('not signed in');
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', String(limit));
  if (before) qs.set('before', String(before));
  const q = qs.toString();
  const res = await fetch(`${trimBase(signupBase)}/membership/shares${q ? `?${q}` : ''}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res || !res.ok) throw new SharesClientError(`shares unavailable (${res ? res.status : 'no response'})`);
  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!Array.isArray(data?.items)) throw new SharesClientError('shares answer had no items');
  return { items: data.items, nextBefore: typeof data.nextBefore === 'string' && data.nextBefore ? data.nextBefore : null };
}

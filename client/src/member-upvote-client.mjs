// SOW-057: the client write path for a member UPVOTE against the deletable edge store, via the signup Worker's
// POST /membership/upvote. Mirrors member-follows-client.mjs: a thin, injectable fetch wrapper that sends the
// GitHub bearer token. Upvoting is effective-paid only (the Worker is the authority, fail-closed); two distinct
// non-author upvotes enqueue the share for syndication (SOW-058). An upvote is NOT a PR.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class UpvoteClientError extends Error {}

/** Toggle the caller's upvote on a share. Returns { ok, upvoted, upvoteCount, enqueued }. */
export async function upvote({ type = 'share', slug, on = true, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new UpvoteClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/upvote', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, slug, on }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new UpvoteClientError(data?.message || data?.error || `upvote request failed (${res.status})`);
  return data;
}

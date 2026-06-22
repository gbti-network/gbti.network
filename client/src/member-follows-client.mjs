// SOW-023: the client write path for the member FOLLOW graph (subscriptions) against the deletable edge store,
// via the signup Worker's GET/POST /membership/follows. Mirrors member-activity-client.mjs: thin, injectable
// fetch wrappers that send the GitHub bearer token. Unit-tested with a fake fetch (no network).
//
// SOW-060: following is a FREE-tier perk (any signed-in, non-banned member; read + write); the Worker is the
// authority (fail-closed). A follow is NOT a PR: it writes the private, erasable edge store, never the public repo.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class FollowsClientError extends Error {}

async function call(method, body, { token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new FollowsClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/follows', {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new FollowsClientError(data?.message || data?.error || `follows request failed (${res.status})`);
  return data;
}

/** The caller's follow list ({ following: [{ username, addedAt }] }). */
export async function getFollows(opts) {
  return call('GET', null, opts);
}

/** Follow (on:true) or unfollow (on:false) a member by username. */
export async function setFollow({ username, on = true, ...opts }) {
  return call('POST', { username, on }, opts);
}

// Owner, 2026-09-29: what the member has read in the notification bells, kept on their account through the signup
// Worker's GET /membership/notifications and POST /membership/notifications/seen { bellSeen } (see
// membership/bell-seen.mjs). Thin, injectable-fetch wrappers that send the GitHub bearer token, like
// member-follows-client.mjs. Unit-tested with a fake fetch (no network).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class BellSeenClientError extends Error {}

async function call(path, method, body, { token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new BellSeenClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new BellSeenClientError(data?.message || data?.error || `read state request failed (${res.status})`);
  return data;
}

/** The account's read record: { bellSeen }. */
export async function getBellSeen(opts) {
  const data = await call('/membership/notifications', 'GET', null, opts);
  return { bellSeen: data?.bellSeen && typeof data.bellSeen === 'object' ? data.bellSeen : { groups: {} } };
}

/** Merge a read record into the account's; answers the merged { bellSeen }. */
export async function markBellSeen(bellSeen, opts) {
  const data = await call('/membership/notifications/seen', 'POST', { bellSeen }, opts);
  return { bellSeen: data?.bellSeen && typeof data.bellSeen === 'object' ? data.bellSeen : { groups: {} } };
}

// SOW-038 P2: the client read path for the admin per-member Stripe-status map, via the signup Worker's
// GET /membership/admin/statuses. Mirrors member-follows-client.mjs: a thin, injectable-fetch wrapper that sends
// the GitHub bearer token. The Worker is the authority (admin-gated, fail-closed); this just relays. Unit-tested
// with a fake fetch (no network).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class AdminClientError extends Error {}

/** The { github_id -> stripe status } map for the superadmin dashboard. Admin-only (the Worker enforces it). */
export async function getRosterStatuses({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/admin/statuses', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `admin statuses request failed (${res.status})`);
  return data?.statuses ?? {};
}

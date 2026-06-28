// SOW-083 P2: the client READ path for a member's own EARNINGS ledger, via the signup Worker's GET
// /membership/earnings. Mirrors member-activity-client.mjs: a thin, injectable-fetch wrapper that sends the GitHub
// bearer token. The Worker serves earnings:<github_id> (written by the offline payout job); a non-earning member
// gets an empty zeroed ledger. Unit-tested with a fake fetch (no network).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class EarningsClientError extends Error {}

/**
 * The caller's own earnings ledger:
 *   { v, recipient, entries: [{ from, role, amount, currency, invoice, state }], totals: { held, payable, paid, lifetime } }
 */
export async function getEarnings({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new EarningsClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/earnings', {
    headers: { Authorization: 'Bearer ' + token },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new EarningsClientError(data?.message || data?.error || `earnings request failed (${res.status})`);
  return data;
}

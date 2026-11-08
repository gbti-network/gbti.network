// sow-494: the bearer transport for Community, the MCP's way to the signup Worker's /membership/community/* and
// /membership/admin/community routes. A thin, injectable-fetch wrapper that sends the GitHub token; the Worker is the
// authority on every call (members only, each entry shared with all members or chosen ones, superadmin ops re-checked).
// Unit-tested with a fake fetch, no network.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class CommunityClientError extends Error {
  constructor(status, code, message) {
    super(message || code || `request failed (${status})`);
    this.name = 'CommunityClientError';
    this.status = status;
    this.code = code || '';
  }
}

/**
 * One call. `path` is the route path with its query string, `body` a JSON body for a POST. Returns the parsed JSON,
 * or throws CommunityClientError carrying the HTTP status, the Worker's error name and its message.
 */
export async function communityRequest({ token, signupBase, path, method = 'GET', body, fetch = globalThis.fetch }) {
  if (!token) throw new CommunityClientError(401, 'unauthorized', 'Sign in first (call login).');
  if (!signupBase) throw new CommunityClientError(0, 'misconfigured', 'The network address is not configured.');
  let res;
  try {
    res = await fetch(trimBase(signupBase) + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new CommunityClientError(0, 'unavailable', 'The network could not be reached. Try again in a moment.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new CommunityClientError(res.status, data?.error, data?.message || data?.error || `request failed (${res.status})`);
  return data ?? {};
}

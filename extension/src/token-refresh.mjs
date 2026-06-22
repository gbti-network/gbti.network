// SOW: pure helpers for the background's PROACTIVE GitHub-App-token refresh. GitHub App user tokens expire (~8h)
// and the device flow hands back a refresh_token (~6mo). Instead of letting the access token die (which forces a
// re-sign-in), the background refreshes it via the Worker's /auth/refresh just before it expires. These helpers
// are pure (no chrome / no fetch) so the decision + the store patch are unit-tested in node; the IO lives in
// background.mjs. The reader's onAuthError (clear-session -> re-sign-in splash) stays the fallback for when the
// refresh token ITSELF is dead.

const SKEW_MS = 60_000; // refresh a minute early so a request never races the expiry boundary into a 401

/**
 * Should we refresh the access token right now? Only when we actually CAN (a token + a rotating refresh token + a
 * known expiry) and we are at/within SKEW of expiry. A session with no stored expiry/refresh token (a pre-refresh
 * login, or a non-expiring classic token) returns false — it just rides until a 401 forces re-auth.
 * @param {{ githubToken?:string, githubRefreshToken?:string, githubTokenExpiresAt?:number }} s
 */
export function needsRefresh(s = {}, now = Date.now(), skewMs = SKEW_MS) {
  if (!s.githubToken || !s.githubRefreshToken || !s.githubTokenExpiresAt) return false;
  return now >= Number(s.githubTokenExpiresAt) - skewMs;
}

/**
 * The store patch from a successful Worker /auth/refresh response. The refresh token ROTATES on each use, so we
 * persist the new one (falling back to the old if GitHub omitted it). Returns null for an unusable response so the
 * caller leaves the session untouched (and the stale token then trips the 401 -> re-auth fallback).
 * @param {{ access_token?:string, refresh_token?:string, expires_in?:number }} resp
 */
export function refreshPatch(resp, oldRefreshToken, now = Date.now()) {
  if (!resp || !resp.access_token) return null;
  return {
    githubToken: resp.access_token,
    githubRefreshToken: resp.refresh_token || oldRefreshToken || null,
    githubTokenExpiresAt: now + (Number(resp.expires_in) || 0) * 1000,
  };
}

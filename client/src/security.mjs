// Always-on local server hardening primitives (SOW-006, HARD REQUIREMENT). The local client runs a
// persistent HTTP/SSE server on localhost that holds a real GitHub token and can open PRs, so it is a
// genuine local attack surface (other local processes; malicious web pages hitting localhost via CSRF or
// DNS-rebinding). These pure functions are the gate. They take raw header values so they are unit-testable
// without a live server; server.mjs wires them onto every request. Mirror of the gate's one rule:
// the always-on server NEVER accepts an unauthenticated request.

import crypto from 'node:crypto';

/** Generate the per-install bearer token (shown in Settings; pasted into agent configs). */
export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Constant-time string compare (no early-exit length leak beyond length itself). */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Pull a bearer token out of an Authorization header value, or null. */
export function bearerFrom(authHeader) {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(authHeader).trim());
  return m ? m[1].trim() : null;
}

/**
 * True only when the request carries the correct per-install token. Fail closed if no token configured.
 * The Authorization header is preferred; queryToken is a fallback used ONLY for the initial browser
 * navigation to the served UI (the page immediately strips it from the URL and uses the header after).
 */
export function isAuthorized(headers = {}, token, queryToken) {
  if (!token) return false; // no configured token => nothing is authorized
  const provided = bearerFrom(headers['authorization'] ?? headers['Authorization']) ?? (queryToken || null);
  return provided != null && safeEqual(provided, token);
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Strip a trailing :port from a Host header, handling bare ipv6 ([::1]:port). */
export function hostnameOf(hostHeader) {
  if (!hostHeader) return null;
  const s = String(hostHeader).trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    return end > 0 ? s.slice(0, end + 1) : s;
  }
  const idx = s.lastIndexOf(':');
  return idx > 0 ? s.slice(0, idx) : s;
}

/**
 * Defeat DNS-rebinding: the Host header MUST be a loopback host. A rebinding attack reaches us with the
 * attacker's hostname (e.g. evil.com rebound to 127.0.0.1) in Host, which this rejects. Fail closed on a
 * missing Host.
 */
export function isHostAllowed(hostHeader) {
  const h = hostnameOf(hostHeader);
  return h != null && LOCAL_HOSTS.has(h);
}

/**
 * When an Origin header is present (a browser request), it MUST be a loopback origin. A request with no
 * Origin (curl, an agent, the MCP client) is allowed through this check; the bearer token is still the
 * real gate. We do not pin the Origin port: a user may front the server with a local proxy.
 */
export function isOriginAllowed(originHeader) {
  if (!originHeader) return true;
  let url;
  try {
    url = new URL(String(originHeader));
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(url.hostname);
}

/**
 * The combined per-request gate. Order: Host (anti-rebinding), Origin (anti-CSRF for browsers), then the
 * bearer token. Returns { ok } or { ok:false, reason } where reason is bad-host | bad-origin | unauthorized.
 */
export function requestAllowed({ headers = {}, token, queryToken }) {
  if (!isHostAllowed(headers['host'] ?? headers['Host'])) return { ok: false, reason: 'bad-host' };
  if (!isOriginAllowed(headers['origin'] ?? headers['Origin'])) return { ok: false, reason: 'bad-origin' };
  if (!isAuthorized(headers, token, queryToken)) return { ok: false, reason: 'unauthorized' };
  return { ok: true };
}

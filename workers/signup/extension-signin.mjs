// sow-393: the extension signs in THROUGH THE WEBSITE, with no device code (owner, 2026-09-24).
//
// The extension keeps exactly the credential it always had, a GitHub App user token with its refresh token, because
// every Worker route verifies a bearer by asking GitHub who it belongs to and the extension also reads GitHub with it.
// Only HOW it gets that token changes: a normal web redirect through this Worker instead of a code the member copies.
//
//   1. GET  /auth/extension/start?challenge=C&redirect=R[&login=L]   The extension opens this in Chrome's own sign-in
//                                               window (chrome.identity.launchWebAuthFlow). C is a PKCE S256 challenge
//                                               whose verifier never leaves the extension; R is the extension's
//                                               https://<id>.chromiumapp.org/signed-in address, and only allow-listed
//                                               extension ids are accepted. Redirects to the GitHub App's authorize page.
//   2. GET  /auth/extension/callback            GitHub returns here. The code is exchanged with the App secret, the
//                                               token set is parked in KV under a random one-time HANDOFF code for
//                                               120s, the website session is minted (one sign-in, both surfaces), and
//                                               the window is sent to R#code=HANDOFF.
//   3. POST /auth/extension/claim {code, verifier}   The extension claims the tokens with its verifier. One use.
//
// WHY THE CODE ONLY EVER GOES TO A chromiumapp.org ADDRESS. Chrome intercepts that address and hands it to the
// extension that opened the sign-in window; the address never resolves, so no web page can read it (a fragment is never
// sent anywhere, and a cross-origin error page reveals nothing to its opener). The verifier alone does NOT protect the
// code: anyone can start a flow with a challenge of their own and so hold its verifier. The first build sent the code to
// a gbti.network page, where any script on the site could have read it and claimed a member's token. Two reviews caught
// that and what follows before it shipped; test/extension-signin.test.mjs pins each defence.
//
// WHY GITHUB ALWAYS SHOWS ITS ACCOUNT PICKER (prompt=select_account). For a member who already authorized the App,
// GitHub would otherwise send the flow straight back with no click. Then anyone could start one in a member's browser
// and have it finish unseen, leaving the code in an address an installed extension with the tabs permission can read,
// or that a member could be talked into pasting. A required click means no flow completes without the member's say.
// An installed extension that can read tab addresses remains a residual: it still needs the member to click through a
// GitHub page they did not ask for, and such an extension can already read far more of their browsing.
//
// WHY THE NONCE COOKIE IS NAMED PER SIGN-IN AND __Host-. The name carries the start of the challenge, so a page that
// sends a member's browser to /start cannot overwrite the cookie of a sign-in already in flight, and the __Host- prefix
// means no sibling gbti.network subdomain can plant one (which would let it finish a flow of its own in the member's
// browser and sign the WEBSITE in as its account).
import { signSession, sessionCookieHeader, timingSafeEqual } from './session.mjs';
import { csrfCookieHeader, generateCsrfToken } from './csrf.mjs';
import { rateLimit } from './abuse.mjs';
import { githubAuthorizeUrl, githubExchangeAppCode, githubFetchUser } from './oauth.mjs';
import { wlog } from './wlog.mjs';

export const EXT_STATE_KIND = 'ext-signin';
export const EXT_HANDOFF_PREFIX = 'extauth:';
export const EXT_HANDOFF_TTL_SECONDS = 120; // KV's floor is 60; long enough for a slow tab, short enough to be moot
// The Chrome Web Store id of the GBTI Network extension. EXTENSION_IDS (a comma list in wrangler vars) overrides it,
// for example to add a developer's unpacked build, whose id Chrome derives from its folder.
export const STORE_EXTENSION_ID = 'iffjdmifgnjgkdjoodapjciddibmifka';
export const EXT_NONCE_PREFIX = '__Host-gbti_ext_'; // + the challenge's first 16 characters: one cookie per sign-in
export const nonceCookieName = (challenge) => `${EXT_NONCE_PREFIX}${String(challenge).slice(0, 16)}`;

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;       // base64url(SHA-256), unpadded
const REDIRECT_RE = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/signed-in$/; // chrome.identity.getRedirectURL('signed-in')
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;  // RFC 7636 section 4.1
const HANDOFF_RE = /^[A-Za-z0-9_-]{43}$/;         // 32 random bytes, base64url
const NO_STORE = { 'Cache-Control': 'no-store' };

const log = (event, data) => wlog('ext-signin', event, data);

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export async function s256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(verifier)));
  return b64url(new Uint8Array(digest));
}

/** A fresh one-time handoff code: 32 random bytes, base64url. */
export function newHandoffCode() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64url(b);
}

function readCookie(header, name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** The extension ids allowed to receive a sign-in, from EXTENSION_IDS or the store id. */
export function allowedExtensionIds(env) {
  const list = String(env.EXTENSION_IDS ?? '').split(',').map((x) => x.trim()).filter((x) => /^[a-p]{32}$/.test(x));
  return list.length ? list : [STORE_EXTENSION_ID];
}

/** The extension id in an allowed redirect, or null. */
export function allowedRedirectId(redirect, env) {
  const m = REDIRECT_RE.exec(String(redirect ?? ''));
  return m && allowedExtensionIds(env).includes(m[1]) ? m[1] : null;
}

const toExtension = (id, fragment) => `https://${id}.chromiumapp.org/signed-in#${fragment}`;

const nonceCookie = (challenge, value, maxAge) => `${nonceCookieName(challenge)}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const configured = (env) => Boolean(env.GITHUB_PUBLISHER_CLIENT_ID && env.GITHUB_PUBLISHER_CLIENT_SECRET && env.SESSION_SECRET && env.SIGNUP_KV);
const callbackUrl = (env) => `${env.PUBLIC_BASE_URL}/auth/extension/callback`;

/**
 * A failed sign-in goes back to the extension with a coarse reason its sign-in screen explains. Deliberately coarse,
 * like the website callback's single bad_oauth_state: a caller must not learn which check it tripped. The log is where
 * the reasons separate. The nonce cookie is left alone here, so a page that sends a member's browser to this callback
 * cannot cancel a sign-in they have in progress; it expires on its own.
 */
const failTo = (id, h, reason) => h.redirect(toExtension(id, `error=${reason}`), { 'Referrer-Policy': 'no-referrer', ...NO_STORE });

/** With no usable state there is no extension to send the member back to, so the window says so itself. */
const deadEnd = () => new Response('<!doctype html><meta charset="utf-8"><title>Sign-in expired</title><p>This sign-in expired or was already used. Close this window and sign in again from the extension.</p>', {
  status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer', ...NO_STORE },
});

/** GET /auth/extension/start?challenge=… */
export async function handleExtensionStart(request, env, h) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get('challenge') || '';
  if (!CHALLENGE_RE.test(challenge)) return h.json({ error: 'bad_challenge' }, 400, NO_STORE);
  const rid = allowedRedirectId(url.searchParams.get('redirect'), env);
  if (!rid) { log('start rejected', { reason: 'redirect_not_allowed' }); return h.json({ error: 'bad_redirect' }, 400, NO_STORE); }
  const loginParam = url.searchParams.get('login') || '';
  const login = LOGIN_RE.test(loginParam) ? loginParam : '';
  if (!configured(env)) return h.json({ error: 'not_configured' }, 501, NO_STORE);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 20, windowSeconds: 600, prefix: 'rl:ext-signin-start:' });
  if (!rl.allowed) { log('start rejected', { reason: 'rate_limited' }); return h.json({ error: 'rate_limited' }, 429, NO_STORE); }
  // The nonce binds the state to THIS browser (a state carried into another browser has no matching cookie); the jti
  // makes it single-use (the same constructions the website sign-in uses, consumed by the same consumeStateJti).
  const nonce = crypto.randomUUID();
  const jti = crypto.randomUUID();
  const state = await h.packState({ kind: EXT_STATE_KIND, challenge, nonce, jti, rid }, env);
  // scope null: a GitHub App takes its permissions from the App, and asking for none keeps the token identity-only.
  // login: when the extension already knows the member's website account ("Continue as"), GitHub suggests that account.
  // prompt=select_account: GitHub always shows its account picker, so no sign-in completes without a click (above).
  const authorize = githubAuthorizeUrl({ clientId: env.GITHUB_PUBLISHER_CLIENT_ID, redirectUri: callbackUrl(env), state, scope: null });
  const location = `${authorize}&prompt=select_account${login ? `&login=${encodeURIComponent(login)}` : ''}`;
  log('start', {});
  return h.redirect(location, { 'Set-Cookie': nonceCookie(challenge, nonce, 600), 'Referrer-Policy': 'no-referrer', ...NO_STORE });
}

/** GET /auth/extension/callback */
export async function handleExtensionCallback(request, env, h, fetchImpl = globalThis.fetch) {
  const url = new URL(request.url);
  const state = await h.unpackState(url.searchParams.get('state'), env);
  // The extension id is re-checked against the allow-list, not just trusted from the signed state, so removing an id
  // stops sign-ins to it at once.
  const rid = state && state.kind === EXT_STATE_KIND && CHALLENGE_RE.test(String(state.challenge || '')) ? allowedRedirectId(`https://${state.rid}.chromiumapp.org/signed-in`, env) : null;
  if (!rid) { log('callback rejected', { reason: 'bad_state' }); return deadEnd(); }
  const code = url.searchParams.get('code');
  // No code is the member declining on GitHub's page, which is a choice, not a failure.
  if (!code) { log('callback rejected', { reason: 'no_code' }); return failTo(rid, h, 'declined'); }
  const cookieNonce = readCookie(request.headers.get('Cookie'), nonceCookieName(state.challenge));
  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) {
    log('callback rejected', { reason: !cookieNonce ? 'no_cookie_nonce' : 'nonce_mismatch' });
    return failTo(rid, h, 'expired');
  }
  if (!configured(env)) return failTo(rid, h, 'failed');
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 20, windowSeconds: 600, prefix: 'rl:ext-signin-callback:' });
  if (!rl.allowed) { log('callback rejected', { reason: 'rate_limited' }); return failTo(rid, h, 'failed'); }
  if (!(await h.consumeStateJti(env.SIGNUP_KV, state.jti))) { log('callback rejected', { reason: 'state_not_consumed' }); return failTo(rid, h, 'expired'); }

  let tokens;
  let user;
  try {
    tokens = await githubExchangeAppCode({ clientId: env.GITHUB_PUBLISHER_CLIENT_ID, clientSecret: env.GITHUB_PUBLISHER_CLIENT_SECRET, code, redirectUri: callbackUrl(env) }, fetchImpl);
    user = await githubFetchUser(tokens.accessToken, fetchImpl);
  } catch (err) {
    log('callback failed', { step: tokens ? 'github_fetch_user' : 'github_exchange_code', status: err?.status ?? null });
    return failTo(rid, h, 'failed');
  }

  const handoff = newHandoffCode();
  try {
    await env.SIGNUP_KV.put(`${EXT_HANDOFF_PREFIX}${handoff}`, JSON.stringify({
      challenge: state.challenge,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      githubId: user.githubId,
      githubLogin: user.githubLogin,
    }), { expirationTtl: EXT_HANDOFF_TTL_SECONDS });
  } catch (err) {
    log('callback failed', { step: 'kv_put', message: err?.message ?? null });
    return failTo(rid, h, 'failed');
  }

  // One sign-in, both surfaces: the website session is minted here, as /auth/session-from-token does for a device
  // sign-in. Chrome's sign-in window shares the browser's cookies, so gbti.network is signed in too.
  const session = await signSession({ githubId: user.githubId, githubLogin: user.githubLogin }, env.SESSION_SECRET);
  log('complete', { githubId: user.githubId });
  return h.redirect(toExtension(rid, `code=${handoff}`), { 'Referrer-Policy': 'no-referrer', ...NO_STORE }, [
    sessionCookieHeader(session),
    csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN }),
    nonceCookie(state.challenge, '', 0),
  ]);
}

/**
 * POST /auth/extension/claim {code, verifier}. Called only by the extension's background worker, which is not bound
 * by CORS; the response carries NO CORS headers on purpose, so a web page could not read it even holding both halves.
 * A wrong verifier does not burn the record (only the holder of the handoff code could try, and it expires in 120s);
 * a match deletes it, so it claims once.
 */
export async function handleExtensionClaim(request, env, h) {
  if (request.method.toUpperCase() !== 'POST') return h.json({ error: 'method_not_allowed' }, 405, NO_STORE);
  if (!configured(env)) return h.json({ error: 'not_configured' }, 501, NO_STORE);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 30, windowSeconds: 600, prefix: 'rl:ext-signin-claim:' });
  if (!rl.allowed) return h.json({ error: 'rate_limited' }, 429, NO_STORE);
  let body;
  try { body = await request.json(); } catch { return h.json({ error: 'invalid' }, 400, NO_STORE); }
  const code = typeof body?.code === 'string' ? body.code : '';
  const verifier = typeof body?.verifier === 'string' ? body.verifier : '';
  if (!HANDOFF_RE.test(code) || !VERIFIER_RE.test(verifier)) return h.json({ error: 'invalid' }, 400, NO_STORE);
  const key = `${EXT_HANDOFF_PREFIX}${code}`;
  let rec = null;
  try { rec = JSON.parse((await env.SIGNUP_KV.get(key)) || 'null'); } catch { rec = null; }
  if (!rec || typeof rec.challenge !== 'string') { log('claim rejected', { reason: 'no_record' }); return h.json({ error: 'invalid' }, 400, NO_STORE); }
  if (!timingSafeEqual(await s256(verifier), rec.challenge)) { log('claim rejected', { reason: 'verifier_mismatch' }); return h.json({ error: 'invalid' }, 400, NO_STORE); }
  try { await env.SIGNUP_KV.delete(key); } catch { /* it expires in 120s regardless */ }
  log('claimed', { githubId: rec.githubId });
  return h.json({
    access_token: rec.accessToken,
    refresh_token: rec.refreshToken,
    expires_in: rec.expiresIn,
    refresh_token_expires_in: rec.refreshTokenExpiresIn,
    github_id: rec.githubId,
    login: rec.githubLogin,
  }, 200, NO_STORE);
}

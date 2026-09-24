// sow-393: the extension signs in through the website, with no device code (owner, 2026-09-24). The pure half: PKCE,
// the start URL, and reading what Chrome's sign-in window hands back. DOM-free and chrome-free, so node tests drive it.
//
// HOW IT RUNS. The sign-in page opens Chrome's own sign-in window (chrome.identity.launchWebAuthFlow) at the Worker's
// start URL. The Worker sends it to GitHub, GitHub sends it back, and the Worker ends it at this extension's redirect
// URL, https://<extension id>.chromiumapp.org/signed-in#code=<one-time code>. Chrome intercepts that address and hands
// it to the extension that opened the window; it never resolves, so no web page can read the code. The page then asks
// the background to claim the tokens with the PKCE verifier it kept. (The Worker also makes GitHub show its account
// picker every time, so a flow someone else starts cannot finish without the member's click; see extension-signin.mjs.)
//
// WHY NOT A NORMAL TAB. The first build landed the code on a gbti.network page in an ordinary tab. A review found that
// anyone could start that flow with a challenge of their own, and any script on a gbti.network page, or any extension
// that can read tab addresses, could then read the code and claim a member's token with their own verifier. The
// verifier only proves who STARTED a flow, so the code must never reach a place a page can read.

export const SIGNUP_BASE = 'https://signup.gbti.network';
export const REDIRECT_PATH = 'signed-in'; // chrome.identity.getRedirectURL(REDIRECT_PATH)
const CODE_RE = /^#code=([A-Za-z0-9_-]{43})$/;
const ERROR_RE = /^#error=([a-z]{1,20})$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh PKCE pair: a 43-character verifier (32 random bytes) and its S256 challenge. */
export async function makePkce(cryptoImpl = globalThis.crypto) {
  const raw = new Uint8Array(32);
  cryptoImpl.getRandomValues(raw);
  const verifier = b64url(raw);
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** Where the sign-in window starts: the Worker, which sends it on to GitHub. `login` suggests the account to GitHub. */
export function startUrl({ challenge, redirect, login }, base = SIGNUP_BASE) {
  const u = new URL(`${base}/auth/extension/start`);
  u.searchParams.set('challenge', challenge);
  u.searchParams.set('redirect', redirect);
  if (login && LOGIN_RE.test(login)) u.searchParams.set('login', login);
  return u.toString();
}

/**
 * What the sign-in window handed back: { code } for a finished sign-in, { error } for one that did not, else null.
 * Only the exact redirect this extension asked for counts; its fragment carries the result.
 */
export function readRedirectResult(finalUrl, redirect) {
  let u;
  try { u = new URL(String(finalUrl)); } catch { return null; }
  if (`${u.origin}${u.pathname}` !== String(redirect) || u.search) return null;
  const c = CODE_RE.exec(u.hash);
  if (c) return { code: c[1] };
  const e = ERROR_RE.exec(u.hash);
  if (e) return { error: e[1] };
  return null;
}

/** Claim the tokens with the verifier. Resolves the Worker's token set, or throws. */
export async function claimTokens({ code, verifier }, fetchImpl = globalThis.fetch, base = SIGNUP_BASE) {
  const res = await fetchImpl(`${base}/auth/extension/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  });
  if (!res.ok) throw new Error(`claim failed: ${res.status}`);
  const body = await res.json();
  if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new Error('claim returned no token');
  return body;
}

/** Is this message from one of the extension's own pages (not a content script on a web page)? */
export function fromExtensionPage(sender, extensionOrigin) {
  const url = String(sender?.url ?? '');
  return Boolean(extensionOrigin) && url.startsWith(extensionOrigin);
}

/** A website session's login, if the status read says one exists; only a well-formed GitHub login is passed on. */
export function knownLoginFrom(statusBody) {
  const login = statusBody && typeof statusBody.login === 'string' ? statusBody.login : '';
  return LOGIN_RE.test(login) ? login : null;
}

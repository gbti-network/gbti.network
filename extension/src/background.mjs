// The MV3 background service worker (SOW-006 v2 P4). It holds the GitHub token (chrome.storage.local, NEVER
// exposed to the page), runs device-flow auth, and answers the content script's /api/* messages by running the
// dispatcher against the extension ctx. The page can never read the token: it only sends messages and gets
// back results. This is the privileged half of the extension client.

import { createExtStore } from './ext-store.mjs';
import { buildExtContext, UPSTREAM } from './ext-context.mjs';
import { dispatch, computeRole } from './ext-dispatch.mjs';
import { devlog } from './devlog.mjs';
import { createGithubReader } from '../../client/src/github-reader.mjs';
import { deviceFlowLogin } from '../../client/src/auth-device.mjs';
import { createRepoClient } from '../../client/src/github-repo.mjs';
import { resolveMembership } from '../../client/src/membership.mjs';
import { GITHUB_CLIENT_ID, activeClientId, activeScope } from '../../client/src/signup-base.mjs';
import { resolveOpenPage } from './open-page.mjs';
import { needsRefresh, refreshPatch } from './token-refresh.mjs';
import { claimHandoff, shouldOpenWelcome, createDispatchClient, withTimeout, seedOnUpdate } from './welcome-handoff.mjs'; // sow-387
import { loadProgress, WELCOME_SITE_URL } from '../../client-ui/src/onboarding-card-core.mjs'; // sow-387: DOM-free
import { claimTokens, knownLoginFrom, fromExtensionPage } from './web-signin.mjs'; // sow-393

// GITHUB_CLIENT_ID is the PUBLIC device-flow OAuth app client id, single-sourced in signup-base.mjs (device flow
// has no client secret, so it is safe to bundle). Baked into the extension at build time.

// SOW-011: the signup Worker that answers the membership-status oracle. In host_permissions so the worker can
// fetch it cross-origin (the token stays in the worker; only the derived status comes back).
const SIGNUP_BASE = 'https://signup.gbti.network';

let storePromise = null;
function getStore() {
  if (!storePromise) {
    storePromise = chrome.storage.local.get('gbti').then((d) =>
      createExtStore(d?.gbti ?? {}, (next) => chrome.storage.local.set({ gbti: next })),
    );
  }
  return storePromise;
}

// The device-code sign-in, kept as the "Use a code instead" fallback (sow-393). The website sign-in is the default.
async function handleLogin(store) {
  const { accessToken, refreshToken, expiresIn } = await deviceFlowLogin({
    // The extension bakes the GitHub App client (hosted mode) at build time and sends no scope: with no install
    // requested, the token identifies the member and can touch nothing else (sow-274 Part 4). The MV3 worker has
    // no process.env, so an unbaked bundle would fall back to the OAuth app, which asks for identity only too.
    clientId: activeClientId(),
    scope: activeScope(),
    onPrompt: ({ userCode, verificationUri }) => {
      // Surface the code to the page that started sign-in (the new-tab sign-in screen, sow-387). Do NOT auto-open the
      // verification tab here: the GitHub App device flow returns no verification_uri_complete, so an auto-opened
      // page cannot pre-fill the code anyway, and grabbing focus mid-flow is hostile. The page shows the code with a
      // Copy button + an "Open github.com/login/device" button the member clicks themselves. The device flow keeps
      // polling here.
      chrome.runtime.sendMessage({ type: 'login-prompt', userCode, verificationUri }).catch(() => {});
    },
  });
  return completeLogin(store, { accessToken, refreshToken, expiresIn });
}

// sow-393: the website sign-in. The sign-in page ran it in Chrome's own sign-in window (chrome.identity), which
// handed back a one-time code that only this extension can see; the page's PKCE verifier proves it started the
// flow. The Worker returns the same GitHub App token set the device flow produces.
async function handleWebLogin(store, { code, verifier } = {}) {
  const t = await claimTokens({ code, verifier });
  return completeLogin(store, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in });
}

// What every sign-in does once it holds a token, whichever way it got it: read who it belongs to, store it, and
// resolve the membership. sow-393 split it out of handleLogin so both sign-ins store exactly the same record.
async function completeLogin(store, { accessToken, refreshToken, expiresIn }) {
  const repo = createRepoClient({ token: accessToken, upstream: UPSTREAM });
  const u = await repo.getAuthUser();
  // SOW: persist the refresh token + access-token expiry so the background can refresh silently (GitHub App user
  // tokens expire ~8h). A classic OAuth token returns no refresh_token/expires_in -> these are null and the token
  // simply never refreshes (it does not expire). expiresIn is seconds; we store an absolute ms deadline.
  store.set({
    githubToken: accessToken,
    githubRefreshToken: refreshToken || null,
    githubTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    identity: { login: u.login, githubId: String(u.id), username: String(u.login).toLowerCase() },
  });

  // sow-274 Part 2: there is no publishing mode to decide at sign-in any more. SOW-157 probed the member's fork
  // and App install here and stored 'app' or 'hosted'; every member publishes through the network now, and a
  // stored value from before has nothing left that reads it, so nothing is probed and nothing is stored.

  // SOW-011: resolve + cache the effective membership so the in-page editor can show the "membership required
  // to publish" notice and block a trial publish. Best-effort: any failure leaves it 'unknown' (fails OPEN to
  // the gate). The reader reads the public house/*.yml overrides; the Worker supplies the Stripe-derived status.
  try {
    const reader = createGithubReader({ upstream: UPSTREAM, token: accessToken });
    const { stripeStatus, membership, couponUntil, paidTier } = await resolveMembership({ githubId: String(u.id), token: accessToken, signupBase: SIGNUP_BASE, readFile: (p) => reader.readFile(p) });
    store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null, paidTier: paidTier ?? 'none' }); // SOW-119 QA: drives the expiry countdown; sow-185: paidTier for the creator-tier UI + page signal
  } catch {
    // leave membership unset (treated as 'unknown')
  }
  // sow-158: the website session is minted from this fresh token too, but no longer here. sow-387 moved it into
  // afterSignIn, which runs after the sign-in page has its answer, so a slow Worker can never hold the sign-in screen,
  // and the welcome tab it may open waits for the cookie.
  return { ok: true, login: u.login };
}

// SOW: refresh the GitHub App access token via the Worker (which holds the App client secret; the extension only
// sends its rotating refresh_token). Returns the parsed response or throws. The token never goes to a page.
async function refreshViaWorker(refreshToken) {
  const res = await fetch(`${SIGNUP_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  return res.json();
}

// sow-158 auth bridge: mint the gbti.network httpOnly cookie session from this member's verified token, so ONE
// extension sign-in also signs them in on the website (WorkBench / News / account) with no separate web sign-in.
// Bearer-authenticated -> their OWN session (no new capability). Best-effort: a failure is non-fatal (web sign-in
// stays available). credentials:'include' so the browser stores the Set-Cookies in the shared cookie jar the
// gbti.network page reads. The token is sent to the SAME Worker that already holds it. sow-387: resolves true only
// when the Worker answered 2xx, and gives up after MINT_TIMEOUT_MS, so the welcome handoff can wait on it.
const MINT_TIMEOUT_MS = 8000;
async function mintWebSession(token) {
  if (!token) return false;
  try {
    const res = await fetch(`${SIGNUP_BASE}/auth/session-from-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout?.(MINT_TIMEOUT_MS),
    });
    return !!res?.ok;
  } catch { return false; /* non-fatal: the web can always sign in directly */ }
}

// Opportunistic mint: once per browser session, so an EXISTING signed-in member (who signed in before this shipped)
// gets a website session without re-signing-in. chrome.storage.session clears when the browser closes, so this
// re-mints roughly once per browser run (idempotent + rate-limited server-side).
async function maybeMintWebSession(store) {
  try {
    const token = store.get('githubToken');
    if (!token) return;
    const { webSessionMinted } = (await chrome.storage?.session?.get?.('webSessionMinted')) ?? {};
    if (webSessionMinted) return;
    await chrome.storage?.session?.set?.({ webSessionMinted: true });
    await mintWebSession(token);
  } catch { /* best-effort */ }
}

// sow-158: the sign-out counterpart of mintWebSession. When the member signs OUT of the extension, tell the Worker
// to expire the bridged website cookie session so ONE sign-out ends both surfaces. Bearer-gated server-side (clearing
// cookies is capability-free); credentials:'include' so the browser drops the Set-Cookie Max-Age=0 deletions. Pass
// the token BEFORE it is nulled locally. Best-effort: a failure just leaves the web cookie to its 30-day TTL / web
// Sign out, the prior v1 behavior.
async function clearWebSession(token) {
  if (!token) return;
  try {
    await fetch(`${SIGNUP_BASE}/auth/session-clear`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* non-fatal */ }
}

// Single-flight proactive refresh: when the access token is at/near expiry, swap in a fresh one BEFORE the request
// runs, so no read ever 401s on a merely-expired token. Concurrent api calls share ONE in-flight refresh (the
// refresh token rotates, so parallel refreshes would invalidate each other). A failed refresh is swallowed: the
// request proceeds with the stale token, and the reader's 401 -> onAuthError -> re-sign-in splash is the fallback.
let _refreshing = null;
async function ensureFreshToken(store) {
  const state = { githubToken: store.get('githubToken'), githubRefreshToken: store.get('githubRefreshToken'), githubTokenExpiresAt: store.get('githubTokenExpiresAt') };
  if (!needsRefresh(state)) return;
  if (!_refreshing) {
    const old = state.githubRefreshToken;
    _refreshing = (async () => {
      try {
        const patch = refreshPatch(await refreshViaWorker(old), old);
        if (patch) store.set(patch);
      } catch { /* leave the session as-is; a 401 then trips the re-auth fallback */ }
      finally { _refreshing = null; }
    })();
  }
  return _refreshing;
}

// SOW-026: the toolbar icon has NO default_popup, so clicking it fires this handler instead of opening a popup
// (a popup closes the instant it loses focus, which discarded the device-flow code the moment the member tabbed to
// GitHub). sow-387: it opens the new tab, which is the extension's one sign-in screen when signed out and the feed
// when signed in. The separate toolbar sign-in page (onboarding.html) is retired.
chrome.action?.onClicked?.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') }).catch(() => {});
});

// sow-387: existing members are seeded when the extension updates, so the release that adds the welcome handoff
// never counts their next re-sign-in as a first one. It never opens a tab, and nothing happens at install.
chrome.runtime.onInstalled?.addListener(({ reason } = {}) => {
  getStore()
    .then((store) => seedOnUpdate(chrome.storage.local, { reason, githubId: store.get('identity')?.githubId }))
    .catch(() => {});
});

// sow-387: after a sign-in, sign the member in on the website and, on the first sign-in for this account on this
// browser, open the website welcome in front of the sign-in tab. Single-flight, so two sign-ins that finish together
// run it once. It runs AFTER the sign-in page has its answer, so nothing here can hold the sign-in screen.
const PROGRESS_TIMEOUT_MS = 10000;
let _afterSignIn = null;
function afterSignIn(store, tab) {
  if (_afterSignIn) return _afterSignIn;
  _afterSignIn = (async () => {
    try {
      // The website session first: the welcome tab needs the cookie. The stamp is set before the mint so an api call
      // racing it does not mint twice, and removed on failure so the next api call's opportunistic mint retries.
      try { await chrome.storage?.session?.set?.({ webSessionMinted: true }); } catch { /* best-effort */ }
      const minted = await mintWebSession(store.get('githubToken'));
      if (!minted) { try { await chrome.storage?.session?.remove?.('webSessionMinted'); } catch { /* best-effort */ } }
      // Claim before any read. Only the call that writes the record may open a tab.
      const claimed = await claimHandoff(chrome.storage.local, store.get('identity')?.githubId);
      if (!claimed) return;
      // A read that fails or runs long leaves the progress unknown, and unknown progress still opens the welcome.
      const client = createDispatchClient((req) => dispatch(buildExtContext(store), req));
      const progress = await withTimeout(loadProgress(client), PROGRESS_TIMEOUT_MS, null);
      if (!shouldOpenWelcome({ claimed, progress })) return;
      const opts = { url: WELCOME_SITE_URL, active: true };
      if (tab?.windowId != null) opts.windowId = tab.windowId;
      if (tab?.id != null) opts.openerTabId = tab.id;
      try { await chrome.tabs.create(opts); } catch { await chrome.tabs.create({ url: WELCOME_SITE_URL }).catch(() => {}); }
    } catch { /* best-effort: the WorkBench card still links to the welcome */ }
    finally { _afterSignIn = null; }
  })();
  return _afterSignIn;
}

// SOW-030: tell gbti.network content scripts (in any tab) that auth changed, so they re-stamp the page-safe
// identity signal. A service worker's chrome.runtime.sendMessage reaches extension pages, NOT content scripts,
// so we must message each gbti.network tab via chrome.tabs.sendMessage. The url filter is permitted by our
// https://gbti.network/* host permission (no "tabs" permission needed). Best-effort + carries NO data.
async function broadcastAuthChanged() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://gbti.network/*' });
    for (const t of tabs) if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'auth-changed' }).catch(() => {});
  } catch { /* no tabs API / no matching tab */ }
}

/** Bring a tab (by id) to the foreground. Permission-free; reading the tab's url/title would need "tabs". */
async function focusTab(tabId, windowId) {
  if (tabId == null) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
    if (windowId != null) await chrome.windows.update(windowId, { focused: true });
  } catch { /* tab closed */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const store = await getStore();
    try {
      if (msg?.type === 'api') {
        await ensureFreshToken(store); // SOW: refresh an about-to-expire token before the request reads GitHub
        maybeMintWebSession(store); // sow-158: opportunistic once-per-session website sign-in (fire-and-forget)
        sendResponse(await dispatch(buildExtContext(store), msg.req || {}));
      } else if ((msg?.type === 'web-session-peek' || (msg?.type === 'login' && msg.method === 'web')) && !fromExtensionPage(sender, chrome.runtime.getURL(''))) {
        // sow-393: the website sign-in and the "Continue as" read belong to the extension's own sign-in page. A content
        // script on a web page has no business sending either, so a compromised page cannot plant tokens this way.
        sendResponse({ ok: false, error: 'forbidden' });
      } else if (msg?.type === 'web-session-peek') {
        // sow-393: is the member already signed in on the website? Only the login comes back, for the sign-in
        // screen's "Continue as" button; the browser sends the cookie and nothing here reads it.
        let login = null;
        try {
          const r = await fetch(`${SIGNUP_BASE}/membership/status`, { credentials: 'include', signal: AbortSignal.timeout?.(5000) });
          if (r.ok) login = knownLoginFrom(await r.json());
        } catch { login = null; }
        sendResponse({ ok: true, login });
      } else if (msg?.type === 'login') {
        // sow-393: 'web' (the default sign-in) arrives with the code and verifier; anything else is the device code.
        const res = msg.method === 'web' ? await handleWebLogin(store, msg) : await handleLogin(store);
        // Device-flow sign-in ends on GitHub's "you're all set" page in a different tab. Route the member back
        // to the tab that started sign-in (the new tab, or a gbti.network page), which then reloads into the feed.
        if (res?.ok) { broadcastAuthChanged(); await focusTab(sender?.tab?.id, sender?.tab?.windowId); }
        sendResponse(res);
        // sow-387: only now, with the sign-in page answered, the website session and (on a first sign-in) the
        // website welcome, opened last so it lands in front.
        if (res?.ok) afterSignIn(store, sender?.tab);
      } else if (msg?.type === 'signout') {
        // sow-158: end the bridged website cookie session too. Capture the token BEFORE nulling it, so the bearer
        // reaches the clear route; fire-and-forget so a slow/failed clear never blocks local sign-out.
        clearWebSession(store.get('githubToken'));
        store.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, identity: null });
        // SOW-073: clear the local content caches (the workbench SWR cache gbti:wb:* and the SOW-064 create-recent
        // cache) so a signed-out member's owned-content metadata never survives on the device into another session.
        try {
          const all = await chrome.storage.local.get(null);
          const keys = Object.keys(all || {}).filter((k) => k.startsWith('gbti:wb:') || k === 'gbti:create-recent');
          if (keys.length) await chrome.storage.local.remove(keys);
        } catch { /* storage unavailable: best-effort */ }
        // sow-158: clear the once-per-session mint stamp so a later re-sign-in re-mints the website session. The
        // bridged website cookie itself is expired above via clearWebSession (best-effort).
        try { await chrome.storage?.session?.remove?.('webSessionMinted'); } catch { /* best-effort */ }
        broadcastAuthChanged();
        sendResponse({ ok: true });
      } else if (msg?.type === 'open-page') {
        // SOW-036: the avatar menu (site header relay, or the new-tab dropdown) asks to open an in-extension
        // management page in a new tab. resolveOpenPage is the authoritative allowlist: only a known page +
        // a safe hash resolve, so a hostile gbti.network page cannot relay a request to open an arbitrary URL.
        const rel = resolveOpenPage({ page: msg.page, hash: msg.hash });
        if (!rel) { sendResponse({ ok: false, error: 'bad_page' }); return; }
        try {
          await chrome.tabs.create({ url: chrome.runtime.getURL(rel) });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message ?? 'open_failed' });
        }
      } else if (msg?.type === 'devlog-recent' || msg?.type === 'devlog-clear') {
        // SOW-124: the Debug panel reads/clears the BACKGROUND realm's ring. Superadmin-gated (fail-closed): the
        // ring can carry redacted diagnostics, so only a superadmin caller gets it. The role is read from
        // house/roles.yml via the same path /api/status uses.
        let role = 'member';
        try { role = await computeRole(buildExtContext(store)); } catch { role = 'member'; }
        if (role !== 'superadmin') { sendResponse({ ok: false, error: 'forbidden' }); return; }
        if (msg.type === 'devlog-clear') { devlog.clear(); sendResponse({ ok: true }); }
        else sendResponse({ ok: true, entries: devlog.recent() });
      } else {
        sendResponse({ error: 'unknown_message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    }
  })();
  return true; // keep the message channel open for the async sendResponse
});

// The content script (SOW-006 v2 P4), injected into gbti.network pages. Importing @gbti/client-ui DEFINES the
// custom elements, so the page's INERT <gbti-edit-panel> (baked into the static build by EditHooks.astro)
// upgrades and activates. It wires a GbtiClient whose transport is MESSAGING to the background worker (which
// holds the token + does the git work), via createHttpClient with a messaging `fetch`. The page never sees the
// token; the content script only sends messages. The editor then offers in-place editing IF the member owns
// the page's content (the client checks ownership).

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';
import { buildMemberSignal } from './identity-signal.mjs';
import { resolveOpenPage } from './open-page.mjs';
import { DAILYDEV_PROBE_URL, DAILYDEV_SEEN_KEY, DAILYDEV_CHECKED_KEY, shouldProbeDailydev } from './quick-launch-core.mjs';

/** Translate a /api/* request into a background-worker message (replaces the real network fetch). */
async function messagingFetch(url, init = {}) {
  const u = new URL(url, 'https://gbti.network');
  const req = {
    method: init.method || 'GET',
    pathname: u.pathname,
    query: Object.fromEntries(u.searchParams.entries()),
    body: init.body ? JSON.parse(init.body) : undefined,
  };
  const result = await chrome.runtime.sendMessage({ type: 'api', req });
  const r = result || { status: 500, json: { error: 'no_response' } };
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.json,
  };
}

const client = createHttpClient({ baseUrl: '', token: 'extension', fetch: messagingFetch });

setClient(client);
// The page's inert <gbti-edit-panel> upgrades now that the elements are defined; it self-activates for the owner.

// SOW-019: announce the extension to the page so the site's install-aware "Sign in" button can detect it.
// Standard content-script marker pattern: no extension id, no externally_connectable. The site reads the
// data-gbti-extension attribute (and/or listens for the event). A bare relay listener passes the site's sign-in
// request on as gbti:open-auth (sow-410: the device-code sign-in it once reached is gone; the relay starts nothing).
try {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.gbtiExtension = version;
  document.dispatchEvent(new CustomEvent('gbti:extension-ready', { detail: { version } }));
  document.addEventListener('gbti:request-signin', () => {
    // The page asked to sign in. Passed on as gbti:open-auth for any page element that offers sign-in; no
    // extension or site element listens today, and it starts no sign-in (the new tab's sign-in screen does).
    document.dispatchEvent(new CustomEvent('gbti:open-auth'));
  });
  // SOW-036: the site header's avatar menu asks (via a page CustomEvent) to open an in-extension management page
  // in a new tab. The page cannot link to chrome-extension:// (it does not know the id), so it dispatches
  // gbti:open and we relay to the background, which validates against the allowlist and opens the tab. We
  // pre-validate here too (defense in depth) so a malformed request never reaches the worker.
  document.addEventListener('gbti:open', (e) => {
    const detail = e?.detail || {};
    if (!resolveOpenPage(detail)) return;
    chrome.runtime.sendMessage({ type: 'open-page', page: detail.page, hash: detail.hash }).catch(() => {});
    // SOW-112 QA: acknowledge the relay so the page can tell a handled click from a stale extension
    // (an old content script silently ignored pages it did not know, which read as a dead button).
    document.dispatchEvent(new CustomEvent('gbti:open-ack'));
  });
  // SOW-036: sign out from the site header's avatar menu. The worker clears the token + broadcasts auth-changed,
  // which re-stamps the page-safe signal so the header reverts to its logged-out state.
  document.addEventListener('gbti:request-signout', () => {
    chrome.runtime.sendMessage({ type: 'signout' }).catch(() => {});
  });
} catch { /* chrome runtime unavailable: no marker (treated as not installed by the site) */ }

// SOW-030: publish a PAGE-SAFE identity signal so gbti.network can render a signed-in / member experience
// (header avatar, owner-only edit chrome). The GitHub TOKEN never leaves the worker; this carries identity +
// membership status only (built by buildMemberSignal's explicit allowlist). The site treats it as UNTRUSTED
// presentation input; authoritative checks stay server-side (the SOW-005 gate, the Worker oracle). Re-stamped
// whenever the worker broadcasts an auth change (sign-in/sign-out in any tab).
async function stampMemberSignal() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/status', query: {} } });
    const signal = buildMemberSignal(r?.json);
    if (signal) document.documentElement.dataset.gbtiMember = JSON.stringify(signal);
    else delete document.documentElement.dataset.gbtiMember;
    document.dispatchEvent(new CustomEvent('gbti:identity', { detail: signal }));
  } catch { /* worker unreachable: leave the page as a logged-out visitor */ }
}
try {
  stampMemberSignal();
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'auth-changed') stampMemberSignal(); });
} catch { /* no chrome runtime */ }

// sow-397: find out whether daily.dev is installed, for the quick launch (which switches it on the first time it is
// found). daily.dev's manifest makes css/companion.css readable by every http(s) page, and not by another extension's
// pages, so the check runs here on gbti.network rather than in the new tab. It needs no permission. Only the yes or no
// is kept, in this extension's own storage.
async function probeDailydev() {
  try {
    const got = await chrome.storage.local.get([DAILYDEV_SEEN_KEY, DAILYDEV_CHECKED_KEY]);
    if (!shouldProbeDailydev({ seen: got[DAILYDEV_SEEN_KEY], checkedAt: got[DAILYDEV_CHECKED_KEY] })) return;
    let found = false;
    try { found = (await fetch(DAILYDEV_PROBE_URL, { cache: 'no-store' })).ok; } catch { found = false; }
    await chrome.storage.local.set({ [DAILYDEV_SEEN_KEY]: found, [DAILYDEV_CHECKED_KEY]: Date.now() });
  } catch { /* no storage: the quick launch simply never switches daily.dev on */ }
}
probeDailydev();

// The content script (SOW-006 v2 P4), injected into gbti.network pages. Importing @gbti/client-ui DEFINES the
// custom elements, so the page's INERT <gbti-edit-panel> (baked into the static build by EditHooks.astro)
// upgrades and activates. It wires a GbtiClient whose transport is MESSAGING to the background worker (which
// holds the token + does the git work), via createHttpClient with a messaging `fetch`. The page never sees the
// token; the content script only sends messages. The editor then offers in-place editing IF the member owns
// the page's content (the client checks ownership).

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';
import { buildMemberSignal } from './identity-signal.mjs';
import { resolveOpenPage } from './open-page.mjs';

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

// Device-flow login is a HOST capability surfaced to <gbti-auth>: the worker runs the polling; we relay the
// user code to the component's onPrompt.
client.login = (onPrompt) =>
  new Promise((resolve, reject) => {
    const onPromptMsg = (m) => {
      if (m?.type === 'login-prompt') onPrompt({ userCode: m.userCode, verificationUri: m.verificationUri });
    };
    chrome.runtime.onMessage.addListener(onPromptMsg);
    chrome.runtime
      .sendMessage({ type: 'login' })
      .then((r) => {
        chrome.runtime.onMessage.removeListener(onPromptMsg);
        if (r?.ok) resolve(r);
        else reject(new Error(r?.error || 'sign-in failed'));
      })
      .catch((e) => {
        chrome.runtime.onMessage.removeListener(onPromptMsg);
        reject(e);
      });
  });

setClient(client);
// The page's inert <gbti-edit-panel> upgrades now that the elements are defined; it self-activates for the owner.

// SOW-019: announce the extension to the page so the site's install-aware "Sign in" button can detect it.
// Standard content-script marker pattern: no extension id, no externally_connectable. The site reads the
// data-gbti-extension attribute (and/or listens for the event). A bare relay listener lets the site ask the
// extension to start the device-flow sign-in.
try {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.dataset.gbtiExtension = version;
  document.dispatchEvent(new CustomEvent('gbti:extension-ready', { detail: { version } }));
  document.addEventListener('gbti:request-signin', () => {
    // The page asked to sign in. The <gbti-auth> component (already on the page) owns the device-flow UI;
    // surface it by dispatching an event it listens for. Kept minimal: the onboarding tab (opened from the
    // toolbar icon) remains the primary sign-in surface, this is the in-page convenience path.
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

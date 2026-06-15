// The MV3 background service worker (SOW-006 v2 P4). It holds the GitHub token (chrome.storage.local, NEVER
// exposed to the page), runs device-flow auth, and answers the content script's /api/* messages by running the
// dispatcher against the extension ctx. The page can never read the token: it only sends messages and gets
// back results. This is the privileged half of the extension client.

import { createExtStore } from './ext-store.mjs';
import { buildExtContext, UPSTREAM } from './ext-context.mjs';
import { dispatch } from './ext-dispatch.mjs';
import { createGithubReader } from './github-reader.mjs';
import { deviceFlowLogin } from '../../client/src/auth-device.mjs';
import { createRepoClient } from '../../client/src/github-repo.mjs';
import { resolveMembership } from '../../client/src/membership.mjs';
import { GITHUB_CLIENT_ID, activeClientId, activeScope } from '../../client/src/signup-base.mjs';

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

async function handleLogin(store) {
  const { accessToken } = await deviceFlowLogin({
    // SOW-026: classic mode = the public_repo OAuth app (account-wide); app mode = the GitHub App (fork-scoped,
    // no scope, GitHub Apps ignore it). The token only ever reaches GitHub; app mode shrinks its capability to
    // the member's single fork. The MV3 worker has no process.env, so AUTH_MODE defaults to classic until the
    // bundle bakes app mode at provisioning.
    clientId: activeClientId(),
    scope: activeScope(),
    onPrompt: ({ userCode, verificationUri }) => {
      // Surface the code to the onboarding tab. Do NOT auto-open the verification tab here: the GitHub App device
      // flow returns no verification_uri_complete, so an auto-opened page cannot pre-fill the code anyway, and
      // grabbing focus mid-flow is hostile. The tab shows the code with a Copy button + an
      // "Open github.com/login/device" button the member clicks themselves. The device flow keeps polling here.
      chrome.runtime.sendMessage({ type: 'login-prompt', userCode, verificationUri }).catch(() => {});
    },
  });
  const repo = createRepoClient({ token: accessToken, upstream: UPSTREAM });
  const u = await repo.getAuthUser();
  store.set({ githubToken: accessToken, identity: { login: u.login, githubId: String(u.id), username: String(u.login).toLowerCase() } });

  // SOW-011: resolve + cache the effective membership so the in-page editor can show the "membership required
  // to publish" notice and block a trial publish. Best-effort: any failure leaves it 'unknown' (fails OPEN to
  // the gate). The reader reads the public house/*.yml overrides; the Worker supplies the Stripe-derived status.
  try {
    const reader = createGithubReader({ upstream: UPSTREAM, token: accessToken });
    const { stripeStatus, membership } = await resolveMembership({ githubId: String(u.id), token: accessToken, signupBase: SIGNUP_BASE, readFile: (p) => reader.readFile(p) });
    store.set({ stripeStatus, membership });
  } catch {
    // leave membership unset (treated as 'unknown')
  }
  return { ok: true, login: u.login };
}

// SOW-026: the toolbar icon has NO default_popup, so clicking it fires this handler instead of opening a popup.
// A popup closes the instant it loses focus, which discarded the device-flow code the moment the member tabbed
// to GitHub; the onboarding TAB persists. Best-effort focus an already-open onboarding tab (kept in
// chrome.storage.session) so repeated clicks do not spawn duplicate tabs. No "tabs" permission is needed: we
// only create/update/get by id (reading a tab's url/title would need it; checking existence + windowId does not).
const ONBOARDING_PAGE = 'onboarding.html';
async function openOnboardingTab() {
  const url = chrome.runtime.getURL(ONBOARDING_PAGE);
  try {
    const { onboardingTabId } = (await chrome.storage?.session?.get?.('onboardingTabId')) ?? {};
    if (onboardingTabId != null) {
      try {
        const t = await chrome.tabs.get(onboardingTabId); // rejects if the tab was closed
        await chrome.tabs.update(onboardingTabId, { active: true });
        if (t?.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
        return;
      } catch { /* the remembered tab is gone; fall through and open a fresh one */ }
    }
    const created = await chrome.tabs.create({ url });
    if (created?.id != null) await chrome.storage?.session?.set?.({ onboardingTabId: created.id });
  } catch {
    try { await chrome.tabs.create({ url }); } catch { /* give up */ }
  }
}
chrome.action?.onClicked?.addListener(() => { openOnboardingTab(); });

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
        sendResponse(await dispatch(buildExtContext(store), msg.req || {}));
      } else if (msg?.type === 'login') {
        const res = await handleLogin(store);
        // Device-flow sign-in ends on GitHub's "you're all set" page in a different tab. Route the member back
        // to the tab that started sign-in (the onboarding tab, or the gbti.network page) so they see step 2.
        if (res?.ok) { broadcastAuthChanged(); await focusTab(sender?.tab?.id, sender?.tab?.windowId); }
        sendResponse(res);
      } else if (msg?.type === 'signout') {
        store.set({ githubToken: null, identity: null });
        broadcastAuthChanged();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'unknown_message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    }
  })();
  return true; // keep the message channel open for the async sendResponse
});

// SOW-031: the extension's Browse page script. Reuses the SAME messaging bridge as the Shares/Workspace pages:
// /api/* requests are relayed to the background worker (which holds the token, reads content over the GitHub
// Contents API, and decrypts member bodies via the Worker); the page never sees the token. Mounts <gbti-auth>
// (sign-in) + <gbti-browse> (Blog/Products/Prompts/Shares + the in-extension reader). Mirrors shares.mjs.

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';
import { initShell } from './shell.mjs';
import { parseBrowseHash } from '../../client-ui/src/browse-hash.mjs';

// Map the active browse tab to its rail key so the left rail highlights the right destination. A bare browse.html
// (no tab) lands on the All directory (SOW-042), so default the highlight to 'all' too.
const RAIL_KEY = { all: 'all', post: 'articles', product: 'products', prompt: 'prompts', share: 'shares' };
const railFor = () => RAIL_KEY[parseBrowseHash(typeof location !== 'undefined' ? location.hash : '').tab] || 'all';

/** Relay a /api/* request to the background worker (replaces a real network fetch). Mirrors shares.mjs. */
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
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
}

const client = createHttpClient({ baseUrl: '', token: 'extension', fetch: messagingFetch });

// Device-flow login surfaced to <gbti-auth> (the worker runs the polling; relay the user code).
client.login = (onPrompt) =>
  new Promise((resolve, reject) => {
    const onPromptMsg = (m) => { if (m?.type === 'login-prompt') onPrompt({ userCode: m.userCode, verificationUri: m.verificationUri }); };
    chrome.runtime.onMessage.addListener(onPromptMsg);
    chrome.runtime.sendMessage({ type: 'login' })
      .then((r) => { chrome.runtime.onMessage.removeListener(onPromptMsg); r?.ok ? resolve(r) : reject(new Error(r?.error || 'sign-in failed')); })
      .catch((e) => { chrome.runtime.onMessage.removeListener(onPromptMsg); reject(e); });
  });

setClient(client);

// SOW-036: mount the shared member-hub shell (top bar + left rail), highlighting the active browse destination.
// Keep the rail highlight in sync as the in-page tab changes (gbti-browse reacts to the same hashchange).
initShell({ active: railFor() });
window.addEventListener('hashchange', () => {
  const key = railFor();
  document.querySelectorAll('.nt-rail .nav-i').forEach((n) => n.classList.toggle('on', n.dataset.key === key));
});

// SOW-036: shared bootstrap for the extension's standalone pages (admin). Wires a GbtiClient whose
// transport RELAYS /api/* to the background worker (which holds the GitHub token + does the git work); the page
// never sees the token. Also surfaces device-flow login to <gbti-auth>. This is the exact bridge workspace.mjs /
// shares.mjs use, factored out so new pages do not re-copy it.

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';

/** Relay a /api/* request to the background worker (replaces a real network fetch). */
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

/** Build + register the messaging-backed client (with device-flow login) for a standalone extension page. */
export function mountPageClient() {
  const client = createHttpClient({ baseUrl: '', token: 'extension', fetch: messagingFetch });
  // Device-flow login surfaced to <gbti-auth>: the worker runs the polling; relay the user code to onPrompt.
  client.login = (onPrompt) =>
    new Promise((resolve, reject) => {
      const onPromptMsg = (m) => { if (m?.type === 'login-prompt') onPrompt({ userCode: m.userCode, verificationUri: m.verificationUri }); };
      chrome.runtime.onMessage.addListener(onPromptMsg);
      chrome.runtime.sendMessage({ type: 'login' })
        .then((r) => { chrome.runtime.onMessage.removeListener(onPromptMsg); r?.ok ? resolve(r) : reject(new Error(r?.error || 'sign-in failed')); })
        .catch((e) => { chrome.runtime.onMessage.removeListener(onPromptMsg); reject(e); });
    });
  setClient(client);
  return client;
}

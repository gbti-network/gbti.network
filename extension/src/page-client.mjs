// SOW-036: shared bootstrap for the extension's standalone pages (admin). Wires a GbtiClient whose
// transport RELAYS /api/* to the background worker (which holds the GitHub token + does the git work); the page
// never sees the token. (sow-410 removed the device-code login it also carried.) This is the exact bridge workspace.mjs /
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

/** Build + register the messaging-backed client for a standalone extension page. */
export function mountPageClient() {
  const client = createHttpClient({ baseUrl: '', token: 'extension', fetch: messagingFetch });
  setClient(client);
  return client;
}

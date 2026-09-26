// SOW-018: the extension's dedicated Shares page script. Shares are EXTENSION-ONLY (no public website surface),
// so this extension page is where a member reads and posts the co-op stream. It reuses the SAME client-ui
// components (<gbti-shares> = composer + reading feed; sign-in is the shell's gate) and the SAME messaging bridge
// the content script uses: /api/* requests are relayed to the background worker (which holds the token + does
// the git work + calls the Worker to decrypt). The page never sees the token or the AES key.

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';
import { initShell } from './shell.mjs';

/** Relay a /api/* request to the background worker (replaces a real network fetch). Mirrors content.mjs. */
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

setClient(client);

// sow-406: no left menu. The "+" stays, because this page has no hero share bar of its own at the top.
initShell({ compose: true });

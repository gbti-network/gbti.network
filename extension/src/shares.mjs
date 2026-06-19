// SOW-018: the extension's dedicated Shares page script. Shares are EXTENSION-ONLY (no public website surface),
// so this extension page is where a member reads and posts the co-op stream. It reuses the SAME client-ui
// components (<gbti-auth> for sign-in, <gbti-shares> = composer + reading feed) and the SAME messaging bridge
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

// SOW-052: mount the shell with the WorkBench rail (consistent management chrome; Shares has no rail destination).
initShell({ active: null, nav: 'workbench' });

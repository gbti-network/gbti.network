// SOW-033: the extension's Workspace page script. Reuses the SAME messaging bridge as the Shares page: /api/*
// requests are relayed to the background worker (which holds the token + does the git work + reads PR status);
// the page never sees the token. Mounts <gbti-auth> (sign-in) + <gbti-workspace> (my content + my PRs). Mirrors
// extension/src/shares.mjs.

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';
import { initShell, setRailActive } from './shell.mjs';
import { parseWorkspaceTab } from '../../client-ui/src/workspace-core.mjs';

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

// SOW-052: mount the shell with the WorkBench rail; the active item tracks the workspace tab (overview by default).
// The rail's #tab= links switch tab without a reload (<gbti-workspace> listens for hashchange), so keep the rail
// highlight in sync here too.
const wbTab = () => parseWorkspaceTab(location.hash) || 'overview';
initShell({ active: wbTab(), nav: 'workbench' });
window.addEventListener('hashchange', () => setRailActive(wbTab()));

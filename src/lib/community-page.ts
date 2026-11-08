// sow-494: the one mount routine both Community pages share. Resolve the signed-in member from the cookie session,
// build the website client (with the superadmin methods only for a superadmin), and hand it to the page's element
// directly, so a later page-wide setClient (the header bell) cannot swap it for a client without those methods.
// Signed out, the page shows its sign-in card; a transient failure keeps the session and offers a retry.
function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export async function mountCommunity({ tag, element }: { tag: string; element: () => Promise<unknown> }) {
  const signedOut = document.querySelector('[data-cm-signedout]') as HTMLElement | null;
  const mountEl = document.querySelector('[data-cm-mount]') as HTMLElement | null;
  const out = () => { if (signedOut) signedOut.hidden = false; if (mountEl) mountEl.hidden = true; };
  if (!readCookie('gbti_csrf')) { out(); return; }
  const base = document.documentElement.dataset.signupBase || '';
  const { resolveMemberSession } = await import('./member-gate');
  const s = await resolveMemberSession({ base });
  if (s.state === 'out') { out(); return; }
  if (s.state === 'error') {
    if (mountEl) {
      mountEl.innerHTML = '<p class="lead">Cannot reach the server right now. Your session is still active. <button type="button" class="btn btn-ghost" data-cm-retry>Retry</button></p>';
      mountEl.querySelector('[data-cm-retry]')?.addEventListener('click', () => location.reload());
    }
    return;
  }
  const p = s.payload || {};
  const { createWorkbenchClient } = await import('./workbench-client');
  const { setClient } = await import('../../client-ui/src/base.mjs');
  const client = createWorkbenchClient({
    signupBase: base,
    login: String(p.login || ''),
    username: String(p.folder || p.login || ''), // sow-428: the folder is the GBTI name
    githubId: p.github_id != null ? String(p.github_id) : null,
    isSuperadmin: p.role === 'superadmin',
  });
  setClient(client);
  // Define the element first: a property set on a not-yet-upgraded element would shadow the class's `client` setter.
  await element();
  const el = document.querySelector(tag) as (HTMLElement & { client?: unknown }) | null;
  if (el) el.client = client;
}

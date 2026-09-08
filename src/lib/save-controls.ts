// sow-316: upgrade every save control on the page for a WEBSITE session, from ONE place (BaseLayout).
//
// The decision lives in save-controls-core.mjs (pure, tested). This file is the browser half: build the
// website client once per page, hand it to the client-ui registry, and load the two element modules, which
// upgrade every <gbti-favorite> and <gbti-collection> already in the document. Any component that needs the
// same client (the feed's follow pills, say) takes it from websiteClient() rather than building its own, so
// the page holds one client and the activity read behind the controls happens once.
import { shouldUpgradeSaveControls, websiteClientArgs, cookieValue } from './save-controls-core.mjs';

let clientPromise: Promise<any> | null = null;
let wired = false;

/** The page's one website client, or null when the session cannot write. Memoized for the page's lifetime. */
export function websiteClient(signal: any): Promise<any> | null {
  if (!signal || !signal.login || !cookieValue(document.cookie, 'gbti_csrf')) return null;
  if (!clientPromise) {
    const signupBase = document.documentElement.dataset.signupBase || '';
    clientPromise = import('./workbench-client').then(({ createWorkbenchClient }) => createWorkbenchClient(websiteClientArgs(signal, signupBase)));
  }
  return clientPromise;
}

/** Called on every member-signal event; upgrades once, and only when the decision says so. */
export async function upgradeSaveControls(signal: any): Promise<void> {
  const go = shouldUpgradeSaveControls({
    signal,
    csrf: cookieValue(document.cookie, 'gbti_csrf'),
    extension: document.documentElement.dataset.gbtiExtension,
    hasControls: !!document.querySelector('gbti-favorite, gbti-collection'),
    wired,
  });
  if (!go) return;
  wired = true;
  try {
    const client = await websiteClient(signal);
    if (!client) { wired = false; return; }
    const { setClient } = await import('../../client-ui/src/base.mjs');
    setClient(client);
    await Promise.all([
      import('../../client-ui/src/elements/gbti-favorite.mjs'),
      import('../../client-ui/src/elements/gbti-collection.mjs'),
    ]);
  } catch {
    wired = false; // a failed load leaves the inert control and its sign-in path in place; the next signal retries
  }
}

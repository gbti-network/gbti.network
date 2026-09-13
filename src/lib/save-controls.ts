// sow-316: upgrade every save control on the page for a WEBSITE session, from ONE place (BaseLayout).
//
// The decision lives in save-controls-core.mjs (pure, tested). This file is the browser half: build the
// website client once per page, hand it to the client-ui registry, and load the two element modules, which
// upgrade every <gbti-favorite> and <gbti-collection> already in the document. Any component that needs the
// same client (the feed's follow pills, say) takes it from websiteClient() rather than building its own, so
// the page holds one client and the activity read behind the controls happens once.
//
// sow-330, owner rule 2026-09-12: "All save and collection behavior initiated from the website will stay on the
// website." Until the controls upgrade they are inert [data-signin] buttons, and a click on one used to meet one of
// two wrong outcomes: a member already signed in on the website was shown the sign-in dialog because the page did not
// know who they were yet, and a visitor who then signed in came back to the page with their save lost. This file now
// owns the whole life of such a click, through the pure decisions in save-intent-core.mjs:
//
//   - no website session: remember the save (sessionStorage, never a URL) and let the website sign-in dialog open;
//     the save completes when sign-in brings them back to this page.
//   - a session cookie is present but unresolved: HOLD the click and replay it once the page knows who they are and
//     the controls have loaded, however slow the connection.
//   - replay (for a held click and a remembered save alike) never turns a favorite off and never picks a collection.
import { shouldUpgradeSaveControls, websiteClientArgs, cookieValue } from './save-controls-core.mjs';
import { SAVE_TRIGGER_SELECTOR, intentFromControl, storePendingSave, takePendingSave, holdDecision, replayAction } from './save-intent-core.mjs';
import { whenCookieResolved } from './member-signal';

let clientPromise: Promise<any> | null = null;
let wired = false;

// sow-330: when the controls are live, and the client they were built with (the replay reads activity through it).
let pageClient: any = null;
let ready = false;
let markReady: () => void = () => {};
const controlsReady: Promise<void> = new Promise((resolve) => { markReady = resolve; });
let sessionState: 'pending' | 'signed-in' | 'signed-out' = 'pending';
const upgradeFailures = new Set<() => void>();
// A held click waits for as long as the page is still working: the session answer on its way, then the controls
// loading. Measured 2026-09-12 on a cold load, the heart stays inert for 0.4s on desktop, about 2s on Fast 4G, 6 to 7s
// on Slow 4G and 20 to 24s on 3G (4x CPU slowdown). The hold therefore ends early only when the session resolves signed
// out or the controls fail to load; this ceiling is the backstop for a request that never answers at all.
const HOLD_CEILING_MS = 45000;

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
    hasControls: !!document.querySelector('gbti-favorite, gbti-collection'),
    wired,
  });
  if (!go) return;
  wired = true;
  try {
    const client = await websiteClient(signal);
    if (!client) { wired = false; for (const cb of upgradeFailures) cb(); return; }
    const { setClient } = await import('../../client-ui/src/base.mjs');
    setClient(client);
    await Promise.all([
      import('../../client-ui/src/elements/gbti-favorite.mjs'),
      import('../../client-ui/src/elements/gbti-collection.mjs'),
    ]);
    pageClient = client;
    ready = true;
    markReady();
    completePendingSave();
  } catch {
    wired = false; // a failed load leaves the inert control and its sign-in path in place; the next signal retries
    for (const cb of upgradeFailures) cb(); // and releases a held click to that path rather than holding it to the ceiling
  }
}

function session(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * Replay a save on an UPGRADED control. A heart is clicked only when the member's activity says it is not already
 * favorited (the heart is a toggle, so a blind replay would remove an existing favorite); a Save pill only opens its
 * picker, so the member still chooses the collection.
 */
async function replay(host: HTMLElement, kind: string): Promise<void> {
  const pill = () => host.shadowRoot?.querySelector('.pill') as HTMLElement | null;
  if (!pill()) return;
  let favorited = false;
  if (kind === 'favorite') {
    try {
      const { primeActivity, isFavorited } = await import('../../client-ui/src/activity-state.mjs');
      const activity = await primeActivity(pageClient);
      favorited = isFavorited(activity, { type: host.dataset.gbtiTargetType, slug: host.dataset.gbtiTargetSlug });
    } catch {
      return; // the member's favorites could not be read: do nothing rather than risk turning one off
    }
  }
  const action = replayAction({ kind, favorited, pickerOpen: pill()?.getAttribute('aria-expanded') === 'true' });
  if (action === 'none') return;
  // The element re-renders when its own activity read lands; a frame lets that settle so the click hits the live pill.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  pill()?.click();
}

/** Complete a save remembered before sign-in, once, and only on the page it was started on. */
function completePendingSave(): void {
  const intent = takePendingSave(session(), { path: location.pathname, now: Date.now() });
  if (!intent) return;
  const tag = intent.kind === 'collect' ? 'gbti-collection' : 'gbti-favorite';
  const host = [...document.querySelectorAll(tag)].find((el) => {
    const d = (el as HTMLElement).dataset;
    return d.gbtiTargetType === intent.type && d.gbtiTargetSlug === intent.slug;
  }) as HTMLElement | undefined;
  if (host) replay(host, intent.kind); // a remembered save that names no control on this page is never acted on
}

if (typeof document !== 'undefined') {
  whenCookieResolved().then((signal) => { sessionState = signal ? 'signed-in' : 'signed-out'; });

  let held = false;
  let bypass = false; // set while re-dispatching a released click to the sign-in dialog, so it is not held again

  // Capture phase: runs before SigninModal's bubble-phase [data-signin] listener, so a held click never reaches it.
  // An UPGRADED control is never matched: its click is retargeted to the host, which carries no [data-signin].
  document.addEventListener('click', (e) => {
    if (bypass) return;
    const trigger = (e.target as Element | null)?.closest?.(SAVE_TRIGGER_SELECTOR);
    if (!trigger) return;
    const host = trigger.closest('gbti-favorite, gbti-collection') as HTMLElement | null;
    const intent = intentFromControl(host);
    if (!host || !intent) return;

    const decision = holdDecision({ csrf: cookieValue(document.cookie, 'gbti_csrf'), sessionState, controlsReady: ready });
    if (decision === 'pass') return;
    if (decision === 'signin') {
      storePendingSave(session(), intent, { path: location.pathname, now: Date.now() });
      return; // the website sign-in dialog opens from here (SigninModal)
    }

    // Hold: a website session may be present and the page does not know it yet.
    e.preventDefault();
    e.stopPropagation();
    if (held) return; // one held click at a time
    held = true;
    host.setAttribute('aria-busy', 'true');
    let onFail = () => {};
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    const released = new Promise<'ready' | 'signed-out' | 'failed' | 'ceiling'>((resolve) => {
      onFail = () => resolve('failed');
      ceiling = setTimeout(() => resolve('ceiling'), HOLD_CEILING_MS);
      whenCookieResolved().then((signal) => {
        if (!signal) { resolve('signed-out'); return; }
        // The member-signal listeners (which start the upgrade) have run by now. Not ready and not loading means the
        // last attempt already failed, and its failure was announced before this click was listening.
        if (!ready && !wired) { resolve('failed'); return; }
        upgradeFailures.add(onFail);
        controlsReady.then(() => resolve('ready'));
      });
    });
    released.then(async (result) => {
      clearTimeout(ceiling);
      upgradeFailures.delete(onFail);
      held = false;
      host.removeAttribute('aria-busy');
      if (result === 'ready' || ready) { await replay(host, intent.kind); return; }
      // Signed out, the controls failed to load, or no answer at all: remember the save and open the website sign-in.
      storePendingSave(session(), intent, { path: location.pathname, now: Date.now() });
      if (host.shadowRoot) return; // it upgraded after all; the member can click the live control
      bypass = true;
      try { (trigger as HTMLElement).click(); } finally { bypass = false; }
    });
  }, true);
}

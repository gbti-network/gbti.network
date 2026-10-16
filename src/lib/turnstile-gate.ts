// sow-457: the bot check behind a claim button, loaded ON DEMAND.
//
// WHY ON DEMAND MATTERS HERE and not on an invite lander. The on-page invitation dialog
// (src/components/invite/InviteClaim.astro) renders into a PUBLISHED ARTICLE with ordinary readers. Loading
// challenges.cloudflare.com on every view would make every reader pay for a third-party script because an
// invitation mechanism happens to live on their page, and scripts/check-lcp-priority.mjs names that article a
// required-promotion page. So nothing is fetched until a visitor arrives with a coupon.
//
// THE TOKEN IS SINGLE USE, and the caller must spend it and drop it in the same gesture. The invite landers
// learned that on 2026-09-15: a second tap while the phone was still navigating replayed a spent token and read
// as a failure. `onPass` hands the token over; `onClear` takes it away again when it expires.
//
// THREE OUTCOMES, NOT TWO, because "no token yet" and "this is broken" need different words under the button. A
// blocked script never calls back at all, so a button left disabled in silence is the DEFAULT failure rather
// than an unlikely one: `onBlocked` exists to make that case say something, and the timeout is what reaches it
// when api.js simply never arrives (a content blocker, a captive network).
//
// TWO OLDER COPIES OF THIS EXIST, named so nobody writes a fourth: the inline script in
// src/components/invite/InviteLander.astro and the `ensureTurnstile` closure in src/lib/claim-page.ts. Both are
// live and neither has DOM tests, so they were not rewritten onto this; consolidating them is follow-up work,
// and this is the copy a new surface should use.

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** How long to wait for api.js before telling the visitor why the button is off. */
const BLOCKED_AFTER_MS = 8000;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  reset: (id?: string) => void;
};

interface Win extends Window {
  turnstile?: TurnstileApi;
}

export interface TurnstileGate {
  /** Load the script if needed and render the widget. Safe to call repeatedly; renders at most once. */
  ensure: () => void;
  /** Drop the current token and ask the widget for a fresh one (after a spend, or a restored page). */
  refresh: () => void;
}

export interface TurnstileHandlers {
  /** A check passed: here is the token, good for exactly one use. */
  onPass: (token: string) => void;
  /** There is no usable token now (first load, expired, just spent). Turn the button off, say nothing alarming. */
  onClear: () => void;
  /** The check cannot run: the script errored or never arrived. Turn the button off AND explain. */
  onBlocked: () => void;
}

/**
 * Wire a Turnstile widget into `holder` (whose data-sitekey carries the key) and report its outcome.
 *
 * A null holder is treated as blocked rather than ignored: a caller with no widget to render has a button that
 * can never be enabled, and saying so beats leaving it dead.
 */
export function turnstileGate(
  holder: HTMLElement | null,
  { onPass, onClear, onBlocked }: TurnstileHandlers,
  doc: Document = document,
): TurnstileGate {
  const w = window as Win;
  let widget: string | null = null;
  let loading = false;

  const render = () => {
    if (widget !== null || !holder || !w.turnstile || typeof w.turnstile.render !== 'function') return;
    try {
      widget = w.turnstile.render(holder, {
        sitekey: holder.dataset.sitekey,
        theme: 'auto',
        callback: onPass,
        'expired-callback': onClear,
        'error-callback': () => { onBlocked(); return true; },
      }) ?? null;
    } catch {
      onBlocked();
    }
  };

  const ensure = () => {
    if (!holder) { onBlocked(); return; }
    if (widget !== null) return;
    if (w.turnstile && typeof w.turnstile.render === 'function') { render(); return; }
    if (loading) return;
    loading = true;
    const s = doc.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.addEventListener('load', render);
    s.addEventListener('error', () => { onBlocked(); });
    doc.head.appendChild(s);
    // The script that never arrives: no load event, no error event, no callback.
    window.setTimeout(() => { if (!w.turnstile) onBlocked(); }, BLOCKED_AFTER_MS);
  };

  const refresh = () => {
    onClear();
    try { if (w.turnstile) w.turnstile.reset(widget ?? undefined); } catch { /* widget not mounted */ }
  };

  return { ensure, refresh };
}

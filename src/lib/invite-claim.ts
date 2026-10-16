// sow-457: the wiring for the on-page invitation (src/components/invite/InviteClaim.astro).
//
// THE FIRST DECISION IS WHETHER TO DO ANYTHING AT ALL. Without a usable ?coupon= this returns immediately: no
// dialog, no strip, no Turnstile request, no listeners. The destination is a published article with ordinary
// readers, and every one of them runs this file. Their visit has to cost nothing.
//
// WITH a coupon, the dialog opens over the page on arrival (owner, 2026-10-15: like a project claim), and
// dismissing it leaves the strip, so an offer closed by accident is recoverable. Everything the dialog says
// about the terms comes from the tier registry through tierLine(), never from this file.
//
// THE TOKEN IS SPENT AND DROPPED IN THE SAME TAP. The invite landers learned on 2026-09-15 that a second tap
// while the phone was still navigating replays a spent token and reads as a failure, so the press clears the
// token, shows a pending state, and asks the widget for a fresh one if the browser has not left in 15 seconds.
// Nobody is left holding a dead button.
import { buildClaimSigninUrl, tierLine } from './claim-core.mjs';
import { couponFromSearch } from './invite-claim-core.mjs';
import { turnstileGate } from './turnstile-gate';

/** How long a press waits for the browser to leave before it offers itself again. */
const PENDING_MS = 15000;

function readCookie(name: string, doc: Document): string {
  if (!name) return '';
  for (const part of doc.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

function parseTiers(raw: string | undefined): Record<string, { label: string; priceAnnual: number }> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {}; // unreadable registry data omits the terms line rather than guessing at an offer
  }
}

export function startInviteClaim(doc: Document = document): void {
  const root = doc.querySelector<HTMLElement>('[data-invite-claim]');
  if (!root) return;

  // NOTHING HAPPENS WITHOUT A COUPON, and this is the whole gate: an ordinary reader of this article never
  // reaches another line of this file.
  const coupon = couponFromSearch(window.location.search);
  if (!coupon) return;

  const dialog = root.querySelector<HTMLDialogElement>('[data-invite-dialog]');
  const strip = root.querySelector<HTMLElement>('[data-invite-strip]');
  const openBtn = root.querySelector<HTMLButtonElement>('[data-invite-open]');
  const goBtn = root.querySelector<HTMLButtonElement>('[data-invite-go]');
  const tsHolder = root.querySelector<HTMLElement>('[data-invite-ts]');
  const waitNote = root.querySelector<HTMLElement>('[data-invite-wait]');
  const blockedNote = root.querySelector<HTMLElement>('[data-invite-blocked]');
  const tierEl = root.querySelector<HTMLElement>('[data-invite-tier]');
  if (!dialog || !goBtn) return;

  const signupBase = root.dataset.signupBase ?? '';
  const tier = root.dataset.tier ?? '';
  const freeDays = Number(root.dataset.freeDays);
  let pending = false;

  // The one line about the free year, from house/membership-tiers.yml through the build-time map. An unresolved
  // tier leaves it hidden rather than inventing an offer.
  if (tierEl) {
    const line = tierLine(
      { tier, freeDays: Number.isInteger(freeDays) ? freeDays : null },
      parseTiers(root.dataset.tiers),
    );
    if (line) { tierEl.textContent = line; tierEl.hidden = false; }
  }

  const setPending = (on: boolean) => {
    pending = on;
    goBtn.classList.toggle('is-pending', on);
    if (on) goBtn.setAttribute('aria-busy', 'true'); else goBtn.removeAttribute('aria-busy');
    if (on && waitNote) waitNote.hidden = true;
  };

  const gate = turnstileGate(tsHolder, {
    onPass: (token) => {
      goBtn.disabled = false;
      goBtn.dataset.token = token;
      if (waitNote) waitNote.hidden = true;
      if (blockedNote) blockedNote.hidden = true;
    },
    onClear: () => {
      goBtn.disabled = true;
      delete goBtn.dataset.token;
      // While a press is in flight the button has its own pending state; do not talk over it.
      if (waitNote && !pending) waitNote.hidden = false;
    },
    onBlocked: () => {
      goBtn.disabled = true;
      delete goBtn.dataset.token;
      if (waitNote) waitNote.hidden = true;
      if (blockedNote) blockedNote.hidden = false;
    },
  }, doc);

  const openDialog = () => {
    if (dialog.open) return;
    try { dialog.showModal(); } catch { /* already open, or no dialog support */ }
    gate.ensure();
  };
  const closeDialog = () => {
    if (dialog.open) {
      try { dialog.close(); } catch { /* nothing to close */ }
    }
    if (strip) strip.hidden = false; // the offer stays recoverable
  };

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-invite-close]')) {
    btn.addEventListener('click', closeDialog);
  }
  // Escape closes a native dialog without firing our handler, so the strip has to be revealed on close itself.
  dialog.addEventListener('close', () => { if (strip) strip.hidden = false; });
  openBtn?.addEventListener('click', openDialog);

  goBtn.addEventListener('click', () => {
    const token = goBtn.dataset.token;
    if (!token) { gate.ensure(); return; }
    // SPEND IT AND DROP IT IN THE SAME TAP: the token is single use and the Worker verifies it first.
    delete goBtn.dataset.token;
    goBtn.disabled = true;
    const url = buildClaimSigninUrl({
      signupBase,
      token,
      code: coupon,
      ref: readCookie(root.dataset.refCookie ?? '', doc),
      via: readCookie(root.dataset.viaCookie ?? '', doc),
      sid: readCookie(root.dataset.sidCookie ?? '', doc),
      // No return_to: there is nothing to come back to, so a new member lands on the welcome exactly as they do
      // from an invite lander.
      returnTo: null,
    });
    if (!url) { gate.refresh(); return; }
    setPending(true);
    window.setTimeout(() => {
      if (!pending) return;
      setPending(false);
      gate.refresh();
    }, PENDING_MS);
    window.location.href = url;
  });

  // Back/forward cache restores this page whole: an enabled button, a stale token, and no expiry callback, since
  // the page was frozen rather than running. The normal way back from GitHub would replay a spent token.
  window.addEventListener('pageshow', (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    setPending(false);
    gate.refresh();
  });

  openDialog();
}

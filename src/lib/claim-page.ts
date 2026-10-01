// sow-427: the browser half of the prepared-listing claim page (src/pages/claim/index.astro). Every decision lives in
// claim-core.mjs, which node --test covers; this file reads the Worker, fills the markup, and runs the timers.
//
// THE ORDER A VISIT RUNS IN.
//   1. The code from the address, checked before any request (a malformed code is the inactive panel, no fetch).
//   2. The signed-out read, GET /invite/listing (a plain fetch: wildcard CORS, no credentials). An inactive answer
//      reveals nothing, so the page shows nothing of the listing either.
//   3. The listing view and the dialog, opened on arrival.
//   4. When this browser holds a website session (the readable gbti_csrf cookie), the claim status, GET
//      /membership/claim with credentials. It is asked EVEN AFTER an inactive read (amendment 3): a claimed listing is
//      no longer readable, and the person who claimed it must still see their success and reach the welcome steps.
//   5. The view for that state. Publish POSTs only the code and the note, with the CSRF header; the states the server
//      finishes on its own are polled at 5, 10 and 15 seconds, then every 30.
//
// SAFETY RULES THIS FILE KEEPS. No listing string is ever given to innerHTML: frontmatter goes to textContent, the
// message to text nodes (messageToNodes), and the ONE parsed string is the markdown renderer's output, parsed inside
// an inert <template> and re-checked (links, images, frames) before it is attached. Every href comes from safeHref
// or a claim-core builder. Nothing here logs, and the tab title is never touched, so the project title stays out of
// the tab strip, the history list and any screen share.
//
// sow-434: the preview is the published page section for section. The larger DOM builders (the crumbs, the
// screenshots, the contents rail, the byline and the author note card) live in claim-render.ts, under the same rules.
import {
  parseClaimQuery, buildClaimSigninUrl, claimStatusUrl, listingReadUrl, listingImageUrl, pollDelayMs, greetingLine,
  preparedByLine, messageToNodes, tierLine, safeHref, safeImagePayload, imageDataUrl, listingImageNames, bodyImageSrc,
  bodyLinkHref, bodyFrameSrc, relayFrameSrc, listingModel, statusFromResponse, postOutcome, postErrorMessage, claimView,
  exampleProfileHref, bylineIdentity, noteCardName, noteCardView, POLLING_STATES, POLL_GIVE_UP_MS, WELCOME_REDIRECT_MS, NOTE_MAX,
} from './claim-core.mjs';
import { hasWebSessionCookie, signOutWeb, readMemberSignal, currentIdentity, onMemberSignal } from './member-signal';
import { renderCrumbs, renderGallery, renderToc, fillByline, renderNoteCard } from './claim-render';

type View = ReturnType<typeof claimView>;
type Action = View['actions'][number];

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** How many times the FIRST status read is retried before the page says the network did not answer. */
const FIRST_READ_TRIES = 3;

function readCookie(name: string): string {
  if (!name) return '';
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function startClaimPage(doc: Document): void {
  const rootEl = doc.querySelector('[data-claim-root]') as HTMLElement | null;
  const dialogEl = doc.querySelector('[data-claim-dialog]') as HTMLDialogElement | null;
  if (!rootEl || !dialogEl) return;
  const root: HTMLElement = rootEl;
  const dialog: HTMLDialogElement = dialogEl;
  const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = root) => from.querySelector(sel) as T | null;

  const base = root.dataset.signupBase || '';
  const { code, welcome } = parseClaimQuery(location.search);
  let labels: Record<string, string> = {};
  try { labels = JSON.parse(root.dataset.labels || '{}') || {}; } catch { labels = {}; }
  // house/licenses.yml, read at build (sow-434): the License row is built from it as on the published page.
  let licenses: unknown = null;
  try { licenses = JSON.parse(root.dataset.licenses || 'null'); } catch { licenses = null; }
  let tiers: Record<string, { label: string; priceAnnual: number }> = {};
  try { tiers = JSON.parse(dialog.dataset.tiers || '{}') || {}; } catch { tiers = {}; }

  const panel = $('[data-claim-panel]');
  const listingEl = $('[data-claim-listing]');
  const openBtn = $<HTMLButtonElement>('[data-claim-open]');
  const strip = $('[data-claim-strip]');
  // The example profile page for this invitation: the byline's name and the note card link there (sow-434).
  const profileHref = exampleProfileHref(code);

  let listing: any = null;
  let state = 'loading';
  let projectUrl: string | null = null;
  let waitStart = 0;
  let pollAttempt = 0;
  let pollTimer = 0;
  let gaveUp = false;
  let redirectTimer = 0;
  let dialogOpenedOnce = false;
  let onPanel = true; // the page alone (inactive, claimed, a failed read): no listing, so nothing to reopen
  let lastFocus: Element | null = null;
  let downOnBackdrop = false;

  // ---- the dialog --------------------------------------------------------------------------------------------
  const openDialog = () => {
    if (dialog.open || typeof dialog.showModal !== 'function') return;
    lastFocus = doc.activeElement;
    doc.documentElement.style.overflow = 'hidden';
    try { dialog.showModal(); } catch { return; }
    dialogOpenedOnce = true;
    if (openBtn) openBtn.hidden = true;
  };
  const closeDialog = () => { if (dialog.open) dialog.close(); };
  dialog.querySelectorAll('[data-claim-close]').forEach((b) => b.addEventListener('click', closeDialog));
  // The dark area is the dialog element itself; the press must START there, so a text selection dragged out of the
  // panel (or out of the note field) is not a dismissal.
  dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => { if (e.target === dialog && downOnBackdrop) closeDialog(); });
  dialog.addEventListener('close', () => {
    doc.documentElement.style.overflow = '';
    // The close event lands after render() has moved on, so it asks what is showing NOW: a panel has no dialog to reopen.
    if (openBtn && listing && !onPanel) openBtn.hidden = false;
    if (lastFocus instanceof HTMLElement && doc.contains(lastFocus)) lastFocus.focus();
  });
  openBtn?.addEventListener('click', openDialog);

  // ---- the bot check, on demand ------------------------------------------------------------------------------
  const tsHolder = $('[data-claim-ts]', dialog);
  const goBtn = $<HTMLButtonElement>('[data-claim-signin-go]', dialog);
  const tsNote = $('[data-claim-ts-note]', dialog);
  let tsWidget: string | null = null;
  let tsLoading = false;
  const w = window as any;
  const tsReset = () => { if (goBtn) { goBtn.disabled = true; delete goBtn.dataset.token; } };
  const tsOk = (token: string) => { if (goBtn) { goBtn.disabled = false; goBtn.dataset.token = token; } if (tsNote) tsNote.hidden = true; };
  const tsFail = () => { tsReset(); if (tsNote) tsNote.hidden = false; return true; };
  const renderTurnstile = () => {
    if (tsWidget !== null || !tsHolder || !w.turnstile || typeof w.turnstile.render !== 'function') return;
    try {
      tsWidget = w.turnstile.render(tsHolder, {
        sitekey: tsHolder.dataset.sitekey, theme: 'auto',
        callback: tsOk, 'expired-callback': tsReset, 'error-callback': tsFail,
      });
    } catch { tsFail(); }
  };
  const ensureTurnstile = () => {
    if (tsWidget !== null) return;
    if (w.turnstile && typeof w.turnstile.render === 'function') { renderTurnstile(); return; }
    if (tsLoading) return;
    tsLoading = true;
    const s = doc.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.addEventListener('load', renderTurnstile);
    s.addEventListener('error', () => { tsFail(); });
    doc.head.appendChild(s);
    // A blocked script never loads and no callback ever fires; say why the button stays disabled.
    window.setTimeout(() => { if (!w.turnstile && goBtn?.disabled && tsNote) tsNote.hidden = false; }, 8000);
  };
  // A Turnstile token is SINGLE USE and the Worker verifies it first, so spend it and drop it in the same tap (the
  // invite landers learned this on 2026-09-15: a second tap while the phone was still navigating read as a failure).
  goBtn?.addEventListener('click', () => {
    const token = goBtn.dataset.token || '';
    if (!token) return;
    tsReset();
    const url = buildClaimSigninUrl({
      signupBase: base, token, code,
      ref: readCookie(root.dataset.refCookie || ''), via: readCookie(root.dataset.viaCookie || ''),
      sid: readCookie(root.dataset.sidCookie || ''),
    });
    if (url) window.location.href = url;
  });
  // A page restored from the back/forward cache holds a spent token and an enabled button; force a fresh check.
  window.addEventListener('pageshow', (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    tsReset();
    try { if (w.turnstile && tsWidget !== null) w.turnstile.reset(tsWidget); } catch { /* not mounted */ }
  });

  // ---- the note and Publish -----------------------------------------------------------------------------------
  const noteForm = $<HTMLFormElement>('[data-claim-note]', dialog);
  const noteText = $<HTMLTextAreaElement>('[data-claim-note-text]', dialog);
  const noteCount = $('[data-claim-note-count]', dialog);
  const publishBtn = $<HTMLButtonElement>('[data-claim-publish]', dialog);
  const errEl = $('[data-claim-error]', dialog);
  const showError = (msg: string) => { if (errEl) { errEl.textContent = msg; errEl.hidden = !msg; } };
  const syncCount = () => { if (noteCount && noteText) noteCount.textContent = `${noteText.value.length} / ${NOTE_MAX}`; };
  noteText?.addEventListener('input', () => { syncCount(); showError(''); showNote(); });
  let publishing = false;
  noteForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (publishing || !noteText || !code) return;
    const note = noteText.value;
    if (!note.trim()) { showError(postErrorMessage('note_required')); noteText.focus(); return; }
    publishing = true;
    if (publishBtn) { publishBtn.disabled = true; publishBtn.textContent = 'Publishing'; }
    showError('');
    let outcome: { state: string; projectUrl?: string | null; error?: string };
    try {
      const csrf = readCookie('gbti_csrf');
      const res = await fetch(`${base.replace(/\/+$/, '')}/membership/claim`, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
        body: JSON.stringify({ code, note }),
      });
      outcome = postOutcome(res.status, await readJson(res));
    } catch {
      outcome = { state: 'ready', error: 'unavailable' };
    }
    publishing = false;
    if (publishBtn) { publishBtn.disabled = false; publishBtn.textContent = 'Publish'; }
    if (outcome.state === 'ready' && outcome.error) { showError(postErrorMessage(outcome.error)); return; }
    apply(outcome.state, { projectUrl: outcome.projectUrl ?? null });
  });

  // ---- actions -------------------------------------------------------------------------------------------------
  const actionNode = (a: Action): HTMLElement => {
    const cls = `btn ${a.primary ? 'btn-primary' : 'btn-ghost'}`;
    if (a.kind === 'link') {
      const el = doc.createElement('a');
      el.className = cls;
      el.textContent = a.label;
      // Site paths are ours; any absolute address must pass safeHref, and an address that fails renders nothing.
      const href = typeof a.href === 'string' && /^\/(?!\/)/.test(a.href) ? a.href : safeHref(a.href);
      if (href) el.href = href;
      return el;
    }
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      if (a.kind === 'retry') { location.reload(); return; }
      if (a.kind === 'recheck') { gaveUp = false; waitStart = Date.now(); pollAttempt = 0; void checkStatus(false); return; }
      if (a.kind === 'signout') {
        b.disabled = true;
        await signOutWeb(base);
        location.reload();
      }
    });
    return b;
  };
  const fillActions = (holder: Element | null, actions: Action[]) => {
    if (!holder) return;
    holder.replaceChildren(...actions.map(actionNode));
  };

  // ---- rendering a state --------------------------------------------------------------------------------------
  const setText = (el: Element | null, text: string) => { if (el) el.textContent = text; };
  const show = (el: HTMLElement | null, on: boolean) => { if (el) el.hidden = !on; };

  function render(next: string): void {
    const changed = next !== state;
    state = next;
    const v = claimView(next, { welcome, waitedMs: waitStart ? Date.now() - waitStart : 0, projectUrl, gaveUp });
    onPanel = v.surface === 'panel' || !listing;
    window.clearTimeout(redirectTimer);

    if (onPanel) {
      closeDialog();
      show(listingEl, false);
      show(openBtn, false);
      show(strip, false);
      show(panel, true);
      setText($('[data-claim-panel-title]'), v.title);
      setText($('[data-claim-panel-text]'), v.text);
      show($('[data-claim-panel-busy]'), v.busy);
      fillActions($('[data-claim-panel-actions]'), v.actions);
    } else {
      show(panel, false);
      show(listingEl, true);
      show(strip, true);
      showIdentity();
      setText($('[data-claim-title]', dialog), v.title);
      setText($('[data-claim-text]', dialog), v.text);
      const tier = v.tier ? tierLine({ tier: listing.tier, freeDays: listing.freeDays }, tiers) : null;
      const tierEl = $('[data-claim-tier]', dialog);
      setText(tierEl, tier || '');
      show(tierEl, Boolean(tier));
      show($('[data-claim-busy]', dialog), v.busy);
      const signin = $('[data-claim-signin]', dialog);
      show(signin, Boolean(v.signin));
      if (v.signin) {
        setText(goBtn, v.signin.label);
        ensureTurnstile();
      }
      show(noteForm, v.note);
      if (v.note) syncCount();
      else showError('');
      fillActions($('[data-claim-actions]', dialog), v.actions);
      // The dialog opens on arrival. After that it reopens only with the RESULT of a wait (a poll that ended), so a
      // person who closed it to read the listing is not interrupted while the page is still checking.
      if (!dialogOpenedOnce) openDialog();
      else if (changed && next !== 'checking' && !POLLING_STATES.includes(next)) openDialog();
      if (!dialog.open && openBtn) openBtn.hidden = false;
    }
    if (v.redirect) {
      const to = v.redirect;
      redirectTimer = window.setTimeout(() => { window.location.assign(to); }, WELCOME_REDIRECT_MS);
    }
  }

  // ---- the claim status, and polling --------------------------------------------------------------------------
  const stopPoll = () => { window.clearTimeout(pollTimer); pollTimer = 0; };
  const schedulePoll = (retryAfterSeconds: number | null) => {
    stopPoll();
    if (waitStart && Date.now() - waitStart >= POLL_GIVE_UP_MS) { gaveUp = true; render(state); return; }
    const delay = pollDelayMs(pollAttempt, retryAfterSeconds);
    pollAttempt += 1;
    pollTimer = window.setTimeout(() => { void checkStatus(false); }, delay);
  };

  function apply(next: string, extra: { projectUrl?: string | null; retryAfterSeconds?: number | null } = {}): void {
    if (next === 'claimed') projectUrl = extra.projectUrl ?? null;
    // Fail closed: with nothing readable to show, the only states worth a page are success and a failed read.
    if (!listing && !['claimed', 'error', 'rate_limited'].includes(next)) next = 'inactive';
    if (POLLING_STATES.includes(next)) {
      if (!POLLING_STATES.includes(state)) { waitStart = Date.now(); pollAttempt = 0; gaveUp = false; }
      render(next);
      if (!gaveUp) schedulePoll(extra.retryAfterSeconds ?? null);
      return;
    }
    stopPoll();
    waitStart = 0;
    gaveUp = false;
    render(next);
  }

  async function checkStatus(first: boolean): Promise<void> {
    const url = claimStatusUrl(base, code);
    if (!url) { apply('inactive'); return; }
    for (let attempt = 0; ; attempt += 1) {
      let r: ReturnType<typeof statusFromResponse>;
      try {
        const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
        r = statusFromResponse(res.status, await readJson(res));
      } catch {
        r = { transient: true };
      }
      if (!('transient' in r)) {
        apply(r.state as string, { projectUrl: (r as any).projectUrl ?? null, retryAfterSeconds: (r as any).retryAfterSeconds ?? null });
        return;
      }
      // A failed read during a wait keeps the view as it is and asks again on the schedule.
      if (!first) {
        if (POLLING_STATES.includes(state) && !gaveUp) schedulePoll((r as any).rateLimited ? 60 : null);
        return;
      }
      if (attempt + 1 >= FIRST_READ_TRIES) { apply((r as any).rateLimited ? 'rate_limited' : 'error'); return; }
      await wait(pollDelayMs(attempt, (r as any).rateLimited ? 30 : null));
    }
  }

  // ---- the listing ---------------------------------------------------------------------------------------------
  async function readListing(): Promise<{ listing?: any; inactive?: boolean; rateLimited?: boolean; error?: boolean }> {
    const url = listingReadUrl(base, code);
    if (!url) return { inactive: true };
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 429) return { rateLimited: true };
      if (res.status === 404) return { inactive: true };
      const body = await readJson(res);
      if (res.ok && body && body.ok === true && body.listing && typeof body.listing === 'object') return { listing: body.listing };
      return res.status >= 500 ? { error: true } : { inactive: true };
    } catch {
      return { error: true };
    }
  }

  async function loadImages(l: any): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await Promise.all(listingImageNames(l).map(async (name: string) => {
      const url = listingImageUrl(base, code, name);
      if (!url) return;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const src = imageDataUrl(safeImagePayload(await readJson(res), name));
        if (src) out[name] = src;
      } catch { /* a missing picture leaves its frame empty; the listing still reads */ }
    }));
    return out;
  }

  const setImg = (sel: string, src: string, alt = '') => {
    const el = $<HTMLImageElement>(sel);
    if (!el) return;
    if (src) { el.src = src; el.alt = alt; el.hidden = false; } else { el.removeAttribute('src'); el.hidden = true; }
  };
  // An icon from the page's sprite. `size` is set only where the published markup sets it (the end CTA's 16px); the
  // install bar and the rail size theirs in CSS (.pd-bar .btn svg, .pd-rail-link svg), as published.
  const iconSvg = (id: string | null, size?: number): SVGSVGElement | null => {
    if (!id) return null;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (size) { svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); }
    svg.setAttribute('aria-hidden', 'true');
    const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.appendChild(use);
    return svg;
  };
  const linkButton = (l: { label: string; url: string; locked?: boolean; icon?: string | null; hint?: string }, cls: string, iconSize?: number): HTMLElement => {
    if (l.locked) {
      // A members-only link renders inert, as on the published page: the lock icon, the label and the tooltip.
      const span = doc.createElement('span');
      span.className = /\bbtn\b/.test(cls) ? `${cls} pd-locked-btn` : cls;
      if (l.hint) span.setAttribute('data-tooltip', l.hint);
      const lock = iconSvg('ico-lock');
      if (lock) span.appendChild(lock);
      span.appendChild(doc.createTextNode(l.label));
      return span;
    }
    const a = doc.createElement('a');
    a.className = cls;
    a.href = l.url;
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    const svg = iconSvg(l.icon ?? null, iconSize);
    if (svg) a.appendChild(svg);
    a.appendChild(doc.createTextNode(l.label));
    return a;
  };

  /** The markdown body, parsed inertly and checked node by node before any of it reaches the page. */
  async function renderBody(md: string, images: Record<string, string>): Promise<void> {
    const bodyEl = $('[data-cl-body]');
    if (!bodyEl) return;
    let html = '';
    try {
      const { renderMarkdown } = await import('../../client/src/markdown.mjs');
      html = renderMarkdown(md);
    } catch { html = ''; }
    const tpl = doc.createElement('template');
    tpl.innerHTML = html; // the renderer escapes raw HTML; inside a <template> nothing loads or runs
    const frag = tpl.content;
    frag.querySelectorAll('script, style, object, embed, form, input, button:not(.md-embed-open), link, meta, base').forEach((n) => n.remove());
    frag.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) if (/^on/i.test(attr.name) || attr.name === 'srcdoc') el.removeAttribute(attr.name);
    });
    frag.querySelectorAll('img').forEach((img) => {
      const src = bodyImageSrc(img.getAttribute('src') || '', images);
      if (!src) { img.remove(); return; }
      img.setAttribute('src', src);
      img.removeAttribute('srcset');
      img.setAttribute('referrerpolicy', 'no-referrer');
    });
    frag.querySelectorAll('a').forEach((a) => {
      const href = bodyLinkHref(a.getAttribute('href') || '');
      if (!href) { a.removeAttribute('href'); return; }
      a.setAttribute('href', href);
      if (!href.startsWith('#')) a.setAttribute('rel', 'noopener noreferrer');
    });
    frag.querySelectorAll('iframe').forEach((f) => {
      const src = bodyFrameSrc(f.getAttribute('src') || '', location.origin);
      if (!src) { f.remove(); return; }
      f.setAttribute('src', src);
    });
    frag.querySelectorAll('[data-embed-src]').forEach((el) => {
      const src = bodyFrameSrc(el.getAttribute('data-embed-src') || '', location.origin);
      if (src) el.setAttribute('data-embed-src', src); else el.remove();
    });
    bodyEl.replaceChildren(frag);
  }

  async function showListing(l: any): Promise<void> {
    // The dialog's greeting and message first: they are what the person came for.
    setText($('[data-claim-greeting]', dialog), greetingLine(l.recipientName));
    const msg = $('[data-claim-message]', dialog);
    if (msg) msg.replaceChildren(...messageToNodes(typeof l.message === 'string' ? l.message : '', doc));
    setText($('[data-claim-from]', dialog), preparedByLine(l.preparedByLogin));

    const images = await loadImages(l);
    const m = listingModel(l, { labels, images, licenses, now: new Date() });

    const hero = $('[data-cl-hero]');
    if (hero) { if (m.hero.preset) hero.setAttribute('data-preset', m.hero.preset); else hero.removeAttribute('data-preset'); }
    setImg('[data-cl-hero-img]', m.hero.image);
    setImg('[data-cl-mark]', m.mark, '');
    setImg('[data-cl-barmark]', m.barMark, '');
    setText($('[data-cl-title]'), m.title);
    setText($('[data-cl-barname]'), m.title);
    setText($('[data-cl-desc]'), m.description);

    const eb = $('[data-cl-eyebrow]');
    if (eb) renderCrumbs(doc, eb, m.crumbs);

    const version = $('[data-cl-version]');
    setText(version, m.version); show(version, Boolean(m.version));
    const pricing = $('[data-cl-pricing]');
    setText(pricing, m.pricing); show(pricing, Boolean(m.pricing));

    const actions: HTMLElement[] = [];
    if (m.repo) actions.push(linkButton(m.repo, 'btn btn-ghost pd-bar-gh'));
    if (m.primary) actions.push(linkButton(m.primary, 'btn btn-primary'));
    $('[data-cl-actions]')?.replaceChildren(...actions);

    const cta = $('[data-cl-cta]');
    if (cta) {
      const btns: HTMLElement[] = [];
      // The CTA icons carry width and height 16, as the published CTA markup does.
      if (m.primary && !m.primary.locked) btns.push(linkButton(m.primary, 'btn btn-primary', 16));
      if (m.repo) btns.push(linkButton(m.repo, 'btn btn-ghost', 16));
      $('[data-cl-cta-btns]')?.replaceChildren(...btns);
      const sub = $('[data-cl-cta-sub]');
      setText(sub, m.ctaSub); show(sub, Boolean(m.ctaSub));
      show(cta, btns.length > 0);
    }

    $('[data-cl-grid]')?.setAttribute('data-side', m.side);

    const specs = $('[data-cl-specs]');
    if (specs) {
      specs.replaceChildren(...m.specs.map(([k, val]: [string, string]) => {
        const row = doc.createElement('div');
        row.className = 'pd-spec';
        const dt = doc.createElement('dt'); dt.textContent = k;
        const dd = doc.createElement('dd'); dd.textContent = val;
        row.append(dt, dd);
        return row;
      }));
      // The License row after the others, as published: a green link to the terms (.pd-release-link), or plain text
      // for a licence with no public page.
      if (m.license) {
        const row = doc.createElement('div');
        row.className = 'pd-spec';
        const dt = doc.createElement('dt'); dt.textContent = 'License';
        const dd = doc.createElement('dd');
        if (m.license.href) {
          const licLink = doc.createElement('a');
          licLink.className = 'pd-release-link';
          licLink.href = m.license.href;
          licLink.rel = 'noopener noreferrer';
          licLink.target = '_blank';
          licLink.textContent = m.license.id;
          dd.appendChild(licLink);
        } else {
          dd.textContent = m.license.id;
        }
        row.append(dt, dd);
        specs.appendChild(row);
      }
    }
    $('[data-cl-tags]')?.replaceChildren(...m.tags.map((t: string) => {
      const s = doc.createElement('span'); s.className = 'pd-tag'; s.textContent = t; return s;
    }));
    show($('[data-cl-specblock]'), m.specs.length > 0 || m.tags.length > 0 || Boolean(m.license));

    const linkBlock = $('[data-cl-linkblock]');
    if (linkBlock) {
      // As on the published page the links sit directly under the rail label, so the block's column layout spaces them.
      linkBlock.querySelectorAll(':scope > :not(.pd-rail-lab)').forEach((n) => n.remove());
      linkBlock.append(...m.railLinks.map((l: any) => linkButton(l, `pd-rail-link${l.locked ? ' locked' : ''}`)));
      show(linkBlock, m.railLinks.length > 0);
    }

    const videoBox = $('[data-cl-video]');
    const frameSrc = m.video ? relayFrameSrc(m.video, location.origin) : null;
    if (videoBox && frameSrc) {
      const wrap = doc.createElement('div');
      wrap.className = 'aspect-video w-full overflow-hidden';
      wrap.style.borderRadius = 'var(--r-lg)';
      wrap.style.background = 'var(--ink)';
      const f = doc.createElement('iframe');
      f.src = frameSrc;
      f.title = 'Project video';
      f.loading = 'lazy';
      f.className = 'h-full w-full';
      f.allowFullscreen = true;
      f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      wrap.appendChild(f);
      videoBox.replaceChildren(wrap);
      videoBox.hidden = false;
    }

    const gal = $('[data-cl-gallery]');
    if (gal && m.gallery.length) {
      setText($('[data-cl-gallery-title]'), `See ${m.title} in action`);
      renderGallery(doc, gal, { title: m.title, shots: m.gallery, captioned: m.captioned, style: m.galleryStyle });
    }

    await renderBody(m.body, images);
    const nav = $('[data-cl-toc]');
    const bodyEl = $('[data-cl-body]');
    if (nav && bodyEl) renderToc(doc, nav, bodyEl, { hasGallery: m.gallery.length > 0 });

    // The suggested note starts the claim note (sow-434 decision 1), unless the browser restored something typed.
    const suggestion = typeof l.suggestedNote === 'string' ? l.suggestedNote : '';
    if (noteText && !noteText.value && suggestion) { noteText.value = suggestion; syncCount(); }
    showIdentity();
  }

  // ---- the byline and the author note: whose name and face, and the note as it stands -------------------------
  const today = new Date();
  const who = () => bylineIdentity({ state, signal: currentIdentity(readMemberSignal()), recipientName: listing?.recipientName });
  function showNote(): void {
    const holder = $('[data-cl-note]');
    if (!holder || !listing) return;
    const view = noteCardView({ suggestion: typeof listing.suggestedNote === 'string' ? listing.suggestedNote : '', current: noteText ? noteText.value : null });
    // The face is the byline's; the name is the folder the published card will print (noteCardName).
    const name = noteCardName({ state, signal: currentIdentity(readMemberSignal()), listing });
    renderNoteCard(doc, holder, { ...who(), name }, profileHref, view);
  }
  function showIdentity(): void {
    const byline = $('[data-cl-byline]');
    if (!listing) return;
    if (byline) fillByline(doc, byline, who(), profileHref, today);
    showNote();
  }
  // The signed-in identity can arrive after the claim status (the cookie session resolves on its own schedule).
  onMemberSignal(() => { if (listing && !onPanel) showIdentity(); });

  // ---- the visit -----------------------------------------------------------------------------------------------
  async function boot(): Promise<void> {
    render('loading');
    if (!code) { apply('inactive'); return; }
    const read = await readListing();
    if (read.rateLimited) { apply('rate_limited'); return; }
    if (read.error) { apply('error'); return; }
    if (read.listing) {
      listing = read.listing;
      await showListing(listing);
    }
    if (!hasWebSessionCookie()) { apply(listing ? 'signin' : 'inactive'); return; }
    if (listing) render('checking');
    await checkStatus(true);
  }

  void boot();
}

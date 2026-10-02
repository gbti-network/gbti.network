// sow-396 (owner, 2026-09-24; placement A chosen 2026-10-02): the extension's "Submit content" dialog, opened from the
// top-bar button beside the bell on every extension page (the button itself is in shell.mjs controlsHtml).
//
// The extension stays a READER (sow-204, sow-406): articles, projects and prompts are written on the website, so three
// of the four choices open the website editor in a new tab through the WorkBench's own `#new=<type>` deep link
// (parseWorkspaceNew, client-ui/src/workspace-core.mjs). Only a share is posted from here, through the share box the
// extension already has (openComposeModal in shell.mjs).
//
// An account that cannot publish is told why instead, in the owner's approved wording (2026-09-19), which lives in ONE
// place: lockedAccountCopy (client/src/membership.mjs). This module never carries a second copy of it.
//
// Design of record: the canvas "Extension Submit Content", https://claude.ai/artifact/7Re1RMKVCivm1pGemywtHr.

import { upgradePromptKind, lockedAccountCopy } from '../../client/src/membership.mjs';

const SITE = 'https://gbti.network';

/** The explainer page, linked from the chooser and from the free account's dialog. */
export const HOW_PUBLISHING_URL = `${SITE}/submit-content/`;

/** The four choices, in the canvas's order and words. `href` null means the choice is handled here (the share box). */
export const SUBMIT_CHOICES = Object.freeze([
  Object.freeze({ key: 'post', title: 'Article', desc: 'A tutorial, a write-up or an opinion for the network.', href: `${SITE}/workbench/#new=post`, icon: 'pencil' }),
  Object.freeze({ key: 'project', title: 'Project', desc: 'Something you built: a plugin, an app, a tool.', href: `${SITE}/workbench/#new=project`, icon: 'box' }),
  Object.freeze({ key: 'prompt', title: 'Prompt & Skill', desc: 'A prompt or an agent skill others can reuse.', href: `${SITE}/workbench/#new=prompt`, icon: 'bot' }),
  Object.freeze({ key: 'share', title: 'Share', desc: 'A link worth reading, with a note on why.', href: null, icon: 'link' }),
]);

/**
 * Which dialog a press of the button shows, from the shell's /api/status reply. Pure.
 *   - no status yet (pressed before the membership check answered): 'loading';
 *   - paid, or a check that failed ('unknown', or no membership at all): 'choose'. The interface fails OPEN here on
 *     purpose (the canvas ruling): the website editor and the publish gate still decide what can be published;
 *   - a free account: 'join'; a lapsed member: 'renew' (upgradePromptKind);
 *   - 'trialing', a tier that no longer exists (owner, 2026-09-22), is told what membership adds, like a free account;
 *   - anything else (a restricted account): 'restricted', which offers no button, because paying lifts no restriction.
 */
export function submitDialogKind(status) {
  if (!status) return 'loading';
  const m = status.membership;
  if (m === 'paid' || m === 'unknown' || m == null) return 'choose';
  if (m === 'trialing') return 'join';
  return upgradePromptKind(m) || 'restricted';
}

/** The membership value whose approved wording a locked dialog shows (trialing reads as a free account). Pure. */
const copyFor = (membership) => lockedAccountCopy(membership === 'trialing' ? 'none' : membership);

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Inline glyphs (the extension CSP forbids fetching them). Trusted constants, drawn to the canvas.
const SVG = {
  pencil: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8V4.5M12 4.5h-1.5M9 13h.01M15 13h.01M9.5 16.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  link: '<path d="M10.5 13.5a3 3 0 0 0 4.5.3l2.4-2.4a3.2 3.2 0 0 0-4.5-4.5l-1.4 1.4M13.5 10.5a3 3 0 0 0-4.5-.3l-2.4 2.4a3.2 3.2 0 0 0 4.5 4.5l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  out: '<path d="M8 16L16 8M9.5 8H16v6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  chev: '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>`;

/** The pencil glyph, exported for the button's folded (narrow window) form. */
export const PENCIL_SVG = SVG.pencil;

const howLink = (cls) => `<a class="${cls}" href="${HOW_PUBLISHING_URL}" target="_blank" rel="noopener">How publishing works ${svg('out')}</a>`;

function choiceHtml(ch) {
  const tag = ch.href ? `Opens the website editor ${svg('out')}` : 'Opens the share box here';
  const inner = `<span class="sc-tile">${svg(ch.icon)}</span>
      <span class="sc-txt"><b class="sc-title">${escHtml(ch.title)}</b><span class="sc-desc">${escHtml(ch.desc)}</span><span class="sc-tag">${tag}</span></span>
      <span class="sc-chev">${svg('chev')}</span>`;
  return ch.href
    ? `<li><a class="sc-choice" href="${ch.href}" target="_blank" rel="noopener" data-sc-choice="${ch.key}">${inner}</a></li>`
    : `<li><button class="sc-choice" type="button" data-sc-choice="${ch.key}">${inner}</button></li>`;
}

/**
 * The dialog for a kind ('choose' | 'join' | 'renew' | 'restricted' | 'loading'), as markup for the overlay. `membership`
 * picks the approved wording for the locked kinds. Pure; every dynamic string is escaped.
 */
export function submitDialogHtml(kind, membership) {
  const head = `<button class="share-x" type="button" aria-label="Close" data-sc-close>${svg('x')}</button>
    <p class="sc-eyebrow"><span class="sc-dot" aria-hidden="true"></span>Submit content</p>`;
  if (kind === 'choose') {
    return `<div class="sc-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title" data-sc-kind="choose">${head}
    <h2 id="sc-title">What would you like to create?</h2>
    <p class="sc-lead">Articles, projects and prompts open the editor on gbti.network in a new tab. A share is posted from here.</p>
    <ul class="sc-choices">${SUBMIT_CHOICES.map(choiceHtml).join('')}</ul>
    <div class="sc-foot">${howLink('sc-how')}</div>
  </div>`;
  }
  if (kind === 'loading') {
    const row = '<li class="sc-skrow"><span class="sc-sk sc-sk-tile"></span><span class="sc-sk-lines"><span class="sc-sk sc-sk-a"></span><span class="sc-sk sc-sk-b"></span></span></li>';
    return `<div class="sc-dialog" role="dialog" aria-modal="true" aria-label="Submit content" aria-busy="true" data-sc-kind="loading">${head}
    <span class="sc-sk sc-sk-h"></span><span class="sc-sk sc-sk-p"></span>
    <ul class="sc-choices" aria-hidden="true">${row.repeat(4)}</ul>
    <p class="sc-checking" role="status">Checking your membership&hellip;</p>
  </div>`;
  }
  const copy = copyFor(membership);
  const cta = copy.cta ? `<a class="sc-cta" href="${escHtml(copy.cta.href)}" target="_blank" rel="noopener">${escHtml(copy.cta.label)} ${svg('arrow')}</a>` : '';
  const how = kind === 'join' ? howLink('sc-how') : '';
  const close = copy.cta ? '' : '<button class="sc-close" type="button" data-sc-close>Close</button>';
  return `<div class="sc-dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title" data-sc-kind="${escHtml(kind)}">${head}
    <h2 id="sc-title">${escHtml(copy.heading)}</h2>
    <p class="sc-body">${escHtml(copy.body)}</p>
    <div class="sc-acts">${cta}${how}${close}</div>
  </div>`;
}

/**
 * Open the dialog on the shared `.compose-modal` overlay. `status` is the shell's settled /api/status reply, or null
 * while it is still on its way, in which case `statusReady` (the shell's promise of it) re-renders the dialog when it
 * lands. `onShare` opens the share box. Esc, the close button and a click outside close it; there is nothing in
 * progress to lose. Following a link closes it on the next tick, because a link removed from the page during its own
 * click is not followed. Returns the overlay, or null when the dialog is already open.
 */
export function openSubmitDialog({ status = null, statusReady = null, onShare = () => {}, returnFocus = null } = {}) {
  if (document.querySelector('.submit-modal')) return null;
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal submit-modal';
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
    returnFocus?.focus?.();
  };
  const render = (st) => {
    overlay.innerHTML = submitDialogHtml(submitDialogKind(st), st?.membership);
    (overlay.querySelector('.sc-choice, .sc-cta, .sc-close') || overlay.querySelector('[data-sc-close]'))?.focus?.();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const t = e.target.closest?.('[data-sc-close], [data-sc-choice="share"], a');
    if (!t) return;
    if (t.matches('[data-sc-close]')) { close(); return; }
    if (t.matches('[data-sc-choice="share"]')) { close(); onShare(); return; }
    setTimeout(close, 0); // a link: let it open its tab first
  });
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
  render(status);
  if (!status && statusReady) {
    // Signed out by the time it answers: the sign-in wall takes over, so the dialog has nothing to say.
    statusReady.then((st) => { if (!overlay.isConnected) return; if (st) render(st); else close(); }, () => { if (overlay.isConnected) render({ membership: 'unknown' }); });
  }
  return overlay;
}

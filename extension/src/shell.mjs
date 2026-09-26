// extension/src/shell.mjs (SOW-036/039): the SHARED member-hub shell for every extension page. initShell() puts the
// brand and the controls in the page's top row (no left menu since sow-406) and wires the theme toggle, the quick
// launch (sow-397), and the account dropdown (identity, sign-out, role-gated Admin).
// A signed-out page shows the sign-in wall instead (mountAuthGate), which is the extension's only sign-in screen. One
// implementation so the chrome stays identical across newtab / saved / shares / account / admin. CSP-safe: trusted constant markup, no inline handlers, inline-SVG icons. The icon set + esc are
// exported so the new-tab feed reuses them.

import '../../client-ui/src/elements/gbti-share-composer.mjs'; // SOW-041 P5: the top-bar "+" mounts this composer
import '../../client-ui/src/elements/gbti-activity-bell.mjs'; // SOW-042 P3: the top-bar activity bell
import '../../client-ui/src/elements/gbti-debug-panel.mjs'; // SOW-124: the superadmin Debug panel (devlog viewer)
// sow-387: the sign-in wall's own element. It replaces <gbti-welcome auth-gate>, which could fail open into the setup
// wizard, and the wizard itself no longer ships in the extension: setup lives on the website.
import '../../client-ui/src/elements/gbti-signin-splash.mjs';
import { makePkce, startUrl, readRedirectResult, REDIRECT_PATH } from './web-signin.mjs'; // sow-393: the website sign-in
import { expiryPopupDecision, expiryPopupCopy } from '../../client-ui/src/membership-expiry.mjs'; // SOW-119 QA: the coupon-expiry countdown
import { devlog, devlogFlagOn, setDevlogFlag } from './devlog.mjs'; // SOW-124: the page realm's devlog + the shared flag
import { mountQuickLaunch } from './quick-launch.mjs'; // sow-397: the quick launch pill + its settings popup

const SITE = 'https://gbti.network';
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Inline SVG icon set (CSP forbids external requests for these). Shared by the shell + the new-tab feed.
export const SVG = {
  prompt: '<path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 9.5h6M9 12.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  article: '<path d="M4.5 14.5h6.6v3.2a1.9 1.9 0 0 1-1.9 1.9H6.4a1.9 1.9 0 0 1-1.9-1.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.4 14.6C10.5 9.4 14.4 5.2 20 3.4c.5 5.6-2.4 10.1-7 12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/><path d="M10.8 11.6l3 .4M13.4 8.2l2.7 .4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', // inkwell + quill (Articles)
  project: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  coin: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.5c-.6-.8-1.6-1.2-2.7-1.2-1.5 0-2.6.8-2.6 2s1 1.7 2.6 1.9c1.6.2 2.7.7 2.7 2s-1.1 2-2.7 2c-1.2 0-2.2-.5-2.8-1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  news: '<path d="M4 5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M18 9h2a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7H21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="4" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  chev: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  mCompact: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  mDetailed: '<rect x="3.5" y="4.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="3.5" y="14.5" width="5" height="5" rx="1" fill="currentColor"/><path d="M11 6h9M11 9h6M11 16h9M11 19h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  mCard: '<rect x="4" y="4" width="7" height="7" rx="1.3" fill="currentColor"/><rect x="13" y="4" width="7" height="7" rx="1.3" fill="currentColor"/><rect x="4" y="13" width="7" height="7" rx="1.3" fill="currentColor"/><rect x="13" y="13" width="7" height="7" rx="1.3" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mega: '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 3.5V5.5L7 9H5a1 1 0 0 0-1 1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', // megaphone (Share)
  share: '<path d="m3 11 18-5v12L3 14v-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', // SOW-069: paper-plane (Shares rail + card cat-glyph; matches the "New Share" composer card), replacing a coin
  // SOW-052: the WorkBench rail glyphs.
  bookmark: '<path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M16.5 13.5a5.5 5.5 0 0 1 4 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 19.5a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', // SOW-129: Profile rail glyph
  gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13a7.8 7.8 0 0 0 0-2l1.7-1.3-1.7-3-2 .8a7.6 7.6 0 0 0-1.7-1l-.3-2.1H10l-.3 2.1a7.6 7.6 0 0 0-1.7 1l-2-.8-1.7 3L6 11a7.8 7.8 0 0 0 0 2l-1.7 1.3 1.7 3 2-.8a7.6 7.6 0 0 0 1.7 1l.3 2.1h3.6l.3-2.1a7.6 7.6 0 0 0 1.7-1l2 .8 1.7-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  pr: '<circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 8.2v7.6M18 15.8V11a4 4 0 0 0-4-4h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  // SOW-052: the "Network" rail item (back to the co-op feed) — connected nodes.
  network: '<circle cx="6" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7h8M7.7 8.6 10.7 16M16.3 8.6 13.3 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};
export const ico = (k) => (SVG[k] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>` : '');

// sow-406 (owner, 2026-09-25): "no workbench support from the extension". The WorkBench page and the left menu that
// carried it on the Shares, Admin tools and WorkBench pages are gone; every extension page now has the new tab's
// railless layout (sow-296): the brand and the controls share the top row. What members still reach from here is in
// the avatar menu below: favorites and collections (an extension page), Following and Earnings (the website
// WorkBench), Profile, Settings and the staff tools.

// SOW-052: the relocatable control cluster (no longer a full-width bar). initShell appends it to the page's
// top-right [data-topbar] slot. Order: apps, the view-mode slot (the new tab moves its .nt-modes here), bell,
// theme, account.
// sow-296: the "+" is for the pages with no other way to post (Shares, Admin tools: they pass compose:true). The new
// tab leaves it off, because its hero share bar is the compose affordance there and two controls for one action
// beside each other is worse than one. wireCompose binds whichever of the two exists.
function controlsHtml({ compose = false } = {}) {
  return `<div class="nt-controls" data-controls>
    <span class="nt-apps" data-apps></span>
    <span class="nt-modes-slot" data-modes-slot></span>
    <gbti-activity-bell></gbti-activity-bell>
    <button class="nt-icobtn" data-theme-toggle title="Toggle theme" aria-label="Toggle theme"></button>
    <div class="nt-acctwrap" data-me-wrap>
      <button class="nt-acct" data-me-btn type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu" hidden>
        <img class="av" data-me-av alt="" width="34" height="34" />
        <span data-ico="chev"></span>
      </button>
      <div class="me-menu" data-me-menu role="menu" hidden>
        <div class="me-head" data-me-head></div>
        <div class="me-sep" role="separator"></div>
        <a class="mi" role="menuitem" href="saved.html#favorites" data-me-saved="favorites">Favorites</a>
        <a class="mi" role="menuitem" href="saved.html#collections" data-me-saved="collections">Collections</a>
        <a class="mi" role="menuitem" href="${SITE}/workbench/#tab=subs" target="_blank" rel="noopener">Following</a>
        <a class="mi" role="menuitem" href="${SITE}/workbench/#tab=earnings" target="_blank" rel="noopener">Earnings</a>
        <a class="mi" role="menuitem" href="${SITE}/members/" data-me-profile target="_blank" rel="noopener">Profile</a>
        <a class="mi" role="menuitem" href="account.html">Settings</a>
        <a class="mi" role="menuitem" href="admin.html" data-admin-only hidden>Admin tools</a>
        <button class="mi" role="menuitem" type="button" data-debug-panel data-super-only hidden>Debug</button>
        <div class="me-sep" role="separator"></div>
        <button class="mi mi-signout" role="menuitem" type="button" data-me-signout>Sign out</button>
      </div>
    </div>
    ${compose ? '<button class="nt-icobtn" data-compose data-ico="plus" title="Post a Share" aria-label="Post a Share" aria-haspopup="dialog"></button>' : ''}
  </div>`;
}

// SOW-052: the GBTI brand mark, at the start of the top row (sow-296 moved it there from the old rail). The icon is the
// packaged extension logo, accessible by a page-relative path. sow-411 (owner, 2026-09-26): it reads "GBTI" (no
// "Network") and opens the public site in a new tab, like the quick launch; the pages besides the feed lead back to it
// with a breadcrumb instead.
function brandHtml() {
  return `<a class="nt-brand" href="https://gbti.network/" target="_blank" rel="noopener" aria-label="GBTI Network website, opens in a new tab">
    <img class="nt-brand-mk" src="icons/icon-128.png" alt="" width="26" height="26" />
    <span class="nt-brand-tx">GBTI</span>
  </a>`;
}

/** GET /api/* via the background worker; null on any failure. */
async function api(pathname, query = {}) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query } });
    return r?.json ?? null;
  } catch { return null; }
}

/** Reflect the signed-in status into the account control and every avatar the page carries. */
function applyAccount(root, status) {
  const meBtn = root.querySelector('[data-me-btn]');
  if (status) {
    const login = status.identity.login;
    // sow-296: querySelectorAll, because the new tab's hero share bar carries a SECOND [data-me-av]. With
    // querySelector it stayed an empty disc while the top-bar avatar filled, which reads as a broken control.
    root.querySelectorAll('[data-me-av]').forEach((av) => {
      av.src = `https://github.com/${encodeURIComponent(login)}.png?size=64`;
      av.alt = `@${login}`;
    });
    // The avatar menu's Profile opens the member's own public page (owner, 2026-09-25).
    // The member folder name, as the website's Header does (username, else login).
    const folder = status.identity.username || String(login).toLowerCase();
    root.querySelectorAll('[data-me-profile]').forEach((a) => { a.href = `${SITE}/members/${encodeURIComponent(folder)}/`; });
    const head = root.querySelector('[data-me-head]');
    if (head) head.innerHTML = `Signed in as <b>@${esc(login)}</b>`;
    // Role-gate EVERY [data-admin-only] node (querySelectorAll, not querySelector): a page may carry more than one. Shown for staff (moderator and up); admin.html
    // self-gates each tool and the SOW-005 gate + CODEOWNERS stay the real boundary.
    const showAdmin = (RANK[status.role] ?? 0) >= RANK.moderator;
    root.querySelectorAll('[data-admin-only]').forEach((el) => { el.hidden = !showAdmin; });
    // Superadmin-only items ([data-super-only]: the Debug panel). sow-399: the Social Queue that also sat here moved to
    // the website's avatar menu with the rest of syndication.
    const showSuper = (RANK[status.role] ?? 0) >= RANK.superadmin;
    root.querySelectorAll('[data-super-only]').forEach((el) => { el.hidden = !showSuper; });
    if (meBtn) meBtn.hidden = false;
  } else {
    // sow-296: the greeting suffix went with the greeting row, so there is nothing to clear here any more.
    if (meBtn) meBtn.hidden = true;
  }
}

/** SOW-048: the gate decision (PURE, testable). A signed-in caller has both a token (authenticated) and a GitHub
 *  login. Everything else (signed out, malformed status) is gated to the login splash. AUTH, not membership. */
export function shouldGate(status) {
  return !(status?.authenticated && status?.identity?.login);
}

/** sow-228: the STAFF gate decision for admin.html (PURE, testable). Same contract as shouldGate: TRUE means DENY.
 *  `data-admin-only` hid the rail's Admin LINK at moderator and up, but the PAGE had no check and is directly
 *  navigable, so any signed-in member who reached the URL got the whole staff surface. Uses RANK.moderator so the
 *  entrance and the door share one threshold; if they ever diverge we are back to this defect.
 *  FAILS CLOSED on purpose: signed out, malformed, or a role this build does not recognize all deny. An
 *  unrecognized role must render nothing rather than everything, including one a future release adds.
 *  This is UX and disclosure control, NEVER the boundary. The Worker's authorizeStaff/authorizeAdmin, the SOW-005
 *  gate and CODEOWNERS remain the authority; do not let a green client gate justify relaxing any of them. */
export function shouldGateStaff(status) {
  if (shouldGate(status)) return true;
  // Require a STRING before the lookup. `RANK[['admin']]` coerces the array to the key 'admin' and would otherwise
  // resolve to rank 2, so a non-string role is denied on its type rather than on its stringification.
  if (typeof status.role !== 'string') return true;
  const rank = RANK[status.role];
  return typeof rank !== 'number' || rank < RANK.moderator;
}

/** sow-323: does this status clear a tab's own floor? TRUE means DENY, matching shouldGateStaff.
 *
 *  The staff gate above is ONE threshold for the whole admin page, and some sections sit higher than it. The
 *  editorial review queue is superadmin at the Worker, so without this a moderator or admin saw a tab whose
 *  every request came back 403 -- which is exactly the mismatch the retired applications tab shipped with, and
 *  the reason its replacement is gated on both hosts. An unrecognized floor denies, like every other lookup here.
 *  UX and disclosure control, never the boundary: authorizeSuperadmin at the Worker stays the authority. */
export function shouldGateTab(status, min) {
  if (!min) return shouldGateStaff(status);
  if (shouldGateStaff(status)) return true;
  const need = RANK[String(min)];
  const have = RANK[status.role];
  return typeof need !== 'number' || typeof have !== 'number' || have < need;
}

// The last raw /api/status, kept so the gate can tell an EXPIRED session (token died) from a never-signed-in one
// and label the splash accordingly. Not exported; read only by initShell's gate handler.
let _lastStatus = null;

/** Load /api/status and reflect it into the account control. Returns the status (or null when not signed in). */
export async function loadShellAccount(root = document.querySelector('[data-shell]')) {
  const status = await api('/api/status');
  _lastStatus = status;
  const signedIn = !shouldGate(status);
  if (root) applyAccount(root, signedIn ? status : null);
  return signedIn ? status : null;
}

// sow-393: the website sign-in, in Chrome's own sign-in window (chrome.identity.launchWebAuthFlow). This page keeps
// the PKCE verifier and receives the one-time code from the window; no web page ever sees either. The background then
// claims the tokens and stores them. Since sow-410 it is the only sign-in the extension has. Rejects with a reason the gate explains: closed
// (the member closed the window), declined, expired, failed.
async function shellWebLogin(login) {
  const { verifier, challenge } = await makePkce();
  const redirect = chrome.identity.getRedirectURL(REDIRECT_PATH);
  let finalUrl;
  try {
    finalUrl = await chrome.identity.launchWebAuthFlow({ url: startUrl({ challenge, redirect, login }), interactive: true });
  } catch { throw new Error('closed'); }
  const got = readRedirectResult(finalUrl, redirect);
  if (!got?.code) throw new Error(got?.error || 'failed');
  const r = await chrome.runtime.sendMessage({ type: 'login', method: 'web', code: got.code, verifier });
  if (!r?.ok) throw new Error('failed');
  return r;
}

/** SOW-048: the forced-sign-in gate. With no token, hide the app (data-unauth) and overlay ONLY the sign-in screen
 *  (<gbti-signin-splash>, sow-387). Its Sign in button runs the website sign-in; on success we reload into the
 *  signed-in app (initShell re-runs, now signed in, no gate). Idempotent. The background worker opens the website
 *  welcome after a member's FIRST sign-in (extension/src/welcome-handoff.mjs), so nothing here does. */
function mountAuthGate(root, { expired = false } = {}) {
  if (!root || document.querySelector('.gbti-authwrap')) return;
  document.documentElement.setAttribute('data-unauth', '1');
  const wrap = document.createElement('div');
  wrap.className = 'gbti-authwrap';
  const el = document.createElement('gbti-signin-splash');
  if (expired) el.setAttribute('expired', ''); // SOW: token-expiry detected -> the splash explains the re-sign-in
  wrap.appendChild(el);
  root.appendChild(wrap);
  // sow-393: the website sign-in, in Chrome's sign-in window. sow-410 removed the device-code fallback, so a click
  // while a sign-in is still open is ignored rather than starting a second window.
  const why = {
    closed: 'The sign-in window was closed before it finished.',
    declined: 'GitHub was not authorized, so nothing changed.',
    expired: 'That sign-in waited too long. Please try again.',
  };
  let active = null;
  el.addEventListener('gbti:signin-start', () => {
    if (active) return;
    el.setNote?.('');
    el.setWaiting?.(true);
    const run = shellWebLogin(el.getAttribute('known-login') || '');
    const me = { run };
    active = me;
    run
      .then(() => location.reload())                          // signed in -> re-run initShell -> the app renders
      .catch((err) => {                                       // failed/cancelled -> allow another attempt
        if (active !== me) return;                            // not the attempt that is open
        active = null;
        el.setWaiting?.(false);
        el.setNote?.((Object.hasOwn(why, err?.message) && why[err.message]) || 'Sign-in did not finish. Please try again.');
      });
  });
  // sow-393: already signed in on the website? Then the button offers to continue as that account. Only the login
  // comes back from the background, and a failure just leaves the plain button.
  try {
    chrome.runtime.sendMessage({ type: 'web-session-peek' })
      .then((r) => { if (r?.login) el.setAttribute('known-login', r.login); })
      .catch(() => {});
  } catch { /* messaging unavailable */ }
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('gbti-theme', t); } catch (e) {}
  const b = document.querySelector('[data-theme-toggle]');
  if (b) b.innerHTML = ico(t === 'dark' ? 'sun' : 'moon');
}

function wireAccount(root) {
  const menu = () => root.querySelector('[data-me-menu]');
  const btn = root.querySelector('[data-me-btn]');
  const close = () => { const m = menu(); if (m) m.hidden = true; btn?.setAttribute('aria-expanded', 'false'); };
  const open = () => { const m = menu(); if (m) m.hidden = false; btn?.setAttribute('aria-expanded', 'true'); m?.querySelector('.mi')?.focus(); };
  root.querySelectorAll('[data-me-av]').forEach((av) => av.addEventListener('error', (e) => { e.target.src = 'icons/icon-32.png'; }));
  btn?.addEventListener('click', (e) => { e.stopPropagation(); menu()?.hidden ? open() : close(); });
  document.addEventListener('click', (e) => { const m = menu(); if (m && !m.hidden && !root.querySelector('[data-me-wrap]')?.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { const m = menu(); if (e.key === 'Escape' && m && !m.hidden) { close(); btn?.focus(); } });
  root.querySelector('[data-me-signout]')?.addEventListener('click', async () => {
    close();
    try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
    location.reload(); // re-evaluate identity + the membership lock gate on this page
  });
  // SOW-124: the superadmin Debug panel (the devlog viewer; the item is superadmin-gated by [data-super-only]).
  root.querySelector('[data-debug-panel]')?.addEventListener('click', () => { close(); openDebugPanelModal(); });
}

// SOW-124: the avatar-menu "Debug" opens a centered popup mounting <gbti-debug-panel>. The panel is a
// host-agnostic view; here we inject the `adapter` that does the realm plumbing: the toggle writes the shared
// flag, refresh MERGES this page's ring with the background service worker's ring (fetched over one message,
// superadmin-gated on the worker side), and clear empties both. Every logged value is already redacted.
function openDebugPanelModal() {
  if (document.querySelector('.debug-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal debug-modal';
  overlay.innerHTML = `<gbti-debug-panel></gbti-debug-panel>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('gbti-debug-close', close);
  document.addEventListener('keydown', onEsc);
  const panel = overlay.querySelector('gbti-debug-panel');
  panel.adapter = {
    isEnabled: () => devlogFlagOn(),
    async refresh() {
      const page = devlog.recent().map((e) => ({ ...e, realm: 'page' }));
      let bg = [];
      try { const r = await chrome.runtime.sendMessage({ type: 'devlog-recent' }); if (r?.ok && Array.isArray(r.entries)) bg = r.entries.map((e) => ({ ...e, realm: 'bg' })); } catch { /* worker unreachable */ }
      return page.concat(bg);
    },
    async toggle(on) { await setDevlogFlag(on); },
    async clear() { devlog.clear(); try { await chrome.runtime.sendMessage({ type: 'devlog-clear' }); } catch { /* best-effort */ } },
  };
  document.body.appendChild(overlay);
}

// sow-399 (owner, 2026-09-24): the SOW-121 Social Queue popup that opened from this menu moved to the website's
// avatar menu (src/components/Header.astro) with the rest of syndication. The extension is a reader.

// SOW-041 P5: the top-bar "+" opens a modal that mounts the existing <gbti-share-composer> (the literal owner ask:
// a URL + a comment -> the members-only Shares area). The composer self-gates paid/trial/locked and routes through
// the normal paid-only publish flow; on its gbti-share-posted event we close (any open feed refreshes itself).
function openComposeModal() {
  if (document.querySelector('.compose-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal share-overlay';
  // sow-395 (owner, 2026-09-24): the same dialog as the website's (src/components/home/HomeShareModal.astro): the
  // composer's own card IS the dialog, with a round close button floating on its corner. It used to sit inside a
  // "Post a Share" panel of its own, which read as a section within a section. The title moves to the label.
  overlay.innerHTML = `<div class="share-dialog" role="dialog" aria-modal="true" aria-label="Post a Share"><button class="share-x" type="button" aria-label="Close">${ico('x')}</button><gbti-share-composer></gbti-share-composer></div>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  // SOW-041 follow-up: deliberately NO backdrop-click-to-close on the Share composer — an accidental click on the
  // overlay must never discard an in-progress draft. The member closes intentionally (the X, Esc, or a successful post).
  overlay.querySelector('.share-x')?.addEventListener('click', close);
  // SOW-092: posted -> close, then redirect the member to their new share. A page with a share reader
  // (the new-tab feed, the shares feed) claims the event during dispatch (detail.handled) and opens it in
  // place; on a page with no reader (saved/admin/account) we stash the optimistic item and land on
  // shares.html, whose feed opens it on connect. Deferred a tick so the document listeners run first.
  overlay.addEventListener('gbti-share-posted', (e) => {
    close();
    setTimeout(() => {
      if (e.detail?.handled || !e.detail?.item) return;
      try { sessionStorage.setItem('gbti-open-share', JSON.stringify(e.detail.item)); } catch { /* fail-soft */ }
      location.href = 'shares.html';
    }, 0);
  });
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
  overlay.querySelector('gbti-share-composer')?.querySelector?.('input, textarea')?.focus?.();
}
// sow-204: the "+" opens the SHARE COMPOSER directly, and the SOW-064 create popup is gone from the extension.
//
// The owner's Option A ruling keeps the share composer and moves article, prompt and project authoring to the
// website. That left the popup offering four formats of which one still worked, and a chooser with one card is
// worse than no chooser. The popup and its Recent-drafts machinery are removed rather than trimmed, because
// fetchCreateContent was the extension's last caller of /api/drafts, which this same change removes from
// ext-dispatch; trimming the cards but keeping the list would have left a caller of a route that answers 404.
// (It also called /api/content, which STAYS: that route backs the reader, not authoring.)
//
// The website and npm hosts are untouched: this file is extension-only, and their create flows live elsewhere.

function wireCompose(root) {
  root.querySelector('[data-compose]')?.addEventListener('click', () => openComposeModal());
}

// sow-397: the pill used to be a daily.dev switcher that asked chrome.management whether daily.dev was installed. The
// extension never had that permission, so it could not tell and always showed. It is now the quick launch, and
// daily.dev is one of its destinations, switched on once when the content script on gbti.network detects it.
function wireApps(root) {
  mountQuickLaunch(root.querySelector('[data-apps]')).catch(() => {});
}

/** Inject + wire the shell into [data-shell]. SOW-052: there is no top bar: the control cluster is appended to the
 *  page's top-right [data-topbar] slot (created at the top of <main> if the page does not provide one). sow-406: no
 *  page has a left menu; `compose` adds the "+" for pages with no other way to post. */
export function initShell({ compose = false } = {}) {
  const root = document.querySelector('[data-shell]');
  if (!root) return { ico, loadShellAccount: () => loadShellAccount(null) };
  const main = root.querySelector('.nt-main');
  root.classList.add('nt-norail'); // sow-296 layout, on every page since sow-406
  // The controls live top-right of the content: append them to the page's [data-topbar] row (create a bare one at
  // the top of <main> when the page does not wrap its heading in one).
  if (main) {
    let topbar = main.querySelector('[data-topbar]');
    if (!topbar) { topbar = document.createElement('div'); topbar.className = 'nt-top'; topbar.setAttribute('data-topbar', ''); main.prepend(topbar); }
    topbar.insertAdjacentHTML('afterbegin', brandHtml());
    topbar.insertAdjacentHTML('beforeend', controlsHtml({ compose }));
  }
  // Fill the inline-SVG glyphs (controls + any static [data-ico] in the page main). Trusted constants.
  root.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
  const themeBtn = root.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.innerHTML = ico(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon');
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  }
  wireApps(root);
  wireAccount(root);
  wireCompose(root);
  // SOW-048: gate AFTER the status round-trip. Signed in -> the app stays; signed out -> the login splash overlays
  // it (data-unauth hides the rest). Kept off the synchronous path so initShell's return shape is unchanged.
  loadShellAccount(root).then((status) => {
    if (!status) { mountAuthGate(root, { expired: _lastStatus?.sessionExpired === true }); return; }
    maybeShowExpiryPopup(status).catch(() => {}); // SOW-119 QA: the coupon-expiry countdown (all shell pages)
  });
  return { ico, loadShellAccount: () => loadShellAccount(root) };
}

// SOW-119 QA (2026-07-18): the coupon-expiry countdown popup. Shows for a member whose PAID status is a
// coupon grant (the status oracle emits couponUntil only then), inside the final EXPIRY_POPUP_START_DAYS,
// at most once per cooldown (7 days, collapsing to daily in the final week; the pure decision lives in
// client-ui/src/membership-expiry.mjs). Every close path persists the dismissal instant, so the cadence
// re-derives instead of sleeping through the deadline. The CTA is the established outbound membership
// deep-link (there is no in-extension checkout by design). Before nagging it re-verifies the grant against
// the live oracle (/api/coupon-refresh), so a member who converted to a real subscription is never nagged
// off a stale cached date.
const EXPIRY_DISMISS_KEY = 'gbti-expiry-dismissed';
async function maybeShowExpiryPopup(status) {
  const cachedUntil = status?.couponUntil;
  if (!cachedUntil || document.querySelector('.expiry-modal')) return;
  let dismissedAt = null;
  try { dismissedAt = JSON.parse(localStorage.getItem(EXPIRY_DISMISS_KEY) || 'null')?.at ?? null; } catch { dismissedAt = null; }
  if (!expiryPopupDecision({ until: cachedUntil, dismissedAt, now: Date.now() }).show) return;
  // The CACHED date says nag; re-verify against the live oracle first. couponUntil is seeded at sign-in and
  // never re-resolved while membership stays paid, so a member who already converted to a real subscription
  // would otherwise be nagged until a re-login. The recheck rewrites the store from the oracle (which
  // suppresses couponUntil for Stripe-paid); an error answer leaves the store untouched and defers the
  // popup to the next page load.
  const fresh = await api('/api/coupon-refresh');
  const until = fresh && !fresh.error ? fresh.couponUntil : null;
  if (!until) return;
  const { show, daysLeft } = expiryPopupDecision({ until, dismissedAt, now: Date.now() });
  if (!show) return;
  const { headline, dateLabel, count } = expiryPopupCopy(daysLeft, until, Date.now());
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal expiry-modal';
  overlay.innerHTML = `<div class="compose-panel expiry-panel">
    <div class="compose-head"><b>Membership</b><button class="compose-x" type="button" aria-label="Close">${ico('x')}</button></div>
    <div class="expiry-body">
      <div class="expiry-count">${count}</div>
      <h2>${headline}</h2>
      ${dateLabel ? `<p class="expiry-date">Your complimentary year runs through <b>${dateLabel}</b>.</p>` : ''}
      <p class="expiry-note">Becoming a paying member keeps your profile, articles, projects, and prompts
        published, your Discord access open, and your revenue share active. Nothing bills automatically;
        if you do nothing, your work simply unpublishes at the end and comes back whenever you join.</p>
      <a class="expiry-cta" href="https://gbti.network/membership/" target="_blank" rel="noopener">Become a paying member</a>
      <button class="expiry-later" type="button">Remind me later</button>
    </div>
  </div>`;
  const dismiss = () => {
    try { localStorage.setItem(EXPIRY_DISMISS_KEY, JSON.stringify({ at: Date.now() })); } catch { /* no storage */ }
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };
  // sow-387: this used to ignore Escape while the new-tab welcome overlay covered the popup. The overlay is gone
  // (setup lives on the website), so an Escape here is always meant for this popup.
  const onEsc = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); }); // nothing in-progress to lose
  overlay.querySelector('.compose-x')?.addEventListener('click', dismiss);
  overlay.querySelector('.expiry-later')?.addEventListener('click', dismiss);
  overlay.querySelector('.expiry-cta')?.addEventListener('click', dismiss); // following the CTA also stops the nagging
  document.body.appendChild(overlay);
}

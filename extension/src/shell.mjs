// extension/src/shell.mjs (SOW-036/039): the SHARED member-hub shell for every extension page. initShell({active})
// injects the top bar + the left rail into the [data-shell] container (before its <main class="nt-main">) and
// wires the theme toggle, the daily.dev switcher, and the account dropdown (identity, sign-in -> onboarding,
// sign-out, role-gated Admin). One implementation so the chrome stays identical across newtab / browse / workspace
// / shares / admin. CSP-safe: trusted constant markup, no inline handlers, inline-SVG icons. The icon set + esc are
// exported so the new-tab feed reuses them.

import '../../client-ui/src/elements/gbti-share-composer.mjs'; // SOW-041 P5: the top-bar "+" mounts this composer
import '../../client-ui/src/elements/gbti-activity-bell.mjs'; // SOW-042 P3: the top-bar activity bell
import '../../client-ui/src/elements/gbti-welcome.mjs'; // SOW-048: dual-purposed as the forced-sign-in login splash

const SITE = 'https://gbti.network';
const DAILYDEV_ID = 'jlmpjdjjbgclbocgajdjefcidcncaied';
const DAILYDEV_APP_URL = 'https://app.daily.dev/';
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Inline SVG icon set (CSP forbids external requests for these). Shared by the shell + the new-tab feed.
export const SVG = {
  prompt: '<path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 9.5h6M9 12.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  article: '<path d="M4.5 14.5h6.6v3.2a1.9 1.9 0 0 1-1.9 1.9H6.4a1.9 1.9 0 0 1-1.9-1.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.4 14.6C10.5 9.4 14.4 5.2 20 3.4c.5 5.6-2.4 10.1-7 12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/><path d="M10.8 11.6l3 .4M13.4 8.2l2.7 .4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', // inkwell + quill (Articles)
  product: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
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
  // SOW-052: the WorkBench rail glyphs.
  bookmark: '<path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M16.5 13.5a5.5 5.5 0 0 1 4 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13a7.8 7.8 0 0 0 0-2l1.7-1.3-1.7-3-2 .8a7.6 7.6 0 0 0-1.7-1l-.3-2.1H10l-.3 2.1a7.6 7.6 0 0 0-1.7 1l-2-.8-1.7 3L6 11a7.8 7.8 0 0 0 0 2l-1.7 1.3 1.7 3 2-.8a7.6 7.6 0 0 0 1.7 1l.3 2.1h3.6l.3-2.1a7.6 7.6 0 0 0 1.7-1l2 .8 1.7-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  pr: '<circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 8.2v7.6M18 15.8V11a4 4 0 0 0-4-4h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  // SOW-052: the "Network" rail item (back to the co-op feed) — connected nodes.
  network: '<circle cx="6" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7h8M7.7 8.6 10.7 16M16.3 8.6 13.3 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};
export const ico = (k) => (SVG[k] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>` : '');

// SOW-052: two rail variants. The FEED rail (new tab) is the content browser — its destinations open the feed
// pre-filtered to one type (newtab.html#type=<X>); it also carries a top control block (feed search + Latest/
// Following). The WORKBENCH rail (workspace / account / admin) is the member's management nav — what used to live
// in the avatar dropdown. `initShell({ nav })` picks the variant.
const RAIL_FEED = [
  { group: 'Feeds' },
  { key: 'activity', href: 'newtab.html', ico: 'activity', nm: 'Activity', sub: 'The latest across the co-op' },
  // News is a curated feed open to the limited trial (not members-only), so it sits with Activity, not Browse.
  { key: 'news', href: 'newtab.html#type=news', ico: 'news', nm: 'News', sub: 'Curated, limited trial' },
  { group: 'Member Activity' },
  // No "All" item: Activity (bare newtab.html) IS the all-types river. These narrow to a single member-content type.
  { key: 'articles', href: 'newtab.html#type=post', ico: 'article', nm: 'Articles', sub: 'Posts and tutorials' },
  { key: 'products', href: 'newtab.html#type=product', ico: 'product', nm: 'Products', sub: 'Plugins and tools' },
  { key: 'prompts', href: 'newtab.html#type=prompt', ico: 'prompt', nm: 'Prompts', sub: 'Reusable prompts' },
  { key: 'shares', href: 'newtab.html#type=share', ico: 'coin', nm: 'Shares', sub: 'The co-op stream' },
  { div: true },
  { key: 'workspace', href: 'workspace.html', ico: 'grid', nm: 'WorkBench', sub: 'Your content + tools' },
];

const RAIL_WORKBENCH = [
  // SOW-052: a "Network" item up top takes the member back to the main co-op feed (newtab). No "WorkBench" eyebrow.
  { key: 'network', href: 'newtab.html', ico: 'network', nm: 'Network', sub: 'Back to the co-op' },
  // Explicit #tab=overview so clicking it ON workspace.html is a same-document switch (no reload), like the others.
  { key: 'overview', href: 'workspace.html#tab=overview', ico: 'grid', nm: 'Overview', sub: 'Your hub at a glance' },
  { group: 'My Content' },
  { key: 'post', href: 'workspace.html#tab=post', ico: 'article', nm: 'Articles', sub: 'Your posts' },
  { key: 'prompt', href: 'workspace.html#tab=prompt', ico: 'prompt', nm: 'Prompts', sub: 'Your prompts' },
  { key: 'product', href: 'workspace.html#tab=product', ico: 'product', nm: 'Products', sub: 'Your products' },
  { group: 'Activity' },
  { key: 'prs', href: 'workspace.html#tab=prs', ico: 'pr', nm: 'Pull requests', sub: 'Proposed + accepted' },
  { key: 'saved', href: 'workspace.html#tab=saved', ico: 'bookmark', nm: 'Saved', sub: 'Favorites + collections' },
  { key: 'subs', href: 'workspace.html#tab=subs', ico: 'users', nm: 'Subscriptions', sub: 'Who you follow' },
  { key: 'earnings', href: 'workspace.html#tab=earnings', ico: 'coin', nm: 'Earnings', sub: 'Referrals + rewards' },
  { div: true },
  { key: 'settings', href: 'account.html', ico: 'gear', nm: 'Settings', sub: 'Membership + account' },
  { key: 'admin', href: 'admin.html', ico: 'lock', nm: 'Admin tools', sub: 'Moderation', adminOnly: true },
];

const RAILS = { feed: RAIL_FEED, workbench: RAIL_WORKBENCH };

// The feed rail's top control block (SOW-052): the persistent feed search + the Latest/Following toggle, moved out
// of the new-tab content header. newtab.mjs wires these by selector ([data-filter] / [data-tab]).
function feedControlsHtml() {
  return `<div class="nt-rail-feedctrls">
    <label class="nt-rsrch"><span class="gl" data-ico="search"></span><input type="search" data-filter placeholder="Filter the feed" autocomplete="off" aria-label="Filter the feed" /></label>
    <div class="nt-tabs" role="tablist" aria-label="Activity view">
      <button class="nt-tab on" type="button" data-tab="latest" role="tab" aria-selected="true">Latest</button>
      <button class="nt-tab" type="button" data-tab="following" role="tab" aria-selected="false">Following</button>
    </div>
  </div>`;
}

// SOW-052: the relocatable control cluster (no longer a full-width bar). initShell appends it to the page's
// top-right [data-topbar] slot. Order: apps, the view-mode slot (the new tab moves its .nt-modes here), bell,
// theme, account, then the "+" compose to the right of the avatar. The account dropdown is collapsed to just
// "My WorkBench" + Sign out (the old section deep-links moved to the WorkBench rail).
function controlsHtml() {
  return `<div class="nt-controls" data-controls>
    <span class="nt-apps" data-apps>
      <span class="nt-app gbti" title="GBTI Network (you are here)">GBTI</span>
      <button class="nt-app" data-open-dailydev type="button" title="Switch to daily.dev"><img data-dd-img src="https://app.daily.dev/favicon.ico" alt="daily.dev" /></button>
    </span>
    <span class="nt-modes-slot" data-modes-slot></span>
    <gbti-activity-bell></gbti-activity-bell>
    <button class="nt-icobtn" data-theme-toggle title="Toggle theme" aria-label="Toggle theme"></button>
    <div class="nt-acctwrap" data-me-wrap>
      <button class="nt-signin" data-signin-btn type="button" hidden>Sign in</button>
      <button class="nt-acct" data-me-btn type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu" hidden>
        <img class="av" data-me-av alt="" width="34" height="34" />
        <span data-ico="chev"></span>
      </button>
      <div class="me-menu" data-me-menu role="menu" hidden>
        <div class="me-head" data-me-head></div>
        <div class="me-sep" role="separator"></div>
        <a class="mi" role="menuitem" href="workspace.html">WorkBench</a>
        <div class="me-sep" role="separator"></div>
        <button class="mi mi-signout" role="menuitem" type="button" data-me-signout>Sign out</button>
      </div>
    </div>
    <button class="nt-icobtn" data-compose data-ico="plus" title="New Share" aria-label="Post a new Share"></button>
  </div>`;
}

function railHtml(active, nav = 'feed') {
  const rail = RAILS[nav] || RAIL_FEED;
  const items = rail.map((r) => {
    if (r.group) return `<div class="nt-rail-h">${esc(r.group)}</div>`;
    if (r.div) return `<hr class="nt-rail-div" />`;
    const on = r.key === active ? ' on' : '';
    const admin = r.adminOnly ? ' data-admin-only hidden' : ''; // role-gated after /api/status resolves
    const sub = r.sub ? `<span class="sub">${esc(r.sub)}</span>` : '';
    return `<a class="nav-i${on}" data-key="${r.key}"${admin} href="${r.href}"><span class="gl" data-ico="${r.ico}"></span><span class="tx"><span class="nm">${esc(r.nm)}</span>${sub}</span></a>`;
  }).join('');
  // The feed rail leads with the feed search + Latest/Following; the workbench rail does not.
  const top = nav === 'feed' ? feedControlsHtml() : '';
  return `<nav class="nt-rail">${top}${items}<div class="nt-rail-foot"><a class="nt-coop" href="${SITE}/">View the co-op <span data-ico="arrow"></span></a></div></nav>`;
}

/** Re-highlight the rail to `key` (or clear when null). The rail renders its active item ONCE at initShell, but
 *  the new-tab feed switches type via same-document hash navigation (no reload), so it calls this to keep the
 *  left rail in lockstep with the chips + feed. */
export function setRailActive(key) {
  document.querySelectorAll('.nt-rail .nav-i').forEach((a) => a.classList.toggle('on', a.dataset.key === key));
}

/** GET /api/* via the background worker; null on any failure. */
async function api(pathname) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query: {} } });
    return r?.json ?? null;
  } catch { return null; }
}

/** Reflect the signed-in status into the account control + (if present) the greeting suffix. */
function applyAccount(root, status) {
  const meBtn = root.querySelector('[data-me-btn]');
  const signinBtn = root.querySelector('[data-signin-btn]');
  const greetName = document.querySelector('[data-greet-name]');
  if (status) {
    const login = status.identity.login;
    const av = root.querySelector('[data-me-av]');
    if (av) { av.src = `https://github.com/${encodeURIComponent(login)}.png?size=64`; av.alt = `@${login}`; }
    const head = root.querySelector('[data-me-head]');
    if (head) head.innerHTML = `Signed in as <b>@${esc(login)}</b>`;
    // SOW-052: the Admin entry now lives in the WorkBench rail (role-gated there), not the dropdown.
    const adminItem = root.querySelector('[data-admin-only]');
    if (adminItem) adminItem.hidden = (RANK[status.role] ?? 0) < RANK.moderator;
    if (greetName) greetName.textContent = `, @${login}`;
    if (meBtn) meBtn.hidden = false;
    if (signinBtn) signinBtn.hidden = true;
  } else {
    if (greetName) greetName.textContent = '';
    if (meBtn) meBtn.hidden = true;
    if (signinBtn) signinBtn.hidden = false;
  }
}

/** SOW-048: the gate decision (PURE, testable). A signed-in caller has both a token (authenticated) and a GitHub
 *  login. Everything else (signed out, malformed status) is gated to the login splash. AUTH, not membership. */
export function shouldGate(status) {
  return !(status?.authenticated && status?.identity?.login);
}

/** Load /api/status and reflect it into the account control. Returns the status (or null when not signed in). */
export async function loadShellAccount(root = document.querySelector('[data-shell]')) {
  const status = await api('/api/status');
  const signedIn = !shouldGate(status);
  if (root) applyAccount(root, signedIn ? status : null);
  return signedIn ? status : null;
}

// SOW-048: run the GitHub App device flow via the background worker (same contract as onboarding/page-client).
// `onPrompt` receives the user code to display; resolves on success, rejects on failure/cancel.
function shellLogin(onPrompt) {
  return new Promise((resolve, reject) => {
    const onMsg = (m) => { if (m?.type === 'login-prompt') onPrompt?.({ userCode: m.userCode, verificationUri: m.verificationUri }); };
    try { chrome.runtime.onMessage.addListener(onMsg); } catch { reject(new Error('messaging unavailable')); return; }
    chrome.runtime.sendMessage({ type: 'login' })
      .then((r) => { chrome.runtime.onMessage.removeListener(onMsg); r?.ok ? resolve(r) : reject(new Error(r?.error || 'sign-in failed')); })
      .catch((e) => { chrome.runtime.onMessage.removeListener(onMsg); reject(e); });
  });
}

/** SOW-048: the forced-sign-in gate. With no token, hide the app (data-unauth) and overlay ONLY the dual-purpose
 *  <gbti-welcome> login splash. Its Sign in button runs the device flow; on success we reload into the signed-in
 *  app (initShell re-runs, now signed in, no gate). Idempotent. */
function mountAuthGate(root) {
  if (!root || document.querySelector('.gbti-authwrap')) return;
  document.documentElement.setAttribute('data-unauth', '1');
  const wrap = document.createElement('div');
  wrap.className = 'gbti-authwrap';
  const el = document.createElement('gbti-welcome');
  el.setAttribute('auth-gate', '');
  wrap.appendChild(el);
  root.appendChild(wrap);
  let signingIn = false; // guard against click-spam starting parallel device flows (+ leaking login-prompt listeners)
  el.addEventListener('gbti:welcome-signin', () => {
    if (signingIn) return;
    signingIn = true;
    shellLogin(({ userCode, verificationUri }) => el.setCode?.(userCode, verificationUri))
      .then(() => location.reload())                          // signed in -> re-run initShell -> the app renders
      .catch(() => { el.setCode?.(null); signingIn = false; }); // failed/cancelled -> allow another attempt
  });
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('gbti-theme', t); } catch (e) {}
  const b = document.querySelector('[data-theme-toggle]');
  if (b) b.innerHTML = ico(t === 'dark' ? 'sun' : 'moon');
}

const openOnboarding = () => (chrome.tabs?.create
  ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  : window.open(chrome.runtime.getURL('onboarding.html'), '_blank'));

function wireAccount(root) {
  const menu = () => root.querySelector('[data-me-menu]');
  const btn = root.querySelector('[data-me-btn]');
  const close = () => { const m = menu(); if (m) m.hidden = true; btn?.setAttribute('aria-expanded', 'false'); };
  const open = () => { const m = menu(); if (m) m.hidden = false; btn?.setAttribute('aria-expanded', 'true'); m?.querySelector('.mi')?.focus(); };
  root.querySelector('[data-me-av]')?.addEventListener('error', (e) => { e.target.src = 'icons/icon-32.png'; });
  btn?.addEventListener('click', (e) => { e.stopPropagation(); menu()?.hidden ? open() : close(); });
  document.addEventListener('click', (e) => { const m = menu(); if (m && !m.hidden && !root.querySelector('[data-me-wrap]')?.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { const m = menu(); if (e.key === 'Escape' && m && !m.hidden) { close(); btn?.focus(); } });
  root.querySelector('[data-signin-btn]')?.addEventListener('click', openOnboarding);
  root.querySelector('[data-me-signout]')?.addEventListener('click', async () => {
    close();
    try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
    location.reload(); // re-evaluate identity + the membership lock gate on this page
  });
}

// SOW-041 P5: the top-bar "+" opens a modal that mounts the existing <gbti-share-composer> (the literal owner ask:
// a URL + a comment -> the members-only Shares area). The composer self-gates paid/trial/locked and routes through
// the normal paid-only publish flow; on its gbti-share-posted event we close (any open feed refreshes itself).
function openComposeModal() {
  if (document.querySelector('.compose-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal';
  overlay.innerHTML = `<div class="compose-panel"><div class="compose-head"><b>Post a Share</b><button class="compose-x" type="button" aria-label="Close">${ico('x')}</button></div><gbti-share-composer></gbti-share-composer></div>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }); // backdrop click
  overlay.querySelector('.compose-x')?.addEventListener('click', close);
  overlay.addEventListener('gbti-share-posted', close); // posted -> close (the feed refreshes via its own listener)
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
  overlay.querySelector('gbti-share-composer')?.querySelector?.('input, textarea')?.focus?.();
}
function wireCompose(root) {
  root.querySelector('[data-compose]')?.addEventListener('click', () => openComposeModal());
}

async function wireApps(root) {
  const apps = root.querySelector('[data-apps]');
  if (!apps) return;
  apps.querySelector('[data-open-dailydev]')?.addEventListener('click', () => { window.location.href = DAILYDEV_APP_URL; });
  const img = apps.querySelector('[data-dd-img]');
  img?.addEventListener('error', () => { const b = document.createElement('span'); b.className = 'dd'; b.textContent = 'dd'; img.replaceWith(b); }, { once: true });
  let installed = null;
  try { if (chrome.management?.get) { const info = await chrome.management.get(DAILYDEV_ID).catch(() => null); installed = Boolean(info && info.enabled); } } catch { /* no management permission */ }
  if (installed === true || installed === null) apps.classList.add('show'); // show when present, or when we cannot tell
}

/** Inject + wire the shell into [data-shell]. `active` = the rail key to highlight (or null); `nav` = which rail
 *  variant ('feed' for the new tab, 'workbench' for the management pages). SOW-052: there is no top bar anymore —
 *  the control cluster is appended to the page's top-right [data-topbar] slot (created at the top of <main> if the
 *  page does not provide one), and the rail varies by `nav`. */
export function initShell({ active = null, nav = 'feed' } = {}) {
  const root = document.querySelector('[data-shell]');
  if (!root) return { ico, loadShellAccount: () => loadShellAccount(null) };
  const main = root.querySelector('.nt-main');
  // The rail is the left column (a direct child of [data-shell], before <main>).
  if (main) main.insertAdjacentHTML('beforebegin', railHtml(active, nav));
  else root.insertAdjacentHTML('afterbegin', railHtml(active, nav));
  // The controls live top-right of the content: append them to the page's [data-topbar] row (create a bare one at
  // the top of <main> when the page does not wrap its heading in one).
  if (main) {
    let topbar = main.querySelector('[data-topbar]');
    if (!topbar) { topbar = document.createElement('div'); topbar.className = 'nt-top'; topbar.setAttribute('data-topbar', ''); main.prepend(topbar); }
    topbar.insertAdjacentHTML('beforeend', controlsHtml());
  }
  // Fill the inline-SVG glyphs (rail + controls + any static [data-ico] in the page main). Trusted constants.
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
  loadShellAccount(root).then((status) => { if (!status) mountAuthGate(root); });
  return { ico, loadShellAccount: () => loadShellAccount(root) };
}

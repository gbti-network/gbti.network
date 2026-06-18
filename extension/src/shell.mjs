// extension/src/shell.mjs (SOW-036/039): the SHARED member-hub shell for every extension page. initShell({active})
// injects the top bar + the left rail into the [data-shell] container (before its <main class="nt-main">) and
// wires the theme toggle, the daily.dev switcher, and the account dropdown (identity, sign-in -> onboarding,
// sign-out, role-gated Admin). One implementation so the chrome stays identical across newtab / browse / workspace
// / shares / admin. CSP-safe: trusted constant markup, no inline handlers, inline-SVG icons. The icon set + esc are
// exported so the new-tab feed reuses them.

import '../../client-ui/src/elements/gbti-share-composer.mjs'; // SOW-041 P5: the top-bar "+" mounts this composer
import '../../client-ui/src/elements/gbti-activity-bell.mjs'; // SOW-042 P3: the top-bar activity bell

const SITE = 'https://gbti.network';
const DAILYDEV_ID = 'jlmpjdjjbgclbocgajdjefcidcncaied';
const DAILYDEV_APP_URL = 'https://app.daily.dev/';
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Inline SVG icon set (CSP forbids external requests for these). Shared by the shell + the new-tab feed.
export const SVG = {
  prompt: '<path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 9.5h6M9 12.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  article: '<rect x="4.5" y="3.5" width="15" height="17" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8h8M8 11.5h8M8 15h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  product: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  coin: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.5c-.6-.8-1.6-1.2-2.7-1.2-1.5 0-2.6.8-2.6 2s1 1.7 2.6 1.9c1.6.2 2.7.7 2.7 2s-1.1 2-2.7 2c-1.2 0-2.2-.5-2.8-1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
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
};
export const ico = (k) => (SVG[k] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>` : '');

// The persistent rail. Browse destinations deep-link into the in-extension Browser (browse.html#tab=<type>).
const RAIL = [
  { group: 'Feeds' },
  { key: 'activity', href: 'newtab.html', ico: 'activity', nm: 'Activity' },
  { group: 'Browse' },
  { key: 'all', href: 'browse.html#tab=all', ico: 'grid', nm: 'All', sub: 'Everything in one place' },
  { key: 'articles', href: 'browse.html#tab=post', ico: 'article', nm: 'Articles', sub: 'Posts and tutorials' },
  { key: 'products', href: 'browse.html#tab=product', ico: 'product', nm: 'Products', sub: 'Plugins and tools' },
  { key: 'prompts', href: 'browse.html#tab=prompt', ico: 'prompt', nm: 'Prompts', sub: 'Reusable prompts' },
  { key: 'shares', href: 'browse.html#tab=share', ico: 'coin', nm: 'Shares', sub: 'The co-op stream' },
  { div: true },
  { key: 'workspace', href: 'workspace.html', ico: 'grid', nm: 'My workspace', sub: 'Content + pull requests' },
];

function barHtml() {
  return `<header class="nt-bar">
    <div class="nt-brand"><img class="mk" src="icons/icon-128.png" alt="" /> GBTI Network</div>
    <span class="nt-spring"></span>
    <span class="nt-apps" data-apps>
      <span class="nt-app gbti" title="GBTI Network (you are here)">GBTI</span>
      <button class="nt-app" data-open-dailydev type="button" title="Switch to daily.dev"><img data-dd-img src="https://app.daily.dev/favicon.ico" alt="daily.dev" /></button>
    </span>
    <button class="nt-icobtn" data-compose data-ico="plus" title="New Share" aria-label="Post a new Share"></button>
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
        <a class="mi" role="menuitem" href="workspace.html">My workspace</a>
        <a class="mi" role="menuitem" href="workspace.html#tab=post">My articles</a>
        <a class="mi" role="menuitem" href="workspace.html#tab=prompt">My prompts</a>
        <a class="mi" role="menuitem" href="workspace.html#tab=product">My products</a>
        <a class="mi" role="menuitem" href="workspace.html#tab=prs">My pull requests</a>
        <a class="mi" role="menuitem" href="workspace.html#tab=saved">Saved</a>
        <a class="mi" role="menuitem" href="workspace.html#tab=subs">Subscriptions</a>
        <a class="mi mi-admin" role="menuitem" href="admin.html" hidden>Admin tools</a>
        <div class="me-sep" role="separator"></div>
        <button class="mi mi-signout" role="menuitem" type="button" data-me-signout>Sign out</button>
      </div>
    </div>
  </header>`;
}

function railHtml(active) {
  const items = RAIL.map((r) => {
    if (r.group) return `<div class="nt-rail-h">${esc(r.group)}</div>`;
    if (r.div) return `<hr class="nt-rail-div" />`;
    const on = r.key === active ? ' on' : '';
    const sub = r.sub ? `<span class="sub">${esc(r.sub)}</span>` : '';
    return `<a class="nav-i${on}" data-key="${r.key}" href="${r.href}"><span class="gl" data-ico="${r.ico}"></span><span class="tx"><span class="nm">${esc(r.nm)}</span>${sub}</span></a>`;
  }).join('');
  return `<nav class="nt-rail">${items}<div class="nt-rail-foot"><a class="nt-coop" href="${SITE}/">View the co-op <span data-ico="arrow"></span></a></div></nav>`;
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
    const adminItem = root.querySelector('.mi-admin');
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

/** Load /api/status and reflect it into the account control. Returns the status (or null). */
export async function loadShellAccount(root = document.querySelector('[data-shell]')) {
  const status = await api('/api/status');
  const signedIn = Boolean(status?.authenticated && status?.identity?.login);
  if (root) applyAccount(root, signedIn ? status : null);
  return signedIn ? status : null;
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

/** Inject + wire the shell into [data-shell]. `active` is the rail key to highlight (or null). */
export function initShell({ active = null } = {}) {
  const root = document.querySelector('[data-shell]');
  if (!root) return { ico, loadShellAccount: () => loadShellAccount(null) };
  const main = root.querySelector('.nt-main');
  const html = barHtml() + railHtml(active);
  if (main) main.insertAdjacentHTML('beforebegin', html);
  else root.insertAdjacentHTML('afterbegin', html);
  // Fill the inline-SVG glyphs (rail + toolbar + any static [data-ico] in the page main). Trusted constants.
  root.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
  const themeBtn = root.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.innerHTML = ico(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon');
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  }
  wireApps(root);
  wireAccount(root);
  wireCompose(root);
  loadShellAccount(root);
  return { ico, loadShellAccount: () => loadShellAccount(root) };
}

// SOW-017 + SOW-036 + SOW-039: the new-tab page logic. Fetches the public activity index from gbti.network
// (covered by the extension host permission, no CORS), renders the greeting + the Latest Activity feed in one of
// three view modes (compact / detailed / card, persisted), and wires search, the Latest/Following tabs, the
// theme toggle (persisted, no-flash on next load), the account dropdown (SOW-036), the onboarding setup banner
// (SOW-026/029), the daily.dev app switcher, and the lapsed-member lock (SOW-018). CSP-safe (no inline handlers).

import { isLockedMembership } from '../../client/src/membership.mjs';
import { buildReadHash } from '../../client-ui/src/browse-hash.mjs';

const SITE = 'https://gbti.network';

// SOW: a one-way daily.dev switcher. Chrome gives no way to see another extension WITHOUT the heavyweight
// "management" permission, and daily.dev's markers are scoped to daily.dev origins, so we cannot probe it from
// our page. If "management" is ever granted we TRULY detect it; otherwise we show the switch by default. Clicking
// switches the current tab to the daily.dev web app (their extension new-tab is not navigable cross-extension).
const DAILYDEV_ID = 'jlmpjdjjbgclbocgajdjefcidcncaied';
const DAILYDEV_APP_URL = 'https://app.daily.dev/';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const authorName = (a) => (a === 'gbti' || a === 'house' ? 'GBTI Network' : a);
// Author avatar: GBTI's own house content uses the extension icon; a member's avatar comes from GitHub by login
// (the activity-index author is the folder username, which equals the login for members). A 404 falls back to the
// GBTI icon via a post-render error listener (CSP forbids inline onerror).
const avatarFor = (a) => (a === 'gbti' || a === 'house' ? 'icons/icon-32.png' : `https://github.com/${encodeURIComponent(a)}.png?size=64`);
// The activity index uses type 'post'; the feed UI labels/colors it as an "article" (matching the site + design).
const chipType = (t) => (t === 'post' ? 'article' : t);
const TYPE_LABEL = { article: 'ARTICLE', product: 'PRODUCT', prompt: 'PROMPT' };

// ---- icons (inline SVG; CSP forbids external requests for these) ----
const SVG = {
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
};
const ico = (k) => (SVG[k] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>` : '');

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function longDate() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const day = 86400000;
  if (diff < day) return 'today';
  const d = Math.floor(diff / day);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

let ENTRIES = [];
// SOW-023: the personalized "Following" view. FOLLOWING is a Set of followed usernames once loaded for an
// effective-paid member, or null when unknown (not signed in, trial, or the paid-only Worker denied the read).
let VIEW = 'latest';
let FOLLOWING = null;
let FOLLOWS_LOADED = false;
// SOW-039: the persisted feed view mode (compact | detailed | card).
let MODE = (() => { try { return localStorage.getItem('gbti-nt-mode') || 'compact'; } catch (e) { return 'compact'; } })();

// ---- feed atoms ----
const thumbUrl = (t) => (/^https?:\/\//.test(t) ? t : `${SITE}${t}`);
function thumbEl(e) {
  const ct = chipType(e.type);
  if (e.thumb) {
    // The type glyph sits behind; the optimized content image overlays it. If the image 404s/errs, a post-render
    // listener removes it and the glyph + gradient remain (so a row never shows a broken image).
    return `<span class="thumb t-${ct}">${ico(ct)}<img class="thumb-pic" src="${esc(thumbUrl(e.thumb))}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="thumb fallback">${ico(ct)}</span>`;
}
const chip = (type) => { const ct = chipType(type); return `<span class="tchip c-${ct}">${ico(ct)}${TYPE_LABEL[ct] || ct.toUpperCase()}</span>`; };
const lockBadge = () => `<span class="lock">${ico('lock')}Members</span>`;
const avatarImg = (who) => `<img class="av-img" src="${esc(avatarFor(who))}" alt="" loading="lazy" />`;
const authorMeta = (who, ago) => `<span class="meta-au"><b>${esc(authorName(who))}</b>${ago ? ` · ${esc(ago)}` : ''}</span>`;
// SOW-031: each feed item opens IN the extension reader (browse.html deep-link), falling back to the site URL
// only when the entry carries no repo path (older index, defensive).
const hrefFor = (e) => (e.path ? `browse.html#${buildReadHash(e.type, e.path)}` : `${SITE}${e.url}`);

function renderCompact(items) {
  return `<div class="feed-compact">` + items.map((e) => {
    const ago = relTime(e.publishedAt);
    return `<a class="row-c" href="${esc(hrefFor(e))}">
      ${avatarImg(e.author)}${thumbEl(e)}${chip(e.type)}
      <span class="title">${esc(e.title)}</span>
      <span class="right">${e.visibility === 'members' ? lockBadge() : ''}${authorMeta(e.author, ago)}</span>
    </a>`;
  }).join('') + `</div>`;
}
function renderDetailed(items) {
  return `<div class="feed-detailed">` + items.map((e) => {
    const ago = relTime(e.publishedAt);
    return `<a class="row-d" href="${esc(hrefFor(e))}">
      ${thumbEl(e)}
      <div class="d-body">
        <div class="d-top">${chip(e.type)}${e.visibility === 'members' ? lockBadge() : ''}</div>
        <div class="title">${esc(e.title)}</div>
        <div class="d-meta">${avatarImg(e.author)}${authorMeta(e.author, ago)}</div>
      </div>
    </a>`;
  }).join('') + `</div>`;
}
function renderCard(items) {
  return `<div class="feed-card">` + items.map((e) => {
    const ago = relTime(e.publishedAt);
    return `<a class="card-i" href="${esc(hrefFor(e))}">
      <div class="c-top">${chip(e.type)}${e.visibility === 'members' ? lockBadge() : ''}</div>
      <div class="title">${esc(e.title)}</div>
      <div class="c-meta"><span class="c-au">${avatarImg(e.author)}${authorMeta(e.author, ago)}</span></div>
      ${thumbEl(e)}
    </a>`;
  }).join('') + `</div>`;
}
const RENDER = { compact: renderCompact, detailed: renderDetailed, card: renderCard };

function renderFeed(filter = '') {
  const feed = $('[data-feed]');
  if (!feed) return;
  const q = filter.trim().toLowerCase();

  // The "Following" view needs an effective-paid follow list. Surface a clear empty state otherwise.
  if (VIEW === 'following') {
    if (FOLLOWING === null) {
      feed.innerHTML = `<p class="muted">Following is a member feature. Sign in with the GBTI client or extension as a paid member to see the people you follow. <a href="${SITE}/membership/" style="color:var(--green-700)">Become a member</a>.</p>`;
      return;
    }
    if (FOLLOWING.size === 0) {
      feed.innerHTML = `<p class="muted">You are not following anyone yet. Open a member profile and choose "Subscribe to activity" to build your feed.</p>`;
      return;
    }
  }

  const base = VIEW === 'following' ? ENTRIES.filter((e) => FOLLOWING.has(String(e.author).toLowerCase())) : ENTRIES;
  const rows = base.filter((e) => !q || `${e.title} ${authorName(e.author)}`.toLowerCase().includes(q));
  if (!rows.length) {
    const empty = VIEW === 'following'
      ? (q ? 'No followed activity matches that filter.' : 'No recent activity from the members you follow.')
      : (ENTRIES.length ? 'No activity matches that filter.' : 'No activity yet.');
    feed.innerHTML = `<p class="muted">${empty}</p>`;
    return;
  }
  feed.innerHTML = (RENDER[MODE] || renderCompact)(rows);

  // CSP-safe fallbacks (inline onerror is blocked by the MV3 extension_pages CSP):
  // a content image that 404s drops to the type glyph; an author avatar that 404s drops to the GBTI icon.
  feed.querySelectorAll('.thumb-pic').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
  feed.querySelectorAll('.av-img').forEach((img) => img.addEventListener('error', () => { img.src = 'icons/icon-32.png'; }, { once: true }));
}

/** Reflect the active view mode onto the switcher buttons. */
function syncModeButtons() {
  document.querySelectorAll('.nt-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === MODE));
}

/** Load the caller's follow list from the background worker (paid-only). Sets FOLLOWING to a Set, or null. */
async function loadFollows() {
  FOLLOWS_LOADED = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/follows', query: {} } });
    const list = Array.isArray(r?.json) ? r.json : (Array.isArray(r?.json?.following) ? r.json.following : null);
    FOLLOWING = list ? new Set(list.map((f) => String(f?.username || '').toLowerCase()).filter(Boolean)) : null;
  } catch {
    FOLLOWING = null; // worker unreachable / not paid -> the member-feature empty state
  }
}

async function loadActivity() {
  const status = $('[data-feed-status]');
  try {
    const res = await fetch(`${SITE}/activity-index.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    ENTRIES = Array.isArray(data?.entries) ? data.entries : [];
    renderFeed($('[data-filter]')?.value || '');
  } catch {
    if (status) status.innerHTML = `Could not load the latest activity. <a href="${SITE}/" style="color:var(--green-700)">Open the co-op</a> instead.`;
  }
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('gbti-theme', t); } catch (e) {}
  const btn = $('[data-theme-toggle]');
  if (btn) btn.innerHTML = ico(t === 'dark' ? 'sun' : 'moon');
}

/** Ask the background worker a GET /api/* and return its json (null on any failure). */
async function api(pathname) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query: {} } });
    return r?.json ?? null;
  } catch { return null; }
}

// SOW-036: the account control + dropdown. The avatar menu mirrors the gbti.network site header; in the extension
// the items are plain in-extension links (no content-script relay needed). closeMeMenu/openMeMenu read the
// elements lazily so they are usable from both applyAccount (module scope) and the init wiring.
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
function closeMeMenu() {
  const menu = $('[data-me-menu]');
  if (menu) menu.hidden = true;
  $('[data-me-btn]')?.setAttribute('aria-expanded', 'false');
}
function openMeMenu() {
  const menu = $('[data-me-menu]');
  if (menu) menu.hidden = false;
  $('[data-me-btn]')?.setAttribute('aria-expanded', 'true');
  menu?.querySelector('.mi')?.focus();
}

/** Reflect the signed-in status into the avatar control: avatar + "@login" head + role-gated Admin item + the
 *  greeting suffix, or the signed-out "Sign in" affordance. status is the /api/status payload, or null. */
function applyAccount(status) {
  const meBtn = $('[data-me-btn]');
  const signinBtn = $('[data-signin-btn]');
  const greetName = $('[data-greet-name]');
  if (status) {
    const login = status.identity.login;
    const meAv = $('[data-me-av]');
    if (meAv) { meAv.src = `https://github.com/${encodeURIComponent(login)}.png?size=64`; meAv.alt = `@${login}`; }
    const head = $('[data-me-head]');
    if (head) head.innerHTML = `Signed in as <b>@${esc(login)}</b>`;
    const adminItem = document.querySelector('.mi-admin');
    if (adminItem) adminItem.hidden = (RANK[status.role] ?? 0) < RANK.moderator;
    if (greetName) greetName.textContent = `, @${login}`;
    if (meBtn) meBtn.hidden = false;
    if (signinBtn) signinBtn.hidden = true;
  } else {
    closeMeMenu();
    if (greetName) greetName.textContent = '';
    if (meBtn) meBtn.hidden = true;
    if (signinBtn) signinBtn.hidden = false;
  }
}

// SOW-026: the new tab is onboarding-aware. Show who is signed in, and until the member is signed in AND set up
// (fork + GBTI App install), show a setup banner that opens the onboarding tab.
async function loadAccountAndSetup() {
  const [status, ob] = await Promise.all([api('/api/status'), api('/api/onboarding-status')]);
  const signedIn = Boolean(status?.authenticated && status?.identity?.login);

  applyAccount(signedIn ? status : null);

  const setup = $('[data-setup]');
  if (!setup) return;
  // Ready = the wizard says ready, or classic mode (no fork/install step) once signed in.
  const ready = ob ? (ob.ready || (ob.appMode === false && signedIn)) : signedIn;
  if (ready) { setup.classList.remove('show'); return; }

  const txt = setup.querySelector('[data-setup-txt]');
  const go = setup.querySelector('[data-setup-go]');
  if (!signedIn) {
    if (txt) txt.innerHTML = `<b>Sign in to publish</b><span>Connect GitHub to write and publish your work on GBTI Network.</span>`;
    if (go) go.textContent = 'Get started';
  } else {
    const step = ob?.activeStep === 'fork' ? 2 : ob?.activeStep === 'install' ? 3 : 1;
    if (txt) txt.innerHTML = `<b>Finish setting up publishing</b><span>Step ${step} of 3. Make your copy and give access to start publishing.</span>`;
    if (go) go.textContent = 'Finish setup';
  }
  setup.classList.add('show');
}

/** True if daily.dev is installed + enabled, false if confirmed absent, null if we cannot tell (no permission). */
async function dailydevInstalled() {
  try {
    if (chrome.management?.get) {
      const info = await chrome.management.get(DAILYDEV_ID).catch(() => null);
      return Boolean(info && info.enabled);
    }
  } catch { /* management present but threw */ }
  return null; // unknown: no "management" permission, so Chrome will not reveal other extensions
}

async function setupAppSwitcher() {
  const apps = $('[data-apps]');
  if (!apps) return;
  apps.querySelector('[data-open-dailydev]')?.addEventListener('click', () => { window.location.href = DAILYDEV_APP_URL; });
  // The daily.dev favicon is remote; if it fails (offline / path change) swap in a small "dd" badge.
  const img = apps.querySelector('[data-dd-img]');
  img?.addEventListener('error', () => {
    const b = document.createElement('span');
    b.className = 'dd';
    b.textContent = 'dd';
    img.replaceWith(b);
  }, { once: true });

  const installed = await dailydevInstalled();
  if (installed === true || installed === null) apps.classList.add('show');
}

// SOW-018: a lapsed (Locked) member's extension is locked behind a renew splash. Only a genuinely Locked status
// (expired/cancelled/banned/none) locks the page; a signed-out visitor or an active member sees the normal tab.
async function checkMembershipLock() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/status', query: {} } });
    if (isLockedMembership(r?.json?.membership)) {
      document.documentElement.setAttribute('data-locked', '1');
      return true;
    }
  } catch (e) { /* worker unreachable -> fail open, show the normal new tab */ }
  return false;
}

// One-time tip about Chrome's own new-tab footer (Chrome 138+). We cannot remove that footer from an extension,
// so we show this dismissible note once and remember the dismissal. CSP-safe (no inline handler).
const FOOTERTIP_KEY = 'gbti-footertip-dismissed';
function initFooterTip() {
  const el = $('[data-footertip]');
  if (!el) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(FOOTERTIP_KEY) === '1'; } catch (e) { /* storage blocked */ }
  if (dismissed) return;
  el.classList.add('show');
  el.querySelector('[data-footertip-dismiss]')?.addEventListener('click', () => {
    el.classList.remove('show');
    try { localStorage.setItem(FOOTERTIP_KEY, '1'); } catch (e) { /* storage blocked */ }
  });
}

function init() {
  // Fill the inline-SVG glyphs marked with data-ico (rail, toolbar, mode switcher). CSP-safe (trusted strings).
  document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
  const greetEl = $('[data-greeting]');
  if (greetEl) greetEl.textContent = greeting();
  const dateEl = $('[data-date]');
  if (dateEl) dateEl.textContent = longDate();

  // Theme button reflects the current theme (set no-flash on <html> by theme-init.js).
  const themeBtn = $('[data-theme-toggle]');
  if (themeBtn) themeBtn.innerHTML = ico(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon');

  syncModeButtons();
  initFooterTip(); // one-time Chrome-footer hint
  checkMembershipLock(); // async; sets data-locked if the member has lapsed
  loadAccountAndSetup(); // async; signed-in identity + the onboarding setup banner
  setupAppSwitcher(); // async; the daily.dev switcher

  // The setup banner opens the onboarding tab (sign in -> fork -> install).
  $('[data-setup]')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs?.create
      ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
      : window.open(chrome.runtime.getURL('onboarding.html'), '_blank');
  });

  themeBtn?.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // SOW-039: the view-mode switcher. Persist + re-render in place.
  document.querySelectorAll('.nt-mode').forEach((b) => b.addEventListener('click', () => {
    MODE = b.dataset.mode;
    try { localStorage.setItem('gbti-nt-mode', MODE); } catch (e) {}
    syncModeButtons();
    renderFeed($('[data-filter]')?.value || '');
  }));

  // SOW-036: the account dropdown. Toggle on click; close on Esc, outside-click, and after a menu choice.
  $('[data-me-av]')?.addEventListener('error', (e) => { e.target.src = 'icons/icon-32.png'; });
  $('[data-me-btn]')?.addEventListener('click', (e) => { e.stopPropagation(); $('[data-me-menu]')?.hidden ? openMeMenu() : closeMeMenu(); });
  document.addEventListener('click', (e) => { const m = $('[data-me-menu]'); if (m && !m.hidden && !$('[data-me-wrap]')?.contains(e.target)) closeMeMenu(); });
  document.addEventListener('keydown', (e) => { const m = $('[data-me-menu]'); if (e.key === 'Escape' && m && !m.hidden) { closeMeMenu(); $('[data-me-btn]')?.focus(); } });
  // Sign in -> the onboarding tab (same path as the setup banner). The menu's content links navigate in-extension.
  $('[data-signin-btn]')?.addEventListener('click', () => {
    chrome.tabs?.create
      ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
      : window.open(chrome.runtime.getURL('onboarding.html'), '_blank');
  });
  // Sign out -> clear the token in the worker, then re-render the control as signed-out.
  $('[data-me-signout]')?.addEventListener('click', async () => {
    closeMeMenu();
    try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
    loadAccountAndSetup();
  });

  $('[data-filter]')?.addEventListener('input', (e) => renderFeed(e.target.value));

  // SOW-023: Latest / Following tabs.
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const view = btn.getAttribute('data-tab');
      if (view === VIEW) return;
      VIEW = view;
      document.querySelectorAll('[data-tab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const q = $('[data-filter]')?.value || '';
      if (VIEW === 'following' && !FOLLOWS_LOADED) {
        const feed = $('[data-feed]');
        if (feed) feed.innerHTML = '<p class="muted">Loading the members you follow...</p>';
        await loadFollows();
      }
      renderFeed(q);
    });
  });

  if (document.documentElement.getAttribute('data-off') !== '1') loadActivity();

  // Re-check setup state when the member returns to this tab (for example after forking in another tab).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAccountAndSetup(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

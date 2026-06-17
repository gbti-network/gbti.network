// SOW-017: the new-tab landing page logic. Fetches the public activity index from gbti.network (covered by the
// extension host permission, so no CORS), renders the greeting + date + Latest Activity feed, and wires the
// search filter, the theme toggle (persisted, no-flash on next load), and the on/off takeover toggle.

import { isLockedMembership } from '../../client/src/membership.mjs';
import { buildReadHash } from '../../client-ui/src/browse-hash.mjs';

const SITE = 'https://gbti.network';

// SOW: a one-way daily.dev switcher. Chrome gives no way to see another extension WITHOUT the heavyweight
// "management" permission (a Web Store review + user-scare cost), and daily.dev's web-accessible resources +
// install marker are scoped to daily.dev origins, not our chrome-extension page, so we cannot probe it from
// here. So: if "management" is ever granted we TRULY detect daily.dev; otherwise we show the switch by default.
// Clicking it switches the current tab to the daily.dev web app (their extension new-tab is not navigable
// cross-extension). The reverse jump (a "back to GBTI" button inside daily.dev) is impossible: Chrome forbids
// injecting into another extension's pages.
const DAILYDEV_ID = 'jlmpjdjjbgclbocgajdjefcidcncaied';
const DAILYDEV_APP_URL = 'https://app.daily.dev/';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a);
// Author avatar: GBTI's own house content uses the extension icon; a member's avatar comes from GitHub by login
// (the activity-index author is the folder username, which equals the login for members). A 404 (folder != login,
// or a deleted account) falls back to the GBTI icon via a post-render error listener (CSP forbids inline onerror).
const avatarFor = (a) => (a === 'gbti' ? 'icons/icon-32.png' : `https://github.com/${encodeURIComponent(a)}.png?size=48`);
const TYPE_LABEL = { post: 'Article', product: 'Product', prompt: 'Prompt', share: 'Share' };

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

function renderFeed(filter = '') {
  const feed = $('[data-feed]');
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
  feed.innerHTML = rows
    .map((e) => {
      // SOW-031: open the item IN the extension reader (browse.html deep-link) instead of navigating out to
      // gbti.network. Fall back to the site URL only if the entry carries no repo path (older index, defensive).
      const href = e.path ? `browse.html#${buildReadHash(e.type, e.path)}` : `${SITE}${e.url}`;
      return `<a class="row" href="${esc(href)}">
        <img class="row-av" src="${esc(avatarFor(e.author))}" alt="" width="30" height="30" loading="lazy" />
        <span class="badge">${esc(TYPE_LABEL[e.type] || e.type)}</span>
        <span class="title">${e.visibility === 'members' ? '<span class="mlock" title="Members only">🔒 </span>' : ''}${esc(e.title)}</span>
        <span class="meta">${esc(authorName(e.author))}${e.publishedAt ? ` · ${esc(relTime(e.publishedAt))}` : ''}</span>
      </a>`;
    })
    .join('');
  // CSP-safe avatar fallback: an avatar that 404s (folder != login) swaps to the GBTI icon. Inline onerror is
  // blocked by the MV3 extension_pages CSP, so attach the listener here after render.
  feed.querySelectorAll('.row-av').forEach((img) => img.addEventListener('error', () => { img.src = 'icons/icon-32.png'; }, { once: true }));
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
}

/** Ask the background worker a GET /api/* and return its json (null on any failure). */
async function api(pathname) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query: {} } });
    return r?.json ?? null;
  } catch { return null; }
}

// SOW-036: the account control roles + dropdown. The avatar menu mirrors the gbti.network site header; in the
// extension the items are plain in-extension links (no content-script relay needed). closeMeMenu/openMeMenu read
// the elements lazily so they are usable from both applyAccount (module scope) and the init wiring.
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

/** Reflect the signed-in status into the avatar control: avatar + "@login" head + role-gated Admin item, or the
 *  signed-out "Sign in" affordance. status is the /api/status payload when signed in, or null. */
function applyAccount(status) {
  const meBtn = $('[data-me-btn]');
  const signinBtn = $('[data-signin-btn]');
  if (status) {
    const login = status.identity.login;
    const meAv = $('[data-me-av]');
    if (meAv) { meAv.src = `https://github.com/${encodeURIComponent(login)}.png?size=60`; meAv.alt = `@${login}`; }
    const head = $('[data-me-head]');
    if (head) head.innerHTML = `Signed in as <b>@${esc(login)}</b>`;
    const adminItem = document.querySelector('.mi-admin');
    if (adminItem) adminItem.hidden = (RANK[status.role] ?? 0) < RANK.moderator;
    if (meBtn) meBtn.hidden = false;
    if (signinBtn) signinBtn.hidden = true;
  } else {
    closeMeMenu();
    if (meBtn) meBtn.hidden = true;
    if (signinBtn) signinBtn.hidden = false;
  }
}

// SOW-026: the new tab is onboarding-aware. Show who is signed in, and until the member is signed in AND set up
// (fork + GBTI App install), show a setup banner that opens the onboarding tab. This keeps the new tab from
// looking "done" while publishing is not yet wired up.
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
  // Show when confirmed installed, or when we cannot tell (no management permission to check).
  if (installed === true || installed === null) apps.classList.add('show');
}

// SOW-018: a lapsed (Locked) member's extension is locked behind a renew splash. Ask the background worker for
// the cached membership; only a genuinely Locked status (expired/cancelled/banned/none) locks the page. A
// signed-out visitor (unknown) or an active trial/paid member sees the normal new tab.
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
  $('[data-greeting]').textContent = greeting();
  $('[data-date]').textContent = longDate();
  initFooterTip(); // one-time Chrome-footer hint
  checkMembershipLock(); // async; sets data-locked if the member has lapsed
  loadAccountAndSetup(); // async; shows the signed-in identity + the onboarding setup banner
  setupAppSwitcher(); // async; the [G | daily.dev] switcher

  // The setup banner opens the onboarding tab (sign in -> fork -> install).
  $('[data-setup]')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs?.create
      ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
      : window.open(chrome.runtime.getURL('onboarding.html'), '_blank');
  });

  $('[data-theme-toggle]')?.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // SOW-036: the account dropdown. Toggle on click; close on Esc, on outside-click, and after a menu choice.
  // The CSP forbids inline onerror, so attach the avatar fallback listener here.
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

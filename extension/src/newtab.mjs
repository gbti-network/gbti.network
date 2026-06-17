// SOW-017 + SOW-039: the new-tab page logic. The shared member-hub shell (top bar + left rail + account menu) is
// injected + wired by shell.mjs; this module owns the "Latest Activity" feed (three persisted view modes +
// per-item content thumbnails), the search filter, the Latest/Following tabs (SOW-023), the onboarding setup
// banner (SOW-026/029), and the lapsed-member lock (SOW-018). Fetches the public activity index over the
// extension's gbti.network host permission. CSP-safe (no inline handlers).

import { isLockedMembership } from '../../client/src/membership.mjs';
import { buildReadHash } from '../../client-ui/src/browse-hash.mjs';
import { initShell, ico, esc } from './shell.mjs';

const SITE = 'https://gbti.network';

const $ = (sel) => document.querySelector(sel);
const authorName = (a) => (a === 'gbti' || a === 'house' ? 'GBTI Network' : a);
// Author avatar: GBTI's own house content uses the extension icon; a member's avatar comes from GitHub by login.
const avatarFor = (a) => (a === 'gbti' || a === 'house' ? 'icons/icon-32.png' : `https://github.com/${encodeURIComponent(a)}.png?size=64`);
// The activity index uses type 'post'; the feed UI labels/colors it as an "article" (matching the site + design).
const chipType = (t) => (t === 'post' ? 'article' : t);
const TYPE_LABEL = { article: 'ARTICLE', product: 'PRODUCT', prompt: 'PROMPT' };

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
    // The type glyph sits behind; the optimized content image overlays it. If the image errs, a post-render
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
// only when the entry carries no repo path (older index, defensive). buildReadHash takes the RAW type.
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

  // CSP-safe fallbacks: a content image that 404s drops to the type glyph; an author avatar that 404s drops to
  // the GBTI icon.
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
    FOLLOWING = null;
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

/** GET /api/* via the background worker; null on any failure. (The setup banner needs status + onboarding.) */
async function api(pathname) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query: {} } });
    return r?.json ?? null;
  } catch { return null; }
}

// SOW-026/029: the onboarding setup banner. Shown until the member is signed in AND set up (fork + GBTI App
// install). The shell owns the account control + identity; this only drives the banner.
async function loadSetupBanner() {
  const [status, ob] = await Promise.all([api('/api/status'), api('/api/onboarding-status')]);
  const signedIn = Boolean(status?.authenticated && status?.identity?.login);
  const setup = $('[data-setup]');
  if (!setup) return;
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

// SOW-018: a lapsed (Locked) member's extension is locked behind a renew splash. Only a genuinely Locked status
// (expired/cancelled/banned/none) locks the page; a signed-out visitor or an active member sees the normal tab.
async function checkMembershipLock() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/status', query: {} } });
    if (isLockedMembership(r?.json?.membership)) {
      document.documentElement.setAttribute('data-locked', '1');
      return true;
    }
  } catch (e) { /* worker unreachable -> fail open */ }
  return false;
}

// One-time tip about Chrome's own new-tab footer (Chrome 138+). CSP-safe (no inline handler).
const FOOTERTIP_KEY = 'gbti-footertip-dismissed';
function initFooterTip() {
  const el = $('[data-footertip]');
  if (!el) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(FOOTERTIP_KEY) === '1'; } catch (e) {}
  if (dismissed) return;
  el.classList.add('show');
  el.querySelector('[data-footertip-dismiss]')?.addEventListener('click', () => {
    el.classList.remove('show');
    try { localStorage.setItem(FOOTERTIP_KEY, '1'); } catch (e) {}
  });
}

function init() {
  // The shared shell injects + wires the top bar (theme, apps, account menu) + the left rail, and fills the
  // page's static [data-ico] glyphs (search + the mode-switcher icons).
  initShell({ active: 'activity' });

  const greetEl = $('[data-greeting]');
  if (greetEl) greetEl.textContent = greeting();
  const dateEl = $('[data-date]');
  if (dateEl) dateEl.textContent = longDate();

  syncModeButtons();
  initFooterTip();
  checkMembershipLock();
  loadSetupBanner();

  // The setup banner opens the onboarding tab (sign in -> fork -> install).
  $('[data-setup]')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs?.create
      ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
      : window.open(chrome.runtime.getURL('onboarding.html'), '_blank');
  });

  // SOW-039: the view-mode switcher. Persist + re-render in place.
  document.querySelectorAll('.nt-mode').forEach((b) => b.addEventListener('click', () => {
    MODE = b.dataset.mode;
    try { localStorage.setItem('gbti-nt-mode', MODE); } catch (e) {}
    syncModeButtons();
    renderFeed($('[data-filter]')?.value || '');
  }));

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

  // Re-check the setup banner when the member returns to this tab (e.g. after forking in another tab).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSetupBanner(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

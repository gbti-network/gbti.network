// SOW-017 + SOW-039: the new-tab page logic. The shared member-hub shell (top bar + left rail + account menu) is
// injected + wired by shell.mjs; this module owns the "Latest Activity" feed (three persisted view modes +
// per-item content thumbnails), the search filter, the Latest/Following tabs (SOW-023), the onboarding setup
// banner (SOW-026/029), and the lapsed-member lock (SOW-018). Fetches the public activity index over the
// extension's gbti.network host permission. CSP-safe (no inline handlers).

import { isLockedMembership } from '../../client/src/membership.mjs';
import { buildReadHash } from '../../client-ui/src/browse-hash.mjs';
import { mergeAll, canSeeShares } from '../../client-ui/src/all-merge.mjs'; // SOW-042: the All merge + Shares policy
import { initShell } from './shell.mjs';
import { mountPageClient } from './page-client.mjs'; // SOW-041 P5: a GbtiClient so the top-bar "+" composer works here (also defines <gbti-card-list>)

const SITE = 'https://gbti.network';

const $ = (sel) => document.querySelector(sel);
const authorName = (a) => (a === 'gbti' || a === 'house' ? 'GBTI Network' : a);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function longDate() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

let ENTRIES = [];
// SOW-023: the personalized "Following" view. FOLLOWING is a Set of followed usernames once loaded for an
// effective-paid member, or null when unknown (not signed in, trial, or the paid-only Worker denied the read).
let VIEW = 'latest';
let FOLLOWING = null;
let FOLLOWS_LOADED = false;
// SOW-039: the persisted feed view mode (compact | detailed | card).
let MODE = (() => { try { return localStorage.getItem('gbti-nt-mode') || 'compact'; } catch (e) { return 'compact'; } })();
// SOW-042: the persisted type filter (all | post | product | prompt | share). 'all' merges the activity-index with
// the member's Shares (capped river). MEMBERSHIP gates Shares; SHARES is the raw list, loaded once on demand.
const TYPE_FILTERS = new Set(['all', 'post', 'product', 'prompt', 'share']);
let TYPE = (() => { try { const t = localStorage.getItem('gbti-nt-type'); return TYPE_FILTERS.has(t) ? t : 'all'; } catch (e) { return 'all'; } })();
let MEMBERSHIP = 'unknown';
let SHARES = null;
let SHARES_LOADED = false;
const FEED_CAP = 40; // the Activity feed is a capped river (Browse "All" is the uncapped directory)

// SOW-031/042: each feed item opens IN the extension reader (browse.html deep-link), falling back to the site URL
// only when the entry carries no repo path (older index, defensive). buildReadHash takes the RAW type. The per-mode
// row/card markup + its atoms (thumb, chip, lock, meta) now live in the shared <gbti-card-list> (SOW-042), so the
// activity feed and Browse render through ONE source of truth (the owner's "two stylings" complaint).
const hrefFor = (e) => (e.path ? `browse.html#${buildReadHash(e.type, e.path)}` : `${SITE}${e.url}`);

// Project a merged feed item (an activity-index entry OR a Share, both already carrying a normalized shape) onto the
// <gbti-card-list> item shape. The RAW type ('post'/'share') is preserved so the card glyph + label resolve the same
// way Browse does. A content item deep-links into the in-extension reader; a Share has no path-addressed reader, so
// it routes to the Shares stream tab.
const toCardItem = (e) => ({
  type: e.type,
  title: e.title,
  author: e.author,
  visibility: e.visibility,
  thumb: e.thumb,
  category: e.category,
  excerpt: e.excerpt || '',
  createdAt: e.createdAt ?? e.publishedAt,
  openHref: e.type === 'share' ? 'browse.html#tab=share' : hrefFor(e),
});

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

  // SOW-042: the "All" filter merges the activity-index with the member's Shares (newest-first, Shares omitted for a
  // non-member by the shared policy); a specific type filter narrows to that type. The merge is the ONE shared fn.
  const wantShares = TYPE === 'all' || TYPE === 'share';
  let rows = mergeAll({ items: ENTRIES, shares: wantShares ? SHARES : null, membership: MEMBERSHIP });
  if (TYPE !== 'all') rows = rows.filter((e) => e.type === TYPE);
  if (VIEW === 'following') rows = rows.filter((e) => FOLLOWING.has(String(e.author).toLowerCase()));
  rows = rows.slice(0, FEED_CAP); // the capped river
  if (q) rows = rows.filter((e) => `${e.title} ${authorName(e.author)}`.toLowerCase().includes(q));

  if (!rows.length) {
    const empty = VIEW === 'following'
      ? (q ? 'No followed activity matches that filter.' : 'No recent activity from the members you follow.')
      : (q ? 'No activity matches that filter.' : (TYPE === 'share' ? 'No Shares yet.' : 'No activity yet.'));
    feed.innerHTML = `<p class="muted">${empty}</p>`;
    return;
  }
  // The shared card-list owns the markup, the three density modes, and the CSP-safe broken-image fallback.
  const list = document.createElement('gbti-card-list');
  list.mode = MODE;
  list.items = rows.map(toCardItem);
  feed.replaceChildren(list);
}

/** Reflect the active view mode onto the switcher buttons. */
function syncModeButtons() {
  document.querySelectorAll('.nt-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === MODE));
}

/** Reflect the active type filter onto the chip-row (SOW-042). */
function syncTypeButtons() {
  document.querySelectorAll('.nt-type').forEach((b) => b.classList.toggle('on', b.dataset.type === TYPE));
}

/** Load the member's Shares once (member-gated, fail-closed to []). Shares ride /api/shares via the background. */
async function loadShares() {
  SHARES_LOADED = true;
  if (!canSeeShares(MEMBERSHIP)) { SHARES = []; return; }
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/shares', query: {} } });
    SHARES = Array.isArray(r?.json?.items) ? r.json.items : [];
  } catch { SHARES = []; }
}

/** If the active filter needs Shares and they are not loaded yet, fetch them, then re-render the feed. */
async function ensureSharesForFilter() {
  if ((TYPE === 'all' || TYPE === 'share') && !SHARES_LOADED) {
    await loadShares();
    renderFeed($('[data-filter]')?.value || '');
  }
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
    MEMBERSHIP = r?.json?.membership ?? 'unknown'; // SOW-042: drives the All filter's Shares visibility
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
  // Register the messaging-backed GbtiClient so the shell's "+" composer (and any client-ui element) works on the
  // new tab too; the feed itself still talks to the background worker directly.
  mountPageClient();
  // The shared shell injects + wires the top bar (theme, apps, account menu, "+") + the left rail, and fills the
  // page's static [data-ico] glyphs (search + the mode-switcher icons).
  initShell({ active: 'activity' });

  const greetEl = $('[data-greeting]');
  if (greetEl) greetEl.textContent = greeting();
  const dateEl = $('[data-date]');
  if (dateEl) dateEl.textContent = longDate();

  syncModeButtons();
  syncTypeButtons();
  initFooterTip();
  // Status drives both the lapsed lock and the All filter's Shares visibility; once it resolves, pull Shares if the
  // default (or persisted) filter needs them and re-render.
  checkMembershipLock().then(() => ensureSharesForFilter());
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

  // SOW-042: the type filter chip-row (All / Articles / Products / Prompts / Shares). Persist + re-render; selecting
  // All or Shares lazily loads the member's Shares the first time.
  document.querySelectorAll('.nt-type').forEach((b) => b.addEventListener('click', async () => {
    const next = b.dataset.type;
    if (!TYPE_FILTERS.has(next) || next === TYPE) return;
    TYPE = next;
    try { localStorage.setItem('gbti-nt-type', TYPE); } catch (e) {}
    syncTypeButtons();
    if ((TYPE === 'all' || TYPE === 'share') && !SHARES_LOADED) {
      const feed = $('[data-feed]');
      if (feed) feed.innerHTML = '<p class="muted">Loading...</p>';
      await loadShares();
    }
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

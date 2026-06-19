// SOW-017 + SOW-039: the new-tab page logic. The shared member-hub shell (top bar + left rail + account menu) is
// injected + wired by shell.mjs; this module owns the "Latest Activity" feed (three persisted view modes +
// per-item content thumbnails), the search filter, the Latest/Following tabs (SOW-023), the onboarding setup
// banner (SOW-026/029), and the lapsed-member lock (SOW-018). Fetches the public activity index over the
// extension's gbti.network host permission. CSP-safe (no inline handlers).

import { isLockedMembership } from '../../client/src/membership.mjs';
import { mergeAll, canSeeShares, toMs } from '../../client-ui/src/all-merge.mjs'; // SOW-042: the All merge + Shares policy
import { newsToItem } from '../../client-ui/src/news.mjs'; // SOW-043: blend members-only news into the feed
import { parseBrowseHash } from '../../client-ui/src/browse-hash.mjs'; // the activity bell's deep-link (tab=<type>&read=<path>)
import { initShell, setRailActive } from './shell.mjs';
import { TYPE_FILTERS, typeForHash, railKeyForType } from '../../client-ui/src/feed-route.mjs';
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
// SOW-046 E: the member's followed NEWS CHANNELS (source ids); the Following view drills into these for news.
let FOLLOWED_CHANNELS = null; // a Set of lowercased source ids, or null when not loaded / not a paid member
let PREFS_LOADED = false;
// SOW-039: the persisted feed view mode (compact | detailed | card).
let MODE = (() => { try { return localStorage.getItem('gbti-nt-mode') || 'compact'; } catch (e) { return 'compact'; } })();
// SOW-042/043: the active type filter (all | post | product | prompt | share | news). 'all' blends the
// activity-index with the member's Shares + members-only News (capped river). MEMBERSHIP gates both; SHARES + NEWS
// are the raw lists, loaded once on demand. News is PAID-only; Shares are paid-or-trial. (TYPE_FILTERS,
// parseTypeFromHash, typeForHash, railKeyForType live in client-ui/src/feed-route.mjs so they are node-testable.)
// The feed IS the unified content browser; the rail's Browse items are shortcuts that open it pre-filtered via
// the hash (newtab.html#type=<X>). A BARE newtab.html (the Activity rail item) is ALWAYS the all-types river: the
// hash alone decides the filter, so clicking Activity deterministically resets to 'all' (there is no persisted
// type to fight it). The activity bell deep-links here too, in the legacy Browse hash shape
// (#tab=<type>&read=<repo path>); the hash parser accepts `type=` OR `tab=`, and readFromHash pulls the optional
// path that auto-opens the in-place reader.
const hashStr = () => (typeof location !== 'undefined' && location.hash) || '';
const readFromHash = () => { const { read } = parseBrowseHash(hashStr()); return read || null; };
let TYPE = typeForHash(hashStr()); // bare newtab.html -> 'all' (the river); #type=<X> -> that type
let MEMBERSHIP = 'unknown';
let SHARES = null;
let SHARES_LOADED = false;
let NEWS = null;
let NEWS_LOADED = false;
const FEED_CAP = 40; // the Activity feed is a capped river (Browse "All" is the uncapped directory)

// The per-mode row/card markup + its atoms (thumb, chip, lock, meta) live in the shared <gbti-card-list>
// (SOW-042), so the activity feed and Browse render through ONE source of truth. Content + Shares open IN PLACE
// in the page reader (openReader); only News carries an outbound openHref (its UTM source link).

// Project a merged feed item (an activity-index entry OR a Share, both already carrying a normalized shape) onto the
// <gbti-card-list> item shape. The RAW type ('post'/'share') is preserved so the card glyph + label resolve the same
// way Browse does. A content item deep-links into the in-extension reader; a Share has no path-addressed reader, so
// it routes to the Shares stream tab.
const toCardItem = (e) => ({
  ...e, // pass the reader fields through: gbti-reader.open needs `path` for content, author+id+body for a Share
  excerpt: e.excerpt || '',
  createdAt: e.createdAt ?? e.publishedAt,
  // No openHref: content + Shares open IN PLACE in the page reader (the card emits card-open). Only News keeps an
  // openHref (its outbound UTM link, set by newsToItem), so the feed is the one browser — no Browse-page bounce.
});

function renderFeed(filter = '') {
  const feed = $('[data-feed]');
  if (!feed) return;
  const q = filter.trim().toLowerCase();

  if (VIEW === 'following') {
    const noChannels = !FOLLOWED_CHANNELS || FOLLOWED_CHANNELS.size === 0;
    if (FOLLOWING === null && noChannels) {
      feed.innerHTML = `<p class="muted">Following is a member feature. Sign in with the GBTI client or extension as a paid member to follow people and news channels. <a href="${SITE}/membership/" style="color:var(--green-700)">Become a member</a>.</p>`;
      return;
    }
    if ((!FOLLOWING || FOLLOWING.size === 0) && noChannels) {
      feed.innerHTML = `<p class="muted">You are not following anyone or any news channel yet. Subscribe to a member's activity, or follow a channel from the News section, to build your feed.</p>`;
      return;
    }
  }

  // SOW-042/043: the "All" filter blends content + the member's Shares (the ONE shared mergeAll, Shares omitted for
  // a non-member) with members-only News (supplementary, paid-only). A specific type filter narrows to that type.
  // Content + Shares are projected by toCardItem; News (a different source) by newsToItem; both are card items.
  const wantShares = TYPE === 'all' || TYPE === 'share';
  const wantNews = TYPE === 'all' || TYPE === 'news';
  let rows = mergeAll({ items: ENTRIES, shares: wantShares ? SHARES : null, membership: MEMBERSHIP }).map(toCardItem);
  if (wantNews && MEMBERSHIP === 'paid' && Array.isArray(NEWS)) rows = rows.concat(NEWS.map(newsToItem)); // news is a paid perk
  if (TYPE !== 'all') rows = rows.filter((e) => e.type === TYPE);
  // SOW-046 E: the Following view drills into followed MEMBERS' content/shares AND followed NEWS CHANNELS' news
  // (a news item is kept when its source is in the member's followedChannels).
  if (VIEW === 'following') {
    rows = rows.filter((e) => (e.type === 'news'
      ? (FOLLOWED_CHANNELS && FOLLOWED_CHANNELS.has(String(e.source ?? e.author).toLowerCase()))
      : (FOLLOWING && FOLLOWING.has(String(e.author).toLowerCase()))));
  }
  rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)); // newest-first across all three sources
  // "All" is the capped recent river; a specific type filter is the uncapped directory for that type (so the rail's
  // Articles/Products/Prompts/Shares/News shortcuts show everything, not just the latest 40).
  if (TYPE === 'all') rows = rows.slice(0, FEED_CAP);
  if (q) rows = rows.filter((e) => `${e.title} ${authorName(e.author)}`.toLowerCase().includes(q));

  if (!rows.length) {
    const empty = VIEW === 'following'
      ? (q ? 'No followed activity matches that filter.' : 'No recent activity from the members you follow.')
      : (q ? 'No activity matches that filter.' : (TYPE === 'share' ? 'No Shares yet.' : (TYPE === 'news' ? 'No news right now. Check back soon.' : 'No activity yet.')));
    feed.innerHTML = `<p class="muted">${empty}</p>`;
    return;
  }
  // The shared card-list owns the markup, the three density modes, and the CSP-safe broken-image fallback.
  const list = document.createElement('gbti-card-list');
  list.mode = MODE;
  list.items = rows; // already card items (toCardItem / newsToItem)
  list.addEventListener('card-open', (e) => openReader(e.detail?.item)); // content + Shares open IN PLACE
  feed.replaceChildren(list);
}

/** Open a content/Share item IN the page reader (gbti-reader handles post/product/prompt/share), hiding the feed;
 *  Back restores it. The feed IS the browser now, so there is no Browse-page bounce. News items are <a> links
 *  (outbound UTM) and never reach here. gbti-reader is defined by mountPageClient (client-ui), called in init(). */
function openReader(item) {
  if (!item) return;
  const fv = $('[data-feedview]');
  const rv = $('[data-readerview]');
  const host = $('[data-reader]');
  if (!fv || !rv || !host) return;
  const r = document.createElement('gbti-reader');
  host.replaceChildren(r);
  r.open(item);
  fv.hidden = true;
  rv.hidden = false;
  window.scrollTo(0, 0);
}
function closeReader() {
  const fv = $('[data-feedview]');
  const rv = $('[data-readerview]');
  const host = $('[data-reader]');
  if (rv) rv.hidden = true;
  if (host) host.replaceChildren();
  if (fv) fv.hidden = false;
}

/** Reflect the active view mode onto the switcher buttons. */
function syncModeButtons() {
  document.querySelectorAll('.nt-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === MODE));
}

/** Reflect the active type filter onto the chip-row (SOW-042). */
function syncTypeButtons() {
  document.querySelectorAll('.nt-type').forEach((b) => b.classList.toggle('on', b.dataset.type === TYPE));
}

/** Switch the active type filter (shared by the chip-row clicks AND the rail's #type=<X> hash shortcuts). Lazily
 *  loads Shares/News the first time they are needed, then re-renders. A no-op if the filter is unchanged. */
async function selectType(next) {
  if (!TYPE_FILTERS.has(next) || next === TYPE) return;
  TYPE = next;
  syncTypeButtons();
  setRailActive(railKeyForType(TYPE)); // keep the left rail in lockstep with the chips + feed
  closeReader(); // switching filter returns from the reader to the feed
  const needsShares = (TYPE === 'all' || TYPE === 'share') && !SHARES_LOADED;
  const needsNews = (TYPE === 'all' || TYPE === 'news') && !NEWS_LOADED;
  if (needsShares || needsNews) {
    const feed = $('[data-feed]');
    if (feed) feed.innerHTML = '<p class="muted">Loading...</p>';
    if (needsShares) await loadShares();
    if (needsNews) await loadNews();
  }
  renderFeed($('[data-filter]')?.value || '');
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

/** Load the member's News once (SOW-043). News is PAID-only (the Worker 403s a non-paid caller), so only attempt
 *  for a paid member; otherwise fail-closed to []. Rides /api/news via the background (the key stays in the Worker). */
async function loadNews() {
  NEWS_LOADED = true;
  if (MEMBERSHIP !== 'paid') { NEWS = []; return; }
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/news', query: { limit: 60 } } });
    NEWS = Array.isArray(r?.json?.items) ? r.json.items : [];
  } catch { NEWS = []; }
}

/** If the active filter needs News and it is not loaded yet, fetch it, then re-render the feed. */
async function ensureNewsForFilter() {
  if ((TYPE === 'all' || TYPE === 'news') && !NEWS_LOADED) {
    await loadNews();
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

/** SOW-046 E: load the member's followed news channels (source ids) from prefs (paid-only). Set, or null. */
async function loadPrefs() {
  PREFS_LOADED = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/prefs', query: {} } });
    const chans = Array.isArray(r?.json?.followedChannels) ? r.json.followedChannels : null;
    FOLLOWED_CHANNELS = chans ? new Set(chans.map((c) => String(c).toLowerCase())) : null;
  } catch { FOLLOWED_CHANNELS = null; }
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
  // page's static [data-ico] glyphs (search + the mode-switcher icons). The rail item highlighted is derived from
  // the active TYPE (railKeyForType): a bare load lights Activity (the 'all' river), a #type=<X> lights its
  // Browse item. selectType keeps it in sync thereafter.
  initShell({ active: railKeyForType(TYPE) });

  const greetEl = $('[data-greeting]');
  if (greetEl) greetEl.textContent = greeting();
  const dateEl = $('[data-date]');
  if (dateEl) dateEl.textContent = longDate();

  syncModeButtons();
  syncTypeButtons();
  initFooterTip();
  // Status drives the lapsed lock + the All filter's Shares (paid/trial) + News (paid) visibility; once it
  // resolves, pull whatever the default/persisted filter needs and re-render.
  checkMembershipLock().then(() => { ensureSharesForFilter(); ensureNewsForFilter(); });
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

  // SOW-042/043: the type filter chip-row (All / Articles / Products / Prompts / Shares / News). Persist +
  // re-render; selecting All/Shares lazily loads Shares, All/News lazily loads News, the first time.
  document.querySelectorAll('.nt-type').forEach((b) => b.addEventListener('click', () => selectType(b.dataset.type)));

  // The rail's Browse shortcuts (newtab.html#type=<X>) switch the filter when clicked while already on the feed; a
  // bell deep-link (#tab=<type>&read=<path>) also auto-opens that item in the in-place reader. A hash that drops
  // the type (back to a bare or typeless fragment) resets to 'all' (typeForHash), so the river is reachable
  // without a full reload too.
  window.addEventListener('hashchange', () => {
    const t = typeForHash(hashStr());
    selectType(t);
    const rd = readFromHash();
    if (rd) openReader({ type: t, path: rd });
  });

  // A bell deep-link present on first load opens that item straight into the in-place reader (the feed still
  // renders underneath, so Back reveals it). The reader resolves the title/body from the path via the client.
  const deepRead = readFromHash();
  if (deepRead) openReader({ type: TYPE, path: deepRead });

  // Collapsible filter search: the icon expands an inline input; it collapses on blur-when-empty or Escape, and the
  // icon itself toggles (clearing + closing an open field). The input keeps data-filter so the feed wiring is unchanged.
  const srch = $('[data-srch]');
  const srchIn = $('[data-filter]');
  const srchBtn = $('[data-search-toggle]');
  const expandSearch = () => { srch?.classList.add('open'); srchBtn?.setAttribute('aria-expanded', 'true'); srchIn?.focus(); };
  const collapseSearch = () => { srch?.classList.remove('open'); srchBtn?.setAttribute('aria-expanded', 'false'); };
  srchBtn?.addEventListener('click', () => {
    if (srch?.classList.contains('open')) {
      if (srchIn?.value) { srchIn.value = ''; renderFeed(''); } // clear the active filter as it closes
      collapseSearch();
    } else expandSearch();
  });
  srchIn?.addEventListener('input', (e) => renderFeed(e.target.value));
  srchIn?.addEventListener('blur', () => { if (!srchIn.value) collapseSearch(); });
  srchIn?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { srchIn.value = ''; renderFeed(''); collapseSearch(); } });

  // The in-place reader's Back button returns to the feed.
  $('[data-reader-back]')?.addEventListener('click', closeReader);

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
      if (VIEW === 'following' && (!FOLLOWS_LOADED || !PREFS_LOADED || !NEWS_LOADED)) {
        const feed = $('[data-feed]');
        if (feed) feed.innerHTML = '<p class="muted">Loading the people + channels you follow...</p>';
        // Following needs followed members (loadFollows), followed channels (loadPrefs), and the news to filter.
        await Promise.all([FOLLOWS_LOADED ? null : loadFollows(), PREFS_LOADED ? null : loadPrefs(), NEWS_LOADED ? null : loadNews()]);
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

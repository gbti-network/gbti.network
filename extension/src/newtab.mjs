// SOW-017 + SOW-039: the new-tab page logic. The shared member-hub shell (top bar + left rail + account menu) is
// injected + wired by shell.mjs; this module owns the "Latest Activity" feed (three persisted view modes +
// per-item content thumbnails), the search filter, the Latest/Following tabs (SOW-023), the onboarding setup
// banner (SOW-026/029), and the lapsed-member lock (SOW-018). Fetches the public activity index over the
// extension's gbti.network host permission. CSP-safe (no inline handlers).

import { isLockedMembership, canSeeNews } from '../../client/src/membership.mjs'; // SOW-060: news is a free-tier (signed-in) perk
import { BUNDLED_QUOTES, pickQuote, shouldShowSplash, splashDestHash, normalizeBgMode, normalizeBgOpacity, normalizeBgPattern, splashBgClass, GBTI_ASCII } from '../../client-ui/src/splash.mjs'; // SOW-063 landing splash + SOW-074 background
import { mergeAll, canSeeShares, toMs } from '../../client-ui/src/all-merge.mjs'; // SOW-042: the All merge + Shares policy
import { newsToItem } from '../../client-ui/src/news.mjs'; // SOW-043: blend members-only news into the feed
import { parseBrowseHash } from '../../client-ui/src/browse-hash.mjs'; // the activity bell's deep-link (tab=<type>&read=<path>)
import { initShell, setRailActive } from './shell.mjs';
import { TYPE_FILTERS, typeForHash, railKeyForType, feedSources } from '../../client-ui/src/feed-route.mjs';
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
      feed.innerHTML = `<p class="muted">Follow people and news channels to build your own feed. Subscribe to a member's activity, or follow a channel from the News section.</p>`;
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
  // The per-view source matrix (pure, node-tested): Activity ('all') = member content + Shares, NO news; News
  // ('news') = news BLENDED with member content + Shares; the single-type directories narrow to their type.
  const { wantNews, wantShares, narrow } = feedSources(TYPE);
  let rows = mergeAll({ items: ENTRIES, shares: wantShares ? SHARES : null, membership: MEMBERSHIP }).map(toCardItem);
  // SOW-046 G: strip openHref so a news card opens the in-extension expanded reader (card-open) instead of bouncing
  // to the source; the reader still offers an "Open source" link (it rebuilds the UTM link from item.link).
  if (wantNews && canSeeNews(MEMBERSHIP) && Array.isArray(NEWS)) rows = rows.concat(NEWS.map(newsToItem).map(({ openHref, ...n }) => n)); // SOW-060: news is a free-tier (signed-in) perk
  if (narrow) rows = rows.filter((e) => e.type === TYPE);
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
    // Cold start: if this view is still fetching news (nothing cached yet), say "loading", not "no news" — the
    // list refreshes in place once it lands (avoids a "no news" flash that then fills in).
    const newsLoading = wantNews && canSeeNews(MEMBERSHIP) && !NEWS_LOADED;
    const empty = VIEW === 'following'
      ? (q ? 'No followed activity matches that filter.' : 'No recent activity from the members you follow.')
      : (q ? 'No activity matches that filter.' : newsLoading ? 'Loading the latest news…' : (TYPE === 'share' ? 'No Shares yet.' : (TYPE === 'news' ? 'No news right now. Check back soon.' : 'No activity yet.')));
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

/** Open an item IN the page reader, hiding the feed; Back restores it. The feed IS the browser now (no Browse-page
 *  bounce). content/Share -> <gbti-reader>; News -> <gbti-news-reader> (SOW-046 G: the expanded news view with
 *  publisher detail + Follow-publisher + discussion). Both are defined by mountPageClient (client-ui), called in init(). */
function openReader(item) {
  if (!item) return;
  const fv = $('[data-feedview]');
  const rv = $('[data-readerview]');
  const host = $('[data-reader]');
  if (!fv || !rv || !host) return;
  const r = document.createElement(item.type === 'news' ? 'gbti-news-reader' : 'gbti-reader');
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

// SOW-063: the new-tab landing splash. A BARE tab (no hash) lands on the splash unless snoozed within the window;
// clicking a card snoozes that destination and switches the main column IN PLACE (WorkBench navigates away). The
// pure decision/rotation helpers live in client-ui/src/splash.mjs; this owns the DOM + the localStorage state. The
// lapsed lock (SOW-018, data-locked) and the forced-sign-in gate (SOW-048, data-unauth) are fixed overlays that
// cover this, so it is safe to show the splash before those async checks resolve.
const SPLASH_DECISION_KEY = 'gbti-splash-decision';
const SPLASH_WINDOW_KEY = 'gbti-splash-window-min'; // a client preference set in account.html; minutes, 0 = always show
let QUOTES = null; // P2: the git-native /quotes.json once loaded; null -> the bundled set
function readSplashDecision() { try { return JSON.parse(localStorage.getItem(SPLASH_DECISION_KEY) || 'null'); } catch { return null; } }
function splashWindowMs() {
  try { const m = parseInt(localStorage.getItem(SPLASH_WINDOW_KEY) ?? '30', 10); return Number.isFinite(m) && m >= 0 ? m * 60000 : 30 * 60000; }
  catch { return 30 * 60000; }
}
function renderSplashQuote() {
  const fig = $('[data-splash-quote]');
  const q = pickQuote(QUOTES || BUNDLED_QUOTES, Date.now());
  if (!fig || !q) return;
  const t = fig.querySelector('[data-splash-quote-text]');
  const a = fig.querySelector('[data-splash-quote-author]');
  if (t) t.textContent = q.text;
  if (a) a.textContent = q.author;
  fig.hidden = false;
}
function showSplash() {
  const sv = $('[data-splashview]');
  if (!sv) return;
  const fv = $('[data-feedview]'); const rv = $('[data-readerview]');
  if (fv) fv.hidden = true;
  if (rv) rv.hidden = true;
  sv.hidden = false;
  document.documentElement.setAttribute('data-splash', '1');
  renderSplashQuote();
  applySplashBg(); // SOW-074: apply the uploaded background (no-op until the image is read; off -> plain splash)
  window.scrollTo(0, 0);
}
function hideSplash() {
  const sv = $('[data-splashview]'); const fv = $('[data-feedview]');
  if (sv) sv.hidden = true;
  if (fv) fv.hidden = false;
  document.documentElement.removeAttribute('data-splash');
}
function snoozeSplash(dest) {
  try { localStorage.setItem(SPLASH_DECISION_KEY, JSON.stringify({ dest, at: Date.now() })); } catch { /* storage unavailable */ }
}

// SOW-063 P2: the git-native quote pool (gbti.network/quotes.json, built from house/quotes.yml). Like the news
// cache, it is the SAME curated set for everyone, so persist the last good fetch + re-hydrate it for an instant
// quote; the live fetch then refreshes it. Fail-soft: cache -> the bundled BUNDLED_QUOTES, so the splash always has
// a quote even offline or before the first fetch.
const QUOTES_CACHE_KEY = 'gbti-quotes-cache';
async function readQuotesCache() {
  try { const r = await chrome.storage?.local?.get?.(QUOTES_CACHE_KEY); const c = r?.[QUOTES_CACHE_KEY]; return Array.isArray(c?.quotes) ? c.quotes : null; }
  catch { return null; }
}
function writeQuotesCache(quotes) {
  try { chrome.storage?.local?.set?.({ [QUOTES_CACHE_KEY]: { quotes, at: Date.now() } }); } catch { /* storage unavailable */ }
}
const reRenderQuoteIfVisible = () => { if (!$('[data-splashview]')?.hidden) renderSplashQuote(); };
async function loadQuotes() {
  const cached = await readQuotesCache();
  if (Array.isArray(cached) && cached.length) { QUOTES = cached; reRenderQuoteIfVisible(); }
  try {
    const res = await fetch(`${SITE}/quotes.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    const quotes = Array.isArray(data?.quotes) ? data.quotes : null;
    if (quotes && quotes.length) { QUOTES = quotes; writeQuotesCache(quotes); reRenderQuoteIfVisible(); }
  } catch { /* keep the cache / the bundled fallback */ }
}

// SOW-074: the user-uploaded splash background. Mode / opacity / pattern are SYNC localStorage prefs; the (downscaled)
// image is ASYNC in chrome.storage.local. The bg is applied to the splash element when it is shown; the image fills
// in once read (a brief fade). Off / no image -> the plain SOW-063 splash. Content + full are the placement modes;
// opacity + the pattern overlay (incl. the GBTI ASCII art, image bleeding through) are full-mode only.
const SPLASH_BG_IMAGE_KEY = 'gbti:splash-bg-image';
let SPLASH_BG_IMG = null; // the image data URL once read (null = none / not yet read)
const lsItem = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

function applySplashBg() {
  const el = $('[data-splashview]');
  if (!el) return;
  el.classList.remove('bg-content', 'bg-full');
  el.style.removeProperty('--splash-bg');
  el.style.removeProperty('--splash-bg-dim');
  const pat = $('[data-splash-pattern]');
  if (pat) { pat.className = 'splash-pattern'; pat.replaceChildren(); }

  const mode = normalizeBgMode(lsItem('gbti-splash-bg-mode'));
  if (mode === 'off' || !SPLASH_BG_IMG) return; // off, or no image yet -> the plain splash
  el.style.setProperty('--splash-bg', `url("${SPLASH_BG_IMG}")`);
  const cls = splashBgClass(mode);
  if (cls) el.classList.add(cls);
  if (mode === 'full') {
    const dim = (100 - normalizeBgOpacity(lsItem('gbti-splash-bg-opacity'))) / 100; // higher opacity = brighter image
    el.style.setProperty('--splash-bg-dim', `rgba(0,0,0,${dim.toFixed(2)})`);
    const pattern = normalizeBgPattern(lsItem('gbti-splash-bg-pattern'));
    if (pat && pattern !== 'none') {
      pat.classList.add(`p-${pattern}`);
      if (pattern === 'ascii') { const pre = document.createElement('pre'); pre.textContent = GBTI_ASCII; pat.appendChild(pre); }
    }
  }
}

async function loadSplashBg() {
  try { const r = await chrome.storage?.local?.get?.(SPLASH_BG_IMAGE_KEY); SPLASH_BG_IMG = r?.[SPLASH_BG_IMAGE_KEY] || null; }
  catch { SPLASH_BG_IMG = null; }
  if (!$('[data-splashview]')?.hidden) applySplashBg(); // re-apply if the splash is already up (the image just landed)
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
function selectType(next) {
  if (!TYPE_FILTERS.has(next) || next === TYPE) return;
  TYPE = next;
  syncTypeButtons();
  setRailActive(railKeyForType(TYPE)); // keep the left rail in lockstep with the chips + feed
  closeReader(); // switching filter returns from the reader to the feed
  // Render IMMEDIATELY with whatever is already loaded (member activity + any cached news) — no blank "Loading...".
  renderFeed($('[data-filter]')?.value || '');
  // Then refresh the sources this view needs in the BACKGROUND; each re-renders (re-sorts) the list when it lands.
  ensureSharesForFilter();
  ensureNewsForFilter();
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
  if (feedSources(TYPE).wantShares && !SHARES_LOADED) {
    await loadShares();
    renderFeed($('[data-filter]')?.value || '');
  }
}

// News cache (chrome.storage.local): news is the SAME curated feed for every paid member (not per-member), so we
// persist the last good fetch and re-hydrate it on the next new tab for an INSTANT first paint — the network
// refresh then re-sorts the list in place instead of showing a blank "Loading...". Render stays paid-gated.
const NEWS_CACHE_KEY = 'gbti-news-cache';
async function readNewsCache() {
  try { const r = await chrome.storage?.local?.get?.(NEWS_CACHE_KEY); const c = r?.[NEWS_CACHE_KEY]; return Array.isArray(c?.items) ? c.items : null; }
  catch { return null; }
}
function writeNewsCache(items) {
  try { chrome.storage?.local?.set?.({ [NEWS_CACHE_KEY]: { items, at: Date.now() } }); } catch { /* storage unavailable */ }
}

/** Load the member's News once (SOW-043 / SOW-060). News is a FREE-tier perk: the Worker allows any signed-in,
 *  non-banned member, so attempt for any signed-in member (canSeeNews); a locked/banned account fails-closed to [].
 *  Rides /api/news via the background (the key stays in the Worker). A successful fetch updates the cache; an
 *  empty/failed fetch KEEPS the already-hydrated cache (no blanking). */
async function loadNews() {
  NEWS_LOADED = true;
  if (!canSeeNews(MEMBERSHIP)) { NEWS = []; return; }
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/news', query: { limit: 60 } } });
    const items = Array.isArray(r?.json?.items) ? r.json.items : [];
    if (items.length) { NEWS = items; writeNewsCache(items); }
    else if (!Array.isArray(NEWS)) NEWS = []; // empty AND no cache hydrated -> []
  } catch {
    if (!Array.isArray(NEWS)) NEWS = []; // network failure AND no cache -> []; otherwise keep the cached items
  }
}

/** If the active filter needs News and it is not loaded yet, fetch it, then re-render the feed. */
async function ensureNewsForFilter() {
  if (feedSources(TYPE).wantNews && !NEWS_LOADED) {
    await loadNews();
    renderFeed($('[data-filter]')?.value || '');
  }
}

/** Load the caller's follow list from the background worker (SOW-060: a free-tier perk, signed-in). Sets FOLLOWING to a Set, or null. */
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

/** SOW-046 E / SOW-060: load the member's followed news channels (source ids) from prefs (a free-tier perk, signed-in). Set, or null. */
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
  // SOW-063: resolve the landing BEFORE initShell (so the rail highlight matches). A bare tab (no hash) shows the
  // splash unless snoozed within the window; if snoozed, land directly on the remembered feed type. A hashed open
  // (rail click / bell deep-link) always goes straight to the feed.
  const splashBare = !hashStr();
  const splashDecision = readSplashDecision();
  const wantSplash = splashBare && shouldShowSplash(splashDecision, Date.now(), splashWindowMs());
  if (splashBare && !wantSplash && splashDecision?.dest) {
    TYPE = typeForHash(splashDestHash(splashDecision.dest)); // snoozed -> land on the remembered feed type
  }
  // The shared shell injects the left rail (feed variant: search + Latest/Following on top) + the control cluster
  // (theme, apps, account, "+") into the greeting's top-right, and fills the page's [data-ico] glyphs. The rail
  // item highlighted is derived from the active TYPE (railKeyForType); selectType keeps it in sync thereafter.
  initShell({ active: railKeyForType(TYPE), nav: 'feed' });
  // SOW-052: relocate the view-mode switch into the control cluster's slot (a DOM move; the .nt-mode click wiring
  // below still finds it by selector).
  const modesEl = $('.nt-greet .nt-modes');
  const modesSlot = $('[data-modes-slot]');
  if (modesEl && modesSlot) modesSlot.appendChild(modesEl);

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
  // Hydrate the news cache for an INSTANT first paint (a #type=news tab shows the last-known news while the live
  // fetch runs); skip if a fresh fetch already landed. Render gating stays paid-only, so this never leaks to a
  // non-paid viewer. The live loadNews then re-sorts the list in place.
  readNewsCache().then((cached) => { if (cached && !NEWS_LOADED) { NEWS = cached; renderFeed($('[data-filter]')?.value || ''); } });
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

  // SOW-063: the landing splash cards. Activity/News switch the main column IN PLACE (snoozing that destination so
  // the next bare tab skips straight to it); WorkBench navigates to its own page (it leaves the new tab, so it does
  // not become a new-tab default). Setting the hash drives the existing hashchange handler (selectType + rail).
  document.querySelectorAll('[data-splash-go]').forEach((b) => b.addEventListener('click', () => {
    const dest = b.dataset.splashGo;
    if (dest === 'workbench') { window.location.href = chrome.runtime.getURL('workspace.html'); return; }
    snoozeSplash(dest);
    hideSplash();
    location.hash = splashDestHash(dest);
  }));
  loadQuotes(); // SOW-063 P2: hydrate + refresh the git-native quote pool (the splash shows a bundled quote until it lands)
  loadSplashBg(); // SOW-074: read the uploaded splash background (applied when the splash is shown)
  if (wantSplash) showSplash();

  // The rail's Browse shortcuts (newtab.html#type=<X>) switch the filter when clicked while already on the feed; a
  // bell deep-link (#tab=<type>&read=<path>) also auto-opens that item in the in-place reader. A hash that drops
  // the type (back to a bare or typeless fragment) resets to 'all' (typeForHash), so the river is reachable
  // without a full reload too.
  window.addEventListener('hashchange', () => {
    const h = hashStr();
    if (!h) { showSplash(); return; } // SOW-063: Back to the bare tab returns to the splash
    hideSplash();
    const t = typeForHash(h);
    selectType(t);
    const rd = readFromHash();
    if (rd) openReader({ type: t, path: rd });
  });

  // A bell deep-link present on first load opens that item straight into the in-place reader (the feed still
  // renders underneath, so Back reveals it). The reader resolves the title/body from the path via the client.
  const deepRead = readFromHash();
  if (deepRead) openReader({ type: TYPE, path: deepRead });

  // SOW-052: the feed search is now a persistent input in the left rail (shell-rendered). Filter the feed in place
  // on input; Escape clears it. No collapse toggle anymore.
  const srchIn = $('[data-filter]');
  srchIn?.addEventListener('input', (e) => renderFeed(e.target.value));
  srchIn?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { srchIn.value = ''; renderFeed(''); srchIn.blur(); } });

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
      // News only appears in the News view now, so Following loads news ONLY when the current view wants it
      // (TYPE==='news'); on Activity it loads just the followed members + channels for the member-content filter.
      const wantN = feedSources(TYPE).wantNews;
      if (VIEW === 'following' && (!FOLLOWS_LOADED || !PREFS_LOADED || (wantN && !NEWS_LOADED))) {
        const feed = $('[data-feed]');
        if (feed) feed.innerHTML = '<p class="muted">Loading the people + channels you follow...</p>';
        await Promise.all([FOLLOWS_LOADED ? null : loadFollows(), PREFS_LOADED ? null : loadPrefs(), (wantN && !NEWS_LOADED) ? loadNews() : null]);
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

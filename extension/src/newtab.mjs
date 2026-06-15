// SOW-017: the new-tab landing page logic. Fetches the public activity index from gbti.network (covered by the
// extension host permission, so no CORS), renders the greeting + date + Latest Activity feed, and wires the
// search filter, the theme toggle (persisted, no-flash on next load), and the on/off takeover toggle.

import { isLockedMembership } from '../../client/src/membership.mjs';

const SITE = 'https://gbti.network';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a);
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
    .map(
      (e) => `<a class="row" href="${SITE}${esc(e.url)}">
        <span class="badge">${esc(TYPE_LABEL[e.type] || e.type)}</span>
        <span class="title">${e.visibility === 'members' ? '<span class="mlock" title="Members only">🔒 </span>' : ''}${esc(e.title)}</span>
        <span class="meta">${esc(authorName(e.author))}${e.publishedAt ? ` · ${esc(relTime(e.publishedAt))}` : ''}</span>
      </a>`,
    )
    .join('');
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

function init() {
  $('[data-greeting]').textContent = greeting();
  $('[data-date]').textContent = longDate();
  checkMembershipLock(); // async; sets data-locked if the member has lapsed

  $('[data-theme-toggle]')?.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  $('[data-newtab-off]')?.addEventListener('click', () => {
    try { localStorage.setItem('gbti-newtab-off', '1'); } catch (e) {}
    document.documentElement.setAttribute('data-off', '1');
  });
  $('[data-newtab-on]')?.addEventListener('click', (e) => {
    e.preventDefault();
    try { localStorage.removeItem('gbti-newtab-off'); } catch (err) {}
    document.documentElement.removeAttribute('data-off');
    if (!ENTRIES.length) loadActivity();
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
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

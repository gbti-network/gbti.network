// <gbti-notification-bell> (SOW-186 C2): the SITE header notification bell, built to the owner's design
// (claude.ai/design 5dc9aeee, "Notifications handoff"). It is the WEBSITE bell (the extension keeps its own
// <gbti-activity-bell>). Data is computed ON READ (ruling R1 + the design handoff): the member's follow list
// (getFollows()) intersected with the public activity index, so it shows "members I follow published X". The
// dormant server store is not read here. Unread is a localStorage watermark set on "Mark all read"; a
// banned/no-session account fails closed and the bell hides itself. Three first-class states per the design:
// loading (skeletons), empty ("You are all caught up" + a follow nudge), and populated.
import { GbtiElement, define, esc } from '../base.mjs';
import { buildFollowingBell, unreadLabel } from '../notification-bell-core.mjs';
import { relTime, absTime } from '../time-core.mjs';

const INDEX_URL = '/activity-index.json'; // same-origin public build artifact (site root)
const SEEN_KEY = 'gbti-notif-seen';       // a single ms watermark (distinct from the extension bell's per-source object)
const SETTINGS_URL = '/account/notifications/'; // C3 destination (the digest footer link lands here too, sow-267)
const FIND_URL = '/members/';             // "find more members to follow"

function loadWatermark() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } }
function saveWatermark(ms) { try { localStorage.setItem(SEEN_KEY, String(ms)); } catch { /* private mode */ } }

// Inline icons (no Material Symbols font dependency; the shadow tree cannot see page fonts anyway).
const I_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3 21a2 2 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const I_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.4 2.4 4.6-5"/></svg>';
const I_PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.6-5.5 5.5-5.5 1.2 0 2.3.4 3.2 1"/><path d="M17 9v6M20 12h-6"/></svg>';
const I_TUNE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2.1"/><circle cx="9" cy="16" r="2.1"/></svg>';
const I_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

const CSS = `
  :host { position:relative; display:inline-flex; font-family:var(--font-body); }
  :host([hidden]) { display:none; }
  .btn { position:relative; width:32px; height:32px; border-radius:7px; border:0; background:transparent; color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; transition:background .15s,color .15s; }
  .btn:hover { color:var(--fg); background:var(--hover); }
  .btn.open { background:var(--hover); color:var(--fg); }
  .btn svg { width:20px; height:20px; }
  .badge { position:absolute; top:-3px; right:-3px; min-width:17px; height:17px; box-sizing:border-box; padding:0 4px; border-radius:9px; background:var(--brand); border:2px solid var(--panel); color:#fff; font-family:var(--font-mono,monospace); font-size:10px; font-weight:700; line-height:1; display:flex; align-items:center; justify-content:center; }
  .panel { position:absolute; top:calc(100% + 8px); right:0; width:380px; max-width:calc(100vw - 24px); background:var(--panel); border:1.5px solid var(--line); border-radius:12px; box-shadow:0 20px 50px -16px rgba(0,0,0,.45); overflow:hidden; z-index:90; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .panel[hidden] { display:none; }
  .phead { display:flex; align-items:center; gap:12px; padding:13px 16px; border-bottom:1.5px solid var(--line); }
  .phead b { font-family:var(--font-display,var(--font-body)); font-size:14px; color:var(--fg); }
  .clr { margin-left:auto; background:transparent; border:0; color:var(--accent); font:inherit; font-size:11.5px; font-weight:600; cursor:pointer; padding:0; }
  .clr:hover { text-decoration:underline; }
  .list { max-height:340px; overflow-y:auto; }
  .it { display:flex; gap:11px; align-items:flex-start; padding:12px 16px; border-bottom:1px solid var(--line); color:var(--fg); text-decoration:none; cursor:pointer; }
  .it:last-child { border-bottom:0; }
  .it:hover { background:var(--hover); }
  .it.unread { background:color-mix(in srgb, var(--brand) 8%, transparent); }
  .it.unread:hover { background:color-mix(in srgb, var(--brand) 13%, transparent); }
  .av { width:28px; height:28px; border-radius:50%; flex:none; background:var(--hover); object-fit:cover; margin-top:1px; }
  .it .body { flex:1; min-width:0; }
  .it .line { font-size:13px; line-height:1.45; color:var(--muted); }
  .it .line b { color:var(--fg); font-weight:600; }
  .it .line .tg { color:var(--fg); }
  .it .when { display:block; margin-top:4px; font-family:var(--font-mono,monospace); font-size:10.5px; color:var(--muted); }
  .it .dot { width:7px; height:7px; border-radius:50%; background:var(--brand); flex:none; margin-top:6px; }
  .foot { display:flex; align-items:center; justify-content:center; gap:7px; padding:12px 16px; background:var(--hover); color:var(--accent); font-size:12px; font-weight:600; cursor:pointer; text-decoration:none; }
  .foot svg { width:15px; height:15px; }
  .settings { display:flex; align-items:center; gap:9px; padding:11px 16px; border-top:1.5px solid var(--line); color:var(--muted); font-family:var(--font-mono,monospace); font-size:11px; text-decoration:none; }
  .settings:hover { color:var(--fg); }
  .settings svg { width:16px; height:16px; flex:none; }
  .empty { padding:28px 24px 22px; text-align:center; }
  .empty .ic { color:var(--accent); }
  .empty .ic svg { width:32px; height:32px; }
  .empty .h { font-family:var(--font-display,var(--font-body)); font-size:15px; color:var(--fg); margin-top:10px; }
  .empty .p { font-size:12.5px; line-height:1.5; color:var(--muted); margin-top:6px; }
  .nudge { display:flex; align-items:center; gap:9px; text-align:left; margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
  .nudge svg { width:19px; height:19px; color:var(--muted); flex:none; }
  .nudge .t { flex:1; min-width:0; font-size:12.5px; color:var(--muted); }
  .nudge .go { font-size:12.5px; font-weight:600; color:var(--accent); white-space:nowrap; flex:none; }
  .sk { display:flex; gap:11px; align-items:flex-start; padding:12px 16px; border-bottom:1px solid var(--line); }
  .sk:last-child { border-bottom:0; }
  .sk .a { width:28px; height:28px; border-radius:50%; background:var(--hover); flex:none; }
  .sk .b { flex:1; }
  .sk .l { height:9px; border-radius:4px; background:var(--hover); }
  .sk .l.w1 { width:78%; }
  .sk .l.w2 { width:38%; margin-top:8px; }
  @keyframes nb-shimmer { 0%{opacity:.4} 50%{opacity:.75} 100%{opacity:.4} }
  .sk .a, .sk .l { animation:nb-shimmer 1.3s ease-in-out infinite; }
  @media (max-width:480px) { .panel { position:fixed; top:56px; right:12px; left:12px; width:auto; } }
`;

class GbtiNotificationBell extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._open = false;
    this._loaded = false;
    this._loading = false;
    this._gated = false;
    this._watermark = loadWatermark();
    this._bell = { rows: [], unread: 0, followCount: 0 };
    // Close the panel on an outside click (composedPath so nesting in another shadow root stays correct).
    this._onDoc = (e) => { if (this._open && !e.composedPath().includes(this)) this._close(); };
    if (typeof document !== 'undefined') document.addEventListener('click', this._onDoc);
    this.render();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onDoc && typeof document !== 'undefined') document.removeEventListener('click', this._onDoc);
  }

  // The element upgrades from inert static markup BEFORE the host calls setClient(); load once the client
  // arrives (setClient re-renders every subscriber, which lands us back here). Idempotent.
  _maybeLoad() {
    if (this.client && !this._loaded && !this._loading && !this._gated) {
      this._loading = true;
      this._load();
    }
  }

  async _fetchIndex() {
    try {
      const res = await fetch(INDEX_URL, { cache: 'no-cache' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.entries) ? data.entries : [];
    } catch { return []; }
  }

  async _load() {
    try {
      const f = (await this.client.getFollows()) || {};       // throws (banned / no session) -> gated
      const follows = Array.isArray(f.following) ? f.following : [];
      const entries = await this._fetchIndex();                // fail-closed to []
      this._bell = buildFollowingBell({ follows, entries, watermark: this._watermark });
      this._gated = false;
    } catch {
      this._gated = true; // a signed-in member with no web session or a banned account gets no bell
    } finally {
      this._loaded = true;
      this._loading = false;
      this.render();
    }
  }

  _close() { this._open = false; this.render(); }

  _toggle() { this._open = !this._open; this.render(); }

  _markAll() {
    // A single watermark: everything currently shown becomes seen; a LATER publish re-badges.
    this._watermark = Date.now();
    saveWatermark(this._watermark);
    this._bell = { ...this._bell, rows: this._bell.rows.map((r) => ({ ...r, unread: false })), unread: 0 };
    this.render();
  }

  render() {
    if (!this.root) return;
    this._maybeLoad();
    // A banned / no-session account (getFollows failed) shows no bell and takes no space.
    if (this._gated) { this.hidden = true; this.set(''); return; }
    this.hidden = false;
    const loading = !this._loaded;
    const unread = loading ? 0 : (this._bell.unread || 0);
    const badge = unread > 0 ? `<span class="badge">${unreadLabel(unread)}</span>` : '';
    const btnCls = this._open ? 'btn open' : 'btn';
    const panel = this._open ? this._panelHtml(loading) : '';
    this.set(this.css(CSS)
      + `<button class="${btnCls}" type="button" data-bell aria-label="Notifications${unread ? `, ${unread} new` : ''}" aria-haspopup="true" aria-expanded="${this._open}">${I_BELL}${badge}</button>`
      + panel);
    this.on('[data-bell]', 'click', (e) => { e.stopPropagation(); this._toggle(); });
    this.on('[data-clear]', 'click', (e) => { e.stopPropagation(); this._markAll(); });
  }

  _panelHtml(loading) {
    const unread = loading ? 0 : (this._bell.unread || 0);
    const head = `<div class="phead"><b>Notifications</b>${unread > 0 ? '<button class="clr" type="button" data-clear>Mark all read</button>' : ''}</div>`;
    let body;
    if (loading) {
      const sk = '<div class="sk"><span class="a"></span><span class="b"><span class="l w1"></span><span class="l w2"></span></span></div>';
      body = `<div class="list">${sk}${sk}${sk}</div>`;
    } else if (this._bell.rows.length) {
      body = this._rowsHtml() + this._footHtml();
    } else {
      body = this._emptyHtml();
    }
    return `<div class="panel" role="menu">${head}${body}</div>`;
  }

  _rowsHtml() {
    const rows = this._bell.rows.slice(0, 12).map((r) => {
      const when = relTime(r.ts);
      const abs = when ? absTime(r.ts) : '';
      const av = r.actor ? `https://github.com/${encodeURIComponent(r.actor)}.png?size=56` : '';
      const href = r.url || SETTINGS_URL;
      const internal = /^\//.test(href);
      const ext = internal ? '' : ' target="_blank" rel="noopener nofollow"';
      return `<a class="it${r.unread ? ' unread' : ''}" href="${esc(href)}"${ext}${abs ? ` title="${esc(abs)}"` : ''}>`
        + `<img class="av" src="${esc(av)}" alt="" width="28" height="28" decoding="async" loading="lazy" />`
        + `<span class="body"><span class="line"><b>${esc(r.actor)}</b> ${esc(r.action)} <span class="tg">${esc(r.target)}</span></span>`
        + `${when ? `<span class="when">${esc(when)}</span>` : ''}</span>`
        + `${r.unread ? '<span class="dot"></span>' : ''}</a>`;
    }).join('');
    return `<div class="list">${rows}</div>`;
  }

  _footHtml() {
    return `<a class="foot" href="${SETTINGS_URL}">See all notifications ${I_ARROW}</a>`
      + `<a class="settings" href="${SETTINGS_URL}">${I_TUNE}<span>Choose what arrives here</span></a>`;
  }

  _emptyHtml() {
    const n = this._bell.followCount || 0;
    if (n === 0) {
      return `<div class="empty"><span class="ic">${I_PERSON}</span>`
        + `<div class="h">Nothing here yet</div>`
        + `<div class="p">Follow members to see what they publish, right here.</div>`
        + `<div class="nudge">${I_PERSON}<span class="t">You are not following anyone yet.</span><a class="go" href="${FIND_URL}">Find members</a></div></div>`;
    }
    return `<div class="empty"><span class="ic">${I_CHECK}</span>`
      + `<div class="h">You are all caught up</div>`
      + `<div class="p">When someone you follow publishes, it lands here.</div>`
      + `<div class="nudge">${I_PERSON}<span class="t">Following ${esc(String(n))} member${n === 1 ? '' : 's'}.</span><a class="go" href="${FIND_URL}">Find more</a></div></div>`;
  }
}

define('gbti-notification-bell', GbtiNotificationBell);
export { GbtiNotificationBell };

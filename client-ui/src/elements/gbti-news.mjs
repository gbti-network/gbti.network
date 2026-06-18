// <gbti-news> (SOW-043 P2 + SOW-046 E): the members-only news section. Two views toggled in the header:
//   - FEED: the classified news (client.getNews -> newsToItem -> shared <gbti-card-list>); each card opens the
//     source with UTM. A non-paid/locked caller gets an upgrade nudge.
//   - CHANNELS: the followable news channels (client.getNewsSources) with a Follow/Following toggle per channel
//     (writes client.setPrefs({ followChannel })). Following a channel makes its news show in the new-tab
//     Following view (SOW-046 E). Inert in public (no injected client). Host-agnostic.
import { GbtiElement, define, esc } from '../base.mjs';
import { newsToItem } from '../news.mjs';
import './gbti-card-list.mjs';

const SITE = 'https://gbti.network';
const nudge = (msg) => `<div class="nudge">${esc(msg)} <a href="${SITE}/membership/">Become a member</a> to unlock the news feed.</div>`;
const lc = (s) => String(s ?? '').toLowerCase();

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:0 0 14px; flex-wrap:wrap; }
  .head .t h3 { margin:0 0 2px; font-family:var(--font-display, var(--font-body)); font-size:18px; }
  .head .t .sub { margin:0; color:var(--muted); font-size:13px; }
  .tabs { display:flex; gap:2px; background:var(--hover); border:1px solid var(--line); border-radius:999px; padding:3px; }
  .tabs button { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:12.5px; padding:6px 13px; border-radius:999px; cursor:pointer; }
  .tabs button.on { background:var(--panel); color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; }
  .nudge { padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
  button.retry { font:inherit; font-size:13px; font-weight:600; margin-left:8px; padding:5px 11px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); cursor:pointer; }
  ul.chans { list-style:none; margin:0; padding:0; }
  .chan { display:flex; align-items:center; gap:12px; padding:12px 2px; border-top:1px solid var(--line); }
  .chan:first-child { border-top:0; }
  .chan .ci { min-width:0; flex:1; }
  .chan .ci b { display:block; font-size:14.5px; }
  .chan .ci .d { display:block; color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chan .ci .n { color:var(--muted); font-size:11.5px; }
  .fbtn { flex:none; font:inherit; font-weight:600; font-size:12.5px; padding:6px 13px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .fbtn:hover { border-color:var(--accent); color:var(--accent); }
  .fbtn.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .fbtn[disabled] { opacity:.6; cursor:default; }
`;

class GbtiNews extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._view = 'feed';
    this._state = 'loading';
    this.render();
    this._load();
  }

  async _load() {
    if (!this.client) { this._state = 'inert'; this.render(); return; }
    try {
      const { items } = await this.client.getNews({ limit: 60 });
      this._items = (Array.isArray(items) ? items : []).map(newsToItem);
      this._state = 'ready';
    } catch (err) {
      this._state = err?.code === 'membership-required' ? 'locked' : (err?.code === 'not-authenticated' ? 'signin' : 'error');
    }
    this.render();
  }

  async _loadChannels() {
    this._chanState = 'loading';
    this.render();
    try {
      const [{ sources }, prefs] = await Promise.all([this.client.getNewsSources(), this.client.getPrefs()]);
      this._sources = Array.isArray(sources) ? sources : [];
      this._followed = new Set((prefs?.followedChannels || []).map(lc));
      this._chanState = 'ready';
    } catch (err) {
      this._chanState = err?.code === 'membership-required' ? 'locked' : (err?.code === 'not-authenticated' ? 'signin' : 'error');
    }
    this.render();
  }

  _setView(v) {
    if (v === this._view) return;
    this._view = v;
    if (v === 'channels' && !this._chanState) { this._loadChannels(); return; }
    this.render();
  }

  async _toggleFollow(id, btn) {
    const on = !this._followed.has(lc(id));
    if (btn) { btn.disabled = true; btn.textContent = on ? 'Following…' : 'Unfollowing…'; }
    try {
      const prefs = await this.client.setPrefs({ followChannel: { id, on } });
      this._followed = new Set((prefs?.followedChannels || []).map(lc));
    } catch { /* leave the prior state; re-render reflects it */ }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client to read the news.</p>`); return; }
    const tabs = `<div class="tabs"><button data-view="feed" class="${this._view === 'feed' ? 'on' : ''}" type="button">Feed</button><button data-view="channels" class="${this._view === 'channels' ? 'on' : ''}" type="button">Channels</button></div>`;
    const head = `<div class="head"><div class="t"><h3>News</h3><p class="sub">Curated developer news, refreshed hourly. A members-only perk.</p></div>${tabs}</div>`;
    this.set(this.css(CSS) + head + `<div data-body></div>`);
    this.$$('[data-view]').forEach((b) => b.addEventListener('click', () => this._setView(b.dataset.view)));
    this._view === 'channels' ? this._renderChannels() : this._renderFeed();
  }

  _renderFeed() {
    const host = this.$('[data-body]'); if (!host) return;
    if (this._state === 'loading') { host.innerHTML = `<p class="muted">Loading the latest news…</p>`; return; }
    if (this._state === 'signin') { host.innerHTML = nudge('Sign in to read the members-only news feed.'); return; }
    if (this._state === 'locked') { host.innerHTML = nudge('The news feed is a members-only perk.'); return; }
    if (this._state === 'error') {
      host.innerHTML = `<p class="muted">Could not load the news right now.<button class="retry" data-retry type="button">Retry</button></p>`;
      this.$('[data-retry]')?.addEventListener('click', () => { this._state = 'loading'; this.render(); this._load(); });
      return;
    }
    const items = this._items || [];
    if (!items.length) { host.innerHTML = `<p class="muted">No news right now. Check back soon.</p>`; return; }
    const list = document.createElement('gbti-card-list');
    list.mode = 'detailed';
    list.items = items; // newsToItem carries openHref (the UTM source link) -> cards render as <a> and navigate out
    host.replaceChildren(list);
  }

  _renderChannels() {
    const host = this.$('[data-body]'); if (!host) return;
    if (!this._chanState || this._chanState === 'loading') { host.innerHTML = `<p class="muted">Loading channels…</p>`; return; }
    if (this._chanState === 'signin') { host.innerHTML = nudge('Sign in to follow news channels.'); return; }
    if (this._chanState === 'locked') { host.innerHTML = nudge('Following news channels is a members-only perk.'); return; }
    if (this._chanState === 'error') {
      host.innerHTML = `<p class="muted">Could not load channels.<button class="retry" data-retry type="button">Retry</button></p>`;
      this.$('[data-retry]')?.addEventListener('click', () => this._loadChannels());
      return;
    }
    const sources = this._sources || [];
    if (!sources.length) { host.innerHTML = `<p class="muted">No channels available yet.</p>`; return; }
    const followed = this._followed || new Set();
    const rows = sources.map((s) => {
      const on = followed.has(lc(s.id));
      const meta = [s.description, s.count != null ? `${s.count} items` : null].filter(Boolean).join(' · ');
      return `<li class="chan"><div class="ci"><b>${esc(s.name || s.id)}</b>${meta ? `<span class="d">${esc(meta)}</span>` : ''}</div><button class="fbtn ${on ? 'on' : ''}" data-follow="${esc(s.id)}" type="button">${on ? 'Following' : 'Follow'}</button></li>`;
    }).join('');
    host.innerHTML = `<p class="muted" style="margin:0 0 10px">Follow channels to drill into them from your <b>Following</b> feed.</p><ul class="chans">${rows}</ul>`;
    this.$$('[data-follow]').forEach((b) => b.addEventListener('click', () => this._toggleFollow(b.dataset.follow, b)));
  }
}

define('gbti-news', GbtiNews);
export { GbtiNews };

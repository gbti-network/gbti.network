// <gbti-news> (SOW-043 P2): the members-only news section. Loads the classified developer-news feed via
// client.getNews (proxied through the signup Worker, which holds NEWS_API_KEY; effective-paid gated server-side),
// projects each item with newsToItem, and renders the shared <gbti-card-list>. A non-paid/locked caller gets an
// upgrade nudge; inert in public (no injected client). Each card opens the original source with UTM params (the
// readability inline preview is a later phase). Host-agnostic — talks only to the injected client.
import { GbtiElement, define, esc } from '../base.mjs';
import { newsToItem } from '../news.mjs';
import './gbti-card-list.mjs';

const SITE = 'https://gbti.network';
const nudge = (msg) => `<div class="nudge">${esc(msg)} <a href="${SITE}/membership/">Become a member</a> to unlock the news feed.</div>`;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { margin:0 0 14px; }
  .head h3 { margin:0 0 2px; font-family:var(--font-display, var(--font-body)); font-size:18px; }
  .head .sub { margin:0; color:var(--muted); font-size:13px; }
  .muted { color:var(--muted); font-size:14px; }
  .nudge { padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
  button.retry { font:inherit; font-size:13px; font-weight:600; margin-left:8px; padding:5px 11px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); cursor:pointer; }
`;

class GbtiNews extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
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
      this._state = err?.code === 'membership-required' ? 'locked'
        : (err?.code === 'not-authenticated' ? 'signin' : 'error');
    }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client to read the news.</p>`); return; }
    const head = `<div class="head"><h3>News</h3><p class="sub">Curated developer news, refreshed hourly. A members-only perk.</p></div>`;
    if (this._state === 'loading') { this.set(this.css(CSS) + head + `<p class="muted">Loading the latest news…</p>`); return; }
    if (this._state === 'signin') { this.set(this.css(CSS) + head + nudge('Sign in to read the members-only news feed.')); return; }
    if (this._state === 'locked') { this.set(this.css(CSS) + head + nudge('The news feed is a members-only perk.')); return; }
    if (this._state === 'error') {
      this.set(this.css(CSS) + head + `<p class="muted">Could not load the news right now.<button class="retry" data-retry type="button">Retry</button></p>`);
      this.on('[data-retry]', 'click', () => { this._state = 'loading'; this.render(); this._load(); });
      return;
    }
    const items = this._items || [];
    if (!items.length) { this.set(this.css(CSS) + head + `<p class="muted">No news right now. Check back soon.</p>`); return; }
    this.set(this.css(CSS) + head + `<div data-list></div>`);
    const list = document.createElement('gbti-card-list');
    list.mode = 'detailed';
    list.items = items; // newsToItem carries openHref (the UTM source link) -> cards render as <a> and navigate out
    this.$('[data-list]')?.replaceChildren(list);
  }
}

define('gbti-news', GbtiNews);
export { GbtiNews };

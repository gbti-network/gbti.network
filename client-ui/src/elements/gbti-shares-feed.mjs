// <gbti-shares-feed> (SOW-018): the EXTENSION/client-only Shares reading stream. There is no public website
// surface for Shares; this is where a member reads the co-op's status updates. It calls client.listShares()
// (the host enumerates members/*/shares/*.md under the member token), then resolves each body: a PUBLIC Share
// renders its markdown via client.preview(); a members Share is decrypted via client.decrypt({encPath}) (the
// Worker holds the key and ALLOWS AN ACTIVE TRIAL to read a Share, SOW-018) and then rendered. A Locked
// account (lapsed/expired/banned) gets a lock splash and no feed. Read-only; the key never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; margin:4px 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .refresh { background:transparent; border:0; color:var(--muted); cursor:pointer; font:inherit; font-size:13px; }
  .refresh:hover { color:var(--brand); }
  .feed { display:flex; flex-direction:column; gap:12px; }
  .share { border:1px solid var(--line); border-radius:12px; padding:14px 16px; background:var(--panel); }
  .who { display:flex; align-items:baseline; gap:8px; }
  .who .name { font-weight:700; font-size:14px; }
  .who .when { color:var(--muted); font-size:12px; }
  .badge { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .title { font-weight:700; margin-top:8px; }
  .body { margin-top:6px; font-size:14px; line-height:1.55; }
  .body :is(h1,h2,h3,h4){ font-weight:700; margin:.8em 0 .3em; }
  .body p { margin:0 0 .7em; } .body ul,.body ol { margin:0 0 .7em 1.2em; }
  .body a { color:var(--accent, var(--brand)); }
  .body pre { background:var(--bg, rgba(0,0,0,.05)); padding:10px; border-radius:8px; overflow:auto; }
  .link { display:inline-flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px; color:var(--brand); text-decoration:none; }
  .tags { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .muted { color:var(--muted); font-size:13.5px; }
  .locked { color:var(--muted); font-size:13.5px; } .locked a { color:var(--brand); font-weight:600; }
  .splash { text-align:center; padding:40px 16px; }
  .splash .lock { font-size:30px; } .splash h3 { margin:10px 0 4px; } .splash a { color:var(--brand); font-weight:600; }
`;

function relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t, day = 86400000;
  if (diff < day) return 'today';
  const d = Math.floor(diff / day);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? '' : 's'} ago`;
}
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a || 'A member');

class GbtiSharesFeed extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    // Refresh the feed when a Share is posted from the composer (event bubbles + composed to document).
    this._onPosted = () => this.reload();
    document.addEventListener('gbti-share-posted', this._onPosted);
    this.reload();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onPosted) document.removeEventListener('gbti-share-posted', this._onPosted);
  }

  async reload() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client to read Shares.</p>`); return; }
    this.set(this.css(CSS) + `<p class="muted">Loading the co-op stream…</p>`);
    // Locked accounts get a splash, not the feed.
    let membership = 'unknown';
    try { membership = (await this.client.status())?.membership ?? 'unknown'; } catch { membership = 'unknown'; }
    if (LOCKED.has(membership)) return this._splash();

    let items = [];
    try { items = (await this.client.listShares())?.items ?? []; }
    catch { this.set(this.css(CSS) + `<p class="muted">Could not load Shares right now.</p>`); return; }
    if (!items.length) { this._render([]); return; }

    // Resolve every body in parallel: public -> preview; members -> decrypt then preview.
    const resolved = await Promise.all(items.map((it) => this._resolveBody(it).then((html) => ({ it, html }))));
    this._render(resolved);
  }

  async _resolveBody(it) {
    try {
      if (it.visibility === 'members') {
        if (!it.encryptedBody) return ''; // a members Share with no body
        const { text } = await this.client.decrypt({ encPath: it.encryptedBody });
        return (await this.client.preview({ body: text }))?.html ?? '';
      }
      return it.body ? (await this.client.preview({ body: it.body }))?.html ?? '' : '';
    } catch (err) {
      const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
      return { locked };
    }
  }

  _splash() {
    this.set(this.css(CSS) + `<div class="splash"><div class="lock">🔒</div><h3>Your access is locked</h3>
      <p class="muted">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to read the community Shares stream again.</p></div>`);
  }

  _render(rows) {
    const head = `<div class="head"><h3>Co-op stream</h3><button class="refresh" type="button">Refresh</button></div>`;
    if (!rows.length) {
      this.set(this.css(CSS) + head + `<p class="muted">No Shares yet. Post the first one above.</p>`);
      this.on('.refresh', 'click', () => this.reload());
      return;
    }
    const cards = rows.map(({ it, html }) => {
      const bodyHtml = (html && html.locked)
        ? `<div class="locked">This Share is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>`
        : (typeof html === 'string' && html) ? `<div class="body">${html}</div>` : '';
      const link = it.url ? `<a class="link" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">🔗 ${esc(hostOf(it.url))}</a>` : '';
      const tags = (it.tags || []).length ? `<div class="tags">${it.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : '';
      const badge = it.visibility === 'members' ? `<span class="badge">Members</span>` : '';
      const title = it.title ? `<div class="title">${esc(it.title)}</div>` : '';
      return `<article class="share">
        <div class="who"><span class="name">${esc(authorName(it.author))}</span><span class="when">${esc(relTime(it.createdAt))}</span>${badge}</div>
        ${title}${bodyHtml}${link}${tags}
      </article>`;
    }).join('');
    this.set(this.css(CSS) + head + `<div class="feed">${cards}</div>`);
    this.on('.refresh', 'click', () => this.reload());
  }
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; }
}

define('gbti-shares-feed', GbtiSharesFeed);
export { GbtiSharesFeed };

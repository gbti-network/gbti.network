// <gbti-news-reader> (SOW-046 G): the in-extension EXPANDED view of a single news item, opened in the new-tab
// reader pane when a member clicks a news card (the feed is the one browser — no bounce to the source on click).
// Shows the PUBLISHER (favicon + name + description + item count, from /membership/news-sources) with a
// Follow/Following toggle (writes the SOW-046 E followChannel pref), the AI summary, an "Open source" UTM link, the
// curator "Add to Discord" action (SOW-046 C), and the members-only discussion (SOW-046 D via <gbti-discussion>).
// Mirrors <gbti-reader>.open(item) so the new-tab opens it the same way. Host-agnostic; inert without a client.
import { GbtiElement, define, esc } from '../base.mjs';
import { newsTargetSlug, utmLink } from '../news.mjs';
import { faviconFor } from './gbti-card-list.mjs';
import './gbti-discussion.mjs';

const lc = (s) => String(s ?? '').toLowerCase();

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); max-width:760px; }
  .pub { display:flex; align-items:center; gap:12px; padding:0 0 16px; margin:0 0 16px; border-bottom:1px solid var(--line); }
  .pav { position:relative; width:40px; height:40px; border-radius:10px; overflow:hidden; flex:none; background:var(--hover); }
  .pav img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .pub .pi { min-width:0; flex:1; }
  .pub .pi b { display:block; font-size:15px; }
  .pub .pi .d { display:block; color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fbtn { flex:none; font:inherit; font-weight:600; font-size:12.5px; padding:7px 15px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .fbtn:hover { border-color:var(--accent); color:var(--accent); }
  .fbtn.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .fbtn[disabled] { opacity:.6; cursor:default; }
  .hero { display:block; width:100%; aspect-ratio:16 / 9; object-fit:cover; border-radius:12px; margin:0 0 18px; background:var(--hover); }
  h2 { font-family:var(--font-display, var(--font-body)); font-size:23px; line-height:1.3; margin:0 0 12px; }
  .sum { font-size:15px; line-height:1.6; color:var(--fg); margin:0 0 20px; }
  .acts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  a.src { font:inherit; font-weight:600; font-size:13.5px; padding:9px 16px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); text-decoration:none; }
  a.src:hover { border-color:var(--accent); color:var(--accent); }
  button.disc { font:inherit; font-weight:700; font-size:13.5px; padding:9px 16px; border:1px solid var(--brand); border-radius:9px; background:var(--brand); color:#fff; cursor:pointer; }
  button.disc[disabled] { opacity:.6; cursor:default; }
  .note { font-size:12.5px; margin:12px 0 0; } .note.ok { color:var(--brand); } .note.err { color:#d4495a; }
  .disc-wrap { margin-top:24px; padding-top:18px; border-top:1px solid var(--line); }
  .disc-wrap h4 { margin:0 0 12px; font-family:var(--font-display, var(--font-body)); font-size:15px; }
  .muted { color:var(--muted); }
`;

class GbtiNewsReader extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    // SOW-046 D: when a member comments on THIS item, tell the Worker to reflect it onto the Discord post (if any).
    this._onComment = (e) => {
      const it = this._item;
      if (!it?.guid || !this.client?.newsDiscussed) return;
      if (e?.detail?.targetSlug !== newsTargetSlug(it.guid)) return;
      Promise.resolve(this.client.newsDiscussed(it.guid)).catch(() => {});
    };
    document.addEventListener('gbti-comment-posted', this._onComment);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._onComment) document.removeEventListener('gbti-comment-posted', this._onComment);
  }

  /** Mirrors <gbti-reader>.open(item): the new-tab mounts this then calls open() with the news card item. */
  async open(item) {
    this._item = item || null;
    this._postNote = null;
    this._canCurate = false;
    this._publisher = null;
    this._followed = null;
    this.render();
    if (!item || !this.client) return;
    // Enrich: the curator capability (UI hint), the publisher record (description + count), and the follow state.
    // Each is best-effort — the title/summary/favicon already render without them.
    try {
      const [status, srcs, prefs] = await Promise.all([
        this.client.status?.().catch(() => null),
        this.client.getNewsSources?.().catch(() => null),
        this.client.getPrefs?.().catch(() => null),
      ]);
      this._canCurate = Boolean(status?.canCurate);
      const sid = lc(item.source);
      this._publisher = (srcs?.sources || []).find((s) => lc(s.id) === sid || lc(s.name) === sid) || null;
      this._followed = new Set((prefs?.followedChannels || []).map(lc));
    } catch { /* keep the basics */ }
    this.render();
  }

  async _toggleFollow(btn) {
    const id = this._item?.source;
    if (!id || !this._followed) return;
    const on = !this._followed.has(lc(id));
    if (btn) { btn.disabled = true; btn.textContent = on ? 'Following…' : 'Unfollowing…'; }
    try {
      const prefs = await this.client.setPrefs({ followChannel: { id, on } });
      this._followed = new Set((prefs?.followedChannels || []).map(lc));
    } catch { /* leave the prior state; re-render reflects it */ }
    this.render();
  }

  async _publishToDiscord(btn) {
    const it = this._item; if (!it) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    this._postNote = null;
    try {
      const r = await this.client.publishNews(it);
      this._postNote = r?.posted ? { ok: true, msg: 'Posted to Discord.' }
        : r?.alreadyPosted ? { ok: true, msg: 'Already posted to Discord.' }
        : { ok: false, msg: r?.reason || 'No Discord channel is mapped for this category yet.' };
    } catch (err) { this._postNote = { ok: false, msg: err?.message || 'Could not post to Discord.' }; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client to read the news.</p>`); return; }
    const it = this._item;
    if (!it) { this.set(this.css(CSS) + `<p class="muted">No item selected.</p>`); return; }
    const fav = faviconFor(it.link || it.openHref);
    const pub = this._publisher;
    const followable = Boolean(this.client?.setPrefs && it.source && this._followed); // prefs loaded (paid) -> followable
    const followed = followable && this._followed.has(lc(it.source));
    const meta = [pub?.description, pub?.count != null ? `${pub.count} items` : null].filter(Boolean).join(' · ');
    const open = it.openHref || (it.link ? utmLink(it.link) : '');
    const disc = this._canCurate ? `<button class="disc" data-disc type="button">Add to Discord</button>` : '';
    const note = this._postNote ? `<p class="note ${this._postNote.ok ? 'ok' : 'err'}">${esc(this._postNote.msg)}</p>` : '';
    const slug = it.guid ? newsTargetSlug(it.guid) : '';
    const discussion = slug ? `<div class="disc-wrap"><h4>Discussion</h4><gbti-discussion data-gbti-target-type="news" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></div>` : '';
    // SOW-050: the source article's og:image as a hero (drops out on load error via the capture handler below).
    const heroSrc = it.thumb || it.image || '';
    const hero = heroSrc ? `<img class="hero" src="${esc(heroSrc)}" alt="" loading="lazy">` : '';
    this.set(this.css(CSS)
      + `<div class="pub"><span class="pav">${fav ? `<img class="avimg" src="${esc(fav)}" alt="">` : ''}</span>`
      + `<div class="pi"><b>${esc(pub?.name || it.source || 'Publisher')}</b>${meta ? `<span class="d">${esc(meta)}</span>` : ''}</div>`
      + (followable ? `<button class="fbtn ${followed ? 'on' : ''}" data-follow type="button">${followed ? 'Following' : 'Follow'}</button>` : '')
      + `</div>`
      + hero
      + `<h2>${esc(it.title || 'News')}</h2>`
      + `<p class="sum">${esc(it.excerpt || 'No summary available.')}</p>`
      + `<div class="acts">${open ? `<a class="src" href="${esc(open)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}${disc}</div>${note}`
      + discussion);
    if (!this._wiredErr) { // a broken favicon drops to the empty disc, a broken hero removes itself (CSP-safe capture phase)
      this.root?.addEventListener('error', (e) => { const t = e.target; if (t?.tagName === 'IMG' && (t.classList?.contains('avimg') || t.classList?.contains('hero'))) t.remove(); }, true);
      this._wiredErr = true;
    }
    this.$('[data-follow]')?.addEventListener('click', (e) => this._toggleFollow(e.currentTarget));
    this.$('[data-disc]')?.addEventListener('click', (e) => this._publishToDiscord(e.currentTarget));
  }
}

define('gbti-news-reader', GbtiNewsReader);
export { GbtiNewsReader };

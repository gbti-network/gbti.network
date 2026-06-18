// <gbti-reader> (SOW-031): the in-extension reading view. Opens a post/product/prompt/share item and renders it
// IN the extension (markdown -> HTML via client.preview) instead of navigating to gbti.network. Body resolution
// follows the gbti-shares-feed / gbti-locked-content contract VERBATIM: a public body renders via preview; a
// members body (Mode B whole body or Mode C tail) decrypts via client.decrypt (the AES key never leaves the
// Worker, SOW-016) then renders via preview; a non-entitled member sees the upgrade notice. Host-agnostic
// (consumes only the injected client). Honest limit: this is the CMS markdown renderer, not the full Astro
// pipeline, so "View on gbti.network" stays in the header for pixel-perfect / interactive parity.
import { GbtiElement, define, esc } from '../base.mjs';
import { resolveAsset } from '../assets.mjs';
import './gbti-discussion.mjs'; // SOW-041: the always-open discussion below the body

const SITE = 'https://gbti.network';
const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a);

// SOW-041: the comment targetSlug for an item. A post/product/prompt keys on its content slug (matching the
// public Comments.astro); a Share keys on the composite "<author>/<shareId>". Empty -> no discussion is shown.
function targetSlugFor(it) {
  if (it.type === 'share') return it.author && it.id ? `${it.author}/${it.id}` : '';
  if (it.slug) return String(it.slug);
  const m = String(it.path || '').match(/\/(?:posts|products|prompts)\/([^/]+)\/index\.md$/);
  return m ? m[1] : '';
}
const TYPE_LABEL = { post: 'Article', product: 'Product', prompt: 'Prompt', share: 'Share' };
const dateStr = (ms) => { try { return ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''; } catch { return ''; } };
const lockNotice = (what) => `<div class="locked">${esc(what)} is for members. <a href="${SITE}/membership/" target="_blank" rel="noopener">Become a member</a> to unlock.</div>`;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  article { max-width:680px; margin:0 auto; }
  h1 { font-family:var(--font-display); font-size:28px; line-height:1.2; margin:0 0 8px; }
  .meta { color:var(--muted); font-size:13px; margin:0 0 18px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .cover { display:block; width:100%; max-height:340px; object-fit:cover; border-radius:12px; border:1px solid var(--line); margin:0 0 20px; }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .body { font-size:15.5px; line-height:1.7; }
  .body h1,.body h2,.body h3 { font-family:var(--font-display); margin:1.4em 0 .5em; }
  .body p { margin:0 0 1em; }
  .body pre { background:var(--hover); padding:12px 14px; border-radius:10px; overflow:auto; }
  .body code { font-family:ui-monospace,monospace; font-size:.92em; }
  .body a { color:var(--accent); }
  .body img { max-width:100%; height:auto; border-radius:10px; }
  .locked { border:1px solid var(--line); background:var(--hover); border-radius:10px; padding:14px 16px; color:var(--fg); font-size:14px; margin:14px 0; }
  .locked a { color:var(--accent); }
  .muted { color:var(--muted); }
  .view { display:inline-block; margin-top:22px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }
  .discussion-wrap { max-width:680px; margin:30px auto 0; border-top:1px solid var(--line); padding-top:18px; }
  .discussion-wrap h3 { font-family:var(--font-display); font-size:18px; margin:0 0 12px; }
`;

class GbtiReader extends GbtiElement {
  /** open(item): { type, path, title, author, publishedAt, url, visibility, body?, encryptedBody? }.
   *  For share, body/encryptedBody come from the summary; for post/product/prompt they come from readItem(path). */
  open(item) { this._item = item; this._html = null; this.render(); this._resolve(); }

  async _resolve() {
    const it = this._item || {};
    try {
      if (it.type === 'share') {
        this._html = await this._body(it.visibility, it.body, it.encryptedBody);
      } else {
        const { frontmatter, body } = await this.client.readItem({ path: it.path });
        this._html = await this._body(it.visibility, body, frontmatter?.encryptedBody);
      }
    } catch {
      this._html = { error: true };
    }
    this.render();
  }

  // Render the public body via preview, then append the members part (decrypt -> preview) or a locked notice.
  async _body(visibility, publicBody, encPath) {
    let html = publicBody ? ((await this.client.preview({ body: publicBody }))?.html ?? '') : '';
    if (encPath) {
      try {
        const { text } = await this.client.decrypt({ encPath });
        html += (await this.client.preview({ body: text }))?.html ?? '';
      } catch (err) {
        const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
        html += locked ? lockNotice('This part') : `<p class="muted">Could not load the members-only part right now.</p>`;
      }
    }
    if (!html && visibility === 'members') html = lockNotice('This');
    return html;
  }

  render() {
    const it = this._item;
    if (!it) { this.set(this.css(CSS)); return; }
    const t = TYPE_LABEL[it.type] || it.type || '';
    // A Share's `url` is the external link it points at (open it directly); every other type's `url` is a
    // gbti.network path (prefix the origin). A Share with no url shows no view link.
    const view = it.type === 'share'
      ? (it.url ? `<a class="view" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">Open link</a>` : '')
      : (it.url ? `<a class="view" href="${esc(SITE + it.url)}" target="_blank" rel="noopener">View on gbti.network</a>` : '');
    // Shares carry an ISO createdAt; content items carry a numeric publishedAt.
    const when = it.publishedAt ?? (it.createdAt ? Date.parse(it.createdAt) : null);
    const meta = `<div class="meta"><span class="badge">${esc(t)}</span><span>${esc(authorName(it.author))}</span>${when ? `<span>· ${esc(dateStr(when))}</span>` : ''}</div>`;
    const coverUrl = resolveAsset(it.thumb); // SOW-031: the index item's thumbnail, shown as a cover above the body
    const cover = coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="" loading="lazy">` : '';
    let body;
    if (this._html === null) body = `<p class="muted">Loading...</p>`;
    else if (this._html && this._html.error) body = `<p class="muted">Could not load this content. Try opening it on gbti.network.</p>`;
    else body = `<div class="body">${typeof this._html === 'string' ? this._html : ''}</div>`;
    // SOW-041: the always-open discussion, mounted ONCE on the resolved render (not while loading) so its thread
    // is not fetched twice. Shown for any item with a comment target (post/product/prompt slug or a Share slug).
    const slug = targetSlugFor(it);
    const discussion = (this._html !== null && slug)
      ? `<div class="discussion-wrap"><h3>Discussion</h3><gbti-discussion data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></div>`
      : '';
    this.set(this.css(CSS) + `<article><h1>${esc(it.title || '')}</h1>${meta}${cover}${body}${view}</article>${discussion}`);
  }
}

define('gbti-reader', GbtiReader);
export { GbtiReader };

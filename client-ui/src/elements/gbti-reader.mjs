// <gbti-reader> (SOW-031): the in-extension reading view. Opens a post/product/prompt/share item and renders it
// IN the extension (markdown -> HTML via client.preview) instead of navigating to gbti.network. Body resolution
// follows the gbti-shares-feed / gbti-locked-content contract VERBATIM: a public body renders via preview; a
// members body (Mode B whole body or Mode C tail) decrypts via client.decrypt (the AES key never leaves the
// Worker, SOW-016) then renders via preview; a non-entitled member sees the upgrade notice. Host-agnostic
// (consumes only the injected client). Honest limit: this is the CMS markdown renderer, not the full Astro
// pipeline, so "View on gbti.network" stays in the article for pixel-perfect / interactive parity.
//
// SOW-050 redesign: a two-column reading layout (article + a right author drawer) that collapses to one column
// below 960px. The hero cover uses the full-resolution `thumbWide` derivative, rendered width-contained (no crop
// = no clipping). The meta row leads with the author avatar + category chips. The right drawer carries the author
// card (avatar, name, the headline "author note"), a Follow control, the author's public social links (Discord
// revealed on inspection), and the discussion thread beneath it. Fenced code blocks upgrade into code cards with
// a language label + Copy button.
import { GbtiElement, define, esc } from '../base.mjs';
import { resolveAsset } from '../assets.mjs';
import './gbti-discussion.mjs'; // SOW-041: the always-open discussion, now mounted inside the author drawer
import './gbti-upvote.mjs'; // SOW-057: the share upvote control
import './gbti-favorite.mjs'; // SOW-013/064: favorite + add-to-collection on the reader meta line
import './gbti-collection.mjs';
import { hostOf } from '../all-merge.mjs'; // SOW-057: the link domain for the "Read article on <domain>" CTA
import { socialIcon } from '../social-icons.mjs'; // SOW-067: per-platform inline brand icons for the author card

const SITE = 'https://gbti.network';
const lc = (s) => String(s || '').toLowerCase();
const isHouse = (a) => { const x = lc(a); return !x || x === 'gbti' || x === 'house'; };
const authorName = (a) => (isHouse(a) ? 'GBTI Network' : a);
const githubLogin = (a) => (lc(a) === 'gbti' || lc(a) === 'house' ? 'gbti-network' : a);
const githubAvatar = (a) => (a ? `https://github.com/${encodeURIComponent(githubLogin(a))}.png?size=96` : '');

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

// SOW-050: the member directory (/members-index.json) carries the author drawer's avatar/name/headline/links. It
// is small + public (CORS *), so fetch it once per page and cache the promise across reader opens.
let _directory = null;
function loadDirectory() {
  if (_directory) return _directory;
  _directory = fetch(`${SITE}/members-index.json`)
    .then((r) => (r.ok ? r.json() : { members: [] }))
    .then((j) => new Map((j.members || []).map((m) => [lc(m.username), m])))
    .catch(() => new Map());
  return _directory;
}

// Build a {href,label,handle?} for each known public social link. A bare handle is prefixed to a canonical URL;
// an already-absolute value passes through. Discord is a handle (not reliably linkable), so it surfaces as an
// inspectable chip (the username on the chip + its title), satisfying "make their Discord available on inspection".
const SOCIALS = [
  ['github', 'GitHub', 'https://github.com/'],
  ['website', 'Website', ''],
  ['x', 'X', 'https://x.com/'],
  ['bluesky', 'Bluesky', 'https://bsky.app/profile/'],
  ['youtube', 'YouTube', 'https://youtube.com/'],
  ['devto', 'DEV', 'https://dev.to/'],
  ['reddit', 'Reddit', 'https://reddit.com/user/'],
  ['mastodon', 'Mastodon', ''],
  ['linkedin', 'LinkedIn', 'https://linkedin.com/in/'],
];
function linkUrl(value, base) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (!base) return /^[\w.-]+\.[a-z]{2,}/i.test(v) ? `https://${v}` : ''; // website/mastodon: only if it looks like a host
  return `${base}${v.replace(/^@/, '')}`;
}

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .wrap { max-width:1160px; margin:0 auto; }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:40px; align-items:start; }
  @media (max-width:960px) { .cols { grid-template-columns:1fr; gap:28px; } }
  article { min-width:0; }
  h1 { font-family:var(--font-display); font-size:30px; line-height:1.2; margin:0 0 12px; }

  .meta { color:var(--muted); font-size:13px; margin:0 0 18px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .meta .who { display:inline-flex; align-items:center; gap:8px; }
  .meta .av { width:24px; height:24px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center; background:var(--hover); color:var(--muted); font-size:11px; font-weight:700; }
  .meta .av img { width:100%; height:100%; object-fit:cover; }
  .meta .who b { color:var(--fg); font-weight:600; }
  .meta .m-actions { margin-left:auto; display:inline-flex; align-items:center; gap:8px; }
  .meta gbti-favorite, .meta gbti-collection { display:inline-flex; }
  .meta .m-act { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; }
  .meta .m-act:hover { color:var(--accent); border-color:var(--accent); }
  /* Mobile: lift the favorite + collection actions to their own right-justified row ABOVE the author meta. */
  @media (max-width:650px) { .meta .m-actions { order:-1; width:100%; justify-content:flex-end; margin-left:0; margin-bottom:2px; } }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .cats { display:flex; gap:6px; flex-wrap:wrap; }
  .cat { font-size:11px; font-weight:600; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:999px; padding:2px 9px; }

  /* SOW-050: the hero cover is contained by WIDTH only (height auto, no object-fit crop), so the whole image
     shows at full resolution with no clipping. */
  .cover { display:block; width:100%; height:auto; border-radius:12px; border:1px solid var(--line); margin:0 0 22px; }

  .body { font-size:15.5px; line-height:1.7; }
  .body h1,.body h2,.body h3 { font-family:var(--font-display); margin:1.4em 0 .5em; }
  .body p { margin:0 0 1em; }
  .body a { color:var(--accent); }
  .body img { max-width:100%; height:auto; border-radius:10px; }
  .body ul,.body ol { padding-left:1.4em; margin:0 0 1em; }
  .body blockquote { margin:0 0 1em; padding:2px 0 2px 14px; border-left:3px solid var(--line); color:var(--muted); }
  .body > pre, .body code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .body :not(pre) > code { background:var(--hover); border:1px solid var(--line); border-radius:5px; padding:.08em .35em; font-size:.9em; }

  /* SOW-050: code cards (built from <pre> in _enhanceCode) — a header bar with the language + a Copy button, a
     dark, horizontally-scrollable body that preserves whitespace. */
  .codecard { margin:0 0 1.2em; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--code-bg, #11131a); }
  .codebar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; background:color-mix(in srgb, var(--line) 40%, transparent); border-bottom:1px solid var(--line); }
  .codelang { font-family:ui-monospace,monospace; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
  .copybtn { font:inherit; font-size:11px; font-weight:600; color:var(--muted); background:transparent; border:1px solid var(--line); border-radius:6px; padding:2px 9px; cursor:pointer; }
  .copybtn:hover { color:var(--fg); border-color:var(--accent); }
  .codecard pre { margin:0; padding:13px 14px; overflow-x:auto; }
  .codecard pre code { display:block; white-space:pre; color:var(--code-fg, #e6e6e6); font-size:13px; line-height:1.55; background:none; border:0; padding:0; }

  .locked { border:1px solid var(--line); background:var(--hover); border-radius:10px; padding:14px 16px; color:var(--fg); font-size:14px; margin:14px 0; }
  .locked a { color:var(--accent); }
  .muted { color:var(--muted); }
  .view { display:inline-block; margin-top:22px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }

  /* The right drawer */
  .side { display:flex; flex-direction:column; gap:22px; }
  .author { border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:18px; }
  .author .a-top { display:flex; align-items:center; gap:12px; }
  .author .a-av { width:48px; height:48px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center; background:var(--hover); color:var(--muted); font-weight:700; }
  .author .a-av img { width:100%; height:100%; object-fit:cover; }
  .author .a-name { font-family:var(--font-display); font-size:17px; font-weight:700; line-height:1.2; }
  .author .a-user { font-size:12px; color:var(--muted); }
  .author .a-note { font-size:13.5px; line-height:1.5; color:var(--fg); margin:12px 0 0; }
  .author .follow { display:inline-flex; align-items:center; justify-content:center; gap:6px; margin-top:14px; width:100%; font:inherit; font-size:13px; font-weight:700; padding:8px 12px; border-radius:9px; cursor:pointer; border:1px solid var(--accent); background:var(--accent); color:#fff; text-decoration:none; }
  .author .follow.on { background:transparent; color:var(--fg); border-color:var(--line); }
  .author .follow.muted { background:transparent; color:var(--muted); border-color:var(--line); cursor:default; }
  .author .socials { display:flex; flex-wrap:wrap; gap:7px; margin-top:14px; }
  .author .soc { position:relative; width:30px; height:30px; flex:none; display:inline-flex; align-items:center; justify-content:center; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:8px; text-decoration:none; }
  .author .soc:hover, .author .soc:focus-visible { color:var(--accent); border-color:var(--accent); outline:none; }
  .author .soc svg { width:15px; height:15px; }
  /* Shared hover-tooltip recipe (SOW-067): a position:relative trigger reveals a hidden, absolutely-positioned
     child on :hover / :focus-within / :focus-visible. The same mechanics back the news channel hovercard
     (gbti-news.mjs). V3 tokens (inverted --fg/--bg) keep it legible in both themes. */
  .author .soc .tip { position:absolute; bottom:calc(100% + 7px); left:50%; transform:translateX(-50%); background:var(--fg); color:var(--bg); font-size:11px; font-weight:600; line-height:1; white-space:nowrap; padding:5px 8px; border-radius:6px; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .12s ease; z-index:30; }
  .author .soc:hover .tip, .author .soc:focus-visible .tip, .author .soc:focus-within .tip { opacity:1; visibility:visible; }

  .discussion h3 { font-family:var(--font-display); font-size:17px; margin:0 0 12px; }
  @media (max-width:960px) { .discussion { border-top:1px solid var(--line); padding-top:18px; } }
`;

class GbtiReader extends GbtiElement {
  /** open(item): { type, path, title, author, publishedAt, url, visibility, thumb?, thumbCard?, thumbWide?,
   *  categoryLabels?, body?, encryptedBody? }. For share, body/encryptedBody come from the summary; for
   *  post/product/prompt they come from readItem(path). */
  open(item) { this._item = item; this._html = null; this._author = undefined; this.render(); this._resolve(); }

  async _resolve() {
    const it = this._item || {};
    // Body + author drawer data load in parallel; both feed ONE resolved render (no re-render churn on the
    // discussion mount). The author lookup is fail-soft: any error degrades to the minimal github-avatar card.
    const [html, author] = await Promise.all([this._resolveBody(it), this._resolveAuthor(it)]);
    this._html = html;
    this._author = author;
    this.render();
  }

  async _resolveBody(it) {
    try {
      if (it.type === 'share') return await this._body(it.visibility, it.body, it.encryptedBody);
      const { frontmatter, body } = await this.client.readItem({ path: it.path });
      return await this._body(it.visibility, body, frontmatter?.encryptedBody);
    } catch {
      return { error: true };
    }
  }

  // Resolve the author drawer model: directory entry (avatar/name/headline/links), whether the viewer follows
  // them, and whether the viewer CAN follow (SOW-060: any signed-in member). House content yields a branded, non-followable card.
  async _resolveAuthor(it) {
    const username = lc(it.author);
    if (isHouse(username)) return { house: true };
    const [dir, status] = await Promise.all([
      loadDirectory(),
      (this.client.status ? this.client.status().catch(() => null) : Promise.resolve(null)),
    ]);
    const entry = dir.get(username) || null;
    const me = lc(status?.identity?.username || status?.identity?.login);
    const canFollow = !!status?.canFollow; // SOW-060: following is a free-tier perk (signed-in); the Worker fail-closes otherwise
    let following = false;
    if (canFollow && this.client.getFollows) {
      // getFollows() returns a bare array (operations.mjs) on both hosts; tolerate the { following: [...] } shape too.
      try { const f = await this.client.getFollows(); const list = Array.isArray(f) ? f : (f?.following ?? []); following = list.some((x) => lc(x.username) === username); }
      catch { /* leave following=false */ }
    }
    return { house: false, username, entry, canFollow, following, isSelf: !!me && me === username };
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

  _metaHtml(it, when) {
    const t = TYPE_LABEL[it.type] || it.type || '';
    const name = authorName(it.author);
    const avUrl = this._author?.entry?.avatar || githubAvatar(it.author);
    const ini = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
    const av = `<span class="av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span>`;
    const cats = Array.isArray(it.categoryLabels) && it.categoryLabels.length
      ? `<span class="cats">${it.categoryLabels.map((c) => `<span class="cat">${esc(c)}</span>`).join('')}</span>` : '';
    // SOW-013/064: favorite + add-to-collection, on the meta row (right-justified on desktop, a right-justified row
    // ABOVE the meta on mobile via the .m-actions order/width rules). The inert buttons upgrade to the working
    // controls once the client is present (extension/CMS). Shares are not favoritable here.
    const slug = it.type === 'share' ? '' : targetSlugFor(it);
    const HEART = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20.3S3.6 15.2 3.6 9.5A4 4 0 0 1 12 7.3a4 4 0 0 1 8.4 2.2c0 5.7-8.4 10.8-8.4 10.8z"/></svg>';
    const COLL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h11M4 12h9M4 17h6"/><path d="M17 13.5v6M14 16.5h6"/></svg>';
    const acts = slug ? `<span class="m-actions">`
      + `<gbti-favorite data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}" data-gbti-region="favorite"><button type="button" class="m-act" aria-label="Favorite">${HEART}</button></gbti-favorite>`
      + `<gbti-collection data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"><button type="button" class="m-act" aria-label="Add to collection">${COLL}</button></gbti-collection>`
      + `</span>` : '';
    return `<div class="meta"><span class="badge">${esc(t)}</span>`
      + `<span class="who">${av}<b>${esc(name)}</b></span>`
      + `${when ? `<span>· ${esc(dateStr(when))}</span>` : ''}${cats}${acts}</div>`;
  }

  _authorCardHtml(it) {
    const a = this._author;
    if (!a || a.house) {
      return `<div class="author"><div class="a-top">`
        + `<span class="a-av"><img src="${esc(githubAvatar('gbti'))}" alt=""></span>`
        + `<div><div class="a-name">GBTI Network</div><div class="a-user">The co-op</div></div></div>`
        + `<p class="a-note">Articles, products, and prompts from the GBTI Network co-op.</p></div>`;
    }
    const e = a.entry || {};
    const name = e.displayName || it.author;
    const avUrl = e.avatar || githubAvatar(it.author);
    const ini = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
    const note = e.headline ? `<p class="a-note">${esc(e.headline)}</p>` : '';
    // Follow control: paid viewer -> toggle; self -> an Edit deep-link into the WorkBench; otherwise a prompt.
    let follow = '';
    // SOW-067 (decision 11): the author viewing their OWN post/product/prompt gets an Edit control that opens the
    // WorkBench on that type tab (workspace.html is a sibling extension page; npm-CMS hosts ignore the dead link).
    if (a.isSelf) follow = ['post', 'product', 'prompt'].includes(it.type)
      ? `<a class="follow edit" href="workspace.html#tab=${esc(it.type)}">Edit in workspace</a>` : '';
    else if (a.canFollow) follow = `<button class="follow${a.following ? ' on' : ''}" data-follow type="button">${a.following ? 'Following' : 'Follow'}</button>`;
    else follow = `<a class="follow muted" href="${SITE}/membership/" target="_blank" rel="noopener" title="Members can follow other members">Follow</a>`;
    // Social links (Discord shown as an inspectable handle chip).
    // SOW-067: per-platform brand ICONS (not spelled-out text). Each chip keeps an aria-label for screen readers
    // and reveals the platform name via the shared hover tooltip (.tip). Discord is not reliably linkable, so it
    // stays a focusable, non-link chip whose tooltip carries the handle.
    const links = e.links || {};
    const chips = [];
    for (const [key, label, base] of SOCIALS) {
      const url = linkUrl(links[key], base);
      const ico = socialIcon(key);
      if (url && ico) chips.push(`<a class="soc" href="${esc(url)}" target="_blank" rel="noopener nofollow" aria-label="${esc(label)}">${ico}<span class="tip" role="tooltip">${esc(label)}</span></a>`);
    }
    if (links.discord) {
      const handle = String(links.discord).trim();
      chips.push(`<span class="soc discord" tabindex="0" role="img" aria-label="Discord: ${esc(handle)}">${socialIcon('discord')}<span class="tip" role="tooltip">Discord: ${esc(handle)}</span></span>`);
    }
    const socials = chips.length ? `<div class="socials">${chips.join('')}</div>` : '';
    return `<div class="author"><div class="a-top">`
      + `<span class="a-av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span>`
      + `<div><div class="a-name">${esc(name)}</div><div class="a-user">@${esc(it.author)}</div></div></div>`
      + `${note}${follow}${socials}</div>`;
  }

  render() {
    const it = this._item;
    if (!it) { this.set(this.css(CSS)); return; }
    // A Share's `url` is the external link it points at; every other type's `url` is a gbti.network path.
    const view = it.type === 'share'
      ? (it.url ? `<a class="view" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">Read article on ${esc(hostOf(it.url))}</a>` : '')
      : (it.url ? `<a class="view" href="${esc(SITE + it.url)}" target="_blank" rel="noopener">View on gbti.network</a>` : '');
    const when = it.publishedAt ?? (it.createdAt ? Date.parse(it.createdAt) : null);
    const meta = this._metaHtml(it, when);
    // SOW-050: the hero uses the full-res thumbWide derivative (falls back to the card/list thumb if absent).
    const coverUrl = resolveAsset(it.thumbWide || it.thumbCard || it.thumb);
    const cover = coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="" loading="lazy">` : '';
    let body;
    if (this._html === null) body = `<p class="muted">Loading...</p>`;
    else if (this._html && this._html.error) body = `<p class="muted">Could not load this content. Try opening it on gbti.network.</p>`;
    else body = `<div class="body">${typeof this._html === 'string' ? this._html : ''}</div>`;

    const resolved = this._html !== null;
    const slug = targetSlugFor(it);
    const discussion = (resolved && slug)
      ? `<section class="discussion"><h3>Discussion</h3><gbti-discussion data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></section>`
      : '';
    // The author drawer only renders once resolved (so its data is present); while loading the side column is empty.
    const side = resolved ? `<aside class="side">${this._authorCardHtml(it)}${discussion}</aside>` : '<aside class="side"></aside>';

    // SOW-057: an upvote control on a Share (extension-only), hidden for the share's own author (whose vote never counts).
    const shareUpvote = (it.type === 'share' && slug && this._author && !this._author.isSelf)
      ? `<div class="share-actions" style="margin-top:12px"><gbti-upvote data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-upvote></div>`
      : '';

    this.set(this.css(CSS) + `<div class="wrap"><div class="cols"><article><h1>${esc(it.title || '')}</h1>${meta}${cover}${body}${view}${shareUpvote}</article>${side}</div></div>`);
    if (resolved) { this._enhanceCode(); this._wireFollow(it); }
  }

  // SOW-050: upgrade each <pre> code block into a code card (language label + Copy button). Idempotent per render.
  _enhanceCode() {
    this.$$('.body pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const lang = (code && code.dataset && code.dataset.lang) || '';
      const card = document.createElement('div');
      card.className = 'codecard';
      const bar = document.createElement('div');
      bar.className = 'codebar';
      const tag = document.createElement('span');
      tag.className = 'codelang';
      tag.textContent = lang || 'code';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copybtn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        } catch { btn.textContent = 'Copy failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); }
      });
      bar.append(tag, btn);
      pre.replaceWith(card);
      card.append(bar, pre);
    });
  }

  // Toggle follow in place (no full re-render, which would remount the discussion). Optimistic; reverts on error.
  _wireFollow(it) {
    const btn = this.$('[data-follow]');
    if (!btn || !this.client.setFollow) return;
    btn.addEventListener('click', async () => {
      const want = !btn.classList.contains('on');
      btn.disabled = true;
      btn.classList.toggle('on', want);
      btn.textContent = want ? 'Following' : 'Follow';
      try {
        await this.client.setFollow({ username: it.author, on: want });
        if (this._author) this._author.following = want;
      } catch {
        btn.classList.toggle('on', !want); // revert
        btn.textContent = !want ? 'Following' : 'Follow';
      } finally {
        btn.disabled = false;
      }
    });
  }
}

define('gbti-reader', GbtiReader);
export { GbtiReader };

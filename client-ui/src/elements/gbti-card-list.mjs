// <gbti-card-list> (SOW-041): the ONE canonical content-item presentation for the extension — the Browse `.row` +
// cat-glyph vocabulary, in three density modes (compact / detailed / card) lifted from the new-tab feed and
// restyled onto the client-ui shadow tokens. Both gbti-browse (SOW-031) and the new-tab Activity feed (SOW-042)
// consume it, so there is one source of truth for the card/row look (the owner's "two stylings" complaint).
//
// Consumed imperatively: set `el.items` (a uniform projection {type,title,author,visibility,thumb,excerpt,
// category,createdAt,openHref?}) and `el.mode`. An item WITH `openHref` renders as an <a> (navigation, e.g. the
// activity feed deep-linking into the reader); an item WITHOUT it renders as a button that emits `card-open`
// (detail:{item}) so the host opens it in place (e.g. gbti-browse's detail pane). Inert in public (no markup
// until a host sets items). The body/discussion engine stays in gbti-reader; this is presentation only.
import { GbtiElement, define, esc } from '../base.mjs';
import { glyphFor, typeAccent } from '../cat-glyph.mjs';
import { resolveAsset } from '../assets.mjs';
// sow-398 (owner, 2026-09-24): heart + Save on the cards, as the website's feed cards carry them.
import { targetSlugFor, SAVABLE_TYPES } from '../target-slug.mjs';
import './gbti-favorite.mjs';
import './gbti-collection.mjs';

const MODES = new Set(['compact', 'detailed', 'card']);
const TYPE_LABEL = { post: 'Article', project: 'Project', prompt: 'Prompt', share: 'Share', news: 'News' };
const lc = (s) => String(s || '').toLowerCase();
const authorName = (a) => (lc(a) === 'gbti' || lc(a) === 'house' ? 'GBTI Network' : a);

// SOW-049: a publisher favicon URL from a news item's article link/domain (Google's favicon service handles sites
// that lack a /favicon.ico). Pure; '' when there is no usable host.
export function faviconFor(urlOrHost) {
  let host = String(urlOrHost || '').trim();
  if (!host) return '';
  try { host = new URL(host).hostname; } catch { host = host.replace(/^https?:\/\//i, '').split('/')[0]; }
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

// SOW-049: the meta-row avatar for a card. A MEMBER-authored item -> the author's GitHub avatar (the extension
// convention; a profile gravatar can layer on later via an enriched authorAvatar field); a NEWS item -> the
// publisher favicon. `title` is the name/source shown as a hover tooltip on the avatar. Pure.
export function avatarFor(item = {}) {
  if (lc(item.type) === 'news') {
    return { src: faviconFor(item.link || item.openHref), title: item.source || item.author || 'News' };
  }
  const a = lc(item.author);
  const login = (a === 'gbti' || a === 'house') ? 'gbti-network' : item.author;
  return { src: login ? `https://github.com/${encodeURIComponent(login)}.png?size=48` : '', title: authorName(item.author) };
}

// SOW-050/067: the RAW thumbnail field for a mode — the card box uses the larger thumbCard derivative; dense rows use
// the small thumb (falling back to thumbCard). null when the item has no featured image. Pure; exported for testing.
export function thumbRaw(item = {}, isCard = false) {
  return ((isCard && item.thumbCard) ? item.thumbCard : (item.thumb || item.thumbCard)) || null;
}

// SOW-067: the leaf taxonomy label (the human breadcrumb's last entry), or '' when absent. Pure; exported for testing.
export function categoryLeaf(labels) {
  const a = Array.isArray(labels) ? labels : [];
  return a.length ? String(a[a.length - 1] || '').trim() : '';
}

// sow-221: relTime now lives in ../time-core.mjs so the pull request rows could use it without becoming a
// FOURTH copy. Re-exported here because existing importers (and test/card-avatars.test.mjs) read it from
// this module; the behavior is byte-for-byte the function that used to be defined right here.
// NOTE: imported AND re-exported, not `export ... from`. A bare re-export does not bind the name in this
// module's scope, and the card row below calls relTime() directly, so that form would throw at runtime.
import { relTime } from '../time-core.mjs';
export { relTime };

const lockIco = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); --feed-radius:7px; }
  .media { position:relative; flex:none; display:flex; align-items:center; justify-content:center; overflow:hidden; color:#fff;
    background:linear-gradient(145deg, color-mix(in srgb, var(--ka, #5b6472) 60%, white), var(--ka, #5b6472)); }
  /* The glyph wrapper must FILL the media so the svg's % sizing + centering resolve (an unsized .gl made the
     icon render tiny + off-center). Bumped to 55% so the type glyph reads clearly. */
  .media .gl { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
  .media .gl svg { width:55%; height:55%; display:block; }
  .media .cimg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  /* sow-296: the type tag carries the WEBSITE's per-type colours (.kt-* in src/styles/gbti-v3.css), so an article
     reads blue and a prompt purple on both hosts. The values are duplicated rather than imported because a shadow
     root cannot see the site stylesheet; test/card-list-site-parity.test.mjs pins the pairs against that file. */
  .chip { display:inline-flex; align-items:center; font-family:var(--font-mono, monospace); font-size:10px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); background:var(--hover); border:1px solid transparent; border-radius:4px; padding:3px 7px; white-space:nowrap; flex:none; }
  .chip.k-post { color:#2f63c0; background:#eef3fc; }
  .chip.k-project { color:#138178; background:#e7f5f3; }
  .chip.k-prompt { color:#6b4fb0; background:#f2eefb; }
  .chip.k-share { color:var(--muted); background:var(--hover); border-color:var(--line); }
  .chip.k-news { color:#b3661e; background:#fdf1e4; }
  :host-context([data-theme="dark"]) .chip.k-post { color:#8fb2ec; background:rgba(63,116,201,.16); }
  :host-context([data-theme="dark"]) .chip.k-project { color:#6fd0c5; background:rgba(19,129,120,.18); }
  :host-context([data-theme="dark"]) .chip.k-prompt { color:#b5a1e8; background:rgba(107,79,176,.2); }
  :host-context([data-theme="dark"]) .chip.k-news { color:#e8b079; background:rgba(179,102,30,.2); }
  .lock { display:inline-flex; align-items:center; gap:4px; font-family:var(--font-mono, monospace); font-size:10px; font-weight:600; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:2px 8px 2px 6px; white-space:nowrap; }
  .lock svg { width:11px; height:11px; }
  .meta { display:inline-flex; align-items:center; gap:7px; font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); white-space:nowrap; min-width:0; }
  .meta b { color:var(--fg); font-weight:500; }
  /* sow-296: the author (or the publication, for news) is NAMED on the row, as it is on the website card. It used
     to be a tooltip on the avatar, which is not a label anyone reads in a list. */
  .meta .who { color:var(--fg); font-weight:500; overflow:hidden; text-overflow:ellipsis; max-width:190px; }
  .meta .dot { width:3px; height:3px; border-radius:50%; background:var(--line); flex:none; }
  /* SOW-049: the meta avatar (member github avatar / news publisher favicon). The name/source is the title tooltip. */
  .av { position:relative; width:20px; height:20px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center;
    background:var(--hover); color:var(--muted); font-size:10px; font-weight:700; line-height:1; }
  .av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .av .ini { user-select:none; }
  .meta .ago { color:var(--muted); }
  /* sow-296: the display face and the website's title weight, so a feed row reads the same on both hosts. */
  .title { font-family:var(--font-display, var(--font-body)); font-weight:700; color:var(--fg); letter-spacing:-.01em; overflow-wrap:anywhere; }
  .empty { color:var(--muted); padding:18px 2px; }
  a, .open { color:inherit; text-decoration:none; }

  /* MODES compact + detailed — a continuous DIVIDED list (hairline separators, no per-row box) */
  .compact, .detailed { display:flex; flex-direction:column; }
  .row-c, .row-d { position:relative; cursor:pointer; border-bottom:1px solid var(--line); transition:background .14s; }
  /* sow-398: each card sits in an .it wrapper (so its heart + Save can be a SIBLING of the card link), which makes
     every row the last child of its own wrapper: the last-row rule reads the wrapper instead. */
  .it:last-child > .row-c, .it:last-child > .row-d { border-bottom:0; }
  .row-c:hover, .row-d:hover { background:var(--hover); }

  .row-c { display:flex; align-items:center; gap:12px; padding:12px 8px 12px 15px; }
  .row-c .media { width:38px; height:38px; border-radius:var(--feed-radius); }
  .row-c .title { flex:1; min-width:0; font-size:14.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row-c:hover .title { color:var(--accent); }
  .row-c .right { display:flex; align-items:center; gap:10px; flex:none; }

  /* sow-296: DETAILED now mirrors the website feed card (src/components/feeds/FeedCard.astro): the body leads and
     the cover sits on the RIGHT, the meta row names the author, and the excerpt runs to two lines. It used to be a
     small left thumbnail with a one-line excerpt, which is the one place the two hosts looked least alike. */
  .row-d { display:grid; grid-template-columns:minmax(0,1fr) 168px; gap:20px; align-items:start; padding:20px 12px 20px 17px; }
  .row-d.no-media { grid-template-columns:1fr; }
  .row-d .media { width:168px; height:110px; border-radius:10px; order:2; }
  .row-d .body { min-width:0; }
  .row-d .top { display:flex; align-items:center; gap:9px; margin:0 0 9px; flex-wrap:wrap; }
  .row-d .title { font-size:19px; line-height:1.24; }
  .row-d:hover .title { color:var(--accent); }
  .row-d .ex { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--muted); font-size:14px; line-height:1.5; margin:8px 0 0; white-space:normal; }

  /* MODE card — boxed grid, image-led (mirrors the /prompts grid card: 4:3 cover image up top, body below) */
  .card { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:13px; }
  .card-i { position:relative; display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:var(--feed-radius); padding:0; cursor:pointer; overflow:hidden; transition:border-color .14s, box-shadow .14s, transform .14s; }
  .card-i:hover { border-color:var(--accent); transform:translateY(-2px); }
  /* The lead media: full-bleed at the top, a 4:3 box like /prompts .va-lead, object-fit cover. The card rounds
     only its top corners (overflow:hidden), so the image's BOTTOM edge is square (no rounded bottom). */
  .card-i .media { width:100%; aspect-ratio:4 / 3; height:auto; border-radius:0; flex:none; }
  .card-i .cbody { display:flex; flex-direction:column; padding:14px; }
  .card-i .top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  /* SOW-067: card titles wrap FULLY (no 2-line clamp); the auto-rows grid reflows the variable-height cards. */
  .card-i .title { font-size:16px; line-height:1.28; margin:10px 0 6px; }
  .card-i:hover .title { color:var(--accent); }
  .card-i .meta { margin:0; white-space:normal; }
  /* SOW-067: the category leaf label beside the type pill (card mode only), grouped left; the lock stays right. */
  .card-i .top { gap:6px; }
  .tcluster { display:inline-flex; align-items:center; gap:6px; min-width:0; }
  .catchip { display:inline-flex; align-items:center; font-family:var(--font-mono, monospace); font-size:10px; font-weight:600; color:var(--muted); background:var(--hover); border-radius:var(--feed-radius); padding:3px 7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; }
  /* SOW-067: the SOW-052 squared aesthetic in CARD MODE ONLY (scoped to .card-i so compact/detailed keep their radii). */
  /* SOW-086: card mode squares only the rectangular pieces to the feed radius; the avatar (.av) stays a
     circle, the lock stays a pill, and the full-bleed .card-i .media stays 0 (clipped by the card corners). */
  .card-i, .card-i .chip, .card-i .catchip { border-radius:var(--feed-radius); }

  /* SEPARATION — member contributions stand out from the (non-member, high-volume) News stream: each member
     type gets a 3px type-color accent bar + a faint tint + a colored chip; NEWS stays plain so it recedes.
     The color comes from --cbar (set per-row in _open from cat-glyph's typeAccent). */
  .row-c[data-type]:not([data-type="news"])::before,
  .row-d[data-type]:not([data-type="news"])::before,
  .card-i[data-type]:not([data-type="news"])::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--cbar, var(--green)); }
  .row-c[data-type]:not([data-type="news"]),
  .row-d[data-type]:not([data-type="news"]) { background:color-mix(in srgb, var(--cbar) 7%, transparent); }
  .row-c[data-type]:not([data-type="news"]):hover,
  .row-d[data-type]:not([data-type="news"]):hover { background:color-mix(in srgb, var(--cbar) 14%, transparent); }
  .card-i[data-type]:not([data-type="news"]) { background:color-mix(in srgb, var(--cbar) 7%, var(--panel)); }
  [data-type]:not([data-type="news"]) .chip { color:var(--cbar); background:color-mix(in srgb, var(--cbar) 13%, transparent); border-color:color-mix(in srgb, var(--cbar) 26%, transparent); }

  /* SOW-070: GLASS — the accent bars + gradient glyphs + colored chips above already carry over; glass just FROSTS
     the list (ONE backdrop blur per CONTAINER, never per row, for the long-feed perf budget) and bumps the per-type
     tint so the rows read over the ambient backdrop. Flat (default) is untouched. */
  :host-context([data-layout="glass"]) :is(.compact, .detailed, .card) { -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  :host-context([data-layout="glass"]) .row-c[data-type]:not([data-type="news"]),
  :host-context([data-layout="glass"]) .row-d[data-type]:not([data-type="news"]) { background:color-mix(in srgb, var(--cbar) 16%, transparent); border-bottom-color:color-mix(in srgb, var(--cbar) 22%, transparent); }
  :host-context([data-layout="glass"]) .row-c[data-type]:not([data-type="news"]):hover,
  :host-context([data-layout="glass"]) .row-d[data-type]:not([data-type="news"]):hover { background:color-mix(in srgb, var(--cbar) 26%, transparent); }
  :host-context([data-layout="glass"]) .card-i[data-type]:not([data-type="news"]) { background:color-mix(in srgb, var(--cbar) 16%, var(--panel)); }

  /* sow-398: heart + Save. A card is ONE link (or one role=button), and a control inside a link is invalid HTML and
     would open the card, so the controls are a sibling of the card inside its .it wrapper, laid over the card's own
     box, with room reserved so they never cover text: lower left under the excerpt (detailed, card), the right end
     of a compact row. Same placement as the website feed card's .feed-foot (src/components/feeds/FeedCard.astro). */
  .it { position:relative; }
  .card > .it { display:flex; flex-direction:column; }
  .card > .it > .card-i { flex:1; }
  .acts { position:absolute; z-index:2; display:flex; align-items:center; gap:8px; }
  .detailed .acts { left:17px; bottom:16px; }
  .detailed .it.has-acts > .row-d { padding-bottom:62px; }
  .card .acts { left:14px; bottom:12px; }
  .card .it.has-acts .cbody { padding-bottom:54px; }
  .compact .acts { right:10px; top:50%; transform:translateY(-50%); }
  .compact .it.has-acts > .row-c { padding-right:190px; }

  /* Phones (responsive rule: shrink/drop the competing secondary metadata before the title loses its room). The
     compact + detailed rows otherwise crush the title to a few characters because the avatar + relative date hold
     fixed width. Below 560px: drop the "x days ago", tighten gaps/padding, shrink the glyph + avatar + chip. */
  @media (max-width: 700px) {
    /* sow-296: the same stack point the website uses: the cover goes full width under the body. */
    .row-d { grid-template-columns:1fr; gap:12px; }
    .row-d .media { width:100%; height:150px; }
    .meta .who { max-width:130px; }
  }
  @media (max-width: 560px) {
    .row-c { gap:9px; padding:11px 10px 11px 12px; }
    .row-c .media { width:34px; height:34px; }
    .row-d { padding:14px 10px 14px 14px; }
    .row-c .ago, .row-d .ago { display:none; }
    .av { width:18px; height:18px; }
    .chip { font-size:10px; padding:3px 6px; }
  }
`;

class GbtiCardList extends GbtiElement {
  set items(v) { this._items = Array.isArray(v) ? v : []; this.render(); }
  get items() { return this._items || []; }
  set mode(v) { this._mode = MODES.has(v) ? v : 'detailed'; this.render(); }
  get mode() { return this._mode || 'detailed'; }

  // SOW-050: the resolved thumbnail URL (the card box uses the larger thumbCard derivative; dense rows use the small
  // thumb), or null when the item has no featured image. News falls back to its single og:image URL.
  _thumbUrl(item) {
    const raw = thumbRaw(item, this.mode === 'card');
    return raw ? resolveAsset(raw) : null;
  }
  _media(item) {
    const isCard = this.mode === 'card';
    // SOW-049/050: in the dense list rows (compact/detailed) news shows NO left media (its publisher favicon sits in
    // the meta); only the image-led card surfaces the article og:image.
    if (lc(item.type) === 'news' && !isCard) return '';
    const thumb = this._thumbUrl(item);
    // SOW-067: a DETAILED row is image-or-nothing — the featured image shows as the small left thumb, or there is NO
    // media at all (no type-glyph fallback; the title spans full width via no-media). Compact + card keep the glyph.
    if (this.mode === 'detailed' && !thumb) return '';
    const g = glyphFor(item.category, item.type);
    const glyph = this.mode === 'detailed' ? '' : `<span class="gl"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>`;
    const img = thumb ? `<img class="cimg" src="${esc(thumb)}" alt="" loading="lazy">` : '';
    return `<span class="media" style="--ka:${esc(g.accent)}">${glyph}${img}</span>`;
  }
  _chip(item) {
    const t = lc(item.type);
    const k = ['post', 'project', 'prompt', 'share', 'news'].includes(t) ? ` k-${t}` : '';
    return `<span class="chip${k}">${esc(TYPE_LABEL[item.type] || item.type)}</span>`;
  }
  // SOW-067: the leaf taxonomy label (the human breadcrumb's last entry) shown beside the type pill in card mode.
  _categoryChip(item) {
    const leaf = categoryLeaf(item.categoryLabels);
    return leaf ? `<span class="catchip">${esc(leaf)}</span>` : '';
  }
  // News is open to the limited trial, not members-only, so it never carries the Members lock badge (SOW-050).
  _lock(item) { return item.visibility === 'members' && lc(item.type) !== 'news' ? `<span class="lock">${lockIco}Members</span>` : ''; }
  // SOW-049: the meta leads with a small avatar (member -> github avatar; news -> publisher favicon); the name/source
  // is the avatar's hover tooltip (title), not a persistent label. Broken images fall back to an initial disc.
  _meta(item, { named = true } = {}) {
    const ago = relTime(item.createdAt ?? item.publishedAt);
    const av = avatarFor(item);
    const ini = esc((av.title || '?').trim().charAt(0).toUpperCase() || '?');
    const img = av.src ? `<img class="avimg" src="${esc(av.src)}" alt="" loading="lazy">` : '';
    // sow-296: the website card names the author beside the avatar, so this one does too. The compact row is the
    // exception (`named: false`): it is one line per item by definition and the title needs that width.
    const who = named && av.title ? `<span class="who">${esc(av.title)}</span>` : '';
    const sep = who && ago ? '<span class="dot"></span>' : '';
    return `<span class="meta"><span class="av" title="${esc(av.title)}"><span class="ini">${ini}</span>${img}</span>${who}${sep}${ago ? `<span class="ago">${esc(ago)}</span>` : ''}</span>`;
  }
  _open(item, i, cls) {
    // data-type drives the separation treatment (accent bar + tint + colored chip); --cbar carries the type
    // color for member types only, so NEWS rows render plain and recede in the blended feed.
    const t = lc(item.type);
    const accent = t && t !== 'news' ? ` style="--cbar:${esc(typeAccent(t))}"` : '';
    // SOW-049/050: news drops its left media in the dense list rows (title leads full-width); the image-led CARD keeps
    // a media block so the article og:image can show.
    // SOW-067: a detailed row with no featured image is also no-media (title spans full width, no glyph fallback).
    const nomedia = ((t === 'news' && cls !== 'card-i') || (cls === 'row-d' && !this._thumbUrl(item))) ? ' no-media' : '';
    const attrs = `class="${cls}${nomedia}" data-card="${i}" data-type="${esc(t)}"${accent}`;
    return item.openHref ? `<a ${attrs} href="${esc(item.openHref)}">` : `<div ${attrs} role="button" tabindex="0">`;
  }
  _close(item) { return item.openHref ? '</a>' : '</div>'; }

  // sow-398: the heart + Save for an item the member can favorite and collect (posts, projects, prompts, shares; not
  // news), keyed exactly as the reader keys them. '' for anything else, so the card renders as before.
  _acts(item) {
    const t = lc(item.type);
    const slug = SAVABLE_TYPES.has(t) ? targetSlugFor({ ...item, type: t }) : '';
    if (!slug) return '';
    const a = `data-gbti-target-type="${esc(t)}" data-gbti-target-slug="${esc(slug)}"`;
    return `<div class="acts"><gbti-favorite ${a} data-gbti-region="favorite"></gbti-favorite><gbti-collection ${a}></gbti-collection></div>`;
  }
  // The wrapper that lets the controls sit beside the card link rather than inside it.
  _wrap(item, inner) {
    const acts = this._acts(item);
    return `<div class="it${acts ? ' has-acts' : ''}">${inner}${acts}</div>`;
  }

  _compact(items) {
    return `<div class="compact">` + items.map((it, i) => this._wrap(it, `${this._open(it, i, 'row-c')}${this._media(it)}${this._chip(it)}<span class="title">${esc(it.title)}</span><span class="right">${this._lock(it)}${this._meta(it, { named: false })}</span>${this._close(it)}`)).join('') + `</div>`;
  }
  _detailed(items) {
    // sow-296: meta first, then the title and the excerpt, with the cover on the right (CSS order), matching the
    // website feed card's reading order.
    return `<div class="detailed">` + items.map((it, i) => this._wrap(it, `${this._open(it, i, 'row-d')}${this._media(it)}<div class="body"><div class="top">${this._meta(it)}${this._chip(it)}${this._categoryChip(it)}${this._lock(it)}</div><div class="title">${esc(it.title)}</div>${it.excerpt ? `<span class="ex">${esc(it.excerpt)}</span>` : ''}</div>${this._close(it)}`)).join('') + `</div>`;
  }
  _card(items) {
    // Image-led card (matches the /prompts grid card): the media leads at the TOP, full-bleed + 4:3, then a
    // padded body. Because the media meets the body below it, its bottom edge stays square (the card only rounds
    // the top corners) — no rounded bottom on the image.
    return `<div class="card">` + items.map((it, i) => this._wrap(it, `${this._open(it, i, 'card-i')}${this._media(it)}<div class="cbody"><div class="top"><span class="tcluster">${this._chip(it)}${this._categoryChip(it)}</span>${this._lock(it)}</div><div class="title">${esc(it.title)}</div>${this._meta(it)}</div>${this._close(it)}`)).join('') + `</div>`;
  }

  render() {
    if (!this._items) return;
    if (!this._items.length) { this.set(this.css(CSS) + `<p class="empty">Nothing here yet.</p>`); return; }
    const body = this.mode === 'compact' ? this._compact(this._items) : this.mode === 'card' ? this._card(this._items) : this._detailed(this._items);
    this.set(this.css(CSS) + body);
    // A content image (.cimg) or a meta avatar/favicon (.avimg) that 404s drops out so the glyph / initial disc
    // shows through (CSP-safe capture-phase; img error does not bubble).
    if (!this._wiredErr) {
      this.root?.addEventListener('error', (e) => { const t = e.target; if (t?.tagName === 'IMG' && (t.classList?.contains('cimg') || t.classList?.contains('avimg'))) t.remove(); }, true);
      this._wiredErr = true;
    }
    // A card without an openHref opens IN PLACE: emit card-open for the host to handle.
    this.$$('[data-card]').forEach((el) => {
      if (el.tagName === 'A') return; // a real link navigates natively
      const open = () => this.emit('card-open', { item: this._items[Number(el.dataset.card)] });
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }
}

define('gbti-card-list', GbtiCardList);
export { GbtiCardList };

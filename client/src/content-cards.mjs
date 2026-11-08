// sow-497: the ```cards block (owner, 2026-11-08, option B "card grid" on the Minecraft plugin promo canvas). A grid
// of cards, two across in an article column and one on a phone, each card a picture, a name, a line, a small meta
// line and, when it links, the whole card is the link. Every renderer goes through this module (the site's remark
// pass, the WorkBench preview and the extension reader through content-blocks.mjs and markdown.mjs, the dev.to and
// Hashnode bodies), so a card cannot look one way on the site and another in the reader.
//
//   ```cards
//   ![Jockey Radio music discs in many colours](./images/jockey-radio.webp)
//   title: Jockey Radio
//   text: Live radio, streams and your own audio on music discs.
//   meta: Minecraft 26.2 · Free
//   link: https://gbti.network/projects/jockey-radio/
//   label: See the plugin
//   ---
//   (the next card)
//   ```
//
// A line holding only --- starts the next card. `cards 3` asks for three columns; two is the default. The image is
// an ordinary markdown image line, so every scanner that looks for a body's ./images/ files (the content check, the
// WorkBench publish, the reader, the cross-post rewrite) already finds it, and the site hands it to Astro as a real
// image node, so it is optimized like any other picture (src/lib/remark-content-blocks.mjs). Title, text, meta and
// label are plain text: a link inside a card that is itself a link is not valid HTML.
//
// This module imports nothing from content-blocks.mjs, which imports it, so the two never load each other in a ring.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\/[^\s<>"']+$/i.test(String(u ?? '').trim()) ? String(u).trim() : null);

export const CARD_KEYS = ['title', 'text', 'meta', 'link', 'label'];
export const CARD_DEFAULT_LABEL = 'Read more';
const CARD_IMAGE_LINE = /^!\[([^\]]*)\]\(\s*([^\s)]+)\s*\)$/;
/** An https address, a site path (/media/x.webp, never //host), or a file beside the item (./images/x.webp). */
export const cardImageSrcOk = (src) => /^https:\/\/[^\s<>"']+$/i.test(src) || /^\/(?!\/)[^\s<>"']*$/.test(src) || /^\.\/[^\s<>"']+$/.test(src);

/** One card per run of lines between --- lines. Columns: 2 (default) or 3 from the fence's option. */
export function parseCards(body, meta = '') {
  const opt = String(meta ?? '').trim();
  const cols = opt === '3' ? 3 : 2;
  const colsBad = opt && opt !== '2' && opt !== '3' ? opt : null;
  const groups = [[]];
  for (const raw of String(body ?? '').split('\n')) {
    const l = raw.trim();
    if (l === '---') { groups.push([]); continue; }
    if (l) groups[groups.length - 1].push(l);
  }
  const cards = groups.filter((g) => g.length).map((g) => {
    const c = { title: '', text: '', meta: '', link: null, linkBad: null, label: '', image: null, imageBad: [], extraImages: 0, unknown: [] };
    for (const l of g) {
      if (l.startsWith('![')) {
        const m = l.match(CARD_IMAGE_LINE);
        if (!m) { c.imageBad.push({ line: l, why: 'form' }); continue; }
        if (!cardImageSrcOk(m[2])) { c.imageBad.push({ line: m[2], why: 'src' }); continue; }
        if (c.image) { c.extraImages++; continue; }
        c.image = { alt: m[1].trim(), src: m[2] };
        continue;
      }
      const i = l.indexOf(':');
      const k = i > 0 ? l.slice(0, i).trim().toLowerCase() : '';
      const v = i > 0 ? l.slice(i + 1).trim() : '';
      if (!CARD_KEYS.includes(k)) { c.unknown.push(l); continue; }
      if (k === 'link') { if (safeUrl(v)) c.link = safeUrl(v); else c.linkBad = v; continue; }
      c[k] = v;
    }
    return c;
  });
  return { cols, colsBad, cards };
}

// The markup in pieces, so the site's remark pass can put a REAL image node between them and still build exactly
// what the preview builds in one string.
export const CARDS_CLOSE = '</div>';
export const CARD_MEDIA_OPEN = '<span class="gbti-card-media">';
export const CARD_MEDIA_CLOSE = '</span>';
export const cardsOpen = (cols) => `<div class="gbti-cards${cols === 3 ? ' gbti-cards-3' : ''}">`;
export const cardOpen = (c) => (c.link ? `<a class="gbti-card" href="${esc(c.link)}">` : '<div class="gbti-card">');
export const cardClose = (c) => (c.link ? '</a>' : '</div>');
/** The text under the picture. The arrow after the link line is drawn by the stylesheet, so a screen reader skips it. */
export function cardBodyHtml(c) {
  return '<span class="gbti-card-body">'
    + `<span class="gbti-card-title">${esc(c.title)}</span>`
    + (c.text ? `<span class="gbti-card-text">${esc(c.text)}</span>` : '')
    + (c.meta ? `<span class="gbti-card-meta">${esc(c.meta)}</span>` : '')
    + (c.link ? `<span class="gbti-card-cta">${esc(c.label || CARD_DEFAULT_LABEL)}</span>` : '')
    + '</span>';
}

/** The whole grid as one string (the preview and the reader), or null when no card has a title. */
export function renderCards(body, meta = '') {
  const p = parseCards(body, meta);
  const cards = p.cards.filter((c) => c.title);
  if (!cards.length) return null;
  const img = (im) => `${CARD_MEDIA_OPEN}<img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy">${CARD_MEDIA_CLOSE}`;
  return cardsOpen(p.cols) + cards.map((c) => cardOpen(c) + (c.image ? img(c.image) : '') + cardBodyHtml(c) + cardClose(c)).join('') + CARDS_CLOSE;
}

/** Cross-posts: each card as its picture, its linked name in bold with its line, then its meta in italics. */
export function cardsToMarkdown(body, meta = '') {
  return parseCards(body, meta).cards.filter((c) => c.title).map((c) => [
    c.image ? `![${c.image.alt}](${c.image.src})` : '',
    (c.link ? `**[${c.title}](${c.link})**` : `**${c.title}**`) + (c.text ? `: ${c.text}` : ''),
    c.meta ? `*${c.meta}*` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n');
}

/** The component checker's messages for one ```cards block (never errors). */
export function cardsWarnings(text, meta = '') {
  const out = [];
  const p = parseCards(text, meta);
  if (p.colsBad) out.push(`cards option "${p.colsBad}" is not known; use 2 or 3 columns (it shows as 2)`);
  if (!p.cards.some((c) => c.title)) out.push('cards needs at least one card with a "title:" line; start each further card with a line holding ---');
  p.cards.forEach((c, i) => {
    const name = c.title ? `card "${c.title}"` : `card ${i + 1}`;
    if (!c.title) out.push(`cards: ${name} has no "title:" line; it is left out`);
    for (const u of c.unknown) out.push(`cards line "${u}" is not an image line or title:, text:, meta:, link: or label:; it is left out`);
    for (const b of c.imageBad) {
      out.push(b.why === 'form'
        ? `cards line "${b.line}" starts like an image but is not ![alt text](path); it is left out`
        : `cards image "${b.line}" is not an https address, a site path or a ./images/ file; it is left out`);
    }
    if (c.image && !c.image.alt) out.push(`cards: ${name} has an image with no alt text; describe the picture between the [ ]`);
    if (c.extraImages) out.push(`cards: ${name} has more than one image line; only the first shows`);
    if (c.linkBad != null) out.push(`cards: ${name} link "${c.linkBad}" is not an http or https address; the card shows without a link`);
    if (c.label && !c.link && c.linkBad == null) out.push(`cards: ${name} has label: but no link: line to go with it`);
    for (const k of ['title', 'text', 'meta', 'label']) {
      if (/\[[^\]]*\]\([^)]*\)/.test(c[k])) out.push(`cards: ${name} ${k} has a markdown link, which shows as text; a card links through its link: line`);
      if (/\[\^[^\]]+\]/.test(c[k])) out.push(`cards: ${name} ${k} has a footnote marker, which shows as text in a card`);
    }
  });
  return out;
}

/**
 * Board B's card, as ems of the article text (the board's 17px body: 19px title, 14.5px text, 11.5px meta). The
 * grid caps its columns at two (three for `cards 3`) and steps down on its own as the column narrows, so it needs no
 * media query: a column never gets narrower than 240px (180px at three).
 */
export function cardsCss(s, t) {
  return `${s} .gbti-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(240px,calc((100% - 16px)/2))),1fr));gap:16px;margin:1.4em 0}
${s} .gbti-cards-3{grid-template-columns:repeat(auto-fill,minmax(min(100%,max(180px,calc((100% - 32px)/3))),1fr))}
${s} .gbti-card{display:flex;flex-direction:column;min-width:0;border:1px solid ${t.line};border-radius:12px;overflow:hidden;background:${t.card};color:inherit;text-decoration:none}
${s} a.gbti-card:hover{border-color:${t.greenBorder};color:inherit}
${s} a.gbti-card:focus-visible{outline:2px solid ${t.green};outline-offset:2px}
${s} .gbti-card-media{display:block}
${s} .gbti-card-media img{display:block;width:100%;max-width:none;height:auto;aspect-ratio:16/10;object-fit:cover;margin:0;border-radius:0}
${s} .gbti-card-body{display:flex;flex-direction:column;flex:1;gap:6px;padding:14px 16px 16px}
${s} .gbti-card-title{font-family:var(--f-display,inherit);font-weight:800;font-size:1.12em;line-height:1.25;color:${t.fg}}
${s} .gbti-card-text{font-size:.86em;line-height:1.55;color:${t.soft}}
${s} .gbti-card-meta{margin-top:2px;font-family:${t.mono};font-size:.68em;line-height:1.5;color:${t.mute}}
${s} .gbti-card-cta{margin-top:auto;padding-top:6px;font-weight:700;font-size:.86em;line-height:1.3;color:${t.green700}}
${s} .gbti-card-cta::after{content:" \\2192";content:" \\2192" / ""}
${s} a.gbti-card:hover .gbti-card-cta{text-decoration:underline;text-underline-offset:3px}`;
}

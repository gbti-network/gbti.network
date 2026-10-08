// sow-445 (owner, 2026-10-08): a news story posted with a gbti.network link gets ITS OWN card. The story page draws
// itself in the browser, and preview bots (LinkedIn, X, Facebook, Slack, Discord) never run that, so every story
// unfurled as the empty shell: "News | GBTI Network", a generic line, our default picture, and one shared address.
// functions/news/item/index.js looks the story up by its id, as the page does, and hands it here.
//
// Pure (string in, string out) so node --test exercises it. ALL OR NOTHING, like personalizeHead: if any tag this
// rewrites is missing, the page goes out untouched rather than half describing a story.
//
// The card reads "<headline> | <publication>"; the tab keeps "<headline> | GBTI Network", which is what the page's
// own script sets it to (link cards name the source, the tab names us, as on a share page).

import { escapeHtml } from './invite-head.mjs';
import { newsSummary } from './news-summary.mjs';
import { newsCardSource } from './link-card.mjs';

export const SITE_NAME = 'GBTI Network'; // src/lib/brand.ts, which this edge-and-node module cannot import
const SITE = 'https://gbti.network';
const SAFE_SOURCE = /^[a-z0-9][a-z0-9 _.-]{0,60}$/i; // the page's own check on the hint
const DESC_MAX = 300;

/**
 * Whether a request comes from a link-preview fetcher rather than a person. Only those get the filled card: a person's
 * browser draws the story itself, and making them wait for the lookup first would slow every story page down for a
 * card they never see. A fetcher this misses gets the plain page, which is today's card. Matches the named unfurlers
 * and anything calling itself a bot, crawler or spider.
 */
export function isPreviewBot(ua) {
  return /bot\b|bot\/|crawler|spider|facebookexternalhit|facebot|linkedin|slack|discord|telegram|whatsapp|skypeuripreview|embedly|iframely|cardyb|bluesky|mastodon|pinterest|vkshare|google-pagerenderer/i.test(String(ua || ''));
}

/** The story a request asks for: { guid, source } from ?g= and ?s=, or null when there is no guid. */
export function storyRequest(url) {
  let p;
  try { p = new URL(url).searchParams; } catch { return null; }
  const guid = String(p.get('g') ?? '');
  if (!guid || guid.length > 2000) return null;
  const s = String(p.get('s') ?? '').trim();
  return { guid, source: SAFE_SOURCE.test(s) ? s : '' };
}

/** The signup Worker's one-story lookup (GET /news/item?g=), which the page reads too (src/pages/news/item.astro). */
export function itemUrlFor(base, { guid } = {}) {
  return `${base}/news/item?g=${encodeURIComponent(String(guid || ''))}`;
}

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const cut = (s, max) => {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sp = head.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,;:.]+$/, '')}...`;
};
// The page decodes an escaped ampersand in the picture's address before using it (item.astro fixUrl); so does this.
const fixUrl = (u) => String(u).replace(/&#0*38;/g, '&').replace(/&amp;/g, '&');

/**
 * What the card says for one story (the lookup's `item`), or null when there is none (the page then shows "left the
 * stream", and the card stays generic to match). `sources` is /news-sources.json.
 */
export function storyCard(it, req, sources) {
  const headline = text(it?.title);
  if (!req || !it || String(it.guid) !== req.guid || !headline) return null;
  const brand = newsCardSource(it, sources);
  const image = text(it.image) ? fixUrl(text(it.image)) : '';
  return {
    tabTitle: `${headline} | ${SITE_NAME}`,
    cardTitle: `${headline} | ${brand || SITE_NAME}`,
    description: cut(text(newsSummary(it)), DESC_MAX),
    image: /^https:\/\//i.test(image) ? image : '', // a card picture must be https; otherwise the default stays
    url: `${SITE}/news/item/?g=${encodeURIComponent(req.guid)}${req.source ? `&s=${encodeURIComponent(req.source)}` : ''}`,
  };
}

const TAG = {
  title: /<title>[^<]*<\/title>/,
  ogTitle: /<meta property="og:title" content="[^"]*"\s*\/?>/,
  ogDesc: /<meta property="og:description" content="[^"]*"\s*\/?>/,
  ogUrl: /<meta property="og:url" content="[^"]*"\s*\/?>/,
  canonical: /<link rel="canonical" href="[^"]*"\s*\/?>/,
  ogImage: /<meta property="og:image" content="[^"]*"\s*\/?>/,
  twImage: /<meta name="twitter:image" content="[^"]*"\s*\/?>/,
};
const SIZE = /<meta property="og:image:(?:width|height)" content="[^"]*"\s*\/?>/g;

/** Returns { html, changed }. `changed` only when every tag was found; otherwise the page comes back untouched. */
export function newsItemHead(html, card) {
  if (typeof html !== 'string' || !card || !card.cardTitle) return { html, changed: false };
  if (!Object.values(TAG).every((re) => re.test(html))) return { html, changed: false };
  const e = escapeHtml;
  let out = html
    .replace(TAG.title, `<title>${e(card.tabTitle)}</title>`)
    .replace(TAG.ogTitle, `<meta property="og:title" content="${e(card.cardTitle)}">`)
    .replace(TAG.ogUrl, `<meta property="og:url" content="${e(card.url)}">`)
    .replace(TAG.canonical, `<link rel="canonical" href="${e(card.url)}">`);
  if (card.description) out = out.replace(TAG.ogDesc, `<meta property="og:description" content="${e(card.description)}">`);
  if (card.image) {
    out = out
      .replace(TAG.ogImage, `<meta property="og:image" content="${e(card.image)}">`)
      .replace(TAG.twImage, `<meta name="twitter:image" content="${e(card.image)}">`)
      .replace(SIZE, ''); // those were the default picture's size; a wrong size is worse than none
  }
  return { html: out, changed: true };
}

// sow-445 (owner, 2026-10-08): a link card on LinkedIn, X, Facebook, Slack or Discord ends with the SOURCE's name,
// "Why Physicists Think Space May Have a Holographic Description | Quanta Magazine", rather than "| GBTI Network".
// The brand when it is known, the domain when it is not. Only the card (og:title) changes; the browser tab and the
// search result keep "| GBTI Network", because the page is ours.
//
// Pure, and free of Node, so the share page (at build) and the news item Pages Function (at the edge) share it.

import { sourceNameMap } from '../../membership/news-source-name.mjs';
import { platformLabel } from '../../client/src/share-source.mjs';

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** A link's host as a reader knows it ("quantamagazine.org"), or '' when it is not an http(s) link. */
export function hostOfUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  } catch { return ''; }
}

/** host -> publication name from the news source pool. Each source's `description` is its site's domain
 *  (house/news-sources.yml), so a share of arstechnica.com is named "Ars Technica" without anything saved on it.
 *  A description that is not a bare domain is skipped. Tolerates a missing or malformed list (an empty map). */
export function newsHostNames(sources) {
  const list = Array.isArray(sources) ? sources : Array.isArray(sources?.sources) ? sources.sources : [];
  const map = new Map();
  for (const s of list) {
    const host = str(s?.description).toLowerCase().replace(/^www\./, '');
    const name = str(s?.name);
    if (name && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !map.has(host)) map.set(host, name);
  }
  return map;
}

/**
 * The name a share's link card ends with, or '' when the share has no usable link (the card then keeps
 * "| GBTI Network"). In order: the name saved with the share (what the page called itself when it was shared),
 * the news source pool by host, the platform (YouTube, X, GitHub ...), and last the domain itself.
 */
export function cardSourceFor({ url, sourceName } = {}, hostNames = new Map()) {
  const host = hostOfUrl(url);
  if (!host) return '';
  return str(sourceName).slice(0, 80) || hostNames.get(host) || platformLabel(url) || host;
}

/** The name a news story's card ends with: the publication from the pool by the story's source id, else the
 *  story link's domain. Never the raw id: an id like `object-object` reads as a fault on a card. '' when neither. */
export function newsCardSource(story = {}, sources) {
  const named = sourceNameMap(sources).get(str(story?.source));
  return named || hostOfUrl(story?.link) || '';
}

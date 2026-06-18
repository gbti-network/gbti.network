// RSS/Atom feed parsing.
//
// The list of sources lives in config/sources.mjs (managed at the filesystem level). This module is
// just the parser: `parseFeed(xml, sourceId)` turns raw feed XML into normalized items:
//   { guid, source, title, link, summary, publishedAt }
// It handles RSS 2.0 (<item>), RSS 1.0/RDF, and Atom (<entry>); `publishedAt` is epoch seconds (or null).
//
// Why fast-xml-parser and not DOMParser: the Workers runtime has no DOMParser. fast-xml-parser is
// pure JS, runs in Workers, and is the only runtime dependency.

import { XMLParser } from 'fast-xml-parser';

// Shared parser. attributeNamePrefix '@_' so we can read Atom <link href="...">; textNodeName
// '#text' so element text living alongside attributes is reachable. CDATA is unwrapped to text by default.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

/** Always return an array, whether the source had 0, 1, or many of an element. */
function toArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract a plain string from a value that may be a string, number, or { '#text', ... } node. */
function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in v) return text(v['#text']);
  return '';
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/** Strip HTML tags, decode common entities, collapse whitespace, and cap length for AI input. */
export function cleanText(raw, max = 500) {
  let s = text(raw);
  if (!s) return '';
  s = s.replace(/<[^>]*>/g, ' '); // drop tags
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  s = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  s = s.replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? m);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** RFC-822 (RSS) and RFC-3339 (Atom) both parse via Date.parse. Returns epoch seconds or null. */
export function toEpochSeconds(raw) {
  const s = text(raw).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Pick the best href from an Atom <link>, which may be a string, one object, or an array of them. */
function atomLink(link) {
  const arr = toArray(link);
  // Prefer rel="alternate" (the human page); else the first entry that has an href.
  const alt = arr.find((l) => l && typeof l === 'object' && l['@_rel'] === 'alternate' && l['@_href']);
  const any = arr.find((l) => l && typeof l === 'object' && l['@_href']);
  if (alt) return alt['@_href'];
  if (any) return any['@_href'];
  // Plain string link (rare in Atom, common if a feed mislabels).
  const str = arr.find((l) => typeof l === 'string');
  return str || '';
}

/**
 * Parse raw feed XML into normalized items for `sourceId`.
 * Returns [] (never throws) on unparseable or empty input so one bad feed can't abort a batch.
 */
export function parseFeed(xml, sourceId) {
  let root;
  try {
    root = parser.parse(xml);
  } catch {
    return [];
  }
  if (!root || typeof root !== 'object') return [];

  // RSS 2.0: <rss><channel><item>...   |   RSS 1.0 / RDF: <rdf:RDF><item>... (items at top level)
  const channel = root.rss?.channel ?? root.channel ?? root['rdf:RDF'] ?? null;
  if (channel && (channel.item || root['rdf:RDF'])) {
    const items = toArray(channel.item ?? root['rdf:RDF']?.item);
    return items.map((it) => normalize({
      rawGuid: text(it.guid) || text(it['dc:identifier']),
      title: it.title,
      link: text(it.link),
      summary: it.description ?? it.summary,
      content: it['content:encoded'] ?? it.description ?? it.summary,
      date: it.pubDate ?? it['dc:date'] ?? it.published,
    }, sourceId)).filter(Boolean);
  }

  // Atom: <feed><entry>...
  const feed = root.feed ?? null;
  if (feed && feed.entry) {
    const entries = toArray(feed.entry);
    return entries.map((e) => normalize({
      rawGuid: text(e.id),
      title: e.title,
      link: atomLink(e.link),
      summary: e.summary ?? e.content,
      content: e.content ?? e.summary,
      date: e.published ?? e.updated,
    }, sourceId)).filter(Boolean);
  }

  return [];
}

// How much feed-provided article text to keep for AI summarization (transient; never persisted). Bounds the AI
// prompt size (Neurons) while giving the model real article text when the feed inlines it (<content:encoded> /
// Atom <content>), instead of only the short display excerpt.
const MAX_CONTENT_CHARS = 4000;

/** Build a normalized item; drops items with no usable link+title (they can't be deduped or shown). */
function normalize({ rawGuid, title, link, summary, content, date }, sourceId) {
  const cleanLink = text(link).trim();
  const cleanTitle = cleanText(title, 300);
  if (!cleanLink || !cleanTitle) return null;
  return {
    // Stable dedupe key: the feed's own guid/id when present, else the link itself (unique per item).
    guid: (text(rawGuid).trim() || cleanLink),
    source: sourceId,
    title: cleanTitle,
    link: cleanLink,
    summary: cleanText(summary ?? content, 500),
    // TRANSIENT (stripped before persisting in ingest): the fuller article text for AI summarization at ingest.
    // Prefers the feed's full content over the short excerpt, so many feeds get a real summary with NO extra fetch.
    contentText: cleanText(content ?? summary, MAX_CONTENT_CHARS),
    publishedAt: toEpochSeconds(date),
  };
}

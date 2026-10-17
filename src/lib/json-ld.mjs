// sow-462: structured data (schema.org JSON-LD) for search engines, and the one safe way to put JSON in a <script>.
//
// JSON.stringify does not escape "<", so a value holding "</script>" closes the element it sits in and whatever
// follows it runs as HTML: a member's display name or an article title would become script on the page. Found on
// the homepage's personalize block, which wrote member display names this way (a display name accepts any text).
// jsonForScript() escapes every character the HTML parser or a script engine could act on, and the result still
// parses to the identical value. Use it for EVERY JSON value written into a <script> element.
//
// Node-free and Astro-free, so the node tests import it directly.

const ESCAPES = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' };

/** JSON for a <script> data block: safe against "</script>", "<!--" and the two JS line terminators. */
export function jsonForScript(value) {
  return JSON.stringify(value ?? null).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
}

const SITE = 'https://gbti.network';
const SCHEMA = 'https://schema.org';

/** GBTI Network as an organization: the publisher of every article, and the author of the network's own. */
export const GBTI_ORGANIZATION = Object.freeze({
  '@type': 'Organization',
  name: 'GBTI Network',
  url: `${SITE}/`,
  logo: Object.freeze({ '@type': 'ImageObject', url: `${SITE}/gbti-logo.png`, width: 512, height: 512 }),
});

/** A date as an ISO string, or undefined (JSON.stringify then drops the key) when it is absent or invalid. */
function iso(value) {
  if (value == null || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The author node: the network itself for its own content, otherwise a person with their profile page when one exists. */
export function authorNode({ name, url, network = false }) {
  if (network) return GBTI_ORGANIZATION;
  return { '@type': 'Person', name, ...(url ? { url } : {}) };
}

/**
 * An article page's record. Every URL must already be absolute. The modified date falls back to the published date,
 * because a missing dateModified reads to Google as "never revised", not as "unknown".
 */
export function articleJsonLd({ url, headline, description, image, publishedAt, updatedAt, author }) {
  const published = iso(publishedAt);
  return {
    '@context': SCHEMA,
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    headline,
    description: description || undefined,
    image: image ? [image] : undefined,
    datePublished: published,
    dateModified: iso(updatedAt) ?? published,
    author,
    publisher: GBTI_ORGANIZATION,
  };
}

/** A breadcrumb trail. Each step is `{ name, url }`; the last (the page itself) may leave its url out. */
export function breadcrumbJsonLd(steps) {
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.name, ...(s.url ? { item: s.url } : {}) })),
  };
}

/** The homepage's records: the site (which is where Google takes the site name it shows) and the organization. */
export function siteJsonLd({ sameAs = [] } = {}) {
  const profiles = sameAs.filter((u) => /^https?:\/\//.test(String(u)));
  return [
    { '@context': SCHEMA, '@type': 'WebSite', name: 'GBTI Network', url: `${SITE}/` },
    { '@context': SCHEMA, ...GBTI_ORGANIZATION, ...(profiles.length ? { sameAs: profiles } : {}) },
  ];
}

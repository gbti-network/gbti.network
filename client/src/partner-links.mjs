// 2026-10-28: where a masked partner link really goes, for DISPLAY. A share whose url is one of our partner
// redirect paths (house/outbound-links.yml, e.g. https://gbti.network/outbound/surfacedby/blog/...) must still read
// "surfacedby.com" on its cards, its source card and its "Read article on <domain>" line, while every click keeps
// going through the masked path so the referral is credited.
//
// The website build resolves this itself (src/lib/rehype-sponsored-links.mjs displayHrefOf, from the store). The
// extension and the account hub read share files straight from the repo, so they look the path up in the site's
// public /outbound-links.json, once per page load. Node-free; every failure resolves to "show the url as it is".

const SITE_HOSTS = new Set(['gbti.network', 'www.gbti.network', 'preview.gbti.network']);
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The path of a url that may be a masked partner link (ours, under /outbound/), else null. */
export function maskedPathOf(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !SITE_HOSTS.has(u.hostname.toLowerCase())) return null;
  return u.pathname.startsWith('/outbound/') ? norm(u.pathname) : null;
}

/** `url` resolved through `links` (`[{ path, destination }]`), or `url` unchanged when it is not one of them. */
export function displayUrlOf(url, links = []) {
  const p = maskedPathOf(url);
  if (!p || !Array.isArray(links)) return url;
  const hit = links.find((l) => l && typeof l.path === 'string' && norm(l.path) === p && typeof l.destination === 'string');
  return hit ? hit.destination : url;
}

let cached = null;

/** The site's partner links, fetched once and shared; `[]` when the list cannot be read. */
export function loadPartnerLinks({ site = 'https://gbti.network', fetchImpl = globalThis.fetch } = {}) {
  if (!cached) {
    cached = Promise.resolve()
      .then(() => fetchImpl(`${site}/outbound-links.json`))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => (Array.isArray(j?.links) ? j.links.map((l) => ({ path: String(l.path || ''), destination: String(l.destination || '') })) : []))
      .catch(() => []);
  }
  return cached;
}

/** Tests only: forget the cached list. */
export function resetPartnerLinksCache() { cached = null; }

// sow-378: a link in a rendered body that leaves this site opens in a new tab.
//
// The page chrome already did this. The share page's Visit button, its read CTA and the sow-222 source card
// all carry target="_blank" rel="noopener nofollow". The BODY did not: a link a member wrote in an article, a
// project, a prompt or a share note rendered as a bare <a href>, so following a citation replaced the page the
// reader was on. The owner reported it on a share whose author note cites two videos.
//
// Runs AFTER the sanitizer, like rehypeSponsoredLinks and for the same reason: the sanitize schema's rel
// allowlist does not carry these values and would strip them if this ran first. Runs BEFORE
// rehypeSponsoredLinks, so a partner redirect keeps the exact rel that pass sets.
const SITE_HOSTS = new Set(['gbti.network', 'www.gbti.network', 'preview.gbti.network']);

/**
 * True when following this href leaves the site. Only an absolute http(s) url on another host counts: a
 * relative path, a fragment (`#user-content-fn-1`, which is what a footnote marker and its back-reference
 * use), a mailto and anything unparsable all stay in the tab they are in.
 */
export function isExternalHref(href) {
  const h = String(href ?? '').trim();
  if (!h || h.startsWith('#') || h.startsWith('/')) return false;
  let u;
  try { u = new URL(h); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  return !SITE_HOSTS.has(u.hostname.toLowerCase());
}

/** The rel to write, keeping whatever the node already carries and adding what a new tab needs. */
export function relFor(existing) {
  const have = Array.isArray(existing) ? existing : String(existing ?? '').split(/\s+/);
  const out = [];
  for (const v of [...have, 'noopener', 'nofollow']) {
    const t = String(v || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function rehypeExternalLinks() {
  const walk = (node) => {
    if (node.tagName === 'a' && isExternalHref(node.properties?.href)) {
      node.properties = node.properties || {};
      node.properties.target = '_blank';
      node.properties.rel = relFor(node.properties.rel);
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  return (tree) => { walk(tree); };
}

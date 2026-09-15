// sow-281: body links to a partner redirect path (the paths in house/outbound-links.yml, sow-289) are paid
// placements, so they carry rel="sponsored nofollow noopener" instead of the bare noopener the markdown pipeline
// leaves on every link. Bounded to the store's exact paths, on this site's origin or relative, so an ordinary
// outbound link in a member's article is never marked sponsored. Runs LAST in the rehype chain, after the
// sanitizer (whose rel allowlist does not know `sponsored` and would strip it if this ran first).
const SITE_HOSTS = new Set(['gbti.network', 'www.gbti.network']);

/** The path of an href when it points at this site (relative, or absolute on gbti.network); else null. */
export function sitePathOf(href) {
  const h = String(href || '').trim();
  if (!h) return null;
  if (h.startsWith('/') && !h.startsWith('//')) return h.split(/[?#]/)[0];
  let u;
  try { u = new URL(h); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !SITE_HOSTS.has(u.hostname)) return null;
  return u.pathname;
}

const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** rehype plugin: `paths` is the list of partner redirect paths. */
export function rehypeSponsoredLinks({ paths = [] } = {}) {
  const set = new Set(paths.map(norm));
  const walk = (node) => {
    if (node.tagName === 'a') {
      const p = sitePathOf(node.properties?.href);
      if (p && set.has(norm(p))) {
        node.properties = node.properties || {};
        node.properties.rel = ['sponsored', 'nofollow', 'noopener'];
      }
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  return (tree) => { walk(tree); };
}

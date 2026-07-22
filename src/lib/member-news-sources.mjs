// sow-140: merge admin-approved member news sources into the house pool the /news-sources.json build
// artifact emits (and the gbti-news worker ingests hourly). Pure + fail-closed: a member feed appears
// ONLY when its product slug is in the admin-owned approval registry AND that slug resolves to a
// PUBLISHED + PUBLIC product still carrying a newsFeed URL. Anything else (revoked, unpublished,
// members-only, feed removed, duplicate id) is skipped. House sources always win an id collision.

/**
 * @param {Array<{id:string,name:string,url:string,description:string,enabled:boolean}>} houseSources
 * @param {Array<{product?:string}>} approvals rows from house/member-news-sources.yml `approved`
 * @param {Array<{slug?:string,title?:string,author?:string,status?:string,visibility?:string,newsFeed?:string,shortDescription?:string}>} products plain product frontmatter
 * @returns the combined source list (house first, then approved member feeds)
 */
export function mergeMemberSources(houseSources, approvals, products) {
  const out = Array.isArray(houseSources) ? [...houseSources] : [];
  const seen = new Set(out.map((s) => s?.id).filter(Boolean));
  const bySlug = new Map();
  for (const p of Array.isArray(products) ? products : []) {
    if (p?.slug) bySlug.set(p.slug, p);
  }
  for (const row of Array.isArray(approvals) ? approvals : []) {
    const slug = typeof row?.product === 'string' ? row.product.trim() : '';
    if (!slug) continue;
    const p = bySlug.get(slug);
    if (!p) continue; // approved but the product is gone: fail closed
    if (p.status !== 'published' || p.visibility !== 'public') continue; // public gallery products only
    const url = typeof p.newsFeed === 'string' ? p.newsFeed.trim() : '';
    if (!/^https:\/\//i.test(url)) continue; // the field was removed or malformed: fail closed
    const id = `member-${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(p.title || slug),
      url,
      description: `A member source: ${String(p.title || slug)} by ${String(p.author || 'a member')}.`,
      enabled: true,
    });
  }
  return out;
}

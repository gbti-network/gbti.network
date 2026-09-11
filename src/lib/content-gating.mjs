// sow-246: the four gating predicates, pure and importable by node --test.
//
// They lived in src/lib/content.ts, which also imports astro:content types and the browser member-signal
// module, so no unit test could reach them: `isStub` had zero references under test/ while being the sole
// decision, in eight consumers, between rendering a locked body and rendering the item's own markdown. The
// predicates moved here unchanged; content.ts re-exports them under the same names, so every consumer keeps
// its import. This file is the one place the decision lives, and test/content-gating.test.mjs drives the
// four frontmatter shapes through it.
//
// The modes (SOW-016):
//   public          published + visibility public                     -> full page, listed
//   Mode A          published + members, no public stub               -> NO page, not listed
//   Mode B (stub)   published + members + publicStub: true            -> a page with the teaser + locked body
//   draft           status draft, any visibility                       -> nothing public

/**
 * Public static build shows only published + public entries. Members-only and drafts are excluded from the
 * public bundle (SOW-001 soft-gating); the SOW-005 controller still reads every entry regardless of state.
 * Use this where the body must be FULLY readable (e.g. RelatedPosts, the comments feed).
 */
export function isPublic(entry) {
  const d = entry?.data || {};
  return d.status === 'published' && d.visibility === 'public';
}

/**
 * SOW-016: does this entry get a public detail PAGE? published AND (public OR a members stub).
 * Mode A (members + no stub) and drafts get no page. This is the getStaticPaths predicate.
 */
export function hasPublicPage(entry) {
  const d = entry?.data || {};
  return d.status === 'published' && (d.visibility === 'public' || d.publicStub === true);
}

/** SOW-016: a members item that renders a public STUB (header + locked body), i.e. Mode B. */
export function isStub(entry) {
  const d = entry?.data || {};
  return d.visibility === 'members' && d.publicStub === true;
}

/**
 * SOW-016: appears in public listings/indexes. Same predicate as hasPublicPage: a Mode B stub shows as a
 * LOCKED card; a Mode A item is absent. Use this in index pages; keep `isPublic` where a locked card is noise.
 */
export function isListed(entry) {
  return hasPublicPage(entry);
}

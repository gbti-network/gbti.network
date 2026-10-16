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
//   Mode B (stub)   published + members + publicStub: true            -> a page with the teaser + locked body,
//                                                                         noindex, listed only for a paying member
//                                                                         (sow-323 Phase 3)
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
 * SOW-016: appears in the MEMBER ecosystem's data: the build-time index JSON the extension, the bells and the
 * members digest read. Same predicate as hasPublicPage (a Mode B stub included; a Mode A item absent).
 *
 * sow-323 Phase 3: NOT the predicate for a public listing any more. The owner ruled on 2026-09-12 that a
 * members-only item keeps its own page but is "not publicly indexed [or] included in public feeds" until a
 * superadmin approves it. Public listings use isPubliclyListed; the members-only cards they reveal after a paying
 * member signs in use isMembersOnlyListed.
 */
export function isListed(entry) {
  return hasPublicPage(entry);
}

/** sow-323 Phase 3: appears in a PUBLIC listing (a feed, a directory, a profile list, the sitemap): published and
 *  public. Approval is what flips an item to public, so this is exactly "approved or never needed review". */
export function isPubliclyListed(entry) {
  return isPublic(entry);
}

/** sow-323 Phase 3: a published members-only item WITH its own page (a Mode B stub). It is left out of public
 *  listings and the sitemap, carries noindex, and appears in a listing only after a paying member signs in. */
export function isMembersOnlyListed(entry) {
  return hasPublicPage(entry) && !isPublic(entry);
}

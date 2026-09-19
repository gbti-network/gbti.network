// sow-362: does this member actually HAVE a profile page to link to?
//
// A member folder is created the moment someone comments, shares or publishes. A profile.md is written later, or
// never. In between, every card that names them linked to /members/<username>/ and that page did not exist:
// measured live on 2026-09-18, a comment author's name and avatar both 301'd nowhere and returned 404 on a
// published prompt page, and a share author's card did the same until the share was moved.
//
// authors.ts already carried ONE instance of this fix, hard-coded: the retired `gbti` pseudo-author points at the
// homepage "because it has no profile page". The condition was always general and the fix never was.
//
// THIS MODULE IS ASTRO-ONLY, deliberately. It reads the content collection at module load, so it cannot be
// imported by the node tests, the build scripts or the client the way authors.ts and avatars.ts are (all three
// import those today). Keeping the collection read here is what lets those stay node-safe.
import { getCollection } from 'astro:content';
import { isPublic } from './content';
import { authorHref } from './authors';

// EXACTLY the predicate src/pages/members/[username].astro uses for getStaticPaths. If the two ever disagree,
// this module starts vouching for pages that were never built, which is the bug it exists to prevent.
// scripts/check-member-links.mjs is the backstop: it fails the build on a link to a member page that is not in
// dist, whatever this module believed.
const PAGES: ReadonlySet<string> = new Set(
  (await getCollection('profile')).filter(isPublic).map((p) => p.data.username),
);

/** Every member with a built page, for a surface that renders links in the BROWSER and so cannot ask. */
export function profilePageUsernames(): string[] {
  return [...PAGES].sort();
}

/** Is there a built page at /members/<username>/ ? */
export function hasProfilePage(username: string | undefined | null): boolean {
  return PAGES.has(String(username ?? '').trim());
}

/**
 * The profile link for a content author, or UNDEFINED when they have no page yet.
 *
 * Undefined rather than an empty string on purpose: Astro omits an undefined attribute, so `<a href={...}>`
 * becomes an anchor with no href, which renders in place, keeps its classes and layout, and is not a link. The
 * one global rule in gbti-v3.css (`a:not([href])`) takes the pointer and the link colour off it. That is what
 * lets every call site keep the markup it already has.
 */
export function profileHref(username: string | undefined | null): string | undefined {
  const name = String(username ?? '').trim();
  const href = authorHref(name);
  if (href === '/') return href; // the retired `gbti` pseudo-author, which authors.ts already points home
  return hasProfilePage(name) ? href : undefined;
}

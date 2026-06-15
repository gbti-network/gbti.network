import type { CollectionEntry } from 'astro:content';

type Gatable = { data: { status: 'draft' | 'published'; visibility: 'public' | 'members'; publicStub?: boolean } };

/**
 * Public static build shows only published + public entries.
 * Members-only and drafts are excluded from the public bundle (SOW-001 soft-gating);
 * the SOW-005 controller still reads every entry regardless of state.
 * Use this where the body must be FULLY readable (e.g. RelatedPosts, the comments feed).
 */
export function isPublic(entry: Gatable): boolean {
  return entry.data.status === 'published' && entry.data.visibility === 'public';
}

/**
 * SOW-016: does this entry get a public detail PAGE? published AND (public OR a members stub).
 * Mode A (members + no stub) and drafts get no page. This is the getStaticPaths predicate.
 */
export function hasPublicPage(entry: Gatable): boolean {
  return entry.data.status === 'published' && (entry.data.visibility === 'public' || entry.data.publicStub === true);
}

/** SOW-016: a members item that renders a public STUB (header + locked body), i.e. Mode B. */
export function isStub(entry: Gatable): boolean {
  return entry.data.visibility === 'members' && entry.data.publicStub === true;
}

/**
 * SOW-016: appears in public listings/indexes. Same predicate as hasPublicPage — a Mode B stub shows as a
 * LOCKED card; a Mode A item is absent. Use this in index pages; keep `isPublic` where a locked card is noise.
 */
export function isListed(entry: Gatable): boolean {
  return hasPublicPage(entry);
}

/**
 * SOW-016: has any public footprint (a public page or a members stub). Drives revenue eligibility: a Mode A
 * item has NO footprint, so it earns no referral share and its comments/contributions earn no delegation.
 */
export function hasPublicFootprint(entry: Gatable): boolean {
  return entry.data.visibility === 'public' || (entry.data.visibility === 'members' && entry.data.publicStub === true);
}

/**
 * SOW-022: where a directory card points. Applets link out to their running tool (`launchUrl`, e.g.
 * `/utilities/<slug>/` for GBTI's embedded ones, or an external URL), exactly the way a product card would link
 * to a download; products link to their `/products/<slug>/` detail page.
 */
export function catalogHref(entry: { data: { type?: string; slug: string; launchUrl?: string } }): string {
  return entry.data.type === 'applet' && entry.data.launchUrl ? entry.data.launchUrl : `/products/${entry.data.slug}/`;
}

/** Newest-first by publishedAt (falls back to updatedAt, then epoch). */
export function byNewest(a: { data: { publishedAt?: Date; updatedAt?: Date } }, b: { data: { publishedAt?: Date; updatedAt?: Date } }): number {
  const at = (a.data.publishedAt ?? a.data.updatedAt ?? new Date(0)).valueOf();
  const bt = (b.data.publishedAt ?? b.data.updatedAt ?? new Date(0)).valueOf();
  return bt - at;
}

/** Resolve the member/house owner segment from a content entry id (e.g. "members/hudson/posts/x" → "hudson"). */
export function ownerOf(entry: CollectionEntry<'post' | 'product' | 'prompt'>): string {
  const parts = entry.id.split('/');
  return parts[0] === 'members' ? parts[1] : 'house';
}

const SUBDIR: Record<string, string> = { post: 'posts', product: 'products', prompt: 'prompts' };

/**
 * The repo-relative file path for a content item, matching the ACTUAL on-disk layout the SOW-001 migration +
 * validate-content use (members/<owner>/<sub>/<slug>/index.md, profiles at members/<owner>/profile.md). The
 * SOW-006 inline editor reads + publishes this exact path (data-gbti-path). NOTE: the npm client's
 * content-ops currently assumes a flat <slug>.md layout; that is reconciled to this nested layout in P5.
 */
export function contentRepoPath(type: 'post' | 'product' | 'prompt' | 'profile', owner: string, slug?: string): string | null {
  if (!owner || owner === 'house' || owner === 'gbti') return null;
  if (type === 'profile') return `members/${owner}/profile.md`;
  const sub = SUBDIR[type];
  return sub && slug ? `members/${owner}/${sub}/${slug}/index.md` : null;
}

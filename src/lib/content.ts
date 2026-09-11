import type { CollectionEntry } from 'astro:content';
import { readMemberSignal, onMemberSignal, currentIdentity, type MemberSignal } from './member-signal';
import { canEditItem } from './content-edit.mjs';
import { contentItemPath } from './content-index.mjs';
import { contentFlagsOf } from './content-flags'; // sow-189: the superadmin stale/unindexed registry

type Gatable = { data: { status: 'draft' | 'published'; visibility: 'public' | 'members'; publicStub?: boolean } };

// sow-246: the four gating predicates live in the pure, node-testable content-gating.mjs and are re-exported
// here under their own names, so every consumer keeps importing them from this module. See that file for the
// mode table; test/content-gating.test.mjs drives the four frontmatter shapes through it.
import {
  isPublic as isPublicCore,
  hasPublicPage as hasPublicPageCore,
  isStub as isStubCore,
  isListed as isListedCore,
} from './content-gating.mjs';

/** Public static build shows only published + public entries (full body readable). */
export function isPublic(entry: Gatable): boolean { return isPublicCore(entry); }
/** SOW-016: does this entry get a public detail PAGE? Mode A and drafts do not. The getStaticPaths predicate. */
export function hasPublicPage(entry: Gatable): boolean { return hasPublicPageCore(entry); }
/** SOW-016: a members item that renders a public STUB (header + locked body), i.e. Mode B. */
export function isStub(entry: Gatable): boolean { return isStubCore(entry); }
/** SOW-016: appears in public listings/indexes (a Mode B stub as a locked card; a Mode A item absent). */
export function isListed(entry: Gatable): boolean { return isListedCore(entry); }

type Keyed = Gatable & { collection?: string; data: Gatable['data'] & { slug?: string } };
const FLAG_TYPE: Record<string, 'post' | 'project' | 'prompt'> = { post: 'post', project: 'project', applet: 'project', prompt: 'prompt' };

/**
 * sow-189: NOT marked stale in house/content-flags.yml. A stale item keeps its page, its direct link and its
 * place in the members' extension feed; it leaves public discovery only (owner decision 2026-09-08).
 */
export function notStale(entry: Keyed): boolean {
  const type = FLAG_TYPE[String(entry.collection || '')];
  const slug = entry.data?.slug;
  if (!type || !slug) return true;
  return !contentFlagsOf(type, slug).stale;
}

/**
 * sow-189: appears in PUBLIC discovery: listed AND not stale. Use this in the article directory, the site
 * feeds, the homepage and related posts; keep isListed for the member ecosystem (the extension's activity
 * feed and in-app browse), which a stale item does not leave.
 */
export function isDiscoverable(entry: Keyed): boolean {
  return isListed(entry) && notStale(entry);
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
 * `/utilities/<slug>/` for GBTI's embedded ones, or an external URL), exactly the way a project card would link
 * to a download; projects link to their `/projects/<slug>/` detail page.
 */
export function catalogHref(entry: { data: { type?: string; slug: string; launchUrl?: string } }): string {
  return entry.data.type === 'applet' && entry.data.launchUrl ? entry.data.launchUrl : `/projects/${entry.data.slug}/`;
}

/** Newest-first by publishedAt (falls back to updatedAt, then epoch). */
export function byNewest(a: { data: { publishedAt?: Date; updatedAt?: Date } }, b: { data: { publishedAt?: Date; updatedAt?: Date } }): number {
  const at = (a.data.publishedAt ?? a.data.updatedAt ?? new Date(0)).valueOf();
  const bt = (b.data.publishedAt ?? b.data.updatedAt ?? new Date(0)).valueOf();
  return bt - at;
}

/** Resolve the member/house owner segment from a content entry id (e.g. "members/hudson/posts/x" → "hudson"). */
export function ownerOf(entry: CollectionEntry<'post' | 'project' | 'prompt'>): string {
  const parts = entry.id.split('/');
  return parts[0] === 'members' ? parts[1] : 'house';
}

/**
 * The repo-relative file path for a content item, matching the ACTUAL on-disk layout the SOW-001 migration +
 * validate-content use (members/<owner>/<sub>/<slug>/index.md, profiles at members/<owner>/profile.md;
 * house/<sub>/<slug>/index.md for a house owner, no profile). The SOW-006 inline editor reads + publishes
 * this exact path (data-gbti-path).
 *
 * sow-183: the post/product/prompt case now delegates to content-index.mjs's ALREADY node-test-covered
 * contentItemPath (identical house/member logic, just without the profile case this function alone needs),
 * instead of duplicating it -- a house owner ('house' or 'gbti') resolves to `house/<sub>/<slug>/index.md`
 * rather than null. House content publish went through the website's own hosted-authoring endpoint as of
 * SOW-183 Phase 2-3 (superadmin-gated server-side), so a null here was a stale carry-over from when it could
 * not. The `!owner` fail-closed guard stays in front of BOTH branches: an empty/missing owner is a broken
 * item, not silently "house" (contentItemPath alone treats '' as house, which is right for its own build-time
 * callers but wrong for a page rendering an edit link off possibly-missing data).
 */
export function contentRepoPath(type: 'post' | 'project' | 'prompt' | 'profile', owner: string, slug?: string): string | null {
  if (!owner) return null;
  if (type === 'profile') return (owner === 'house' || owner === 'gbti') ? null : `members/${owner}/profile.md`;
  return contentItemPath(type, owner, slug);
}

/**
 * sow-183: wire a server-rendered-hidden Edit pill to the member signal, client-side. Every detail page's Edit
 * affordance (project's hero pill, the article/prompt variants) shares this one resolve/toggle instead of each
 * repeating the same few lines. `ownerAttr` names the data attribute the page stamped the item's owner into.
 * No-ops off the browser (this module is also imported server-side, e.g. EditHooks.astro's frontmatter).
 */
export function wireEditAffordance(selector: string, ownerAttr: string): void {
  if (typeof document === 'undefined') return;
  const btn = document.querySelector<HTMLElement>(selector);
  if (!btn) return;
  const owner = btn.getAttribute(ownerAttr) || '';
  const apply = (identity: MemberSignal | null) => { btn.hidden = !canEditItem(identity, owner); };
  apply(currentIdentity(readMemberSignal()));
  onMemberSignal(apply);
}

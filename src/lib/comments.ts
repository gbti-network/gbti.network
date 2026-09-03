import type { CollectionEntry } from 'astro:content';
import { canonicalType } from '../../membership/content-types.mjs';

// sow-196: the comment collection still ACCEPTS targetType 'product' (see src/content.config.ts), because
// every comment written before the 2026-09-02 rename carries it and a fork may still be producing them.
// These readers match on strict equality, so without canonicalizing the stored side a legacy comment
// detaches from its item and simply stops rendering, with no error and no empty-state to notice.
const sameType = (stored: string, want: string) => canonicalType(stored) === canonicalType(want);

// The public content repo is the database, so a comment's edit history IS the git history of its file.
// Link the "edited" affordance straight to GitHub's per-file commit log (no stored history, no cost).
export const REPO_URL = 'https://github.com/gbti-network/gbti.network';

/** GitHub commit-history URL for a comment file (entry.filePath is repo-root-relative). */
export function commitHistoryHref(filePath?: string): string | null {
  if (!filePath) return null;
  return `${REPO_URL}/commits/main/${filePath.replace(/^\.?\//, '')}`;
}

/**
 * Count the visible comment thread for a content item, matching the logic in Comments.astro:
 * published only, the content owner's PUBLIC comment flagged `authorNote` is lifted out as the
 * "from the author" intro (SOW-014, pinned regardless of date) and not counted, and a members-only comment is only counted when it carries an
 * encryptedBody (SOW-016 locked placeholder). Used for the comment-count meta on cards.
 */
export function commentThreadCount(
  comments: CollectionEntry<'comment'>[],
  targetType: 'post' | 'project' | 'prompt' | 'share',
  targetSlug: string,
  owner?: string,
): number {
  const published = comments
    .filter((c) => c.data.status === 'published')
    .filter((c) => sameType(c.data.targetType, targetType) && c.data.targetSlug === targetSlug)
    .sort((a, b) => a.data.createdAt.valueOf() - b.data.createdAt.valueOf());
  const introIdx = owner ? published.findIndex((c) => c.data.author === owner && c.data.visibility === 'public' && c.data.authorNote) : -1;
  const thread = (introIdx >= 0 ? published.filter((_, i) => i !== introIdx) : published)
    .filter((c) => c.data.visibility !== 'members' || c.data.encryptedBody);
  return thread.length;
}

/**
 * Whether a content item has a pinned "from the author" intro (SOW-014): a published, PUBLIC comment by the
 * item's own author flagged `authorNote`. Mirrors Comments.astro's own `notes` selection, including the
 * SOW-112 alias union so a renamed item still matches a note filed under its old slug. Used by ContentFooter
 * to skip the plain "Written by" AuthorBox when the intro already carries the author's name + avatar.
 */
export function hasAuthorNote(
  comments: CollectionEntry<'comment'>[],
  targetType: 'post' | 'project' | 'prompt' | 'share',
  targetSlug: string,
  author?: string,
  aliases: string[] = [],
): boolean {
  if (!author) return false;
  const slugSet = new Set([targetSlug, ...aliases]);
  return comments.some(
    (c) =>
      c.data.status === 'published' &&
      sameType(c.data.targetType, targetType) &&
      slugSet.has(c.data.targetSlug) &&
      c.data.author === author &&
      c.data.visibility === 'public' &&
      c.data.authorNote,
  );
}

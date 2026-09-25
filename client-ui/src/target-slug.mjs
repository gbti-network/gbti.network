// The key a content item is favorited, collected and discussed under, shared by the reader and the feed cards
// (sow-398). It lived inside gbti-reader.mjs until the feed cards needed the same answer, and two copies of one rule
// is how two surfaces start disagreeing about which item a heart belongs to.
//
// A post, project or prompt keys on its content slug (matching the public Comments.astro and FavoriteButton); a
// Share keys on the composite "<author>/<shareId>" (membership/member-activity.mjs validates it with SHARE_SLUG_RE).
// Empty means "no key", and the caller shows no control.
export function targetSlugFor(it) {
  if (!it) return '';
  if (it.type === 'share') return it.author && it.id ? `${it.author}/${it.id}` : '';
  if (it.slug) return String(it.slug);
  const m = String(it.path || '').match(/\/(?:posts|projects|products|prompts)\/([^/]+)\/index\.md$/);
  return m ? m[1] : '';
}

// The types a member can favorite and collect (membership/member-activity.mjs CONTENT_TYPES). News is not one of
// them: it has its own hearts, in the news module.
export const SAVABLE_TYPES = new Set(['post', 'project', 'prompt', 'share']);

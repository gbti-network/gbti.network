// SOW-089: the pure row builder behind /comments-index.json — the ONE-fetch replacement for the extension's
// per-comment GitHub reads (the tree walk downloaded every comment file sequentially; ~12s on a real
// thread). Rows are the commentSummary shape the ops layer already speaks: a PUBLIC comment ships its raw
// markdown body (already public data, rendered into the static pages); a members-visibility comment ships
// '' plus its encryptedBody pointer, decrypted on demand via the Worker exactly as before. Node-free.
export function toCommentIndexRow(entry) {
  const d = (entry && entry.data) || {};
  let createdAt = null;
  if (d.createdAt != null) {
    const t = d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt);
    createdAt = Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const isPublic = d.visibility !== 'members';
  // The repo-relative file path, derived the same way every consumer does (house comments live under
  // house/comments/; member comments under the author's folder) — Astro's filePath semantics vary by loader.
  const author = d.author ?? null;
  const path = d.id ? (author === 'gbti' || author === 'house' ? `house/comments/${d.id}.md` : `members/${author}/comments/${d.id}.md`) : null;
  return {
    id: d.id ?? null,
    path,
    author: d.author ?? null,
    targetType: d.targetType ?? null,
    targetSlug: d.targetSlug ?? null,
    parentId: d.parentId ?? null,
    authorNote: d.authorNote === true,
    visibility: d.visibility ?? 'public',
    createdAt,
    body: isPublic ? String(entry?.body ?? '') : '',
    encryptedBody: typeof d.encryptedBody === 'string' ? d.encryptedBody : null,
  };
}

/** Published comments only (missing status defaults published, matching the reader walks). */
export function isPublishedComment(entry) {
  return (entry?.data?.status ?? 'published') === 'published';
}

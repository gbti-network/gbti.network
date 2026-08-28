// The in-place TITLE edit on the WorkBench Preview page, decided without a DOM so it can be tested.
//
// The title is frontmatter rather than body source, so it has no line range and never goes through the block
// commit path. That makes this the only place its rules live: what counts as a change, what is refused, and what
// the element should display afterwards. The value becomes an <h1> and a document title, so it is one line of
// plain text and nothing else.

/**
 * Decide what an edited title means.
 *
 * @param raw       what the author left in the element (its textContent)
 * @param current   the frontmatter title before the edit
 * @param fallback  what to show when there is no title at all, normally the slug
 * @returns { changed, title, display }
 *          `changed` is whether frontmatter should be written and the draft marked dirty.
 *          `title` is the value to store, and is null when nothing should be stored.
 *          `display` is what the element should show, so a refused edit visibly snaps back rather than
 *          leaving the author looking at text that was not saved.
 */
export function planTitleEdit(raw, current, fallback = '') {
  // Any run of whitespace, including the newlines a paste or a stray Enter can introduce, collapses to one space.
  const next = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const cur = String(current ?? '');
  // An empty title is REFUSED rather than saved. A published page with no heading is worse than an unchanged
  // one, and the author almost always got here by selecting all and typing, not by intending to clear it.
  if (!next) return { changed: false, title: null, display: cur || String(fallback ?? '') };
  if (next === cur) return { changed: false, title: null, display: cur };
  return { changed: true, title: next, display: next };
}

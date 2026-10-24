// sow-354: ONE length limit for an item's identity, shared by every store that is keyed by it.
//
// The slug is the item identity: it names the content folder, the draft record (`<type>:<slug>`), the staged
// images (`draftimg:<github_id>:<type>:<slug>:<name>`), the publish item id (`<type>-<slug>`) and the branch
// the Worker commits to (`hosted/<github_id>/<item id>`). Each of those checked its own copy of an 80
// character cap, set for share ids (sow-157), while nothing capped the slug itself. An imported article with
// an 85 character slug therefore built and served fine and could not be saved or published from any surface:
// Save draft answered "a valid draft slug is required" and Publish "itemId ... (max 80)".
//
// Node-free: imported by the Worker, the client core, the WorkBench and the site's content schema.

/** The longest slug the network accepts. The schemas refuse anything longer, so every store below fits it. */
export const SLUG_MAX = 120;

/** The longest item id: the longest type prefix (`project-`, 8 characters) plus SLUG_MAX. */
export const ITEM_ID_MAX = 128;

/** Regex source (no anchors) for a slug: lowercase letters, digits and hyphens, not starting with a hyphen. */
export const SLUG_PATTERN = `[a-z0-9][a-z0-9-]{0,${SLUG_MAX - 1}}`;

/** Regex source (no anchors) for an item id, the same alphabet at ITEM_ID_MAX. */
export const ITEM_ID_PATTERN = `[a-z0-9][a-z0-9-]{0,${ITEM_ID_MAX - 1}}`;

/** The longest permalink slugFromTitle writes. Shorter than SLUG_MAX on purpose: an author can still type longer. */
export const TITLE_SLUG_MAX = 80;

/**
 * 2026-10-24 (owner): "when creating a new article the permalink needs to autogenerate based on the title." The
 * permalink a title gives: lowercase, accents folded (é to e), apostrophes dropped ("Don't" to "dont", not
 * "don-t"), every other run of non-letters and non-digits one hyphen, hyphens trimmed, and at most TITLE_SLUG_MAX
 * characters cut at a hyphen so no word is split. The result matches SLUG_PATTERN, or is '' when the title has no
 * letters or digits.
 */
export function slugFromTitle(title, max = TITLE_SLUG_MAX) {
  let s = String(title ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['`\u2018\u2019\u02bc]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > max) {
    const head = s.slice(0, max + 1);
    const at = head.lastIndexOf('-');
    s = (at > 0 ? head.slice(0, at) : s.slice(0, max)).replace(/-+$/, '');
  }
  return s;
}

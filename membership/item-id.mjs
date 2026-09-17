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

// sow-269: the project families the projects page gives their own color, icon and filter chip. This is the ONE
// list: the directory, the "Recently created" row and the featured spotlight all read it, and a card receives
// its shades as inline custom properties (categoryStyle) instead of each file restating `.c-*` classes. Three
// hand-copied palettes drifted before this existed: Chrome Extensions was a taxonomy leaf in none of them, so
// Ryker rendered as a Utilities project with no filter chip.
//
// `leaf` is the house/taxonomy.yml leaf key a project's `categories` path ends in. The four shades are the
// card's accent (`ca`, also the chip text), base (`cb`, the icon gradient and the banner preset's `from`), tint
// (`ct`, the chip background) and line (`cl`, the chip border).
//
// src/lib/banner-presets.mjs stays a separate explicit list ON PURPOSE: dropping a family here must never drop
// a banner option, because published frontmatter naming it would then fail the schema enum.
// test/project-categories.test.mjs holds the two lists (and gbti-v3.css's hero rules) in agreement.
export const PROJECT_CATEGORIES = [
  { leaf: 'wordpress', key: 'wp', label: 'WordPress', glyph: 'g-wp', ca: '#2f63c0', cb: '#5a8de0', ct: '#eef3fc', cl: '#bcd0f0' },
  { leaf: 'ide-plugins', key: 'ide', label: 'IDE Plugins', glyph: 'g-ide', ca: '#6b4fb0', cb: '#9277d4', ct: '#f2eefb', cl: '#d6c9ee' },
  { leaf: 'mods', key: 'mod', label: 'Mods', glyph: 'g-mod', ca: '#b3791f', cb: '#d8a847', ct: '#fbf3e3', cl: '#ecd9ad' },
  { leaf: 'utilities', key: 'util', label: 'Utilities', glyph: 'g-util', ca: '#138178', cb: '#3bb0a4', ct: '#e7f5f3', cl: '#b6e0da' },
  // Chip text measures 5.06:1 on its light tint (AA small text is 4.5). In dark mode gbti-v3.css draws the chip in
  // `cb`, which measures 3.26:1 there, level with wordpress (3.64) and ide-plugins (3.34).
  { leaf: 'chrome-extensions', key: 'chrome', label: 'Chrome Extensions', glyph: 'g-chrome', ca: '#b83a2e', cb: '#e0584a', ct: '#fdeeec', cl: '#f3c4be' },
];

// A project whose leaf is none of the families above. Neutral on purpose: it used to borrow the Utilities teal
// and glyph, which filed it visually under a family it is not in. It gets no filter chip and lists under All.
// Chip text measures 6.73:1 on its light tint, and `cb` 4.68:1 as the dark-mode chip, so moving Savepoint off the
// Utilities teal (4.56:1 in dark mode) does not make its chip harder to read in either theme.
export const OTHER_CATEGORY = { leaf: null, key: 'other', label: null, glyph: 'g-other', ca: '#55515e', cb: '#a3a0ac', ct: '#f0eff2', cl: '#d7d4dc' };

const BY_LEAF = new Map(PROJECT_CATEGORIES.map((c) => [c.leaf, c]));

/**
 * The family for a project's categories path (its last element is the leaf).
 * @param {string[]|undefined} categories
 * @param {string} fallbackLabel what an unlisted leaf is called, e.g. the taxonomy label for it
 */
export function categoryOf(categories, fallbackLabel) {
  const leaf = Array.isArray(categories) && categories.length ? categories[categories.length - 1] : '';
  return BY_LEAF.get(leaf) ?? { ...OTHER_CATEGORY, label: fallbackLabel || 'Project' };
}

/** The inline style that carries a family's four shades to the card, chip and icon beneath it. */
export function categoryStyle(c) {
  return `--ca:${c.ca};--cb:${c.cb};--ct:${c.ct};--cl:${c.cl}`;
}

// Shared category -> fallback glyph + accent for the extension/client UI, mirroring the main app's PromptCard
// CAT_GLYPH + k-* accents so a content item with NO image shows the SAME generic category icon the website does.
// Node-free AND sprite-free: the extension pages do not load the site's IconSprite, so the glyph markup is inlined
// here and shipped in the bundle. The category comes from the per-type index JSON's `category` field (the top
// segment of the item's `categories` path).

// Inner SVG markup per glyph key (24x24 viewBox, stroke = currentColor), copied from src/components/IconSprite.astro.
export const GLYPH_SVG = {
  spark: '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  pencil: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  coin: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.3c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1 0-2-.4-2.6-1.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  chart: '<path d="M4 19V5M4 19h16M8 16l3.5-4 3 2.5L20 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 7.6 3.7 3.7 0 0 1 19 10.7c0 4.9-7 9.3-7 9.3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.6M16.5 19a5.5 5.5 0 0 0-2.3-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  skill: '<path d="M13 2.5 6 13.2h5v8.3l7-10.7h-5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  puzzle: '<path d="M9 4.5a1.8 1.8 0 0 1 3.6 0c0 .5.4.9.9.9H16a1 1 0 0 1 1 1v2.5c0 .5.4.9.9.9a1.8 1.8 0 0 1 0 3.6c-.5 0-.9.4-.9.9V17a1 1 0 0 1-1 1h-2.6c-.5 0-.9.4-.9.9a1.8 1.8 0 0 1-3.6 0c0-.5-.4-.9-.9-.9H5a1 1 0 0 1-1-1v-2.4c0-.5-.4-.9-.9-.9a1.8 1.8 0 0 1 0-3.6c.5 0 .9-.4.9-.9V6.4a1 1 0 0 1 1-1h3.1c.5 0 .9-.4.9-.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
};

// Top-level category key -> glyph key (mirrors PromptCard.astro CAT_GLYPH, plus skill + imagegen).
const CAT_GLYPH = {
  ai: 'spark', devops: 'terminal', design: 'pencil', blockchain: 'coin',
  business: 'chart', writing: 'pencil', minecraft: 'box', entertainment: 'heart',
  generators: 'spark', 'member-tutorials': 'users', gbti: 'spark', imagegen: 'spark', skill: 'skill',
};

// Top-level category key -> accent color (mirrors the PromptCard k-* --ka values).
const CAT_ACCENT = {
  ai: '#6b4fb0', devops: '#2f63c0', design: '#c0392f', blockchain: '#b3791f',
  business: '#138178', writing: '#555a66', minecraft: '#3a7d2c', entertainment: '#c0392b',
  generators: '#138178', 'member-tutorials': '#2f63c0', gbti: '#1f9e5f', imagegen: '#6b4fb0', skill: '#b0316f',
};
const OTHER_ACCENT = '#5b6472';

/** Resolve a content item's top-level category to its fallback glyph: { svg, accent }. Unknown / missing -> a
 *  neutral puzzle glyph, so a row never renders empty. */
export function catGlyph(category) {
  const key = String(category || '').toLowerCase();
  const g = CAT_GLYPH[key] || 'puzzle';
  return { svg: GLYPH_SVG[g] || GLYPH_SVG.puzzle, accent: CAT_ACCENT[key] || OTHER_ACCENT };
}

// SOW-041: a Share carries no category (it has tags), so its glyph falls back on its TYPE. Other content types
// keep their category glyph; the type fallback only fires when the category is missing/unknown.
const TYPE_GLYPH = { share: 'coin', post: 'pencil', product: 'box', prompt: 'spark' };
const TYPE_ACCENT = { share: '#b3791f', post: '#555a66', product: '#138178', prompt: '#1f9e5f' };

/** Resolve an item's fallback glyph by category first, then by type (for Shares + any category-less item). */
export function glyphFor(category, type) {
  const key = String(category || '').toLowerCase();
  if (CAT_GLYPH[key]) return { svg: GLYPH_SVG[CAT_GLYPH[key]], accent: CAT_ACCENT[key] };
  const t = String(type || '').toLowerCase();
  if (TYPE_GLYPH[t]) return { svg: GLYPH_SVG[TYPE_GLYPH[t]], accent: TYPE_ACCENT[t] };
  return { svg: GLYPH_SVG.puzzle, accent: OTHER_ACCENT };
}

// SOW-087: the moderation word-list gate for syndication. house/moderation-flags.yml holds named term lists
// (political, profanity, and any future list); flagText scans a queue item's POSTED surface (title + blurb)
// and returns the names of every list with a hit. A flagged item always waits for superadmin approval
// (membership/syndication-queue.mjs isDue), even when require_approval is off.
//
// Node-free + pure (no fs, no IO): callers parse the YAML themselves (the enqueue runner from the working
// copy, the admin editor via the reader). Matching is case-insensitive on whole words; a multi-word term
// matches as a phrase; terms never act as regexes (they are escaped).

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parse raw parsed-YAML ({ lists: { name: [terms] } } or a bare map of lists) into a clean
 * { name: [terms] } object. Drops non-string/empty terms and empty/malformed lists. Never throws.
 */
export function moderationFlagsFromParsed(parsed) {
  const out = {};
  const src = parsed && typeof parsed === 'object' ? (parsed.lists ?? parsed) : {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [name, terms] of Object.entries(src)) {
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(terms)) continue;
    const clean = [];
    const seen = new Set();
    for (const t of terms) {
      const term = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      clean.push(term);
    }
    out[name.trim()] = clean;
  }
  return out;
}

/** One whole-word, case-insensitive matcher per list. A term with spaces matches as a phrase. */
function listMatcher(terms) {
  const parts = terms.map((t) => escapeRe(t.toLowerCase()).replace(/\s+/g, '\\s+'));
  return new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?:[^a-z0-9]|$)`, 'i');
}

/**
 * The names of every list with a hit in `text`, sorted for a stable order. An empty/missing config or a
 * blank text flags nothing. Pure.
 */
export function flagText(parsed, text) {
  const lists = moderationFlagsFromParsed(parsed);
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return [];
  const hits = [];
  for (const [name, terms] of Object.entries(lists)) {
    if (terms.length && listMatcher(terms).test(hay)) hits.push(name);
  }
  return hits.sort();
}

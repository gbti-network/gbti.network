// SOW-063: the pure, node-testable core for the new-tab landing splash. The extension (newtab.mjs) wires these into
// the DOM; this module holds NO DOM and NO chrome APIs, so it unit-tests like client-ui/src/feed-route.mjs. It owns
// the 12-hour quote rotation, the snooze decision, and the bundled fail-soft quote set.

// The fail-soft bundled quote set. This is also the P2 git-native seed (house/quotes.yml). Each { text, author }.
export const BUNDLED_QUOTES = [
  { text: 'Focus can be knowing when to say no.', author: 'Steve Jobs' },
  { text: 'The successful warrior is the average man, with laser-like focus.', author: 'Bruce Lee' },
  { text: 'Where focus goes, energy flows.', author: 'Tony Robbins' },
  { text: 'What you seek is seeking you.', author: 'Rumi' },
  { text: "You will never be able to escape from your heart. So it is better to listen to what it has to say.", author: 'Paulo Coelho' },
  { text: 'In matters of style, swim with the current; in matters of principle, stand like a rock.', author: 'Thomas Jefferson' },
  { text: 'The enemy of art is the absence of constraints.', author: 'Orson Welles' },
  { text: 'The only real test of intelligence is if you get what you want out of life.', author: 'Naval Ravikant' },
  { text: 'Nature does not hurry, yet everything is accomplished.', author: 'Lao Tzu' },
];

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

/** Normalize an arbitrary quotes array to the ENABLED, well-formed set ({text, author}). Drops blank + disabled. */
export function enabledQuotes(quotes) {
  if (!Array.isArray(quotes)) return [];
  return quotes
    .filter((q) => q && q.enabled !== false && String(q.text || '').trim() && String(q.author || '').trim())
    .map((q) => ({ text: String(q.text).trim(), author: String(q.author).trim() }));
}

/** Deterministic 12-hour-bucketed pick over the enabled set: every tab in the same 12h window shows the same quote,
 *  and it advances to the next every 12 hours. Returns a {text, author}, or null when there is no usable quote. */
export function pickQuote(quotes, now = Date.now()) {
  const list = enabledQuotes(quotes);
  if (!list.length) return null;
  const bucket = Math.floor(now / TWELVE_HOURS_MS);
  return list[((bucket % list.length) + list.length) % list.length];
}

/** Whether a bare new tab should show the splash. true when there is no prior decision, the window is 0 (always
 *  show), or the snooze window has lapsed. `decision` = { dest, at } | null; `windowMs` in ms. */
export function shouldShowSplash(decision, now = Date.now(), windowMs = DEFAULT_WINDOW_MS) {
  if (!windowMs) return true; // 0 = always show the splash
  if (!decision || typeof decision.at !== 'number') return true;
  return now - decision.at >= windowMs;
}

/** Map a snoozed card destination to its in-page type-filter hash (reuses the SOW-042 hash vocabulary). 'workbench'
 *  is a different page (it navigates away, it is not an in-page feed), so it has no hash here. */
export function splashDestHash(dest) {
  return dest === 'news' ? '#type=news' : '#type=all';
}

// sow-371: the name of the publication a news story came from, as a reader should see it.
//
// A source's id is a slug we generated at import time and it is not always readable. The Verge's id is
// literally `object-object`, from a bad import that has been in house/news-sources.yml ever since, and the
// story page and the news feed both printed that id under the headline: "NEWS · OBJECT-OBJECT".
//
// THE ID IS NOT FIXABLE IN PLACE. Every stored news item carries its source id, the follow preferences key
// on it, and the filter links carry it. Renaming the id would orphan all of that for one cosmetic gain. The
// pool already carries the right answer beside it (`name: The Verge`); nothing was reading it.
//
// The weekly digest hit this first and solved it there (membership/mail-compile-core.mjs resolves a
// sourceName during the gather, and mail-render.mjs carries the note about a delivered issue showing
// `object-object` under a Verge headline). This is the same fix for the two surfaces on the website, in one
// place so they cannot drift apart the way the summary logic did.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Build the id -> display name map once from the published sources artifact, so a list of 126 sources is not
 * re-scanned per row. Tolerates a missing or malformed payload by returning an empty map, which makes every
 * lookup fall back to the id: the same thing a reader sees today, never worse.
 */
export function sourceNameMap(sources) {
  const list = Array.isArray(sources) ? sources : Array.isArray(sources?.sources) ? sources.sources : [];
  const map = new Map();
  for (const s of list) {
    const id = str(s?.id);
    const name = str(s?.name);
    if (id && name) map.set(id, name);
  }
  return map;
}

/**
 * What to print for a story's source. The publication's name when we know it, the id when we do not.
 *
 * FALLING BACK TO THE ID IS DELIBERATE and is why this is not simply "hide unreadable ids". A source that
 * has left the pool still has stories in the window, and printing nothing under those headlines would lose
 * the attribution entirely. An ugly id is a smaller failure than an unattributed story.
 */
export function newsSourceName(id, names) {
  const key = str(id);
  if (!key) return '';
  const map = names instanceof Map ? names : sourceNameMap(names);
  return map.get(key) || key;
}

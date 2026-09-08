// sow-307: the one decision the personalization panel makes about followed tags that is worth a test: what to
// do on the FIRST signed-in load, when the browser holds a list (tags followed before the account stored them,
// or before signing in) and the account holds another.
//
// Rule: the account wins whenever it holds anything. Only an EMPTY account adopts the browser's list, and that
// adoption is pushed up once so the next device sees it. Nothing is merged: a member who cleared their account
// list on another device must not have this browser's stale list quietly re-added on the next visit here.
//
// Tags are normalized with the SAME rule the Worker stores them under (membership/member-prefs.mjs), so what
// the panel shows and what the account holds cannot disagree by a '#' or a capital letter.
import { cleanTags } from '../../membership/member-prefs.mjs';

/**
 * @param browser  the list from local storage (may be anything; junk is dropped)
 * @param account  the list from the member's prefs (may be undefined when the record predates this)
 * @returns {{ tags: string[], push: string[] | null }} `tags` is what the panel and the feed use from now on;
 *          `push` is the list to write to the account, or null when the account already holds the truth.
 */
export function mergeTagsOnFirstSync(browser, account) {
  const acc = cleanTags(account);
  if (acc.length) return { tags: acc, push: null };
  const local = cleanTags(browser);
  if (local.length) return { tags: local, push: local };
  return { tags: [], push: null };
}

/** The panel's toggle, applied locally with the Worker's rule; null when the cap would be exceeded. */
export function toggleTagLocally(tags, tag, on, cap = 50) {
  const t = cleanTags([tag])[0];
  if (!t) return cleanTags(tags);
  const current = cleanTags(tags);
  if (!on) return current.filter((x) => x !== t);
  if (current.includes(t)) return current;
  if (current.length >= cap) return null;
  return [...current, t];
}

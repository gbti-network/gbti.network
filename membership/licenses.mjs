// sow-305: reading house/licenses.yml, the controlled list of licences a project may declare.
//
// Node-free and pure over the already-parsed document, like membership/ai-tools.mjs beside it, so the build
// validator, the editor field, the page renderer and the tests all read the list the same way.
//
// THE KEY IS THE STORED VALUE AND THE LABEL. An SPDX identifier is already the form a reader recognises, so
// unlike the AI-tool list there is nothing to translate between what is written and what is shown.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The two entries that are not SPDX identifiers, and behave differently when the row is built. */
export const PROPRIETARY = 'Proprietary';
export const CUSTOM = 'Custom';

/**
 * Every allowed licence as { id, url }, in file order. `url` is null when there is no public page to link to,
 * which is true of Proprietary and Custom by design.
 */
export function licenseEntries(doc) {
  const src = isObj(doc) ? doc.licenses : null;
  if (!isObj(src)) return [];
  const out = [];
  for (const [id, value] of Object.entries(src)) {
    const key = String(id || '').trim();
    if (!key) continue;
    const url = isObj(value) ? String(value.url ?? '').trim() : '';
    out.push({ id: key, url: /^https:\/\//i.test(url) ? url : null });
  }
  return out;
}

/** The allowed identifiers, which is what a project's `license` must match exactly. */
export const licenseIds = (doc) => licenseEntries(doc).map((l) => l.id);

/** The public page for a licence, or null. Pure. */
export function licenseUrlFor(id, doc) {
  const want = String(id ?? '').trim();
  return licenseEntries(doc).find((l) => l.id === want)?.url ?? null;
}

/**
 * What is wrong with a project's licence fields, as plain sentences. Empty means nothing is wrong.
 *
 * CASE-INSENSITIVE SUGGESTION, EXACT MATCH, the same bargain as the AI-tool list: "mit" is refused, because
 * accepting it is how one licence becomes two spellings, but the message names the identifier that would have
 * worked rather than making the author search a file for it.
 *
 * CUSTOM REQUIRES A LINK. That is the whole point of choosing Custom: it says the terms are ours, and a reader
 * with no way to read them has been told nothing. A licence with a public page needs no link, because the row
 * finds it in the list.
 */
export function licenseProblems({ license, licenseUrl } = {}, doc) {
  const value = typeof license === 'string' ? license.trim() : '';
  const link = typeof licenseUrl === 'string' ? licenseUrl.trim() : '';
  const entries = licenseEntries(doc);

  if (!value) {
    // Declaring a link without a licence is a half-filled form, not a licence. Caught here because the field is
    // always visible: the alternative, hiding it until Custom is chosen, is what silently drops a value on save.
    return link ? ['licenseUrl is set but license is not, so nothing links to it'] : [];
  }
  if (!entries.length) return []; // no vocabulary to check against; the caller reports that separately

  const byLower = new Map(entries.map((l) => [l.id.toLowerCase(), l.id]));
  const out = [];
  if (byLower.get(value.toLowerCase()) !== value) {
    const near = byLower.get(value.toLowerCase());
    out.push(near
      ? `license "${value}" is spelled differently from the list: write "${near}"`
      : `license "${value}" is not in house/licenses.yml. Add it there, or use one of: ${entries.map((l) => l.id).join(', ')}`);
    return out; // one problem at a time; the rules below are about a licence we recognise
  }
  if (value === CUSTOM && !link) out.push('license "Custom" needs licenseUrl, a link to the licence text');
  if (link && !/^https:\/\//i.test(link)) out.push('licenseUrl must be an https link');
  return out;
}

/**
 * The licence row a project page shows: { id, href } or null when there is nothing to say.
 *
 * THE AUTHOR'S PICK ALWAYS WINS over what GitHub reports (owner, 2026-09-14). Detection exists to fill the row
 * for a project whose author has not got to it, never to overrule one who has.
 *
 * A licence GitHub cannot identify arrives as NOASSERTION and is treated as NO detection, deliberately: it means
 * "there is a file and we do not know what it is", which is not something to print at a reader.
 *
 * WHERE IT LINKS, in the owner's order of preference:
 *   1. the repository's own licence file, whenever GitHub found one (detected or not, it is the real terms),
 *   2. the author's licenseUrl, which is the only answer for Custom,
 *   3. the standard page for that licence,
 *   4. nothing, which is Proprietary with no file: plain text.
 */
export function licenseRow({ license, licenseUrl, detected, repoLicenseHref } = {}, doc) {
  const picked = typeof license === 'string' ? license.trim() : '';
  const found = typeof detected === 'string' && detected.trim() && detected.trim().toUpperCase() !== 'NOASSERTION'
    ? detected.trim() : '';
  const id = picked || found;
  if (!id) return null;
  // An unknown identifier is refused rather than printed: the build rejects one from an author, and a value
  // GitHub invented is not something to put on the page either.
  if (!licenseIds(doc).includes(id)) return null;

  const repoHref = typeof repoLicenseHref === 'string' && /^https:\/\//i.test(repoLicenseHref) ? repoLicenseHref : '';
  const authorHref = typeof licenseUrl === 'string' && /^https:\/\//i.test(licenseUrl.trim()) ? licenseUrl.trim() : '';
  if (id === CUSTOM) return { id, href: authorHref || repoHref || null };
  if (id === PROPRIETARY) return { id, href: repoHref || authorHref || null };
  return { id, href: repoHref || authorHref || licenseUrlFor(id, doc) };
}

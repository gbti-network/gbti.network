// sow-368: reading house/ai-tools.yml, the controlled list of tools a prompt may say it runs on.
//
// Node-free and pure over the already-parsed document, like membership/topics-vocab.mjs beside it, so the
// build validator, the editor field and the tests all read the list the same way.
//
// THE LABEL IS THE CANONICAL FORM. See the header of house/ai-tools.yml for why this file differs from the
// topic vocabulary, which keys by slug: a target is written into the content, rendered as the chip and
// carried in the filter link, so the displayed string IS the stored value.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every allowed tool as { key, label }, in file order. An entry with no usable label is DROPPED rather than
 * falling back to its key: a malformed line must not quietly become a valid answer that nothing renders.
 */
export function aiToolEntries(doc) {
  const tools = isObj(doc) ? doc.tools : null;
  if (!isObj(tools)) return [];
  const out = [];
  for (const [key, value] of Object.entries(tools)) {
    const label = isObj(value) ? String(value.label ?? '').trim() : '';
    if (!key || !label) continue;
    out.push({ key: String(key), label });
  }
  return out;
}

/** The allowed labels, which is what a prompt's `targets` entry must match exactly. */
export const aiToolLabels = (doc) => aiToolEntries(doc).map((t) => t.label);

/**
 * What is wrong with a prompt's targets list, as plain sentences. Empty means nothing is wrong.
 *
 * CASE-INSENSITIVE SUGGESTION, EXACT MATCH. "claude code" is refused, because accepting it is how one tool
 * becomes two filter buttons, but the message names the spelling that would have worked rather than making
 * the author search the file for it. That is the difference between a guard that teaches and one that
 * merely blocks.
 */
export function targetProblems(targets, doc) {
  if (targets === undefined || targets === null) return [];
  if (!Array.isArray(targets)) return ['targets must be a list of tool names'];
  const entries = aiToolEntries(doc);
  if (!entries.length) return []; // no vocabulary to check against; the caller reports that separately
  const byLower = new Map(entries.map((t) => [t.label.toLowerCase(), t.label]));
  const out = [];
  const seen = new Set();
  for (const raw of targets) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) { out.push('targets carries an empty entry'); continue; }
    if (byLower.get(value.toLowerCase()) === value) {
      if (seen.has(value)) out.push(`targets names "${value}" twice`);
      seen.add(value);
      continue;
    }
    const near = byLower.get(value.toLowerCase());
    out.push(near
      ? `target "${value}" is spelled differently from the list: write "${near}"`
      : `target "${value}" is not in house/ai-tools.yml. Add it there, or use one of: ${entries.map((t) => t.label).join(', ')}`);
  }
  return out;
}

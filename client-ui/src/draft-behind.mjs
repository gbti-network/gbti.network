// sow-482: what the WorkBench says and decides when a saved draft is behind the published article (owner,
// 2026-10-26: "we need a way to know if the draft is behind and promenantly offer to discard it"). The editor
// element is browser-only, so the parts worth testing live here: node-free, no DOM, the client injected.
//
// The warning returns on every open while the draft is behind (owner, 2026-10-27: "if we refresh the page and it is
// still behind, we need a way to determine if we want to clear the session"), so a save never moves a draft's base
// forward. It ends when the author discards the draft or publishes it.

import { baseOf, draftBehind } from '../../client/src/content-base.mjs';

/**
 * The base a draft saved before markers existed is given once it has been found behind. It matches no real file,
 * so the draft keeps reading as behind after its next save, when its save time would otherwise pass the article's.
 */
export const BEHIND_BASE = '0000000000000000';

const NOUN = { post: 'article', project: 'project', product: 'project', prompt: 'prompt' };
/** The word for the published thing, by content type. */
export const itemNoun = (type) => NOUN[type] || 'item';

const time = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

/** "October 27 at 2:00 AM" in the reader's own locale and time zone, or '' for no date. */
export function fmtWhen(value) {
  const t = time(value);
  if (t == null) return '';
  try { return new Date(t).toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

/**
 * The behind banner's sentence. The dates are named only when they are true as written: after a re-save the draft's
 * save time passes the article's change, and "changed after this draft was saved" would then be false.
 */
export function behindMessage({ publishedAt, savedAt, type } = {}, fmt = fmtWhen) {
  const noun = itemNoun(type);
  const pub = time(publishedAt);
  const saved = time(savedAt);
  const tail = 'This draft does not have those changes.';
  if (pub != null && saved != null && pub > saved) return `The published ${noun} changed on ${fmt(publishedAt)}, after this draft was saved on ${fmt(savedAt)}. ${tail}`;
  if (pub != null) return `The published ${noun} changed on ${fmt(publishedAt)}, after this draft was started. ${tail}`;
  return `The published ${noun} changed after this draft was started. ${tail}`;
}

/** The refusal a publish shows when the published version changed after this editor opened it. */
export const staleMessage = (type) => `The published ${itemNoun(type)} changed after you opened this. Publishing now would replace those changes.`;

/**
 * "Publish anyway" asks first. The refusal appears above the editor and pushes it down, and at desktop width a second
 * press of Publish lands on "Publish anyway" (measured in the component harness), so one stray click must not be
 * enough to write over the published version.
 */
export const forceConfirmMessage = (type) => `Publish anyway? The changes made to the published ${itemNoun(type)} since you opened this are replaced.`;

/** The work list's line when a draft's publish was refused for the same reason. */
export const staleDraftRowMessage = (type) => `The published ${itemNoun(type)} changed after this draft was saved, so it was not published. Open the draft to see what changed.`;

/**
 * The editor's "open the published version", from the behind banner or a refused publish, done for the workspace
 * (`ws`, the <gbti-workspace> element) so its own file stays at its size. A staged draft is discarded first (the
 * editor has already asked), or the next open would bring the same draft back. A failure is shown in the editor.
 */
export async function openPublishedInto(ws, { discard = false } = {}) {
  const e = ws?._editing;
  if (!e?.path) return;
  try {
    if (discard && e.draftKey) await ws.client.discardDraft(e.draftKey);
    ws._drafts = null;
    ws._overview = null;
    const full = await ws.client.getContentItem({ path: e.path });
    ws._editing = { type: e.type, frontmatter: full.frontmatter, body: full.body, path: e.path, skillFile: typeof full.skillFile === 'string' ? full.skillFile : null, base: typeof full.base === 'string' ? full.base : null };
    ws._writeHash(`#tab=${encodeURIComponent(ws._tab)}&edit=${encodeURIComponent(e.path)}`);
    ws.render();
  } catch (err) {
    ws.$?.('gbti-content-editor')?.showProblem?.(err?.message || 'Could not open the published version. Reload the page and try again.');
  }
}

/**
 * Open-time check for a saved draft: is it behind, and which base should the editor carry from here?
 * `full` is the readDraft result, `d` the draft row. A draft kept in the repository (store 'repo') IS the committed
 * file, and a draft of an item never published has nothing to fall behind. Reads the committed item and its last
 * change; when the committed item cannot be read nothing is claimed, so a failed read never raises a false warning.
 * @returns {Promise<{ behind: null | { publishedAt: string|null, savedAt: string|null }, base: string|null }>}
 */
export async function checkDraftBehind(client, full, d) {
  let base = baseOf(full?.base);
  const path = full?.path || d?.path || '';
  if (!path || d?.store === 'repo' || typeof client?.getContentItem !== 'function') return { behind: null, base };
  const [committed, stats] = await Promise.all([
    Promise.resolve().then(() => client.getContentItem({ path })).catch(() => null),
    typeof client.itemStats === 'function' ? Promise.resolve().then(() => client.itemStats({ path })).catch(() => null) : null,
  ]);
  if (!committed) return { behind: null, base };
  const committedBase = baseOf(committed.base);
  const lastAt = typeof stats?.lastAt === 'string' ? stats.lastAt : null;
  const savedAt = typeof full?.savedAt === 'string' ? full.savedAt : null;
  if (draftBehind({ base, savedAt, committedBase, lastAt })) return { behind: { publishedAt: lastAt, savedAt }, base: base || BEHIND_BASE };
  // A draft saved before markers existed, and found current by its dates, takes the committed version as its start
  // from here on. Without both dates nothing was established, so it stays unmarked and is checked again next open.
  if (!base && lastAt && savedAt) base = committedBase;
  return { behind: null, base };
}

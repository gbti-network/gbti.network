// sow-482 (owner, 2026-10-26: "we need a way to know if the draft is behind and promenantly offer to discard it"): a
// draft remembers which published version it started from, so the WorkBench can tell a draft that is ahead of the
// published article from one the article has moved past, and a publish can refuse to write over a newer version.
//
// The version is a hash of the committed index.md text. Every publish rewrites that file (the editor stamps updatedAt,
// client-ui/src/elements/editor-actions.mjs), so any publish changes it, and the client already reads the text, so no
// extra request is needed to compute it. Pure and shared: the website client, the editor and the tests import it.

const HEX = /^[0-9a-f]{16}$/;

/** The version marker of a committed file's text: the first 16 hex characters of its SHA-256. */
export async function contentBase(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A valid stored marker, or null. */
export const baseOf = (v) => (typeof v === 'string' && HEX.test(v) ? v : null);

const time = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

/**
 * Is a saved draft behind the published article? `base` is the version the draft started from and `committedBase` the
 * version on main now. A draft saved before markers existed has no base, so the dates decide: the article's last
 * change (`lastAt`, from the commit history) came after the draft was saved (`savedAt`). A draft of an item that was
 * never published has neither a committed version nor a last change, so it is never behind.
 */
export function draftBehind({ base, savedAt, committedBase, lastAt } = {}) {
  if (baseOf(base) && baseOf(committedBase)) return base !== committedBase;
  const saved = time(savedAt);
  const changed = time(lastAt);
  return saved != null && changed != null && changed > saved;
}

/**
 * Why a publish must stop before writing, or null. `bases` are the versions the editor may write over: the one it
 * opened, and, just after its own publish, the one it committed (main can still show the older until the merge lands).
 * An editor that sends none (an older client, a new item) is not checked; `force` is the author's "Publish anyway".
 */
export function publishBaseProblem({ bases, committedBase, force = false } = {}) {
  const allowed = (Array.isArray(bases) ? bases : [bases]).map(baseOf).filter(Boolean);
  if (force || !allowed.length || !baseOf(committedBase)) return null;
  return allowed.includes(committedBase) ? null : 'The published article changed after this edit began. Publishing now would replace those changes.';
}

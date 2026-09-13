// sow-330: the pure decisions behind "saves and collections started on the website stay on the website".
//
// Owner rule, 2026-09-12: "All save and collection behavior initiated from the website will stay on the website."
// A heart (<gbti-favorite>) or Save pill (<gbti-collection>) click that happens BEFORE the control has upgraded
// meets one of three situations, and this file decides which, so the browser half (save-controls.ts) holds no
// judgement of its own and every branch is unit-tested:
//
//   - nobody is signed in on the website: remember the save the visitor started, and let the website sign-in dialog
//     open. After sign-in returns them to the page, the save completes (owner decision, 2026-09-12).
//   - a website session cookie is present but the page does not yet know who it belongs to (the upgrade window):
//     HOLD the click and replay it once the session resolves. A signed-in member must never be shown sign-in for
//     clicking early (owner: "this problem should not exist").
//   - the control has already upgraded: nothing to do; its own click handler runs.
//
// THE REMEMBERED SAVE IS NEVER A URL. It lives in sessionStorage, written only by the site's own click handler, and
// is honoured only when it is well-formed, for this exact page, fresh, and names a control present on the page. A
// crafted link therefore cannot make a signed-in member save anything: there is no parameter to craft.
//
// A REPLAY NEVER TURNS A FAVORITE OFF. The heart is a toggle, so replaying a click on an item the member already
// favorited would remove it. replayAction only ever favorites an item that is not favorited, and only ever OPENS the
// collection picker (the member chooses the collection; nothing is guessed).

export const PENDING_SAVE_KEY = 'gbti_pending_save_v1';
export const PENDING_SAVE_TTL_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;

const KINDS = new Set(['favorite', 'collect']);
const TYPES = new Set(['post', 'project', 'prompt', 'share']);
// A content slug, or a share slug (`<author>/<id>`). No leading dot or slash, no traversal, no spaces.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/;

/** The CSS selector for an inert (not yet upgraded) save control's click target. */
export const SAVE_TRIGGER_SELECTOR = 'gbti-favorite [data-signin], gbti-collection [data-signin]';

const str = (v) => (typeof v === 'string' ? v : '');

/** The save a control represents, from its host element (`tagName` + `dataset`), or null when it names nothing. */
export function intentFromControl(host) {
  if (!host) return null;
  const tag = str(host.tagName).toLowerCase();
  const kind = tag === 'gbti-collection' ? 'collect' : tag === 'gbti-favorite' ? 'favorite' : '';
  const type = str(host.dataset?.gbtiTargetType);
  const slug = str(host.dataset?.gbtiTargetSlug);
  if (!KINDS.has(kind) || !TYPES.has(type) || !SLUG_RE.test(slug)) return null;
  return { kind, type, slug };
}

/**
 * A remembered save, validated against the page it is being read on. Returns `{ intent }` when it may be completed
 * here, `{ reason, discard }` otherwise. `discard` says whether the stored value should be removed: malformed and
 * expired values are; a well-formed save remembered on ANOTHER page is left for that page.
 */
export function checkPendingSave(raw, { path, now }) {
  let v = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return { reason: 'malformed', discard: true }; } }
  if (!v || typeof v !== 'object') return { reason: 'malformed', discard: true };
  const intent = { kind: str(v.kind), type: str(v.type), slug: str(v.slug) };
  if (!KINDS.has(intent.kind) || !TYPES.has(intent.type) || !SLUG_RE.test(intent.slug)) return { reason: 'malformed', discard: true };
  if (typeof v.path !== 'string' || !v.path.startsWith('/')) return { reason: 'malformed', discard: true };
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return { reason: 'malformed', discard: true };
  if (v.at > now + FUTURE_SKEW_MS) return { reason: 'malformed', discard: true };
  if (now - v.at > PENDING_SAVE_TTL_MS) return { reason: 'expired', discard: true };
  if (v.path !== path) return { reason: 'other-page', discard: false };
  return { intent };
}

/** Remember a save the visitor started on `path`. Never throws (storage can be unavailable). Returns success. */
export function storePendingSave(storage, intent, { path, now }) {
  if (!storage || !intent || !KINDS.has(intent.kind) || !TYPES.has(intent.type) || !SLUG_RE.test(intent.slug)) return false;
  try {
    storage.setItem(PENDING_SAVE_KEY, JSON.stringify({ kind: intent.kind, type: intent.type, slug: intent.slug, path, at: now }));
    return true;
  } catch { return false; }
}

/**
 * Take the remembered save for this page, one-shot: a valid one is REMOVED before it is returned, so it completes
 * at most once even if completing it fails. Malformed or expired values are removed and ignored.
 */
export function takePendingSave(storage, { path, now }) {
  if (!storage) return null;
  let raw;
  try { raw = storage.getItem(PENDING_SAVE_KEY); } catch { return null; }
  if (raw == null) return null;
  const r = checkPendingSave(raw, { path, now });
  if (r.intent || r.discard) { try { storage.removeItem(PENDING_SAVE_KEY); } catch { /* best effort */ } }
  return r.intent || null;
}

/**
 * What to do with a click on a save control that has not upgraded yet.
 *   'pass'   the control is ready; its own handler runs.
 *   'signin' nobody is signed in on the website: remember the save and let the sign-in dialog open.
 *   'hold'   a website session may be present and is not resolved yet: hold the click and replay it.
 * `sessionState` is 'pending' | 'signed-in' | 'signed-out'.
 */
export function holdDecision({ csrf, sessionState, controlsReady }) {
  if (controlsReady) return 'pass';
  if (!csrf) return 'signin';
  if (sessionState === 'signed-out') return 'signin';
  return 'hold';
}

/**
 * The single replay routine for a held click and a remembered save, once the control is upgraded.
 *   'favorite'    click the heart (it is not favorited, so the click favorites it)
 *   'open-picker' open the collection picker (the member chooses the collection)
 *   'none'        nothing to do: already favorited, the picker is already open, or an unknown kind
 * Never returns an action that removes a favorite.
 */
export function replayAction({ kind, favorited = false, pickerOpen = false }) {
  if (kind === 'favorite') return favorited ? 'none' : 'favorite';
  if (kind === 'collect') return pickerOpen ? 'none' : 'open-picker';
  return 'none';
}

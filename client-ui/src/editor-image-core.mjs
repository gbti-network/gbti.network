// The words an image field says about itself when its upload has not happened, and the Publish message for a
// required image that is still empty. Pure, so node --test covers them; the DOM half is in elements/editor-media.mjs.
//
// Why this exists (reported 2026-10-16 from a member's new project): an image picked before the item had a permalink
// was shown in the field but never uploaded, because the website stores an upload under the item it belongs to and an
// item with no permalink has no name yet. The refusal was printed at the bottom of the page and Publish overwrote it,
// so the project failed with "icon: Invalid input; featuredImage: Invalid input", and an article or prompt quietly
// published without its picture.

/** Shown on a field holding a picked image until the item has a permalink. */
export const HELD_NOTE = 'Uploads when you save or publish.';

/** Shown on a field whose upload failed, after the picture has gone back to what was there before. */
export function notUploadedNote(reason) {
  const r = String(reason || '').trim();
  return r ? `Not uploaded. ${r}` : 'Not uploaded. Choose it again.';
}

/** Publish (and Save draft) refuse to upload held images before the item has a permalink. */
export const NEEDS_PERMALINK = 'Add a permalink first. The images you picked upload once this item has one.';

/** A held image that failed to upload when Publish or Save draft tried it. */
export function heldUploadFailed(label, reason) {
  const what = String(label || 'An image').trim();
  const r = String(reason || '').trim().replace(/[.\s]+$/, ''); // the reason's own full stop would double ours
  return `${what} could not be uploaded${r ? `: ${r}` : ''}. Choose it again.`;
}

/**
 * The Publish message for required image fields that are still empty, by their labels in form order. '' when none.
 * Names every one, so an author who is missing two is not sent round the loop twice.
 */
export function missingImagesMessage(labels) {
  const list = (Array.isArray(labels) ? labels : []).map((l) => String(l || '').trim()).filter(Boolean);
  if (!list.length) return '';
  const quoted = list.map((l) => `"${l}"`);
  const joined = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `Choose an image for ${joined} before publishing.`;
}

// sow-428: member avatars in the shared components, one way everywhere.
//
// - The PHOTO is addressed by the member's folder (their GBTI name) at gbti.network/avatar/<folder>, which redirects
//   to the picture for their GitHub ACCOUNT NUMBER (membership/member-avatar.mjs). Never github.com/<name>.png: a
//   folder can be a name some unrelated GitHub account holds.
// - The BLOBATAR (membership/member-blob.mjs) is drawn underneath, seeded by the same folder, so a member without a
//   photo, or whose photo fails, still has one face on every surface. Owner, 2026-09-30: "We can use blobatar library
//   for anyone who does not have a linked avatar."
//
// The two layers fill whatever frame the component draws (position:relative; overflow:hidden). A photo that fails is
// removed by one capture-phase listener installed on every component's shadow root (base.mjs), because extension
// pages forbid inline `onerror` handlers.
import { memberAvatarUrl } from '../../membership/member-avatar.mjs';
import { memberBlob } from '../../membership/member-blob.mjs';

export { memberAvatarUrl, memberBlob };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The CSS both layers need, included in every component's base CSS. */
export const AVATAR_LAYER_CSS = `img[data-blob], img[data-avphoto] { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; border:0; margin:0; max-width:none; }`;

/**
 * The blobatar layer and, when there is one, the photo layer, as markup for a frame the caller draws. `seed` is the
 * member's folder (a display name only when no folder is known). `photo` defaults to the folder's avatar address;
 * pass '' for none, or a URL (a profile Gravatar, a news favicon) to use instead.
 */
export function avatarLayers(seed, photo) {
  const src = photo === undefined ? memberAvatarUrl(seed) : String(photo || '');
  return `<img data-blob src="${esc(memberBlob(seed))}" alt="" aria-hidden="true">`
    + (src ? `<img data-avphoto src="${esc(src)}" alt="" loading="lazy">` : '');
}

/** Remove a photo layer that fails to load, so the blobatar under it shows. Returns the detach function. */
export function attachAvatarFallback(root) {
  if (!root || typeof root.addEventListener !== 'function') return () => {};
  const onError = (ev) => {
    const el = ev.target;
    if (el && el.tagName === 'IMG' && el.hasAttribute?.('data-avphoto')) el.remove();
  };
  root.addEventListener('error', onError, true);
  return () => root.removeEventListener('error', onError, true);
}

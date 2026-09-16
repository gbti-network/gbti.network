// sow-183: whether a signed-in identity may see a content-detail page's Edit affordance -- they own the item,
// or they are superadmin. Presentation only, matching every other use of the member signal (member-signal.ts):
// the SOW-005 gate (member content) and the Worker's authorizeSuperadmin (house / cross-folder content) are the
// real boundaries on publish, so a false positive here only offers a link, never a write.
//
// Node-free (no Astro types, no DOM) so it stays node --test-covered; relocated out of project-page.mjs (which
// used to be its only caller) now that every content-detail page (post/product/prompt) needs it, not just
// projects.
export function canEditItem(identity, owner) {
  if (!identity) return false;
  if (identity.role === 'superadmin') return true;
  return !!identity.login && !!owner && identity.login.toLowerCase() === String(owner).toLowerCase();
}

/**
 * sow-346: whether the signed-in identity IS the member whose profile page this is. Deliberately narrower than
 * canEditItem: the page's "Edit profile" link opens the viewer's OWN profile in the WorkBench, so showing it to a
 * superadmin on someone else's page would open the wrong profile. Case-insensitive, like GitHub logins.
 */
export function isOwnProfile(identity, username) {
  const login = identity?.username || identity?.login;
  return !!login && !!username && String(login).toLowerCase() === String(username).toLowerCase();
}

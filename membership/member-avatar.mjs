// sow-428: a member's avatar, addressed by their GBTI name (their folder) and served by their GitHub ACCOUNT
// NUMBER. Node-free, so the site, the shared components, the Worker's digest and the build all use this one copy.
//
// WHY NOT github.com/<name>.png. That address looks an account up by NAME. A folder is a GBTI name, and since sow-428
// it can differ from the member's GitHub login, so the name can belong to an unrelated GitHub account: the new
// member `mike-conley` (GitHub login loraxian666) would have shown a stranger's face. An account NUMBER never
// changes and never names anyone else.
//
// HOW. The build writes one redirect per enrolled member, `/avatar/<folder>` -> GitHub's picture for that member's
// account number (scripts/compose-redirects.mjs, from house/members-index.yml). Every surface uses the one address
// and needs no lookup of its own, including an email, whose client follows the redirect exactly as it already
// followed github.com/<login>.png. A folder that is not enrolled is a 404: the picture fails and the blobatar drawn
// underneath it (membership/member-blob.mjs) shows instead.

export const SITE = 'https://gbti.network';
export const AVATAR_ROUTE = '/avatar/';

// The network's own identity (gbtilabs, and the retired gbti and house authors): the gbti.labs Gravatar, the same
// picture src/lib/authors.ts GBTI_AVATAR shows on the site. Only the Gravatar HASH is public, never the email.
export const NETWORK_AVATAR = 'https://secure.gravatar.com/avatar/061a44e977c1338f8b6d2e0e36b36f1a?s=256&d=mm';
export const NETWORK_FOLDERS = Object.freeze(['gbtilabs', 'gbti', 'house']);

const FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RE = /^\d{1,20}$/;

/** A member folder as the members index writes it: lowercase letters, digits and hyphens. */
export function isFolder(v) {
  return FOLDER_RE.test(String(v ?? ''));
}

/** GitHub's picture for an account NUMBER, or '' for anything that is not one. */
export function idAvatarUrl(githubId, size = 128) {
  const id = String(githubId ?? '').trim();
  return ID_RE.test(id) ? `https://avatars.githubusercontent.com/u/${id}?s=${size}&v=4` : '';
}

/**
 * The avatar address for a member folder (`https://gbti.network/avatar/<folder>`), or '' for a value that is not a
 * folder. Case-folded, since folders are lowercase. `site` is '' for a same-origin path.
 */
export function memberAvatarUrl(folder, { site = SITE } = {}) {
  const f = String(folder ?? '').trim().toLowerCase();
  return isFolder(f) ? `${site}${AVATAR_ROUTE}${f}` : '';
}

/**
 * The redirect rows `[source, destination, status]` for every enrolled member plus the network identities. Takes
 * the parsed members index (Map<github_id, folder>, membership/hosted-author.mjs parseMembersIndex). 302, never 301:
 * a folder that is ever reassigned must not stay cached against its old account in every browser.
 */
export function memberAvatarRedirects(membersIndex) {
  const rows = NETWORK_FOLDERS.map((f) => [`${AVATAR_ROUTE}${f}`, NETWORK_AVATAR, 302]);
  const taken = new Set(NETWORK_FOLDERS);
  const entries = [...(membersIndex?.entries?.() ?? [])].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  for (const [id, folder] of entries) {
    const url = idAvatarUrl(id);
    if (!url || !isFolder(folder) || taken.has(folder)) continue;
    taken.add(folder);
    rows.push([`${AVATAR_ROUTE}${folder}`, url, 302]);
  }
  return rows;
}

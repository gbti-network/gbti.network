// Role resolution for the client (SOW-006), self-contained so the published package needs nothing outside
// client/. It reads the LOCAL repo's house/roles.yml to surface which admin/superadmin tools the signed-in
// user may see. This is UX gating only: the client reads roles but never decides privilege. Every admin
// action opens the appropriate house/cross-folder PR, and the SOW-005 gate + CODEOWNERS are the real
// boundary (a member who hand-edits roles to fake a capability still cannot merge it).

import yaml from 'js-yaml';

export const ROLE = Object.freeze({ member: 'member', moderator: 'moderator', admin: 'admin', superadmin: 'superadmin' });
const RANK = Object.freeze({ member: 0, moderator: 1, admin: 2, superadmin: 3 });

/** Build a github_id -> role Map from a parsed roles.yml ({ superadmins, admins, moderators }). */
export function rolesFromParsed(parsed) {
  const map = new Map();
  const assign = (list, role) => {
    for (const e of list ?? []) {
      const id = String(e?.github_id ?? e);
      if (id && id !== 'REPLACE_AT_M0') map.set(id, role);
    }
  };
  // weakest first so a more privileged listing wins on a duplicate id
  assign(parsed?.moderators, ROLE.moderator);
  assign(parsed?.admins, ROLE.admin);
  assign(parsed?.superadmins, ROLE.superadmin);
  return map;
}

export function roleOf(githubId, rolesMap) {
  return rolesMap.get(String(githubId)) ?? ROLE.member;
}

export function rank(role) {
  return RANK[role] ?? 0;
}

/** PURE: build the role Map from raw roles.yml TEXT (host-agnostic, used by both the node + extension hosts
 * via their reader). Missing/unparseable -> empty Map (everyone is a plain member). */
export function rolesFromText(text) {
  if (!text) return new Map();
  try {
    return rolesFromParsed(yaml.load(text));
  } catch {
    return new Map();
  }
}

export const canModerate = (role) => rank(role) >= RANK.moderator;       // deplatform/remove any content
export const canBanGrandfather = (role) => rank(role) >= RANK.admin;     // ban + grandfather
export const canManageRoles = (role) => rank(role) >= RANK.superadmin;   // assign/revoke roles

// Pure edits for the admin/superadmin tools (SOW-006). Each takes a PARSED object (from a house/*.yml or a
// content frontmatter) and returns a NEW parsed object with the change applied, so they are trivially
// unit-testable. The orchestration (read file -> apply edit -> serialize -> open PR) lives in admin-ops.mjs.
// These never enforce anything; the gate + CODEOWNERS do. They just produce the correct file contents.

import { ROLE } from './roles.mjs';

const idStr = (v) => String(v);

function listFrom(obj, key) {
  return Array.isArray(obj?.[key]) ? obj[key].map((e) => ({ ...e })) : [];
}

/** Append a ban to a parsed bans.yml ({ bans: [...] }). Throws if already present. */
export function addBan(parsed, { githubId, reason, at }) {
  const obj = { ...(parsed ?? {}) };
  const bans = listFrom(obj, 'bans');
  if (bans.some((b) => idStr(b.github_id) === idStr(githubId))) throw new Error(`already banned: ${githubId}`);
  bans.push({ github_id: idStr(githubId), reason: reason || 'banned', at: at ?? null });
  obj.bans = bans;
  return obj;
}

/** Remove a ban (unban). */
export function removeBan(parsed, githubId) {
  const obj = { ...(parsed ?? {}) };
  obj.bans = listFrom(obj, 'bans').filter((b) => idStr(b.github_id) !== idStr(githubId));
  return obj;
}

/** Append a grandfather grant to a parsed grandfathered.yml. until null = permanent. Throws if present. */
export function addGrandfather(parsed, { githubId, reason, at, until = null, login }) {
  const obj = { ...(parsed ?? {}) };
  const list = listFrom(obj, 'grandfathered');
  if (list.some((g) => idStr(g.github_id) === idStr(githubId))) throw new Error(`already grandfathered: ${githubId}`);
  list.push({ github_id: idStr(githubId), ...(login ? { login } : {}), reason: reason || 'grandfathered', at: at ?? null, until });
  obj.grandfathered = list;
  return obj;
}

export function removeGrandfather(parsed, githubId) {
  const obj = { ...(parsed ?? {}) };
  obj.grandfathered = listFrom(obj, 'grandfathered').filter((g) => idStr(g.github_id) !== idStr(githubId));
  return obj;
}

const ROLE_LISTS = Object.freeze({ [ROLE.superadmin]: 'superadmins', [ROLE.admin]: 'admins', [ROLE.moderator]: 'moderators' });

/**
 * Assign a role in a parsed roles.yml. Removes the github_id from every elevated list first (so a role is
 * never doubled), then adds it to the target list. role === 'member' just revokes (removes from all lists).
 */
export function assignRole(parsed, { githubId, role, login }) {
  if (role !== ROLE.member && !ROLE_LISTS[role]) throw new Error(`unknown role: ${role}`);
  const obj = { ...(parsed ?? {}) };
  for (const key of Object.values(ROLE_LISTS)) {
    obj[key] = listFrom(obj, key).filter((e) => idStr(e.github_id) !== idStr(githubId));
  }
  if (role !== ROLE.member) {
    const key = ROLE_LISTS[role];
    obj[key] = [...listFrom(obj, key), { github_id: idStr(githubId), ...(login ? { login } : {}) }];
  }
  return obj;
}

export function revokeRole(parsed, githubId) {
  return assignRole(parsed, { githubId, role: ROLE.member });
}

/** Deplatform a piece of content: force status -> draft in its frontmatter. */
export function setStatusDraft(frontmatter) {
  return { ...(frontmatter ?? {}), status: 'draft' };
}

// SOW-038: the PURE superadmin governance action core. Given the parsed override files (roles / bans /
// grandfathered) plus an action, each function returns { next, changed, audit } where `next` is the new parsed
// structure (the caller serializes + commits it via the normal SOW-005 PR flow), `changed` is false when the
// action is already satisfied (idempotent), and `audit` is an identity-minimal, deletable log entry. Node-free
// (no fs / no yaml) so it runs in the Worker, the client, and node tests, and so the SAME logic that the
// effective-status precedence reads (overrides-core.mjs) is the logic the superadmin panel writes.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced where it always was: split CODEOWNERS
// (roles.yml is superadmin-owned, bans/grandfathered are admin-owned) + the no-bypass branch protection + the
// metadata-only gate. A non-superadmin PR touching roles.yml is auto-rejected regardless of what this computes.
// Anti-escalation is therefore structural, not trusted from this module.

import { ROLE } from './overrides-core.mjs';

export class SuperadminActionError extends Error {}

const idOf = (e) => String(e?.github_id ?? '');
// role name -> the roles.yml list it lives in. 'member' is the absence of any privileged listing.
const ROLE_LIST = Object.freeze({ [ROLE.superadmin]: 'superadmins', [ROLE.admin]: 'admins', [ROLE.moderator]: 'moderators' });
const ALL_LISTS = ['superadmins', 'admins', 'moderators'];

function reqId(githubId) {
  const id = githubId != null ? String(githubId) : '';
  if (!id) throw new SuperadminActionError('githubId is required');
  return id;
}
function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new SuperadminActionError('invalid timestamp');
  return d.toISOString();
}
/** Identity-minimal audit entry (deletable; mirrors the SOW-024 erase-audit shape). */
function audit({ actor, action, target, detail = null, now } = {}) {
  return {
    at: isoOf(now),
    actor: actor ? { github_id: actor.githubId != null ? String(actor.githubId) : (actor.github_id != null ? String(actor.github_id) : null), login: actor.login ?? null } : null,
    action,
    target: target ? { github_id: target.githubId != null ? String(target.githubId) : null, login: target.login ?? null } : null,
    detail,
  };
}
// Deep clone so the input parsed object is NEVER mutated even if an entry ever gains a nested field (today the
// override entries are flat scalar records, but structuredClone keeps this defensive regardless).
const cloneList = (list) => (Array.isArray(list) ? list.map((e) => structuredClone(e)) : []);
// Normalize a free-text reason: an empty or whitespace-only reason falls back to the default (?? alone would
// keep an empty string, leaving the entry's reason blank).
const reasonOr = (reason, fallback) => (reason && String(reason).trim()) || fallback;
const cloneRoles = (r) => ({ superadmins: cloneList(r?.superadmins), admins: cloneList(r?.admins), moderators: cloneList(r?.moderators), ...stripLists(r) });
function stripLists(r) { const o = { ...(r || {}) }; for (const l of ALL_LISTS) delete o[l]; return o; } // preserve any other keys

/**
 * Set a github_id to EXACTLY one role. role='member' removes them from every privileged list. Switching roles
 * (admin -> superadmin) removes the old listing and adds the new. Idempotent. Touching roles.yml is
 * superadmin-only by CODEOWNERS; this only computes the edit.
 */
export function grantRole(parsedRoles, { githubId, login, role = ROLE.member }, ctx = {}) {
  const id = reqId(githubId);
  if (role !== ROLE.member && !ROLE_LIST[role]) throw new SuperadminActionError(`unknown role: ${role}`);
  const next = cloneRoles(parsedRoles);
  let changed = false;
  for (const list of ALL_LISTS) {
    const target = ROLE_LIST[role] === list;
    const has = next[list].some((e) => idOf(e) === id);
    if (target && !has) { next[list].push({ github_id: id, ...(login ? { login } : {}) }); changed = true; }
    else if (!target && has) { next[list] = next[list].filter((e) => idOf(e) !== id); changed = true; }
  }
  return { next, changed, audit: audit({ ...ctx, action: 'role.grant', target: { githubId: id, login }, detail: { role } }) };
}

/** Revoke all privileged roles (-> member). Idempotent. */
export function revokeRole(parsedRoles, { githubId, login }, ctx = {}) {
  const r = grantRole(parsedRoles, { githubId, login, role: ROLE.member }, ctx);
  return { ...r, audit: audit({ ...ctx, action: 'role.revoke', target: { githubId: String(githubId), login } }) };
}

/** Ban a github_id (deplatform; overrides everything). Idempotent. */
export function ban(parsedBans, { githubId, login, reason }, ctx = {}) {
  const id = reqId(githubId);
  const list = cloneList(parsedBans?.bans);
  if (list.some((e) => idOf(e) === id)) {
    return { next: { ...(parsedBans || {}), bans: list }, changed: false, audit: audit({ ...ctx, action: 'ban', target: { githubId: id, login }, detail: { reason: reason ?? null, alreadyBanned: true } }) };
  }
  const r = reasonOr(reason, 'banned');
  list.push({ github_id: id, ...(login ? { login } : {}), reason: r, at: isoOf(ctx.now) });
  return { next: { ...(parsedBans || {}), bans: list }, changed: true, audit: audit({ ...ctx, action: 'ban', target: { githubId: id, login }, detail: { reason: r } }) };
}

/** Lift a ban. Idempotent. */
export function unban(parsedBans, { githubId, login }, ctx = {}) {
  const id = reqId(githubId);
  const list = cloneList(parsedBans?.bans);
  const next = list.filter((e) => idOf(e) !== id);
  return { next: { ...(parsedBans || {}), bans: next }, changed: next.length !== list.length, audit: audit({ ...ctx, action: 'unban', target: { githubId: id, login } }) };
}

/** Grandfather a github_id (counts as paid, no Stripe sub). `until` null = permanent; else an ISO date string. */
export function grandfather(parsedGf, { githubId, login, reason, until = null }, ctx = {}) {
  const id = reqId(githubId);
  if (until != null && until !== '' && Number.isNaN(new Date(until).getTime())) throw new SuperadminActionError('invalid until date');
  const list = cloneList(parsedGf?.grandfathered);
  const entry = { github_id: id, ...(login ? { login } : {}), reason: reasonOr(reason, 'complimentary access'), until: until ?? null };
  const i = list.findIndex((e) => idOf(e) === id);
  let changed;
  if (i >= 0) { changed = JSON.stringify(list[i]) !== JSON.stringify(entry); list[i] = entry; }
  else { list.push(entry); changed = true; }
  return { next: { ...(parsedGf || {}), grandfathered: list }, changed, audit: audit({ ...ctx, action: 'grandfather', target: { githubId: id, login }, detail: { reason: reason ?? null, until: until ?? null } }) };
}

/** Revoke a grandfather grant. Idempotent. */
export function revokeGrandfather(parsedGf, { githubId, login }, ctx = {}) {
  const id = reqId(githubId);
  const list = cloneList(parsedGf?.grandfathered);
  const next = list.filter((e) => idOf(e) !== id);
  return { next: { ...(parsedGf || {}), grandfathered: next }, changed: next.length !== list.length, audit: audit({ ...ctx, action: 'grandfather.revoke', target: { githubId: id, login } }) };
}

/**
 * The hide-via-schema moderation primitive (the SOW-035 cleanup fallback, formalized): flip a content item's
 * frontmatter so it leaves every public surface (status: draft excludes it from the build, indexes, and feeds;
 * visibility: members is belt-and-suspenders). Returns the merged frontmatter to commit; the git history is
 * preserved. `unhide` restores status: published. Pure: the caller writes the file via the PR flow.
 */
export function hideContent(frontmatter, { path } = {}, ctx = {}) {
  const next = { ...(frontmatter || {}), status: 'draft', visibility: 'members' };
  const changed = frontmatter?.status !== 'draft' || frontmatter?.visibility !== 'members';
  return { next, changed, audit: audit({ ...ctx, action: 'content.hide', target: null, detail: { path: path ?? null } }) };
}

export function unhideContent(frontmatter, { path } = {}, ctx = {}) {
  const next = { ...(frontmatter || {}), status: 'published' };
  const changed = frontmatter?.status !== 'published';
  return { next, changed, audit: audit({ ...ctx, action: 'content.unhide', target: null, detail: { path: path ?? null } }) };
}

// Pure, node-free overrides logic: roles, bans, grandfather grants, the github_id -> username map, and the
// effective-status precedence (ban > staff > grandfather > Stripe). Split out of overrides.mjs (which adds the
// node:fs I/O wrappers) so the SAME logic runs in the Cloudflare Worker (SOW-015 GET /membership/key), which
// cannot import node:fs. overrides.mjs re-exports everything here, so existing importers are unchanged.
// See .data/specs/roles-and-capabilities.md for the precedence rules.

export const ROLE = Object.freeze({
  member: 'member',
  moderator: 'moderator',
  admin: 'admin',
  superadmin: 'superadmin',
});

const PRIVILEGED_ROLES = new Set([ROLE.moderator, ROLE.admin, ROLE.superadmin]);
const ADMIN_ROLES = new Set([ROLE.admin, ROLE.superadmin]);

export function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.has(role);
}
export function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

const idOf = (entry) => String(entry?.github_id ?? entry);

/** Build a github_id -> role Map from a parsed roles.yml ({ superadmins, admins, moderators }). */
export function rolesFromParsed(parsed) {
  const roles = new Map();
  const assign = (list, role) => {
    for (const e of list ?? []) {
      const id = idOf(e);
      if (id && id !== 'REPLACE_AT_M0') roles.set(id, role);
    }
  };
  // Assign weakest first so a more privileged listing wins if an id appears twice.
  assign(parsed?.moderators, ROLE.moderator);
  assign(parsed?.admins, ROLE.admin);
  assign(parsed?.superadmins, ROLE.superadmin);
  return roles;
}

/** Build a Map of banned github_id -> entry from a parsed bans.yml ({ bans: [...] }). */
export function bansFromParsed(parsed) {
  const bans = new Map();
  for (const e of parsed?.bans ?? []) {
    const id = idOf(e);
    if (id) bans.set(id, e);
  }
  return bans;
}

/** Build a Map of grandfathered github_id -> entry from a parsed grandfathered.yml. */
export function grandfathersFromParsed(parsed) {
  const grandfathers = new Map();
  for (const e of parsed?.grandfathered ?? []) {
    const id = idOf(e);
    if (id) grandfathers.set(id, e);
  }
  return grandfathers;
}

/** Build a github_id -> username Map from a parsed members-index.yml ({ members: { id: username } }). */
export function membersIndexFromParsed(parsed) {
  const index = new Map();
  const members = parsed?.members ?? {};
  for (const [id, username] of Object.entries(members)) {
    if (id && username) index.set(String(id), String(username));
  }
  return index;
}

/**
 * Invert a github_id -> username Map to a lowercased-username -> github_id Map. Used by the payout job to
 * resolve a content author / comment author (stored as a username) back to the immutable github_id that
 * keys Stripe + Connect, so a later rename never misroutes a delegated payout.
 */
export function reverseMembersIndex(membersIndex) {
  const out = new Map();
  for (const [id, username] of membersIndex ?? []) {
    if (username != null) out.set(String(username).toLowerCase(), String(id));
  }
  return out;
}

/**
 * Consistency errors between override grants (bans / grandfathered / roles) and the github_id -> username
 * members-index. For each entry that carries BOTH a github_id and a login:
 *   - if the github_id is known in the index, its login must match the index username;
 *   - if the login is a known index username, its github_id must match the index id for that login.
 * A grant for an id/login NOT in the index (e.g. the gbtilabs bot, or a comp grant before the member has a
 * folder) is allowed and skipped (no contradiction). This catches a typo'd or swapped github_id<->login that
 * would otherwise FAIL CLOSED silently (the wrong id never matches the real member, so they get no access and
 * no error surfaces). Pure; the CI validator + a tripwire test feed it the parsed override files.
 * @param {Map<string,string>} membersIndex  github_id -> username
 * @param {Array<{github_id?:string|number, login?:string, _src?:string}>} entries
 * @returns {string[]} error strings (empty = consistent)
 */
export function overrideConsistencyErrors(membersIndex = new Map(), entries = []) {
  const reverse = reverseMembersIndex(membersIndex); // username(lower) -> id
  const errors = [];
  for (const e of entries ?? []) {
    const id = e?.github_id != null && e.github_id !== '' ? String(e.github_id) : null;
    const login = e?.login != null && e.login !== '' ? String(e.login).toLowerCase() : null;
    const src = e?._src ? `${e._src}: ` : '';
    if (!id || !login) continue;
    const idUser = membersIndex.get(id);
    if (idUser && idUser.toLowerCase() !== login) {
      errors.push(`${src}github_id ${id} is "${idUser}" in members-index.yml but the grant lists login "${e.login}"`);
      continue;
    }
    const loginId = reverse.get(login);
    if (loginId && loginId !== id) {
      errors.push(`${src}login "${e.login}" is github_id ${loginId} in members-index.yml but the grant lists github_id ${id}`);
    }
  }
  return errors;
}

export function roleOf(githubId, roles) {
  return roles.get(String(githubId)) ?? ROLE.member;
}

export function isBanned(githubId, bans) {
  return bans.has(String(githubId));
}

/** A grandfather grant is active when there is no `until`, until is null, or until is in the future. */
export function grandfatherActive(githubId, grandfathers, now = new Date()) {
  const entry = grandfathers.get(String(githubId));
  if (!entry) return false;
  const until = entry.until;
  if (until === undefined || until === null || until === '') return true;
  const untilDate = new Date(until);
  if (Number.isNaN(untilDate.getTime())) return false; // FAIL CLOSED: an unparseable `until` expires the grant
  return now.getTime() < untilDate.getTime();
}

/**
 * Resolve effective status from the Stripe-derived status plus git-native overrides.
 * Returns { status, source } where status is one of:
 *   banned | paid | trialing | expired | cancelled | none
 * Precedence: ban (deplatform) > staff (paid-equivalent) > grandfather (paid, no sub) > Stripe-derived.
 * Staff (moderator/admin/superadmin) never pay and their content stays published; this matches the gate,
 * which exempts staff from the membership check. A ban still overrides everything. `roles` is optional:
 * callers that do not pass it (the gate, which handles staff via decide()) simply skip the staff tier.
 */
export function effectiveStatus(githubId, derived, overrides, now = new Date()) {
  const { bans, grandfathers, roles } = overrides;
  if (isBanned(githubId, bans)) return { status: 'banned', source: 'ban' };
  if (roles && isPrivilegedRole(roleOf(githubId, roles))) return { status: 'paid', source: 'staff' };
  if (grandfatherActive(githubId, grandfathers, now)) return { status: 'paid', source: 'grandfather' };
  return { status: derived, source: 'stripe' };
}

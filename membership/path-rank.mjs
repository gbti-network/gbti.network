// sow-161 increment A: the per-path role rank required to WRITE a repo path, matching CODEOWNERS.
//
// This is the SOURCE OF TRUTH for the multi-file admin-write max-rank gate (membership-admin-author.mjs). A
// single-file config write declares one {path, rank} pair, so one rank is enough. A MULTI-FILE op cannot: a
// category-batch can touch house/taxonomy.yml (admin) AND house/content-channels.yml (superadmin-pinned), and a
// single declared rank would let an admin write a superadmin-pinned file. So a multi-file op's required rank is
// the MAX rankForPath across its RESOLVED file set, computed at request time from the files it actually touches.
//
// WHY THIS IS NOT classify-pr.isTierS (deliberately, do not "simplify" it to that). isTierS is a coarse
// escalation catcher: it calls EVERY house/** except roles.yml Tier A, which disagrees with CODEOWNERS on
// exactly the files this gate exists to protect (content-channels.yml, moderation-flags.yml, site-settings.yml
// are CODEOWNERS-pinned to the two superadmins, but isTierS returns admin for them). Using isTierS as the rank
// source would reintroduce the escalation. This map mirrors CODEOWNERS instead, and a test in
// test/path-rank.test.mjs asserts it agrees with every CONFIG_OP row's hand-declared rank so the two cannot
// drift. Node-free (bundled into the Worker); ROLE is the node-free enum from overrides-core.
import { ROLE } from './overrides-core.mjs';

export const ROLE_RANK = Object.freeze({ [ROLE.member]: 0, [ROLE.moderator]: 1, [ROLE.admin]: 2, [ROLE.superadmin]: 3 });

// The house/** files CODEOWNERS pins to the two superadmins EXPLICITLY ("superadmin-tier by intent; the two
// superadmins own them explicitly even if /house/ is later delegated"). Keep this in lockstep with CODEOWNERS.
// house/syndication-config.yml joined this set on 2026-09-01 by OWNER RULING (sow-298 open question 3). It
// was deliberately absent while three controls disagreed about it: superadmin at the op level, absent from
// CODEOWNERS, and admin per classify-pr. The ruling ratifies what the code already enforced, so nothing here
// becomes more permissive; it closes the declaration gap that made the op-level rank the only real control.
export const SUPERADMIN_HOUSE_FILES = new Set([
  'house/roles.yml',
  'house/content-channels.yml',
  'house/moderation-flags.yml',
  'house/site-settings.yml',
  'house/syndication-config.yml',
  // sow-312: the newsletter send-rate caps. It decides how much mail reaches other people's inboxes, and
  // daily_cap: 0 is the switch that stops sending altogether, so it belongs at the same tier as the files
  // above rather than inheriting /house/'s admin rank.
  'house/mail-settings.yml',
]);

/** A path is canonical iff it is a clean forward-slash relative path (mirrors classify-pr.isCleanPath). */
function isCleanPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * The minimum role RANK required to write `path`, matching CODEOWNERS:
 *   superadmin: roles.yml, content-channels.yml, moderation-flags.yml, site-settings.yml, house/applets/**,
 *               CODEOWNERS, .github/**, and anything OUTSIDE members/ and house/ (root config, src/, scripts/,
 *               membership/, workers/, docs), which fail closed to superadmin.
 *   admin:      the rest of house/** (taxonomy.yml, quotes.yml, news-sources.yml, coupons.yml, bans.yml, ...).
 *   member:     members/** (author-scoped; a curation op's own base rank covers editing another member's file).
 * A non-canonical path (.., absolute, backslash, NUL) FAILS CLOSED to superadmin, so a "../" trick can never
 * land a file in the admin bucket.
 */
export function rankForPath(path) {
  const p = String(path ?? '');
  if (!isCleanPath(p)) return ROLE_RANK[ROLE.superadmin];
  if (SUPERADMIN_HOUSE_FILES.has(p)) return ROLE_RANK[ROLE.superadmin];
  if (p === 'CODEOWNERS' || p.startsWith('.github/') || p === 'house/applets' || p.startsWith('house/applets/')) {
    return ROLE_RANK[ROLE.superadmin];
  }
  if (p.startsWith('members/')) return ROLE_RANK[ROLE.member];
  if (p === 'house' || p.startsWith('house/')) return ROLE_RANK[ROLE.admin];
  // Anything outside members/ and house/ is infrastructure and fails closed to superadmin.
  return ROLE_RANK[ROLE.superadmin];
}

/**
 * The rank a MULTI-FILE op requires: the greatest rank any file it touches requires, never below `baseRank`
 * (the op's own declared floor, e.g. admin for a curation op). An empty file set returns `baseRank`.
 */
export function maxRankForPaths(paths, baseRank = 0) {
  let rank = baseRank;
  for (const p of paths ?? []) rank = Math.max(rank, rankForPath(p));
  return rank;
}

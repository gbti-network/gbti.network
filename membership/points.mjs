// Contributor points: pure logic for SOW-008. No I/O. Award computation, the award-record builder,
// the dispute state machine, and per-contributor totals. The points ledger (house/points-ledger.yml)
// is admin-owned; only the merge automation and admins write it. See .data/ops/revenue-ops/README.md.
//
// Floor of 1 point for a point-bearing contribution (correction or addition). Grammar is courtesy (0).
// Anti-gaming: no self-awards (contributor must not be the folder owner), and a banned contributor
// earns nothing (ban overrides everything).

export const POINTS_BY_CLASS = Object.freeze({ grammar: 0, correction: 1, addition: 1 });

export const AWARD_STATUS = Object.freeze({
  awarded: 'awarded', // created on an accepted point-bearing contribution
  authorRejected: 'author-rejected', // the author disputes the award; routed to an admin
  adminUpheld: 'admin-upheld', // admin agrees with the author: 0 points
  adminOverturned: 'admin-overturned', // admin overrules the author: the award stands
});

/** Points for a class. Addition has a floor of 1 and an optional owner-set bonus. Unknown class -> 0. */
export function classToPoints(klass, { additionBonus = 0 } = {}) {
  if (klass === 'addition') return 1 + Math.max(0, additionBonus);
  return POINTS_BY_CLASS[klass] ?? 0;
}

/**
 * Build an award record for an accepted contribution, or null when no award is due (grammar courtesy,
 * a self-contribution, a banned contributor, or zero points) so the caller writes nothing.
 *
 * @param {object} a
 * @param {string|number} a.contributorGithubId   the contributor (immutable id)
 * @param {string}        [a.contributorLogin]
 * @param {string|number} a.ownerGithubId          the folder owner (for the no-self-award check)
 * @param {object}        a.target                 { username, type, slug }
 * @param {string}        [a.commit]               merge commit SHA
 * @param {string}        [a.url]                  commit URL
 * @param {string}        a.klass                  grammar | correction | addition
 * @param {string}        [a.now]                  ISO timestamp (injected)
 * @param {boolean}       [a.banned]               contributor is banned
 * @param {number}        [a.additionBonus]        owner-set bonus above the floor for an addition
 */
export function buildAward({
  contributorGithubId,
  contributorLogin,
  ownerGithubId,
  target,
  commit,
  url,
  klass,
  now,
  banned = false,
  additionBonus = 0,
}) {
  if (!contributorGithubId) return null;
  if (banned) return null; // ban overrides everything
  if (ownerGithubId != null && String(contributorGithubId) === String(ownerGithubId)) return null; // no self-award
  const points = classToPoints(klass, { additionBonus });
  if (points <= 0) return null; // grammar / courtesy: no ledger entry (the footnote still credits them)
  return {
    id: commit ? `award-${commit}` : `award-${contributorGithubId}-${target?.slug ?? 'unknown'}`,
    contributor_github_id: String(contributorGithubId),
    contributor_login: contributorLogin ?? null,
    target: target ?? null,
    commit: commit ?? null,
    url: url ?? null,
    class: klass,
    points,
    status: AWARD_STATUS.awarded,
    created_at: now ?? null,
    resolved_at: null,
    note: null,
  };
}

/** The author rejects an award: it becomes author-rejected and is routed to an admin. Content is untouched. */
export function rejectAward(record, { reason, now } = {}) {
  return { ...record, status: AWARD_STATUS.authorRejected, note: reason ?? record.note ?? null, resolved_at: now ?? null };
}

/** An admin adjudicates a disputed award: upheld -> 0 points; overturned -> the award stands. */
export function adjudicate(record, { upheld, note, now } = {}) {
  if (upheld) {
    return { ...record, status: AWARD_STATUS.adminUpheld, points: 0, note: note ?? record.note ?? null, resolved_at: now ?? null };
  }
  return { ...record, status: AWARD_STATUS.adminOverturned, note: note ?? record.note ?? null, resolved_at: now ?? null };
}

/** Effective points for a record: a pending dispute or an upheld rejection is worth 0. */
export function effectivePoints(record) {
  if (!record) return 0;
  if (record.status === AWARD_STATUS.authorRejected) return 0; // pending, not counted yet
  if (record.status === AWARD_STATUS.adminUpheld) return 0;
  return record.points ?? 0;
}

/** Sum a contributor's effective points across the whole ledger. */
export function totalPoints(ledger, contributorGithubId) {
  return (ledger ?? [])
    .filter((r) => String(r.contributor_github_id) === String(contributorGithubId))
    .reduce((sum, r) => sum + effectivePoints(r), 0);
}

/** Add or replace an award in the ledger array, keyed by its id (idempotent). */
export function upsertLedger(ledger, award) {
  const list = Array.isArray(ledger) ? [...ledger] : [];
  if (!award) return list;
  const i = list.findIndex((r) => r.id === award.id);
  if (i >= 0) list[i] = award;
  else list.push(award);
  return list;
}

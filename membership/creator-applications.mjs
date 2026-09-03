// sow-293: the CREATOR APPLICATION core. Content Creator stopped being a tier anyone could buy and became a
// tier granted by application plus superadmin approval, so this module models the application itself: the
// record a member submits, the state it is in, and the decision a superadmin records against it. Node-free
// (no fs, no yaml, no crypto), so the Worker, the admin surface and the tests all share one implementation.
//
// WHY THIS LIVES IN KV AND NOT IN house/, since that is the part worth stating plainly:
// an application is a person writing about themselves, keyed by their github_id, and it carries free text
// they may later want removed. CLAUDE.md's storage boundary puts private, mutable, per-person state in KV.
// Committing applications would write person-keyed prose into a public, forkable, CDN-cached repository
// permanently, and "hiding is not deleting" would apply to it forever, so it could never satisfy a
// right-to-erasure request. The same rule moved bans and grandfather state out of the repo in sow-213.
//
// ONE RECORD PER PERSON, keyed by github_id rather than by a minted id. A person has one standing
// application, not a queue of them, and keying on the identity means a resubmission updates the thing a
// superadmin is looking at instead of creating a second row that silently competes with the first.

/** Field bounds. Free text from the public internet is always bounded before it is stored. */
export const MAX_APPLICATION_WHY = 2000;
export const MAX_APPLICATION_LINKS = 600;
export const MAX_APPLICATION_TOPICS = 600;
/** A superadmin's note ON a decision. Shorter: it is a reason, not an essay. */
export const MAX_DECISION_NOTE = 500;

export const APPLICATION_STATE = Object.freeze({
  pending: 'pending',
  approved: 'approved',
  declined: 'declined',
  unknown: 'unknown', // a malformed or missing record: never actionable
});

/** The KV key for one application. ONE builder, so every reader and writer agrees on the shape. */
export function applicationKey(githubId) {
  return `application:${String(githubId ?? '').trim()}`;
}

/**
 * The KV key prefix the superadmin lane lists over. Kept beside applicationKey so the two cannot drift.
 *
 * THIS PREFIX MUST ALSO BE IN `BACKED_UP_PREFIXES` (scripts/lib/kv-backup.mjs). That list is explicit, not
 * a wildcard, so a new store is NOT backed up until it is added there, and nothing reports the omission.
 */
export const APPLICATION_KEY_PREFIX = 'application:';

/**
 * Bound and clean one free-text field.
 *
 * Newlines are PRESERVED here, unlike the single-line administration note in invites.mjs, because these
 * fields are prose a person wrote to be read by a human and paragraph breaks carry meaning. Every other
 * control character collapses to a space so the text cannot smuggle framing into a log, an email or an
 * export. The escapes are written as \x.. rather than as literal bytes so the intent survives a
 * copy-paste through an editor that would silently eat the raw characters.
 */
export function sanitizeApplicationText(value, max) {
  if (typeof value !== 'string') return '';
  const limit = Number.isInteger(max) && max > 0 ? max : MAX_APPLICATION_WHY;
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Build a fresh application record.
 *
 * `why` is the only REQUIRED field, matching the owner's question ("why are you interested in contributing
 * as a writer"). `links` and `topics` are optional context (owner answer, 2026-09-03) and an empty string is
 * a legitimate value for either, so they are never a reason to reject a submission.
 *
 * @throws when there is no usable github_id. An application with no identity can never be granted a tier
 *         later, so accepting one would store a record that cannot be acted on.
 */
export function newApplication({ githubId, login = null, why = '', links = '', topics = '', now = new Date() } = {}) {
  const id = String(githubId ?? '').trim();
  if (!id) throw new Error('creator-applications: a github_id is required');
  return {
    githubId: id,
    login: login ? String(login) : null,
    why: sanitizeApplicationText(why, MAX_APPLICATION_WHY),
    links: sanitizeApplicationText(links, MAX_APPLICATION_LINKS),
    topics: sanitizeApplicationText(topics, MAX_APPLICATION_TOPICS),
    submittedAt: isoOf(now),
    decision: null,
    decidedAt: null,
    decidedBy: null,
    decidedByLogin: null,
    decisionNote: '',
  };
}

/**
 * The state of an application record.
 *
 * FAILS TO `unknown`, never to `pending`. A malformed record must not look like work waiting in the review
 * lane, and it must never be approvable: approving one grants a real tier to whatever identity the broken
 * record happens to carry.
 */
export function applicationState(record) {
  if (!record || typeof record !== 'object') return APPLICATION_STATE.unknown;
  if (!String(record.githubId ?? '').trim()) return APPLICATION_STATE.unknown;
  if (record.decision === APPLICATION_STATE.approved) return APPLICATION_STATE.approved;
  if (record.decision === APPLICATION_STATE.declined) return APPLICATION_STATE.declined;
  if (record.decision === null || record.decision === undefined) return APPLICATION_STATE.pending;
  return APPLICATION_STATE.unknown; // a decision value we do not recognise is not a pending application
}

/** Whether a superadmin may still record a decision against this record. */
export function isDecidable(record) {
  return applicationState(record) === APPLICATION_STATE.pending;
}

/**
 * Whether a member may submit (or replace) an application.
 *
 * An APPROVED application is terminal: the tier has been granted, so there is nothing left to apply for and
 * a resubmission would let someone overwrite the record of their own approval. Pending and declined may
 * both be replaced, so a declined applicant can improve their answer and try again without an admin having
 * to clear anything by hand.
 */
export function canSubmit(record) {
  return applicationState(record) !== APPLICATION_STATE.approved;
}

/**
 * Record a superadmin's decision, returning a NEW record rather than mutating the stored one.
 *
 * @throws when the record is not decidable, or the decision is not one of approved/declined. Both are
 *         caller errors, and failing loudly here keeps an unrecognised decision value from being written
 *         into the store where applicationState would then read it back as `unknown`.
 */
export function decideApplication(record, { decision, by = null, byLogin = null, note = '', now = new Date() } = {}) {
  if (!isDecidable(record)) throw new Error('creator-applications: this application is not open for a decision');
  if (decision !== APPLICATION_STATE.approved && decision !== APPLICATION_STATE.declined) {
    throw new Error('creator-applications: a decision must be approved or declined');
  }
  return {
    ...record,
    decision,
    decidedAt: isoOf(now),
    decidedBy: by === null || by === undefined ? null : String(by),
    decidedByLogin: byLogin || null,
    decisionNote: sanitizeApplicationText(note, MAX_DECISION_NOTE),
  };
}

/**
 * Order applications for the review lane: pending first (that is the work), then most recently submitted.
 * Decided applications stay visible below, because "who did we already turn down" is part of reviewing.
 */
export function sortApplications(records = []) {
  const rank = (r) => (applicationState(r) === APPLICATION_STATE.pending ? 0 : 1);
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return String(b?.submittedAt ?? '').localeCompare(String(a?.submittedAt ?? ''));
  });
}

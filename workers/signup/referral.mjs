// Referral attribution for signup (SOW-007, surfaced through SOW-002 signup). A visitor can arrive
// with ?ref=<code> where the code resolves to a referrer's github_id. Attribution is first-touch and
// immutable: it is written once into the new member's Stripe Customer metadata as `referred_by` and
// is never changed afterward. Self-referral is rejected (a member cannot refer themselves).
//
// This module is pure: it takes the raw ref code and the new member's github_id plus a resolver and
// returns the referrer github_id to store, or null when there is nothing valid to attribute.

/**
 * Normalize a raw ?ref value. Referral codes are member github_id strings (numeric) by convention.
 * Returns a trimmed string, or null when the value is missing or empty.
 */
export function normalizeRefCode(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/**
 * Resolve a ?ref code to the referrer github_id to persist, applying first-touch + self-reject.
 *
 * @param {object} a
 * @param {string|null|undefined} a.refCode      the raw ?ref query value (may be absent).
 * @param {string|number} a.newMemberGithubId    the github_id of the member signing up.
 * @param {(code:string)=>string|null} [a.resolve]  maps a ref code to a referrer github_id, or null
 *                                                   when the code is unknown. Defaults to identity:
 *                                                   the ref code IS the referrer github_id.
 * @returns {string|null} the referrer github_id to store as `referred_by`, or null to store nothing.
 */
export function resolveReferral({ refCode, newMemberGithubId, resolve }) {
  const code = normalizeRefCode(refCode);
  if (code === null) return null;

  const resolver = typeof resolve === 'function' ? resolve : (c) => c;
  let referrerId;
  try {
    referrerId = resolver(code);
  } catch {
    return null; // a broken resolver must not break signup; just skip attribution
  }
  if (referrerId === undefined || referrerId === null) return null;
  const referrer = String(referrerId).trim();
  if (referrer.length === 0) return null;

  // Self-referral is rejected: a member cannot credit themselves.
  if (referrer === String(newMemberGithubId).trim()) return null;

  return referrer;
}

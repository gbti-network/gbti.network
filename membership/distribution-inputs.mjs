// SOW-007/008: resolve, for ONE content item, the inputs the commission splitter consumes (the
// contributor points and the eligible commenters) from the git-native ledgers. PURE + deterministic
// (the clock is injected); the payout shell reads the files and passes parsed records in. The immutable
// github_id is the recipient key throughout: logins/usernames are resolved to github_id HERE so a later
// GitHub/folder rename can never misroute money. Everything fails closed: an unresolvable or banned
// recipient is dropped (they cannot be paid), a disputed award counts 0.

import { effectivePoints } from './points.mjs';

const DAY_MS = 86_400_000;

function toMs(v) {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : 0;
}

/**
 * Contributor recipients for one content item, summed by github_id. Keeps only awards whose `target`
 * matches this content, sums each contributor's EFFECTIVE points (a disputed/upheld-against award counts
 * 0), and drops zero-point and banned contributors. github_id stays the key.
 *
 * Each ledger point is scaled to `pointsPerUnit` (default 7) so a contribution carries the SAME pool-weight
 * unit a comment does: one accepted contribution = one unit = the full contribution pool (the splitter's
 * minPointsForFullPool is one unit), and more contributions dilute it evenly. Without this scaling a lone
 * contribution (1 ledger point) would claim only 1/7 of the pool while a lone comment (7 points) claims all
 * of its pool — the asymmetry this fixes. The reputation ledger stays 1 point per contribution; this only
 * sets the distribution weight. An addition's `additionBonus` rides along, so a bigger addition out-weighs a
 * small correction when several contributions compete.
 *
 * @param {object[]} awards               the ledger `awards` array (house/points-ledger.yml).
 * @param {string} type                   'post' | 'product' | 'prompt'.
 * @param {string} slug                   the content slug.
 * @param {Set<string>} [bannedGithubIds] banned ids earn nothing (fail closed).
 * @param {object} [opts]                 { pointsPerUnit=7 } the pool-weight per ledger point.
 * @returns {{id:string, points:number}[]} one entry per contributor github_id, points > 0.
 */
export function contributorsForContent(awards, type, slug, bannedGithubIds, { pointsPerUnit = 7 } = {}) {
  const byId = new Map();
  for (const a of awards ?? []) {
    if (a?.target?.type !== type || a?.target?.slug !== slug) continue;
    const id = a?.contributor_github_id != null ? String(a.contributor_github_id) : '';
    if (!id) continue;
    if (bannedGithubIds?.has?.(id)) continue; // banned earns nothing
    const pts = effectivePoints(a);
    if (!Number.isFinite(pts) || pts <= 0) continue; // non-finite (e.g. a malformed `points: .inf`) earns nothing
    byId.set(id, (byId.get(id) ?? 0) + pts);
  }
  return [...byId.entries()].map(([id, points]) => ({ id, points: points * pointsPerUnit }));
}

/**
 * Eligible commenter recipients for one content item, in comment order (oldest first), each worth
 * `pointsPerComment` (default 7, the same unit as a contribution: one comment claims the full comment
 * pool, more dilute it). Resolves each comment's author (a username) to its immutable github_id; an
 * unresolvable or banned author is DROPPED (cannot be paid). Only published comments count. The splitter's
 * eligibleComments() applies the first-10 + <90-day window, so all matching comments are returned in order;
 * a comment with no parseable timestamp gets ageDays = MAX so the window filter excludes it (fail closed).
 *
 * @param {object[]} comments                       comment records { author, targetType, targetSlug, createdAt, status }.
 * @param {string} type
 * @param {string} slug
 * @param {Map<string,string>} usernameToGithubId   lowercased username -> github_id (reverseMembersIndex).
 * @param {number} nowMs                            injected clock for ageDays.
 * @param {object} [opts]                           { pointsPerComment=7, bannedGithubIds, ownerGithubId }
 * @returns {{id:string, points:number, ageDays:number}[]}
 */
export function commentsForContent(comments, type, slug, usernameToGithubId, nowMs, { pointsPerComment = 7, bannedGithubIds, ownerGithubId } = {}) {
  const matched = (comments ?? [])
    .filter((c) => c?.targetType === type && c?.targetSlug === slug && c?.status !== 'draft')
    .map((c) => ({ c, t: toMs(c?.createdAt) }))
    .sort((a, b) => a.t - b.t); // oldest first: the first-N eligibility counts the earliest commenters

  const out = [];
  for (const { c, t } of matched) {
    const uname = c?.author != null ? String(c.author).toLowerCase() : '';
    const id = usernameToGithubId?.get?.(uname);
    if (!id) continue; // unresolved author cannot be paid -> drop
    if (bannedGithubIds?.has?.(String(id))) continue;
    // SOW-016: no self-delegation. The content owner's own comments (including the required from-the-author
    // introduction) do NOT earn from their own commenter pool.
    if (ownerGithubId != null && String(id) === String(ownerGithubId)) continue;
    // A non-positive, unparseable, OR FUTURE timestamp is not a verifiable age, so it fails the <90-day
    // window (MAX age). Fail closed: a garbage/future createdAt can never masquerade as a fresh comment.
    const ageDays = t > 0 && t <= nowMs ? Math.floor((nowMs - t) / DAY_MS) : Number.MAX_SAFE_INTEGER;
    out.push({ id: String(id), points: pointsPerComment, ageDays });
  }
  return out;
}

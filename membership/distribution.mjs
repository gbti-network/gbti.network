// Revenue distribution v2 (SOW-007 + SOW-008). PURE. Splits a single referral commission (the content
// owner's 30% of a referred member's invoice, already computed by membership/commissions.mjs) into:
//   - the owner's keep (at least 90% of the commission by default),
//   - a CONTRIBUTIONS pool (the owner may delegate up to 7% of the commission), and
//   - a COMMENTS pool (up to 3% of the commission),
// each pool divided across eligible recipients by points. All amounts are integer minor units (cents).
//
// Model (decided 2026-06-04, SOW-007 "Revenue distribution model v2"):
//   - delegation is OPTIONAL and per-content; the owner sets contributions/comments shares (fractions of
//     the commission), each clamped to its cap (7% / 3%). Default {0,0} => owner keeps 100%.
//   - 1 accepted contribution = 7 points (the unit). A pool is FULLY allocated only once total points
//     reach minPointsForFullPool (7); below that, the unallocated remainder stays with the owner. At or
//     above it, the pool divides by total points, so more contributions dilute each point evenly.
//   - comments use the same rule, limited to the first 10 comments and those under 90 days old.
//
// This is the reusable core. Wiring it to live payouts still needs: the referred content (the `via`
// captured at signup) to find that content's contributors + comments + points, the owner's delegation
// setting (per-content, in git), and the payout-job integration. Those are tracked in SOW-007/008/006.

export const DEFAULT_DISTRIBUTION_CONFIG = Object.freeze({
  contributionCap: 0.07,    // max fraction of the commission delegable to contributors
  commentCap: 0.03,         // max fraction of the commission delegable to commenters
  pointsPerUnit: 7,         // 1 accepted contribution / comment = 7 points (informational; recipients carry points)
  minPointsForFullPool: 7,  // a pool is fully allocated only at >= this many total points
  maxComments: 10,          // only the first N comments are eligible
  maxCommentAgeDays: 90,    // comments older than this are not eligible
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

/** Largest-remainder rounding: integer amounts (>= 0) summing exactly to `target`. */
function roundLargestRemainder(items, target) {
  if (target <= 0) return items.map((i) => ({ id: i.id, points: i.points, amount: 0 }));
  const floored = items.map((i) => ({ id: i.id, points: i.points, amount: Math.floor(i.exact), frac: i.exact - Math.floor(i.exact) }));
  let remainder = target - sum(floored.map((i) => i.amount));
  const order = [...floored].sort((a, b) => b.frac - a.frac || b.points - a.points);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) order[k].amount += 1;
  return floored.map((i) => ({ id: i.id, points: i.points, amount: i.amount }));
}

/** Coerce a points value to a FINITE, non-negative number. A non-finite value (e.g. Infinity from a
 * malformed ledger `points: .inf`, or NaN) counts as 0 so it can never NaN the whole split and silently
 * drop the owner's keep. */
function finitePoints(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Allocate a pool across recipients by points, with the min-points-for-full-pool rule. */
function allocate(pool, recipients, minPoints) {
  const pts = (recipients ?? []).map((r) => ({ id: r.id, points: finitePoints(r.points) }));
  if (pool <= 0 || !pts.length) return pts.map((r) => ({ ...r, amount: 0 }));
  const totalPoints = sum(pts.map((r) => r.points));
  if (totalPoints <= 0) return pts.map((r) => ({ ...r, amount: 0 }));
  const divisor = Math.max(minPoints, totalPoints);
  const withExact = pts.map((r) => ({ id: r.id, points: r.points, exact: (pool * r.points) / divisor }));
  // target <= pool: equals pool when totalPoints >= minPoints, else the pro-rated-against-minPoints amount.
  const target = Math.min(pool, Math.round((pool * totalPoints) / divisor));
  return roundLargestRemainder(withExact, target);
}

/** Filter comments to the eligible set: the first `maxComments` whose age is within `maxCommentAgeDays`. */
export function eligibleComments(comments, config = DEFAULT_DISTRIBUTION_CONFIG) {
  const cfg = { ...DEFAULT_DISTRIBUTION_CONFIG, ...config };
  return (comments ?? [])
    .filter((c) => c.ageDays == null || Number(c.ageDays) <= cfg.maxCommentAgeDays)
    .slice(0, cfg.maxComments);
}

/**
 * Split one commission into owner-keep + contribution recipients + comment recipients.
 *
 * @param {object} a
 * @param {number} a.commissionAmount  the owner's commission in minor units (e.g. 4500 = $45 = 30% of $150).
 * @param {{contributions?:number, comments?:number}} [a.delegation]  the owner's chosen shares (fractions of the commission).
 * @param {{id:string, points:number}[]} [a.contributors]  contribution recipients with their points.
 * @param {{id:string, points:number, ageDays?:number}[]} [a.comments]  comment recipients (order = comment order).
 * @param {object} [a.config]
 * @returns {{commissionAmount, owner, contributions, comments, pools}}
 */
export function splitCommission({ commissionAmount, delegation = {}, contributors = [], comments = [], config = DEFAULT_DISTRIBUTION_CONFIG } = {}) {
  const cfg = { ...DEFAULT_DISTRIBUTION_CONFIG, ...config };
  const amount = Math.max(0, Math.round(Number(commissionAmount) || 0));

  const contribShare = clamp(delegation.contributions ?? 0, 0, cfg.contributionCap);
  const commentShare = clamp(delegation.comments ?? 0, 0, cfg.commentCap);

  const contribPool = Math.round(amount * contribShare);
  const commentPool = Math.round(amount * commentShare);

  const contributions = allocate(contribPool, contributors, cfg.minPointsForFullPool);
  const commentRecipients = allocate(commentPool, eligibleComments(comments, cfg), cfg.minPointsForFullPool);

  const distributed = sum(contributions.map((x) => x.amount)) + sum(commentRecipients.map((x) => x.amount));
  const owner = amount - distributed; // owner keeps the rest (always >= amount * (1 - contributionCap - commentCap))

  return {
    commissionAmount: amount,
    owner,
    contributions,
    comments: commentRecipients,
    pools: { contributions: contribPool, comments: commentPool },
  };
}

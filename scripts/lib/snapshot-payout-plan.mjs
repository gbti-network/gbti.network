// SOW-059 P1c-C: the PURE snapshot-driven payout planner. Replaces the SOW-007 link/delegation planner. Given the
// frozen conversion snapshots + each converted member's paid invoices + an eligibility predicate + the Connect state,
// it plans the Stripe Connect transfers: per member, per PAYABLE invoice, base = NET invoice revenue (not rate*net),
// split by distributeSnapshot's fixed 30/10/5/10 percentages, residual implicitly retained (the platform is never
// over-paid), one transfer per (recipient, invoice) with a stable idempotency key + cross-run dedupe from prior
// transfers. No I/O (the shell injects Stripe/git/KV). NO backward-compat with the SOW-007 metadata: there are zero
// legacy transfers (no paying members yet), so dedupe reads only the new snapshot-payout pairs. Frozen attribution
// drives WHO; only eligibility (not-banned + active) is re-applied here, so a later ban/refund changes who is PAID.
import { distributeSnapshot } from '../../membership/revenue-model.mjs';
import { netPaid, paidAtMs, isReversed, COMMISSION_STATE } from '../../membership/commissions.mjs';

const DAY_MS = 86_400_000;
const round = (n) => Math.round(n);

/**
 * Per-invoice settlement state for the snapshot model.
 *  - voided: refunded / disputed / net <= 0 (pays nobody)
 *  - held:   within the settlement hold (now < paidAt + holdDays)
 *  - payable: past the hold
 * `base` is the NET invoice revenue in minor units (the percentages apply to this).
 */
export function invoiceState(invoice, { holdDays = 90, nowMs } = {}) {
  if (isReversed(invoice)) return { state: COMMISSION_STATE.voided, base: 0, payableAtMs: null };
  const base = netPaid(invoice);
  const payableAtMs = paidAtMs(invoice) + Math.max(0, holdDays) * DAY_MS;
  const state = nowMs < payableAtMs ? COMMISSION_STATE.held : COMMISSION_STATE.payable;
  return { state, base, payableAtMs };
}

/** Label a recipient by the role(s) they hold in the snapshot (for transfer metadata + audit). */
function roleOf(member, snapshot) {
  const roles = [];
  if (member === snapshot.firstOwner) roles.push('first');
  if (member === snapshot.lastOwner) roles.push('last');
  if (member === snapshot.inviter) roles.push('invite');
  if (Array.isArray(snapshot.points) && snapshot.points.some((p) => p && p.member === member)) roles.push('collab');
  return roles.join('+') || 'collab';
}

/**
 * Split one invoice's NET base across recipients per the frozen snapshot, eligibility re-applied. Returns
 * [{ id, role, pct, amount }] (minor units, amount > 0). Conservation: the share percentages sum to at most 55
 * (retained is always >= 45), so the rounded recipient amounts never exceed `base`; a defensive trim from the
 * largest share guarantees Sum(recipients) <= base even under adversarial rounding (the platform is never over-paid).
 */
export function splitInvoice({ snapshot, base, eligible = () => true }) {
  if (!(base > 0)) return [];
  const dist = distributeSnapshot(snapshot, { eligible });
  const recipients = [];
  let distributed = 0;
  for (const [member, pct] of Object.entries(dist.shares)) {
    const amount = round((base * pct) / 100);
    if (amount > 0) { recipients.push({ id: member, role: roleOf(member, snapshot), pct, amount }); distributed += amount; }
  }
  if (distributed > base) { // defensive: trim the overage from the largest share(s) so retained absorbs the residual
    recipients.sort((a, b) => b.amount - a.amount);
    let over = distributed - base;
    for (const r of recipients) { const cut = Math.min(over, r.amount); r.amount -= cut; over -= cut; if (over <= 0) break; }
  }
  return recipients.filter((r) => r.amount > 0);
}

/**
 * Plan the transfers across all converted members.
 * @param {object} a
 * @param {Array}  a.members    [{ member, snapshot, invoices: [stripeInvoice] }] -- a member with NO snapshot pays nobody.
 * @param {number} a.nowMs      payout-run clock.
 * @param {number} [a.holdDays] settlement hold (default 90).
 * @param {(id:string)=>boolean} [a.eligible]  not-banned AND active-at-payout; an ineligible share falls to retained.
 * @param {Set<string>} [a.paidPairs]  `${recipient}:${invoiceId}` pairs already transferred (cross-run dedupe).
 * @param {(id:string)=>{ready:boolean,destination:string|null}} [a.recipientConnect]  Connect readiness + destination.
 * @returns {{ actions: object[], withheld: object[] }}
 */
export function planSnapshotPayouts({ members = [], nowMs, holdDays = 90, eligible = () => true, paidPairs = new Set(), recipientConnect = () => ({ ready: false, destination: null }) }) {
  const actions = [];
  const withheld = [];
  for (const entry of members) {
    const { member, snapshot, invoices = [] } = entry || {};
    if (!member || !snapshot) continue; // fail closed: no frozen snapshot -> pay nobody, retain 100% (never the link model)
    for (const invoice of invoices) {
      const { state, base } = invoiceState(invoice, { holdDays, nowMs });
      if (state !== COMMISSION_STATE.payable || !(base > 0)) continue;
      for (const r of splitInvoice({ snapshot, base, eligible })) {
        const pairKey = `${r.id}:${invoice.id}`;
        if (paidPairs.has(pairKey)) continue; // already transferred for this (recipient, invoice) -> no double-pay
        const conn = recipientConnect(r.id) || { ready: false, destination: null };
        const action = {
          recipientGithubId: r.id, role: r.role, pct: r.pct, amount: r.amount,
          currency: invoice.currency, invoiceId: invoice.id, member,
          destination: conn.destination || null,
          idempotencyKey: `snapshot-payout:${member}:${invoice.id}:${r.id}`,
        };
        if (conn.ready && conn.destination) actions.push(action);
        else withheld.push({ ...action, reason: conn.destination ? 'connect-not-ready' : 'no-connect-account' });
      }
    }
  }
  return { actions, withheld };
}

/**
 * SOW-083 P2: build a per-RECIPIENT earnings view across all converted members, for the member dashboard. Unlike
 * planSnapshotPayouts (which only TRANSFERS payable invoices), this includes HELD (accruing) and PAID amounts so a
 * member sees their whole picture. Pure; the payout job persists the result per recipient (earnings:<github_id>) and
 * the Worker serves it. Eligibility is applied exactly as at payout (an ineligible recipient earns nothing -> the
 * share is retained), so the dashboard never over-promises. Returns Map<recipient, { entries, totals }> where each
 * entry is { from, role, amount, currency, invoice, state } and state is 'paid' | 'payable' | 'held'.
 */
export function buildEarningsLedger({ members = [], nowMs, holdDays = 90, eligible = () => true, paidPairs = new Set() }) {
  const byRecipient = new Map();
  const ensure = (id) => {
    let e = byRecipient.get(id);
    if (!e) { e = { entries: [], totals: { held: 0, payable: 0, paid: 0, lifetime: 0 } }; byRecipient.set(id, e); }
    return e;
  };
  for (const entry of members) {
    const { member, snapshot, invoices = [] } = entry || {};
    if (!member || !snapshot) continue;
    for (const invoice of invoices) {
      const { state, base } = invoiceState(invoice, { holdDays, nowMs });
      if (state === COMMISSION_STATE.voided || !(base > 0)) continue; // refunded/disputed pays nobody
      for (const r of splitInvoice({ snapshot, base, eligible })) {
        const rec = ensure(r.id);
        const st = paidPairs.has(`${r.id}:${invoice.id}`) ? 'paid' : (state === COMMISSION_STATE.held ? 'held' : 'payable');
        rec.entries.push({ from: member, role: r.role, amount: r.amount, currency: invoice.currency, invoice: invoice.id, state: st });
        rec.totals[st] += r.amount;
        rec.totals.lifetime += r.amount;
      }
    }
  }
  return byRecipient;
}

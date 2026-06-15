// Referral commission ledger (SOW-007). PURE: every entry is DERIVED from Stripe data (the referred
// member's paid invoices + their charges' refund/dispute state) plus the referral-config rate/hold and
// the referrer's active intervals. Nothing is stored; the reconcile/payout job recomputes the ledger
// from Stripe on every run, so it is always exactly auditable against Stripe.
//
// An entry's state is one of:
//   held    accrued, still inside the settlement hold (now < payable_at) -> not yet payable.
//   payable past the hold, no refund/dispute -> a Connect transfer should be created (once, by the job).
//   voided  the referred member's payment was refunded or disputed -> commission is cancelled (amount 0).
//   paid    a Connect transfer already exists for this invoice (the job marks this via paidInvoiceIds).
//
// Eligibility rules (all fail closed):
//   - Accrual requires the REFERRER to have been an active paying member (paid or grandfathered) AT THE
//     TIME the referred member's invoice was paid. We model that as referrerActiveIntervals and check
//     invoice.paid_at against them. A referrer who was NOT active at invoice time earns NOTHING for that
//     invoice (returns no entry, distinct from `voided`). A later lapse does NOT claw back commissions
//     earned during an active period (confirmed decision): they stay `payable`. A lapse only stops NEW
//     accrual, and resubscription resumes it, both naturally satisfied by recomputing with current data.
//   - A banned referrer earns nothing (ban voids all accrual).
//   - Self-referral earns nothing (a member cannot refer themselves); signup already blocks it, re-checked.

export const COMMISSION_STATE = Object.freeze({
  held: 'held',
  payable: 'payable',
  voided: 'voided',
  paid: 'paid',
});

const DAY_MS = 86_400_000;

/** The expanded charge object on an invoice, or null when absent/unexpanded. */
function chargeOf(invoice) {
  const c = invoice?.charge;
  return c && typeof c === 'object' ? c : null;
}

/** Minor-unit amount refunded on the invoice's charge (0 when no charge). */
export function amountRefunded(invoice) {
  const c = chargeOf(invoice);
  return c ? Math.max(0, Number(c.amount_refunded ?? 0) || 0) : 0;
}

/** True when the invoice's charge has any dispute (chargeback), pending or lost. */
export function isDisputed(invoice) {
  const c = chargeOf(invoice);
  if (!c) return false;
  return c.disputed === true || (c.dispute != null && c.dispute !== '');
}

/** Net minor-unit amount the referred member actually kept paying (gross minus refunds, floored at 0). */
export function netPaid(invoice) {
  const gross = Math.max(0, Number(invoice?.amount_paid ?? 0) || 0);
  return Math.max(0, gross - amountRefunded(invoice));
}

/** A payment is reversed (commission void) on a full refund, any dispute, or net <= 0. */
export function isReversed(invoice) {
  if (isDisputed(invoice)) return true;
  const c = chargeOf(invoice);
  if (c && c.refunded === true) return true;
  return netPaid(invoice) <= 0;
}

/** Epoch-ms the invoice was paid (status_transitions.paid_at preferred, else created). */
export function paidAtMs(invoice) {
  const t = invoice?.status_transitions?.paid_at ?? invoice?.created;
  return (Number(t) || 0) * 1000;
}

/**
 * True when tMs falls inside any active interval. Intervals are { startMs, endMs }, endMs null = open
 * (still active). Fail closed: no/empty intervals => not active, so a referrer with no provable active
 * period accrues nothing.
 */
export function isActiveAt(intervals, tMs) {
  if (!Array.isArray(intervals)) return false;
  for (const iv of intervals) {
    const start = Number(iv?.startMs);
    const end = iv?.endMs == null ? Infinity : Number(iv.endMs);
    if (Number.isFinite(start) && tMs >= start && tMs < end) return true;
  }
  return false;
}

/**
 * Reconstruct a referrer's active intervals from their Stripe Customer (expanded subscriptions) plus an
 * optional grandfather grant entry ({ at, until }). Helper for the I/O shell; the pure ledger takes the
 * resulting intervals directly so it stays trivially testable.
 */
export function activeIntervalsFromStripe(customer, grandfatherEntry) {
  const intervals = [];
  for (const s of customer?.subscriptions?.data ?? []) {
    const startSec = Number(s.start_date ?? s.created ?? 0) || 0;
    const startMs = startSec * 1000;
    if (!startMs) continue;
    const open = s.status === 'active' || s.status === 'past_due' || s.status === 'trialing';
    let endMs = null;
    if (!open) {
      const endSec = Number(s.ended_at ?? s.canceled_at ?? s.current_period_end ?? 0) || 0;
      endMs = endSec ? endSec * 1000 : startMs; // closed with no end timestamp = point interval (inactive)
    }
    intervals.push({ startMs, endMs });
  }
  if (grandfatherEntry) {
    const atMs = grandfatherEntry.at ? Date.parse(grandfatherEntry.at) : 0;
    const untilMs = grandfatherEntry.until ? Date.parse(grandfatherEntry.until) : null;
    intervals.push({
      startMs: Number.isFinite(atMs) ? atMs : 0,
      endMs: untilMs != null && Number.isFinite(untilMs) ? untilMs : null,
    });
  }
  return intervals;
}

/**
 * Compute the commission entry for ONE invoice, or null when no commission accrues (referrer inactive at
 * paid time, or zero gross). Pure.
 */
export function commissionForInvoice(invoice, { rate, holdDays, nowMs, referrerActiveIntervals, paidInvoiceIds }) {
  const tPaid = paidAtMs(invoice);
  if (!isActiveAt(referrerActiveIntervals, tPaid)) return null; // referrer not active at accrual time
  const gross = Math.max(0, Number(invoice?.amount_paid ?? 0) || 0);
  if (gross <= 0) return null;

  const currency = invoice?.currency ?? 'usd';
  const payableAtMs = tPaid + Math.max(0, holdDays) * DAY_MS;
  const base = {
    invoiceId: invoice?.id,
    currency,
    grossAmount: gross,
    accruedAtMs: tPaid,
    payableAtMs,
  };

  if (isReversed(invoice)) {
    return { ...base, state: COMMISSION_STATE.voided, amount: 0, netAmount: netPaid(invoice) };
  }

  const net = netPaid(invoice);
  const amount = Math.max(0, Math.round(rate * net));
  let state;
  if (paidInvoiceIds && paidInvoiceIds.has(invoice?.id)) state = COMMISSION_STATE.paid;
  else if (nowMs < payableAtMs) state = COMMISSION_STATE.held;
  else state = COMMISSION_STATE.payable;

  return { ...base, state, amount, netAmount: net };
}

/**
 * Build the full list of commission entries owed to ONE referrer (A) for ONE referred member (B).
 *
 * @param {object} a
 * @param {string|number} a.referrerGithubId
 * @param {string|number} a.referredGithubId
 * @param {boolean} [a.referrerBanned]            banned referrer earns nothing.
 * @param {object[]} a.invoices                   B's paid invoices (charge expanded), e.g. from listInvoices.
 * @param {number} a.rate                         commission rate (0..1).
 * @param {number} a.holdDays                     settlement hold in days.
 * @param {number} a.nowMs                         current epoch-ms.
 * @param {{startMs:number,endMs:?number}[]} a.referrerActiveIntervals  A's active periods.
 * @param {Set<string>} [a.paidInvoiceIds]        invoice ids already transferred (marked `paid`).
 * @param {string} [a.via]                        the content B first landed on (e.g. `post:slug`), from B's
 *                                                Customer metadata. Carried on every entry so the payout job
 *                                                can split the owner's commission with that content's
 *                                                contributors + commenters (SOW-007/008). null = no split.
 * @returns {object[]} commission entries, each tagged with referrerGithubId + referredGithubId (+ via).
 */
export function commissionsForReferral({
  referrerGithubId,
  referredGithubId,
  referrerBanned = false,
  invoices,
  rate,
  holdDays,
  nowMs,
  referrerActiveIntervals,
  paidInvoiceIds,
  via = null,
}) {
  if (referrerBanned) return [];
  if (String(referrerGithubId) === String(referredGithubId)) return []; // self-referral guard
  const out = [];
  for (const inv of invoices ?? []) {
    const entry = commissionForInvoice(inv, { rate, holdDays, nowMs, referrerActiveIntervals, paidInvoiceIds });
    if (entry) {
      out.push({
        ...entry,
        referrerGithubId: String(referrerGithubId),
        referredGithubId: String(referredGithubId),
        via: via || null,
      });
    }
  }
  return out;
}

/**
 * Group commission entries by referrer and total the PAYABLE balance owed (excludes held/voided/paid).
 * Returns a Map referrerGithubId -> { currency, payableAmount, payableInvoiceIds }. Mixed currencies for
 * one referrer are summed per currency only when they match; a differing currency is skipped and noted in
 * skipped[] (real data is single-currency USD, but we never silently sum across currencies).
 */
export function summarizePayable(entries) {
  const byReferrer = new Map();
  const skipped = [];
  for (const e of entries ?? []) {
    if (e.state !== COMMISSION_STATE.payable || !(e.amount > 0)) continue;
    const key = e.referrerGithubId;
    let acc = byReferrer.get(key);
    if (!acc) {
      acc = { referrerGithubId: key, currency: e.currency, payableAmount: 0, payableInvoiceIds: [] };
      byReferrer.set(key, acc);
    }
    if (e.currency !== acc.currency) {
      skipped.push({ referrerGithubId: key, invoiceId: e.invoiceId, reason: `currency ${e.currency} != ${acc.currency}` });
      continue;
    }
    acc.payableAmount += e.amount;
    acc.payableInvoiceIds.push(e.invoiceId);
  }
  return { byReferrer, skipped };
}

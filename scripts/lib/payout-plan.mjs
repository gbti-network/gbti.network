// Referral payout planner (SOW-007). PURE decision logic for the payout job, mirroring how the SOW-005
// reconcile splits planReconcile (pure) from reconcile.mjs (I/O shell). Two pieces:
//   buildLedger   turn already-fetched Stripe data (customers + their invoices + overrides + config)
//                 into the flat commission-entry ledger (via membership/commissions.mjs).
//   planPayouts   turn the PAYABLE entries into idempotent Connect-transfer actions, withholding any
//                 the referrer cannot yet be paid (no Connect account, account not onboarded, or the
//                 payouts master switch is off). Re-running after a successful apply yields no actions,
//                 because the caller passes already-transferred invoice ids as `paidInvoiceIds` so those
//                 entries are `paid`, not `payable`.

import {
  commissionsForReferral,
  activeIntervalsFromStripe,
  COMMISSION_STATE,
} from '../../membership/commissions.mjs';
import { splitCommission } from '../../membership/distribution.mjs';

// Stripe caps metadata at 50 keys/object. The recorded split costs one key per chunk on top of the base keys,
// so cap chunks well under 50 and withhold ('split-too-large') rather than emit a transfer Stripe would reject.
const MAX_SPLIT_CHUNKS = 44;

/**
 * Greedily pack invoice ids into chunks whose comma-joined length stays within `budget`. Retained as a
 * tested utility; planPayouts now emits one transfer per (recipient, invoice) so it no longer batches.
 */
export function chunkInvoiceIds(ids, budget = 450) {
  const chunks = [];
  let cur = [];
  for (const id of ids) {
    const next = cur.length ? `${cur.join(',')},${id}` : String(id);
    if (cur.length && next.length > budget) {
      chunks.push(cur);
      cur = [id];
    } else {
      cur.push(id);
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * Encode a recipient split (`[{id, role, amount}]`) into one or more strings, EACH kept under Stripe's
 * 500-char metadata-value limit, broken at recipient boundaries (a single `id:role:amount` token is always
 * well under the budget). Written across numbered metadata keys (referral_split, referral_split_1, ...) so
 * content with many delegates can never produce a transfer Stripe would reject (which would strand the
 * commission with no self-heal). joinSplitChunks reassembles them.
 */
export function encodeSplitChunks(list, budget = 480) {
  const chunks = [];
  let cur = '';
  for (const r of list ?? []) {
    const tok = `${r.id}:${r.role}:${r.amount}`;
    const next = cur ? `${cur};${tok}` : tok;
    if (cur && next.length > budget) { chunks.push(cur); cur = tok; }
    else cur = next;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Reassemble the numbered referral_split_* metadata values (in index order) into one encoded string. */
function joinSplitChunks(meta) {
  const parts = [];
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (v == null || v === '') continue;
    if (k === 'referral_split') parts.push([0, String(v)]);
    else {
      const m = /^referral_split_(\d+)$/.exec(k);
      if (m) parts.push([Number(m[1]), String(v)]);
    }
  }
  if (!parts.length) return '';
  parts.sort((a, b) => a[0] - b[0]);
  return parts.map((p) => p[1]).join(';');
}

/**
 * Build the commission ledger from gathered Stripe data. Pure (no network): the shell fetches customers
 * and per-customer invoices, then this computes every entry.
 *
 * @param {object} a
 * @param {object[]} a.customers                     all Stripe customers (subscriptions expanded).
 * @param {Map<string,object[]>} a.invoicesByCustomerId  customerId -> that customer's paid invoices.
 * @param {Map<string,object>} [a.grandfatherByGithubId] github_id -> grandfather entry ({at, until}).
 * @param {Set<string>} [a.bannedGithubIds]          banned github_ids (their accrual is voided to nothing).
 * @param {Set<string>} [a.alwaysActiveGithubIds]    github_ids treated as active for all time (e.g. if the
 *                                                    owner decides staff accrue without a subscription).
 * @param {number} a.rate
 * @param {number} a.holdDays
 * @param {number} a.nowMs
 * @param {Set<string>} [a.paidInvoiceIds]           invoice ids already transferred (marked `paid`).
 * @returns {object[]} commission entries.
 */
export function buildLedger({
  customers,
  invoicesByCustomerId,
  grandfatherByGithubId,
  bannedGithubIds,
  alwaysActiveGithubIds,
  rate,
  holdDays,
  nowMs,
  paidInvoiceIds,
}) {
  const byGithubId = new Map();
  for (const c of customers ?? []) {
    const gid = c?.metadata?.github_id;
    if (gid) byGithubId.set(String(gid), c);
  }

  const entries = [];
  for (const b of customers ?? []) {
    const referredBy = b?.metadata?.referred_by;
    if (!referredBy) continue;
    const referrerGithubId = String(referredBy);
    const referredGithubId = String(b?.metadata?.github_id ?? '');
    if (!referredGithubId) continue;

    let intervals;
    if (alwaysActiveGithubIds?.has?.(referrerGithubId)) {
      intervals = [{ startMs: 0, endMs: null }];
    } else {
      const referrerCustomer = byGithubId.get(referrerGithubId) ?? null;
      const grandfather = grandfatherByGithubId?.get?.(referrerGithubId) ?? null;
      intervals = referrerCustomer || grandfather
        ? activeIntervalsFromStripe(referrerCustomer ?? {}, grandfather)
        : [];
    }

    const referrerBanned = bannedGithubIds?.has?.(referrerGithubId) ?? false;
    const invoices = invoicesByCustomerId?.get?.(b.id) ?? [];
    const via = b?.metadata?.via ?? null; // the content the referred member landed on (for the split)

    entries.push(...commissionsForReferral({
      referrerGithubId,
      referredGithubId,
      referrerBanned,
      invoices,
      rate,
      holdDays,
      nowMs,
      referrerActiveIntervals: intervals,
      paidInvoiceIds,
      via,
    }));
  }
  return entries;
}

/**
 * Plan Connect transfers from the ledger's PAYABLE entries, splitting each commission into the OWNER's keep
 * plus any DELEGATE slices (contributors + commenters) the owner chose to share (SOW-007/008).
 *
 * Money safety = ATOMIC PER INVOICE. Each invoice's commission is paid to ALL of its recipients (owner +
 * delegates) in the same run, or to none of them. The OWNER is the settlement anchor: an invoice is
 * considered fully settled exactly when the owner has been paid for it, because the owner is only ever paid
 * together with its delegates. This makes conservation EXACT across runs:
 *   - An UNPAID invoice is re-split freely every run (delegation + the delegate set can still change), and is
 *     paid only when EVERY current recipient has a ready Connect account; if any is not ready, the WHOLE
 *     invoice is withheld (so a delegating owner's payout waits for its delegates to onboard, which is the
 *     owner's opt-in choice, with the remedy of lowering delegation).
 *   - A SETTLED invoice (owner already paid) is FROZEN: never re-opened for a delegate who joins later, and
 *     the owner is never retro-diluted. So a commission can never be over- or under-distributed across runs.
 * One transfer is emitted per (recipient, invoice) with a per-invoice idempotency key, so overlapping runs
 * and re-chunking can never defeat Stripe's dedupe. paidByRecipient (from paidByRecipientFromTransfers, which
 * also reads legacy owner-only transfers) is the cross-run record of which (recipient, invoice) pairs are done.
 *
 * PARTIAL APPLY is the one way the all-or-nothing plan can be broken in practice (a createTransfer throws
 * mid-invoice). To self-heal it, EVERY transfer records the full split (referral_split metadata). When a later
 * run sees an invoice that already has a transfer (recordedSplitByInvoice), it LOCKS to that recorded split and
 * pays only the still-unpaid recipients their RECORDED amounts, never re-splitting from current config. So a
 * commission is conserved exactly even if an apply half-failed AND the delegation/delegate-set later changed.
 *
 * With no delegation inputs (the default, and every pre-delegation commission) splitCommission returns
 * owner = the full amount and no delegates, so the behavior is identical to the original owner-only path
 * (one owner transfer per payable invoice, same withholding reasons).
 *
 * @param {object} a
 * @param {object[]} a.entries                         commission entries (from buildLedger), each may carry `via`.
 * @param {Map<string,{accountId:string,payoutsReady:boolean,historyLoaded?:boolean}>} a.connectByReferrer
 *        github_id -> Connect account state, for EVERY recipient (owners AND delegates), not just referrers.
 * @param {boolean} a.payoutsActive                    the referral-config master+payouts switch (isPayoutsActive).
 * @param {Map<string,Set<string>>} [a.paidByRecipient]  recipient github_id -> set of invoice ids already paid to them.
 * @param {Map<string,{id:string,role:string,amount:number}[]>} [a.recordedSplitByInvoice]  invoice id -> the split
 *        recorded on a prior transfer (splitByInvoiceFromTransfers). Present => the invoice is mid-settlement and is
 *        completed at the RECORDED amounts (a partial apply self-heals; later config changes are ignored).
 * @param {Map<string,string>} [a.contentOwnerByVia]   via slug -> the content's TRUE author github_id (anti-spoof).
 * @param {Map<string,{contributions:number,comments:number}>} [a.delegationByContent]  via slug -> owner's delegation.
 * @param {Map<string,{id:string,points:number}[]>} [a.contributorsByContent]            via slug -> contributor points.
 * @param {Map<string,{id:string,points:number,ageDays:number}[]>} [a.commentsByContent] via slug -> commenter list.
 * @param {object} [a.distributionConfig]              optional splitter config override.
 * @returns {{actions: object[], withheld: object[]}}  transfer actions, and balances NOT transferred this run.
 */
export function planPayouts({
  entries,
  connectByReferrer,
  payoutsActive,
  paidByRecipient,
  recordedSplitByInvoice,
  contentOwnerByVia,
  delegationByContent,
  contributorsByContent,
  commentsByContent,
  distributionConfig,
}) {
  const actions = [];
  const withheld = [];

  const getConnect = (id) =>
    connectByReferrer?.get?.(String(id)) ?? (connectByReferrer ? connectByReferrer[String(id)] : undefined);
  const alreadyPaid = (recipientId, invoiceId) => Boolean(paidByRecipient?.get?.(String(recipientId))?.has?.(invoiceId));

  // Why a recipient cannot be paid right now (fail-closed order); null = ready.
  const blockReason = (recipientId) => {
    if (!payoutsActive) return 'payouts-disabled';
    const c = getConnect(recipientId);
    if (!c || !c.accountId) return 'no-connect-account';
    // Fail closed on an unreadable transfer history (double-pay guard): paidByRecipient is built from existing
    // transfers, so if that read FAILED for this recipient we cannot tell what we already paid them.
    if (c.historyLoaded === false) return 'transfer-history-unavailable';
    if (!c.payoutsReady) return 'connect-not-ready';
    return null;
  };

  // The full split is recorded on EVERY transfer (referral_split = id:role:amount;...). That is what makes a
  // PARTIAL apply (some transfers landed, others threw) self-heal with exact conservation: a later run reads
  // the recorded split from any surviving transfer and pays only the still-unpaid recipients their RECORDED
  // amounts, never re-splitting from current config.
  // One transfer per (recipient, role, invoice) per run, even if a malformed ledger duplicates an invoice id,
  // so the per-invoice idempotency guarantee never depends on Stripe's 24h window or upstream integrity.
  const emittedKeys = new Set();
  const emit = (r, invoiceId, currency, splitChunks, ownerId) => {
    const idempotencyKey = `referral-payout:${r.id}:${r.role}:${invoiceId}`;
    if (emittedKeys.has(idempotencyKey)) return;
    emittedKeys.add(idempotencyKey);
    const connect = getConnect(r.id);
    const isOwner = r.role === 'owner';
    const metadata = {
      referral_invoices: invoiceId,
      referral_invoice_count: '1',
      payout_recipient: String(r.id),
      payout_role: r.role,
    };
    // The full split is recorded across numbered keys (referral_split, referral_split_1, ...) each kept under
    // Stripe's 500-char-per-value limit, so popular content with many delegates never produces a transfer
    // Stripe would reject (which would strand the whole commission with no self-heal).
    splitChunks.forEach((chunk, i) => { metadata[i === 0 ? 'referral_split' : `referral_split_${i}`] = chunk; });
    if (isOwner) metadata.referrer_github_id = String(ownerId);
    actions.push({
      type: 'transfer',
      recipientGithubId: String(r.id),
      ...(isOwner ? { referrerGithubId: String(ownerId) } : {}),
      role: r.role,
      destination: connect.accountId,
      amount: r.amount,
      currency,
      invoiceIds: [invoiceId],
      idempotencyKey,
      metadata,
    });
  };
  const withhold = (r, invoiceId, currency, ownerId, reason) => {
    const c = getConnect(r.id);
    withheld.push({
      recipientGithubId: String(r.id),
      ...(r.role === 'owner' ? { referrerGithubId: String(ownerId) } : {}),
      role: r.role,
      amount: r.amount,
      currency,
      invoiceIds: [invoiceId],
      ...(c?.accountId ? { accountId: c.accountId } : {}),
      reason,
    });
  };

  for (const e of entries ?? []) {
    if (e.state !== COMMISSION_STATE.payable || !(e.amount > 0)) continue;
    const ownerId = String(e.referrerGithubId);
    const invoiceId = e.invoiceId;
    const currency = e.currency;

    const recorded = recordedSplitByInvoice?.get?.(invoiceId);
    let recipientList; // [{ id, role, amount }]
    let locked; // the split is frozen to the recorded amounts (an apply already started on this invoice)

    if (recorded && recorded.length) {
      // LOCKED: this invoice already has at least one transfer. Complete the ORIGINAL split, ignoring any later
      // delegation / delegate-set / config change. Pay each recorded recipient (when ready) their EXACT amount.
      // FAIL CLOSED on a recorded split that does not sum to the commission (corruption / partial parse /
      // truncation): withhold the unpaid recipients with a clear reason rather than silently under-pay.
      const recordedTotal = recorded.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      if (recordedTotal !== e.amount) {
        for (const r of recorded) {
          if (!alreadyPaid(r.id, invoiceId)) withhold(r, invoiceId, currency, ownerId, 'recorded-split-mismatch');
        }
        continue;
      }
      recipientList = recorded;
      locked = true;
    } else if (alreadyPaid(ownerId, invoiceId)) {
      // LEGACY freeze: the owner was paid by an old owner-only (full-amount) transfer that carried no
      // referral_split, so the invoice is fully settled. Never re-open it for delegates added later.
      continue;
    } else {
      // FRESH: compute the split from current config (anti-spoof: only delegate when the via-content's TRUE
      // author equals THIS commission's referrer).
      const via = e.via || null;
      const trustedOwner = via ? contentOwnerByVia?.get?.(via) : null;
      const delegate = Boolean(via && trustedOwner != null && String(trustedOwner) === ownerId);
      const delegation = (delegate && delegationByContent?.get?.(via)) || {};
      const contributors = (delegate && contributorsByContent?.get?.(via)) || [];
      const comments = (delegate && commentsByContent?.get?.(via)) || [];
      const split = splitCommission({ commissionAmount: e.amount, delegation, contributors, comments, config: distributionConfig });
      const byId = new Map(); // merge a same-id contributor+commenter into one slice
      const add = (id, role, amount) => {
        if (!(amount > 0)) return;
        const k = String(id);
        const cur = byId.get(k);
        if (cur) { cur.amount += amount; if (cur.role !== role) cur.role = 'delegate'; }
        else byId.set(k, { id: k, role, amount });
      };
      add(ownerId, 'owner', split.owner);
      for (const c of split.contributions) add(c.id, 'contributor', c.amount);
      for (const m of split.comments) add(m.id, 'commenter', m.amount);
      recipientList = [...byId.values()];
      locked = false;
    }

    const splitChunks = encodeSplitChunks(recipientList);
    // Fail closed on Stripe's 50-keys-per-metadata limit: the recorded split costs one key per chunk on top of
    // the ~5 base keys, so a split with too many recipients would produce a transfer Stripe rejects (and the
    // commission would strand with no self-heal). UNREACHABLE under the $150 product (the 7% pool caps the
    // recipient count near ~326 = ~19 chunks), but guard it so a future higher price/rate withholds visibly.
    if (splitChunks.length > MAX_SPLIT_CHUNKS) {
      for (const r of recipientList) if (!alreadyPaid(r.id, invoiceId)) withhold(r, invoiceId, currency, ownerId, 'split-too-large');
      continue;
    }
    const unpaid = recipientList.filter((r) => r.amount > 0 && !alreadyPaid(r.id, invoiceId));
    if (!unpaid.length) continue; // fully settled

    if (locked) {
      // The split is frozen, so pay each ready recipient INDEPENDENTLY (their amounts are fixed; no atomicity
      // needed to preserve conservation once an invoice is in settlement).
      for (const r of unpaid) {
        const reason = blockReason(r.id);
        if (reason) withhold(r, invoiceId, currency, ownerId, reason);
        else emit(r, invoiceId, currency, splitChunks, ownerId);
      }
    } else {
      // FRESH: ATOMIC all-or-nothing so the first settlement either fully lands or (on a partial apply) leaves a
      // recorded split the locked path completes. If any recipient is not ready, the WHOLE invoice waits.
      const blocks = unpaid.map((r) => blockReason(r.id));
      if (blocks.some((b) => b != null)) {
        unpaid.forEach((r, i) => withhold(r, invoiceId, currency, ownerId, blocks[i] || 'awaiting-co-recipient'));
        continue;
      }
      for (const r of unpaid) emit(r, invoiceId, currency, splitChunks, ownerId);
    }
  }

  return { actions, withheld };
}

/**
 * Reconstruct the per-invoice recorded split from existing transfers' `referral_split` metadata (the
 * id:role:amount;... blob written on every split transfer). Returns Map<invoiceId, [{id, role, amount}]>.
 * Legacy / multi-invoice transfers (no referral_split, or a comma-joined invoice list) are skipped, so an
 * old owner-only payment is handled by the LEGACY freeze, not here.
 */
export function splitByInvoiceFromTransfers(transfers) {
  const map = new Map();
  for (const t of transfers ?? []) {
    const meta = t?.metadata ?? {};
    const inv = meta.referral_invoices;
    const enc = joinSplitChunks(meta); // reassembles referral_split + referral_split_1 + ...
    if (!inv || !enc || String(inv).includes(',') || map.has(inv)) continue;
    const list = [];
    for (const part of String(enc).split(';')) {
      const [id, role, amount] = part.split(':');
      const amt = Number(amount);
      if (id && role && Number.isFinite(amt)) list.push({ id: String(id), role, amount: amt });
    }
    if (list.length) map.set(String(inv), list);
  }
  return map;
}

/** Parse already-paid invoice ids from existing Connect transfers' metadata (cross-run dedupe, legacy). */
export function paidInvoiceIdsFromTransfers(transfers) {
  const set = new Set();
  for (const t of transfers ?? []) {
    const joined = t?.metadata?.referral_invoices;
    if (!joined) continue;
    for (const id of String(joined).split(',')) {
      const trimmed = id.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return set;
}

/**
 * Build the PER-RECIPIENT paid map from existing Connect transfers: recipient github_id -> set of invoice
 * ids already transferred to THAT recipient. The recipient is `metadata.payout_recipient` on new split
 * transfers, falling back to `metadata.referrer_github_id` on legacy owner-only transfers (so both dedupe
 * correctly). This is what planPayouts uses to avoid re-paying any (recipient, invoice) pair.
 */
export function paidByRecipientFromTransfers(transfers) {
  const map = new Map();
  for (const t of transfers ?? []) {
    const meta = t?.metadata ?? {};
    const recipient =
      meta.payout_recipient != null && meta.payout_recipient !== ''
        ? String(meta.payout_recipient)
        : meta.referrer_github_id != null && meta.referrer_github_id !== ''
          ? String(meta.referrer_github_id)
          : null;
    const joined = meta.referral_invoices;
    if (!recipient || !joined) continue;
    let set = map.get(recipient);
    if (!set) { set = new Set(); map.set(recipient, set); }
    for (const id of String(joined).split(',')) {
      const trimmed = id.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return map;
}

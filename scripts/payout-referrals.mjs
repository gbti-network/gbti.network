#!/usr/bin/env node
// SOW-007/008 referral payout job. Computes the referral commission ledger from Stripe (the referred
// members' paid invoices), SPLITS each commission into the content owner's keep plus any delegate slices
// (contributors + commenters the owner chose to share), and pays them out via Stripe Connect transfers.
// Runs locally (owner runs --dry-run first, then --apply) and can be scheduled alongside the reconcile.
//
//   node scripts/payout-referrals.mjs            # DRY RUN: prints the ledger + planned transfers, changes nothing
//   node scripts/payout-referrals.mjs --apply    # creates the Connect transfers
//   node scripts/payout-referrals.mjs --dry-run  # explicit dry run
//
// Design mirrors reconcile.mjs: every decision lives in the PURE modules (scripts/lib/payout-plan.mjs
// buildLedger + planPayouts, membership/distribution*.mjs, scripts/lib/distribution-gather.mjs); this
// file is the thin I/O shell that reads Stripe + the git-native content/points/comments and feeds them in.
//
// Fail closed on MONEY: payouts only happen when house/referral-config.yml has BOTH enabled AND
// payouts_enabled (isPayoutsActive). A missing/unparseable config, a missing Connect account, an
// un-onboarded account, or an unreadable transfer history all WITHHOLD (accrue) the balance rather than
// pay. Cross-run safety is PER RECIPIENT: each recipient's existing transfers are read and the (recipient,
// invoice) pairs they cover are marked paid, so a re-run never double-pays anyone, and a delegate who had
// no Connect account at first is still paid on a later run (their slice accrued, the owner was not blocked).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStripeClient } from '../clients/stripe.mjs';
import { loadOverrides } from '../membership/overrides.mjs';
import { loadReferralConfig, isPayoutsActive } from '../membership/referral-config.mjs';
import { buildLedger, planPayouts, paidByRecipientFromTransfers, splitByInvoiceFromTransfers } from './lib/payout-plan.mjs';
import { assembleDistributionInputs, readContentIndex, readComments, readAwards } from './lib/distribution-gather.mjs';
import { COMMISSION_STATE } from '../membership/commissions.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  return { apply: apply && !argv.includes('--dry-run'), dryRun: argv.includes('--dry-run') || !apply };
}

/** Format a minor-unit amount as a human string, e.g. 4500 + usd -> "45.00 USD". */
export function formatAmount(amount, currency) {
  return `${(amount / 100).toFixed(2)} ${String(currency || 'usd').toUpperCase()}`;
}

/** A Connect account is ready to receive transfers only when fully onboarded. Fail closed on any doubt. */
export function connectReady(account) {
  return Boolean(account && account.details_submitted === true && account.payouts_enabled === true);
}

/**
 * Gather the customers + their paid invoices from Stripe (no Connect reads yet; those come after the
 * ledger so we know which delegate accounts to read too).
 * @returns {{customers, byGithubId, invoicesByCustomerId, referrerIds:Set<string>}}
 */
export async function gatherCustomers(stripe) {
  const customers = [];
  for await (const c of stripe.listCustomers()) customers.push(c);

  const byGithubId = new Map();
  for (const c of customers) {
    const gid = c?.metadata?.github_id;
    if (gid) byGithubId.set(String(gid), c);
  }

  const referredCustomers = customers.filter((c) => c?.metadata?.referred_by);
  const invoicesByCustomerId = new Map();
  for (const b of referredCustomers) {
    const invoices = [];
    try {
      for await (const inv of stripe.listInvoices({ customer: b.id, status: 'paid' })) invoices.push(inv);
    } catch (err) {
      console.warn(`payout: could not list invoices for ${b.id} (${err?.message ?? err}); skipping that member.`);
    }
    invoicesByCustomerId.set(b.id, invoices);
  }

  const referrerIds = new Set(referredCustomers.map((b) => String(b.metadata.referred_by)));
  return { customers, byGithubId, invoicesByCustomerId, referrerIds };
}

/**
 * Read each recipient's Connect account state + their existing transfers, building connectByReferrer (the
 * readiness map the planner gates on) and paidByRecipient (the per-recipient cross-run dedupe). recipientIds
 * covers BOTH referrers (content owners) and delegates (contributors/commenters). A transfer-history read
 * failure marks that recipient historyLoaded=false so the planner withholds them this run (double-pay guard).
 * @returns {{connectByReferrer:Map, paidByRecipient:Map}}
 */
export async function gatherConnectForRecipients(stripe, recipientIds, byGithubId) {
  const connectByReferrer = new Map();
  const paidByRecipient = new Map();
  const recordedSplitByInvoice = new Map();

  for (const id of recipientIds) {
    const key = String(id);
    const customer = byGithubId.get(key);
    const accountId = customer?.metadata?.connect_account_id || null;
    if (!accountId) {
      connectByReferrer.set(key, { accountId: null, payoutsReady: false });
      continue;
    }
    let payoutsReady = false;
    try {
      payoutsReady = connectReady(await stripe.getConnectAccount(accountId));
    } catch (err) {
      console.warn(`payout: could not read Connect account ${accountId} for ${key} (${err?.message ?? err}); withholding.`);
    }
    let historyLoaded = true;
    try {
      const transfers = [];
      for await (const t of stripe.listTransfers({ destination: accountId })) transfers.push(t);
      for (const [rid, set] of paidByRecipientFromTransfers(transfers)) {
        let s = paidByRecipient.get(rid);
        if (!s) { s = new Set(); paidByRecipient.set(rid, s); }
        for (const inv of set) s.add(inv);
      }
      // Reconstruct the recorded split so a partially-applied invoice is completed at its original amounts.
      for (const [inv, list] of splitByInvoiceFromTransfers(transfers)) {
        if (!recordedSplitByInvoice.has(inv)) recordedSplitByInvoice.set(inv, list);
      }
    } catch (err) {
      historyLoaded = false;
      console.warn(`payout: could not list transfers for ${accountId} (${err?.message ?? err}); WITHHOLDING ${key} this run to avoid double-pay.`);
    }
    connectByReferrer.set(key, { accountId, payoutsReady, historyLoaded });
  }

  return { connectByReferrer, paidByRecipient, recordedSplitByInvoice };
}

function describeLedger(entries) {
  const tally = { held: 0, payable: 0, voided: 0, paid: 0 };
  let payableTotal = 0;
  for (const e of entries) {
    tally[e.state] = (tally[e.state] ?? 0) + 1;
    if (e.state === COMMISSION_STATE.payable) payableTotal += e.amount;
  }
  return { tally, payableTotal };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const env = process.env;
  const nowMs = new Date().getTime();

  const config = loadReferralConfig(ROOT);
  const overrides = loadOverrides(ROOT);
  const payoutsActive = isPayoutsActive(config);
  const bannedGithubIds = new Set(overrides.bans.keys());

  console.log(
    `payout: referral-config enabled=${config.enabled} payouts_enabled=${config.payouts_enabled} ` +
    `(payoutsActive=${payoutsActive}) rate=${config.rate} hold_days=${config.hold_days}`,
  );

  const stripe = createStripeClient({ apiKey: env.STRIPE_SECRET_KEY });
  const { customers, byGithubId, invoicesByCustomerId, referrerIds } = await gatherCustomers(stripe);

  // No paidInvoiceIds here on purpose: the per-recipient dedupe happens in planPayouts so a withheld
  // delegate slice can still be paid on a later run after the owner's invoice was already settled.
  const entries = buildLedger({
    customers,
    invoicesByCustomerId,
    grandfatherByGithubId: overrides.grandfathers,
    bannedGithubIds,
    rate: config.rate,
    holdDays: config.hold_days,
    nowMs,
  });

  // Per-content delegation + contributors + commenters for the vias in the ledger (git-native sources).
  const distribution = assembleDistributionInputs({
    entries,
    contentIndex: readContentIndex(ROOT),
    awards: readAwards(ROOT),
    comments: readComments(ROOT),
    membersIndex: overrides.membersIndex,
    bannedGithubIds,
    nowMs,
  });

  // Connect state + per-recipient paid map + any recorded splits, for every recipient: referrers PLUS delegates.
  const recipientIds = new Set([...referrerIds, ...distribution.delegateIds]);
  const { connectByReferrer, paidByRecipient, recordedSplitByInvoice } = await gatherConnectForRecipients(stripe, recipientIds, byGithubId);

  const { tally, payableTotal } = describeLedger(entries);
  console.log(
    `payout: ledger has ${entries.length} commission(s) ` +
    `[held=${tally.held} payable=${tally.payable} voided=${tally.voided} paid=${tally.paid}], ` +
    `payable total ${formatAmount(payableTotal, 'usd')}.`,
  );
  if (distribution.delegationByContent.size) {
    console.log(`payout: ${distribution.delegationByContent.size} content item(s) delegate part of their commission to contributors/commenters.`);
  }

  const { actions, withheld } = planPayouts({
    entries,
    connectByReferrer,
    payoutsActive,
    paidByRecipient,
    recordedSplitByInvoice,
    contentOwnerByVia: distribution.contentOwnerByVia,
    delegationByContent: distribution.delegationByContent,
    contributorsByContent: distribution.contributorsByContent,
    commentsByContent: distribution.commentsByContent,
  });

  for (const w of withheld) {
    console.log(`  withhold ${w.recipientGithubId} (${w.role})  ${formatAmount(w.amount, w.currency)}  (${w.reason})`);
  }
  for (const a of actions) {
    console.log(`  transfer ${a.recipientGithubId} (${a.role}) -> ${a.destination}  ${formatAmount(a.amount, a.currency)}  invoices=${a.invoiceIds.length}`);
  }
  console.log(`payout: ${actions.length} transfer(s) planned, ${withheld.length} balance(s) withheld.`);

  if (dryRun) {
    console.log('payout: DRY RUN (no transfers). Re-run with --apply to enact.');
    return;
  }
  if (!payoutsActive) {
    console.log('payout: payouts are NOT active (referral-config). Nothing transferred.');
    return;
  }

  // Best-effort, fault-tolerant apply: a single failed transfer must NOT abort the rest. Every transfer
  // records the full split (referral_split), so any that fail this run are completed on a later run from the
  // recorded amounts (planPayouts' locked path), preserving exact conservation. The idempotency key makes a
  // re-run of a SUCCEEDED transfer a no-op within Stripe's window; the cross-run paidByRecipient covers beyond it.
  let made = 0;
  let failed = 0;
  for (const a of actions) {
    try {
      await stripe.createTransfer(
        { amount: a.amount, currency: a.currency, destination: a.destination, metadata: a.metadata },
        a.idempotencyKey,
      );
      made++;
    } catch (err) {
      failed++;
      console.error(`payout: transfer to ${a.recipientGithubId} (${a.role}) for ${a.invoiceIds.join(',')} FAILED (${err?.message ?? err}); a later run completes it from the recorded split.`);
    }
  }
  console.log(`payout: applied. ${made} transfer(s) created${failed ? `, ${failed} FAILED (re-run to complete).` : '.'}`);
  if (failed) process.exitCode = 1; // signal the operator to re-run; conservation is preserved meanwhile
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('payout: failed:', err?.message ?? err);
    process.exit(1);
  });
}

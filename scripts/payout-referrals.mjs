#!/usr/bin/env node
// SOW-059 referral payout job. Pays out the FROZEN conversion snapshots (scripts/lib/snapshot-payout-plan.mjs):
// per converted member, per PAYABLE paid invoice, base = NET invoice revenue split 30/10/5/10 (first-touch /
// last-touch / collaboration / invite lane), eligibility (not-banned + active) re-applied at payout, via Stripe
// Connect transfers. Replaces the SOW-007 link/delegation job (clean replacement: there are zero legacy transfers).
//
//   node scripts/payout-referrals.mjs            # DRY RUN: prints the plan, changes nothing
//   node scripts/payout-referrals.mjs --apply    # creates the Connect transfers
//   node scripts/payout-referrals.mjs --dry-run  # explicit dry run
//
// The pure money math lives in scripts/lib/snapshot-payout-plan.mjs; this file is the thin I/O shell that reads the
// frozen snapshots from KV (`conv:*`), each member's paid invoices + Connect state from Stripe, and feeds the planner.
//
// Fail closed on MONEY: payouts only happen when house/referral-config.yml has BOTH enabled AND payouts_enabled
// (isPayoutsActive). A member with no frozen snapshot pays nobody (retain 100%); a missing/un-onboarded Connect
// account withholds (accrues); cross-run dedupe reads each recipient's existing transfers so a re-run never
// double-pays. Collaboration POINTS (the 5% pool) are taken as frozen on the snapshot; populating them from git at
// payout is the C-gather follow-up (until then the 5% pool returns to retained -- safe, never mis-paid).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStripeClient } from '../clients/stripe.mjs';
import { loadOverrides } from '../membership/overrides.mjs';
import { loadReferralConfig, isPayoutsActive } from '../membership/referral-config.mjs';
import { activeIntervalsFromStripe, isActiveAt, COMMISSION_STATE } from '../membership/commissions.mjs';
import { planSnapshotPayouts, invoiceState, buildEarningsLedger } from './lib/snapshot-payout-plan.mjs';
import { listKvByPrefix, putKvValue } from './lib/erase-member.mjs';
import { readCommentsIndex, gatherSnapshotPoints, reverseMembersIndex } from './lib/collaboration-gather.mjs';

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

/** Read the frozen conversion snapshots from KV `conv:*`. `listKv` is injected ({ available, entries:[{key,value}] }).
 *  Returns Map<member github_id, snapshot record>. A missing KV (no creds) yields an empty map (a dry-run no-op). */
export async function gatherSnapshots(listKv) {
  const listed = await listKv({ prefix: 'conv:' });
  const byMember = new Map();
  if (!listed?.available) return byMember;
  for (const { value } of listed.entries) {
    if (value && value.member) byMember.set(String(value.member), value);
  }
  return byMember;
}

/** Build byGithubId from all customers (the github_id -> customer map for invoices, Connect, eligibility). */
export async function gatherCustomers(stripe) {
  const byGithubId = new Map();
  for await (const c of stripe.listCustomers()) {
    const gid = c?.metadata?.github_id;
    if (gid) byGithubId.set(String(gid), c);
  }
  return byGithubId;
}

/** For each converted member WITH a snapshot, list their paid invoices (the lifetime stream the split applies to). */
export async function gatherMemberInvoices(stripe, members, byGithubId) {
  const invoicesByMember = new Map();
  for (const member of members) {
    const customer = byGithubId.get(String(member));
    if (!customer?.id) { invoicesByMember.set(member, []); continue; }
    const invoices = [];
    try {
      for await (const inv of stripe.listInvoices({ customer: customer.id, status: 'paid' })) invoices.push(inv);
    } catch (err) {
      console.warn(`payout: could not list invoices for member ${member} (${err?.message ?? err}); skipping.`);
    }
    invoicesByMember.set(member, invoices);
  }
  return invoicesByMember;
}

/** Eligibility-at-payout: NOT banned AND active (a current paid subscription OR a grandfather grant). The frozen
 *  snapshot pins WHO; this only re-checks PAID-OR-NOT, so a later ban/lapse drops that share to retained. */
export function buildEligible({ bannedGithubIds, byGithubId, grandfathers, nowMs }) {
  return (member) => {
    const id = String(member);
    if (bannedGithubIds.has(id)) return false;
    const grandfather = grandfathers.get(id);
    const intervals = activeIntervalsFromStripe(byGithubId.get(id), grandfather);
    return isActiveAt(intervals, nowMs);
  };
}

/** Cross-run dedupe: the set of `${recipient}:${invoice}` pairs already covered by existing snapshot-payout transfers
 *  (read from this job's own metadata; there is no legacy SOW-007 metadata to consider). */
export function paidPairsFromTransfers(transfers) {
  const pairs = new Set();
  for (const t of transfers || []) {
    const recipient = t?.metadata?.payout_recipient;
    const invoice = t?.metadata?.snapshot_invoice;
    if (recipient && invoice) pairs.add(`${recipient}:${invoice}`);
  }
  return pairs;
}

/**
 * Read each recipient's Connect account state + their existing transfers, building recipientConnect (ready +
 * destination) and paidPairs (cross-run dedupe). A transfer-history read failure marks that recipient not-ready
 * this run (withhold -> avoid double-pay). recipientIds = every github_id a snapshot pays (owners, inviter, collab).
 */
export async function gatherConnectForRecipients(stripe, recipientIds, byGithubId) {
  const connect = new Map();
  const paidPairs = new Set();
  for (const id of recipientIds) {
    const key = String(id);
    const accountId = byGithubId.get(key)?.metadata?.connect_account_id || null;
    if (!accountId) { connect.set(key, { ready: false, destination: null }); continue; }
    let ready = false;
    try { ready = connectReady(await stripe.getConnectAccount(accountId)); }
    catch (err) { console.warn(`payout: could not read Connect account ${accountId} for ${key} (${err?.message ?? err}); withholding.`); }
    try {
      const transfers = [];
      for await (const t of stripe.listTransfers({ destination: accountId })) transfers.push(t);
      for (const p of paidPairsFromTransfers(transfers)) paidPairs.add(p);
    } catch (err) {
      ready = false; // unreadable history -> withhold this run (double-pay guard)
      console.warn(`payout: could not list transfers for ${accountId} (${err?.message ?? err}); WITHHOLDING ${key} this run.`);
    }
    connect.set(key, { ready, destination: accountId });
  }
  return { connect, paidPairs };
}

/** Every github_id a snapshot would pay: first/last-touch owners, the inviter, and collaboration recipients. */
export function recipientsFromSnapshots(snapshots) {
  const ids = new Set();
  for (const s of snapshots.values()) {
    for (const id of [s.firstOwner, s.lastOwner, s.inviter]) if (id) ids.add(String(id));
    for (const p of s.points || []) if (p?.member) ids.add(String(p.member));
  }
  return ids;
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
    `(payoutsActive=${payoutsActive}) hold_days=${config.hold_days}`,
  );

  const stripe = createStripeClient({ apiKey: env.STRIPE_SECRET_KEY });
  const snapshots = await gatherSnapshots((opts) => listKvByPrefix({ ...opts, env }));
  console.log(`payout: ${snapshots.size} frozen conversion snapshot(s).`);
  if (snapshots.size === 0) {
    console.log('payout: no snapshots to pay (nobody has converted under the SOW-059 model yet). Nothing to do.');
    return;
  }

  // SOW-059 C-gather: reconstruct each snapshot's collaboration points (the 5% pool) from git at payout. The frozen
  // items + conversion window make this deterministic. Read the comment index once; contributors are read per item.
  const reverseIndex = reverseMembersIndex(overrides.membersIndex);
  const commentsIndex = readCommentsIndex(ROOT);
  for (const snapshot of snapshots.values()) {
    snapshot.points = gatherSnapshotPoints({ root: ROOT, snapshot, membersIndex: overrides.membersIndex, reverseIndex, commentsIndex });
  }

  const byGithubId = await gatherCustomers(stripe);
  const invoicesByMember = await gatherMemberInvoices(stripe, [...snapshots.keys()], byGithubId);
  const recipientIds = recipientsFromSnapshots(snapshots);
  const { connect, paidPairs } = await gatherConnectForRecipients(stripe, recipientIds, byGithubId);
  const eligible = buildEligible({ bannedGithubIds, byGithubId, grandfathers: overrides.grandfathers, nowMs });

  // Describe the matured balance before planning (held vs payable vs voided across all members' invoices).
  const tally = { held: 0, payable: 0, voided: 0 };
  for (const [member, invoices] of invoicesByMember) {
    for (const inv of invoices) tally[invoiceState(inv, { holdDays: config.hold_days, nowMs }).state] += 1;
  }
  console.log(`payout: invoices [held=${tally.held} payable=${tally.payable} voided=${tally.voided}] across ${snapshots.size} member(s).`);

  const members = [...snapshots.entries()].map(([member, snapshot]) => ({ member, snapshot, invoices: invoicesByMember.get(member) || [] }));
  const { actions, withheld } = planSnapshotPayouts({
    members, nowMs, holdDays: config.hold_days, eligible, paidPairs,
    recipientConnect: (id) => connect.get(String(id)) || { ready: false, destination: null },
  });

  for (const w of withheld) console.log(`  withhold ${w.recipientGithubId} (${w.role})  ${formatAmount(w.amount, w.currency)}  (${w.reason})`);
  for (const a of actions) console.log(`  transfer ${a.recipientGithubId} (${a.role}) -> ${a.destination}  ${formatAmount(a.amount, a.currency)}  invoice=${a.invoiceId}`);
  console.log(`payout: ${actions.length} transfer(s) planned, ${withheld.length} balance(s) withheld.`);

  if (dryRun) { console.log('payout: DRY RUN (no transfers, earnings ledger not written). Re-run with --apply to enact.'); return; }

  // SOW-083 P2: persist each recipient's earnings ledger (held + payable + paid) so the member dashboard can read it.
  // Written on a real run REGARDLESS of payoutsActive, since members ACCRUE before payouts are switched on. The KV
  // value holds github_ids + amounts only (erasure-resilient); the Worker serves earnings:<github_id> per member.
  const earnings = buildEarningsLedger({ members, nowMs, holdDays: config.hold_days, eligible, paidPairs });
  let wroteEarnings = 0;
  for (const [recipient, ledger] of earnings) {
    // SOW-083 P3: record this recipient's Connect readiness (already gathered) so the dashboard can prompt setup.
    const c = connect.get(String(recipient)) || {};
    const payoutSetup = { connected: !!c.destination, ready: !!c.ready };
    try {
      await putKvValue({ key: `earnings:${recipient}`, value: JSON.stringify({ v: 1, recipient, ...ledger, payoutSetup, updatedAt: nowMs }), env });
      wroteEarnings++;
    } catch (err) { console.warn(`payout: could not write earnings for ${recipient} (${err?.message ?? err}).`); }
  }
  console.log(`payout: earnings ledger written for ${wroteEarnings} recipient(s).`);

  if (!payoutsActive) { console.log('payout: payouts are NOT active (referral-config). Nothing transferred.'); return; }

  // Best-effort, fault-tolerant apply: a single failed transfer must NOT abort the rest. The idempotency key makes
  // a re-run of a succeeded transfer a no-op within Stripe's window; the cross-run paidPairs covers beyond it.
  let made = 0, failed = 0;
  for (const a of actions) {
    try {
      await stripe.createTransfer(
        {
          amount: a.amount, currency: a.currency, destination: a.destination,
          metadata: { snapshot_member: a.member, snapshot_invoice: a.invoiceId, payout_recipient: a.recipientGithubId, payout_role: a.role },
        },
        a.idempotencyKey,
      );
      made++;
    } catch (err) {
      failed++;
      console.error(`payout: transfer to ${a.recipientGithubId} (${a.role}) for ${a.invoiceId} FAILED (${err?.message ?? err}); re-run to complete.`);
    }
  }
  console.log(`payout: applied. ${made} transfer(s) created${failed ? `, ${failed} FAILED (re-run to complete).` : '.'}`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('payout: failed:', err?.message ?? err);
    process.exit(1);
  });
}

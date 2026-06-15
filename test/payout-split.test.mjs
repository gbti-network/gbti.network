// SOW-007/008: the payout planner splitting a commission into owner + delegate transfers, with
// per-recipient cross-run dedupe (the accrual / no-starvation guarantee). Pure, deterministic, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLedger, planPayouts, paidByRecipientFromTransfers, splitByInvoiceFromTransfers, encodeSplitChunks } from '../scripts/lib/payout-plan.mjs';
import { COMMISSION_STATE } from '../membership/commissions.mjs';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const sec = (ms) => Math.floor(ms / 1000);

// A payable commission entry the owner (100) earned, with the reader's landed-on content tagged.
const payable = (over = {}) => ({ state: 'payable', amount: 4500, currency: 'usd', invoiceId: 'in_a', referrerGithubId: '100', via: 'post:hello', ...over });

const ready = (id) => [id, { accountId: `acct_${id}`, payoutsReady: true }];
const DELEGATION = new Map([['post:hello', { contributions: 0.07, comments: 0.03 }]]);
const CONTRIBUTORS = new Map([['post:hello', [{ id: '200', points: 7 }]]]);
const COMMENTS = new Map([['post:hello', [{ id: '300', points: 7, ageDays: 10 }]]]);
// the via-content "post:hello" is genuinely authored by the owner (100), so delegation is trusted
const OWNER_BY_VIA = new Map([['post:hello', '100']]);

test('splits one commission into owner + contributor + commenter transfers, conserving every cent', () => {
  const connect = new Map([ready('100'), ready('200'), ready('300')]);
  const { actions, withheld } = planPayouts({
    entries: [payable()],
    connectByReferrer: connect,
    payoutsActive: true,
    contentOwnerByVia: OWNER_BY_VIA,
    delegationByContent: DELEGATION,
    contributorsByContent: CONTRIBUTORS,
    commentsByContent: COMMENTS,
  });
  assert.equal(withheld.length, 0);
  assert.equal(actions.length, 3);

  const owner = actions.find((a) => a.role === 'owner');
  const contrib = actions.find((a) => a.role === 'contributor');
  const commenter = actions.find((a) => a.role === 'commenter');

  assert.equal(owner.amount, 4050); // keeps $40.50
  assert.equal(owner.destination, 'acct_100');
  assert.equal(owner.metadata.payout_recipient, '100');
  assert.equal(owner.metadata.referrer_github_id, '100'); // legacy field preserved on owner transfers
  assert.equal(contrib.amount, 315); // 7% of $45
  assert.equal(contrib.destination, 'acct_200');
  assert.equal(contrib.metadata.payout_recipient, '200');
  assert.ok(!('referrer_github_id' in contrib.metadata), 'a delegate transfer is not tagged as the referrer');
  assert.equal(commenter.amount, 135); // 3% of $45
  assert.equal(commenter.destination, 'acct_300');

  // conservation: every cent of the commission is accounted for across the three transfers
  assert.equal(actions.reduce((s, a) => s + a.amount, 0), 4500);
});

test('atomic: a delegate with no Connect account holds the WHOLE invoice; once they onboard, both pay together', () => {
  // Run 1: contributor 200 has no Connect account -> the whole invoice waits (no partial owner payout).
  const r1 = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100')]),
    payoutsActive: true,
    contentOwnerByVia: OWNER_BY_VIA,
    delegationByContent: DELEGATION,
    contributorsByContent: CONTRIBUTORS,
    commentsByContent: new Map(), // no commenters this time
  });
  assert.equal(r1.actions.length, 0, 'no partial payout: the owner is not paid while a delegate cannot be');
  const ownerHeld = r1.withheld.find((w) => w.recipientGithubId === '100');
  const contribHeld = r1.withheld.find((w) => w.recipientGithubId === '200');
  assert.equal(contribHeld.reason, 'no-connect-account');
  assert.equal(contribHeld.amount, 315);
  assert.equal(ownerHeld.reason, 'awaiting-co-recipient'); // owner is ready but waits on the delegate
  assert.equal(ownerHeld.amount + contribHeld.amount, 4500); // full commission accounted for, held

  // Run 2: the contributor onboards -> the invoice pays atomically (owner 4185 + contributor 315).
  const r2 = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100'), ready('200')]),
    payoutsActive: true,
    contentOwnerByVia: OWNER_BY_VIA,
    delegationByContent: DELEGATION,
    contributorsByContent: CONTRIBUTORS,
    commentsByContent: new Map(),
  });
  assert.equal(r2.actions.length, 2);
  assert.equal(r2.actions.find((a) => a.role === 'owner').amount, 4185);
  assert.equal(r2.actions.find((a) => a.role === 'contributor').amount, 315);
  assert.equal(r2.actions.reduce((s, a) => s + a.amount, 0), 4500);
});

test('freeze: a settled invoice is NOT re-opened when delegation is raised or a delegate joins later (no over-distribution)', () => {
  // The owner was already paid 100% for in_a (a legacy owner-only transfer, no payout_recipient).
  const paidByRecipient = paidByRecipientFromTransfers([{ metadata: { referrer_github_id: '100', referral_invoices: 'in_a' } }]);
  // Now the owner retro-enables 7%/3% delegation and a contributor + commenter exist and are ready.
  const { actions, withheld } = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100'), ready('200'), ready('300')]),
    payoutsActive: true,
    paidByRecipient,
    contentOwnerByVia: OWNER_BY_VIA,
    delegationByContent: DELEGATION,
    contributorsByContent: CONTRIBUTORS,
    commentsByContent: COMMENTS,
  });
  assert.equal(actions.length, 0, 'the settled invoice is frozen: no delegate cents are created on top of the full commission');
  assert.equal(withheld.length, 0);
});

test('atomic dedupe: after an invoice pays the owner + a delegate, a re-run produces nothing', () => {
  const paidByRecipient = paidByRecipientFromTransfers([
    { metadata: { payout_recipient: '100', payout_role: 'owner', referral_invoices: 'in_a' } },
    { metadata: { payout_recipient: '200', payout_role: 'contributor', referral_invoices: 'in_a' } },
  ]);
  const { actions, withheld } = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100'), ready('200')]),
    payoutsActive: true,
    paidByRecipient,
    contentOwnerByVia: OWNER_BY_VIA,
    delegationByContent: DELEGATION,
    contributorsByContent: CONTRIBUTORS,
    commentsByContent: new Map(),
  });
  assert.equal(actions.length, 0);
  assert.equal(withheld.length, 0);
});

test('per-invoice idempotency key is stable regardless of what else is payable (overlapping-run safe)', () => {
  const base = { connectByReferrer: new Map([ready('100')]), payoutsActive: true };
  const runA = planPayouts({ entries: [payable({ invoiceId: 'in_a' })], ...base });
  const runB = planPayouts({ entries: [payable({ invoiceId: 'in_a' }), payable({ invoiceId: 'in_b' })], ...base });
  const keyA = runA.actions.find((a) => a.invoiceIds[0] === 'in_a').idempotencyKey;
  const keyB = runB.actions.find((a) => a.invoiceIds[0] === 'in_a').idempotencyKey;
  assert.equal(keyA, keyB, 'in_a key must not depend on whether in_b is also payable this run');
  assert.equal(keyA, 'referral-payout:100:owner:in_a');
});

test('paidByRecipientFromTransfers reads new split transfers and legacy owner-only transfers', () => {
  const map = paidByRecipientFromTransfers([
    { metadata: { payout_recipient: '200', referral_invoices: 'in_a,in_b' } }, // new delegate transfer
    { metadata: { referrer_github_id: '100', referral_invoices: 'in_c' } }, // legacy owner-only transfer
  ]);
  assert.deepEqual([...map.get('200')].sort(), ['in_a', 'in_b']);
  assert.deepEqual([...map.get('100')], ['in_c']);
});

test('a via with no delegation configured pays the owner 100% (one transfer, unchanged behavior)', () => {
  const { actions } = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100')]),
    payoutsActive: true,
    // no delegationByContent / contributorsByContent / commentsByContent maps
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].role, 'owner');
  assert.equal(actions[0].amount, 4500);
});

test('anti-spoof: a via pointing at content the referrer does NOT own is ignored (owner keeps 100%)', () => {
  // The commission's referrer is 100, but the via-content "post:hello" is actually authored by 999.
  // A malicious signup set via to siphon 100's commission to that content's contributor (200). Rejected.
  const spoofedOwner = new Map([['post:hello', '999']]); // true author is 999, not the referrer 100
  const { actions } = planPayouts({
    entries: [payable()], // referrerGithubId '100', via 'post:hello'
    connectByReferrer: new Map([ready('100'), ready('200')]),
    payoutsActive: true,
    contentOwnerByVia: spoofedOwner,
    delegationByContent: DELEGATION,
    contributorsByContent: CONTRIBUTORS,
    commentsByContent: COMMENTS,
  });
  assert.equal(actions.length, 1, 'no delegate transfers when the via-content is not the referrer\'s');
  assert.equal(actions[0].role, 'owner');
  assert.equal(actions[0].amount, 4500, 'the owner keeps the full commission');
});

// The full split is recorded on every transfer (referral_split), so a half-applied invoice self-heals.
const RECORDED = '100:owner:4050;200:contributor:315;300:commenter:135';
// Config has been wiped since the first (partial) apply -> the locked path MUST ignore it.
const WIPED_CONFIG = {
  contentOwnerByVia: new Map(),
  delegationByContent: new Map(),
  contributorsByContent: new Map(),
  commentsByContent: new Map(),
};

test('partial apply (owner paid, a delegate transfer failed): a later run completes the delegates at recorded amounts', () => {
  const ownerTransfer = { metadata: { payout_recipient: '100', payout_role: 'owner', referral_invoices: 'in_a', referral_split: RECORDED } };
  const { actions } = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100'), ready('200'), ready('300')]),
    payoutsActive: true,
    paidByRecipient: paidByRecipientFromTransfers([ownerTransfer]),
    recordedSplitByInvoice: splitByInvoiceFromTransfers([ownerTransfer]),
    ...WIPED_CONFIG,
  });
  assert.equal(actions.length, 2);
  assert.equal(actions.find((a) => a.recipientGithubId === '200').amount, 315);
  assert.equal(actions.find((a) => a.recipientGithubId === '300').amount, 135);
  assert.ok(!actions.some((a) => a.role === 'owner'), 'the already-paid owner is not re-paid');
  // total ever paid: 4050 (already) + 315 + 135 = 4500, exactly the commission
  assert.equal(4050 + actions.reduce((s, a) => s + a.amount, 0), 4500);
});

test('partial apply (a delegate paid, owner failed) + config wiped: the owner is completed at the RECORDED keep, no over-pay', () => {
  const contribTransfer = { metadata: { payout_recipient: '200', payout_role: 'contributor', referral_invoices: 'in_a', referral_split: RECORDED } };
  const { actions } = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100'), ready('200'), ready('300')]),
    payoutsActive: true,
    paidByRecipient: paidByRecipientFromTransfers([contribTransfer]),
    recordedSplitByInvoice: splitByInvoiceFromTransfers([contribTransfer]),
    ...WIPED_CONFIG, // the owner removed delegation after the fact -> ignored (locked to the recorded split)
  });
  assert.equal(actions.find((a) => a.role === 'owner').amount, 4050, 'owner gets the recorded keep, not a re-split 4500');
  assert.equal(actions.find((a) => a.recipientGithubId === '300').amount, 135);
  assert.ok(!actions.some((a) => a.recipientGithubId === '200'), 'the already-paid contributor is not re-paid');
  // conservation: 315 (already) + 4050 (owner) + 135 (commenter) = 4500, no created cents
  assert.equal(315 + actions.reduce((s, a) => s + a.amount, 0), 4500);
});

test('a large split is chunked under the Stripe 500-char metadata limit and round-trips intact (popular content never strands)', () => {
  // owner + 30 delegates = 31 recipients, with 9-digit github ids (the realistic worst case)
  const recipients = [{ id: '100', role: 'owner', amount: 4050 }];
  for (let i = 0; i < 30; i++) recipients.push({ id: String(900000000 + i), role: i < 20 ? 'contributor' : 'commenter', amount: 15 });
  const chunks = encodeSplitChunks(recipients);
  assert.ok(chunks.length > 1, 'a 31-recipient split must span multiple metadata values');
  for (const c of chunks) assert.ok(c.length < 500, 'each chunk stays under the Stripe 500-char value limit');

  const metadata = { referral_invoices: 'in_big' };
  chunks.forEach((c, i) => { metadata[i === 0 ? 'referral_split' : `referral_split_${i}`] = c; });
  const recovered = splitByInvoiceFromTransfers([{ metadata }]).get('in_big');
  assert.equal(recovered.length, 31, 'every recipient is recovered across the chunked keys');
  assert.equal(recovered.reduce((s, r) => s + r.amount, 0), 4500, 'the reassembled split conserves the commission');
});

test('a split too large for Stripe metadata limits is WITHHELD (split-too-large), never an un-writable transfer', () => {
  // Unreachable under the $150 product, so force it with a large commission whose 7% pool spreads to ~1100 contributors.
  const bigEntry = { state: 'payable', amount: 2_000_000, currency: 'usd', invoiceId: 'in_big', referrerGithubId: '100', via: 'post:hello' };
  const contributors = Array.from({ length: 1100 }, (_, i) => ({ id: String(800000000 + i), points: 7 }));
  const connect = new Map([ready('100'), ...contributors.map((c) => ready(c.id))]);
  const { actions, withheld } = planPayouts({
    entries: [bigEntry],
    connectByReferrer: connect,
    payoutsActive: true,
    contentOwnerByVia: new Map([['post:hello', '100']]),
    delegationByContent: new Map([['post:hello', { contributions: 0.07 }]]),
    contributorsByContent: new Map([['post:hello', contributors]]),
    commentsByContent: new Map(),
  });
  assert.equal(actions.length, 0, 'no transfer is emitted that Stripe would reject for too many metadata keys');
  assert.ok(withheld.length > 0 && withheld.every((w) => w.reason === 'split-too-large'));
});

test('a recorded split that does not sum to the commission is WITHHELD, not silently under-paid (fail closed)', () => {
  // a corrupt/truncated recorded split missing a recipient (sums to 4185, not the 4500 commission)
  const recordedSplitByInvoice = new Map([['in_a', [
    { id: '100', role: 'owner', amount: 4050 },
    { id: '200', role: 'contributor', amount: 135 },
  ]]]);
  const { actions, withheld } = planPayouts({
    entries: [payable()],
    connectByReferrer: new Map([ready('100'), ready('200')]),
    payoutsActive: true,
    recordedSplitByInvoice,
  });
  assert.equal(actions.length, 0, 'a mismatched recorded split must not pay out');
  assert.ok(withheld.length > 0 && withheld.every((w) => w.reason === 'recorded-split-mismatch'));
});

test('a duplicated invoice id across two ledger entries yields only ONE transfer per recipient (intra-run dedupe)', () => {
  const dup = payable({ invoiceId: 'in_dup' });
  const { actions } = planPayouts({
    entries: [dup, { ...dup }], // the same invoice id twice (a malformed ledger) must not pay twice
    connectByReferrer: new Map([ready('100')]),
    payoutsActive: true,
  });
  assert.equal(actions.length, 1, 'one transfer per (recipient, invoice), never two with the same idempotency key');
  assert.equal(actions[0].amount, 4500);
});

test('buildLedger threads the customer.metadata.via onto every commission entry', () => {
  const A = {
    id: 'cus_100',
    metadata: { github_id: '100', connect_account_id: 'acct_100' },
    subscriptions: { data: [{ status: 'active', start_date: sec(NOW - 365 * DAY) }] },
  };
  const B = { id: 'cus_200', metadata: { github_id: '200', referred_by: '100', via: 'product:cool-thing' } };
  const invoices = new Map([[B.id, [{
    id: 'in_x', amount_paid: 15000, currency: 'usd', status: 'paid',
    status_transitions: { paid_at: sec(NOW - 100 * DAY) }, charge: { amount_refunded: 0 },
  }]]]);
  const entries = buildLedger({ customers: [A, B], invoicesByCustomerId: invoices, rate: 0.3, holdDays: 90, nowMs: NOW });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, COMMISSION_STATE.payable);
  assert.equal(entries[0].via, 'product:cool-thing');
});

// SOW-059 P1c-C: the PURE snapshot payout planner -- the money-math core. No IO. This is the adversarial payout-math
// surface: base = NET (not rate*net), conservation (platform never over-paid), hold/void, eligibility-at-payout,
// no-double-dip, cross-run dedupe, and fail-closed on a missing snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceState, splitInvoice, planSnapshotPayouts, buildEarningsLedger } from '../scripts/lib/snapshot-payout-plan.mjs';
import { COMMISSION_STATE } from '../membership/commissions.mjs';

const DAY = 86_400_000;
const inv = ({ id = 'in_1', amount = 15000, paidAtSec = 0, refunded = 0, disputed = false, currency = 'usd' } = {}) => ({
  id, amount_paid: amount, currency,
  status_transitions: { paid_at: paidAtSec },
  charge: { amount_refunded: refunded, refunded: refunded >= amount, disputed },
});
const snap = (over = {}) => ({ firstOwner: 'alice', lastOwner: 'bob', inviter: 'carol', points: [{ member: 'dana', points: 1 }], conversionAt: 1, windowMs: 90 * DAY, ...over });
const sumAmounts = (rs) => rs.reduce((n, r) => n + r.amount, 0);
const ready = (id) => ({ ready: true, destination: 'acct_' + id });

test('invoiceState: payable past the hold, held within it, voided on full refund / dispute', () => {
  assert.equal(invoiceState(inv({ paidAtSec: 0 }), { holdDays: 90, nowMs: 91 * DAY }).state, COMMISSION_STATE.payable);
  assert.equal(invoiceState(inv({ paidAtSec: 0 }), { holdDays: 90, nowMs: 1 * DAY }).state, COMMISSION_STATE.held);
  assert.equal(invoiceState(inv({ refunded: 15000 }), { holdDays: 90, nowMs: 91 * DAY }).state, COMMISSION_STATE.voided);
  assert.equal(invoiceState(inv({ disputed: true }), { holdDays: 90, nowMs: 91 * DAY }).state, COMMISSION_STATE.voided);
  assert.equal(invoiceState(inv(), { holdDays: 90, nowMs: 91 * DAY }).base, 15000); // base = NET, the full invoice
});

test('splitInvoice: base is NET, not rate*net -- first-touch owner gets exactly 30% of the invoice', () => {
  const rs = splitInvoice({ snapshot: { firstOwner: 'alice', lastOwner: null, inviter: null, points: [] }, base: 15000 });
  assert.equal(rs.length, 1);
  assert.equal(rs[0].id, 'alice'); assert.equal(rs[0].role, 'first');
  assert.equal(rs[0].amount, 4500); // 30% of 15000 (NET) -- NOT 30% of 0.30*15000
});

test('splitInvoice: the full split 30/10/5/10 + conservation (recipients + retained === base, never over-paid)', () => {
  const base = 15000;
  const rs = splitInvoice({ snapshot: snap(), base });
  const by = Object.fromEntries(rs.map((r) => [r.id, r.amount]));
  assert.equal(by.alice, 4500);  // first 30%
  assert.equal(by.bob, 1500);    // last 10%
  assert.equal(by.dana, 750);    // collaboration 5% (sole point)
  assert.equal(by.carol, 1500);  // invite 10%
  assert.equal(sumAmounts(rs), 8250);            // 55%
  assert.ok(sumAmounts(rs) <= base, 'never over-distribute');
  assert.equal(base - sumAmounts(rs), 6750);     // retained 45%
});

test('splitInvoice no-double-dip: inviter who is the first-touch owner earns the content share, not the invite', () => {
  const rs = splitInvoice({ snapshot: snap({ inviter: 'alice', points: [] }), base: 15000 });
  const by = Object.fromEntries(rs.map((r) => [r.id, r.amount]));
  assert.equal(by.alice, 4500); // 30% content, NOT also 10% invite
  assert.equal(by.bob, 1500);
  assert.ok(!('carol' in by));
  assert.equal(sumAmounts(rs), 6000); // 40%, retained 60%
});

test('splitInvoice eligibility: a banned first-touch owner -> their 30% falls to retained', () => {
  const rs = splitInvoice({ snapshot: snap({ points: [] }), base: 15000, eligible: (m) => m !== 'alice' });
  const by = Object.fromEntries(rs.map((r) => [r.id, r.amount]));
  assert.ok(!('alice' in by));     // dropped
  assert.equal(by.bob, 1500); assert.equal(by.carol, 1500);
  assert.equal(sumAmounts(rs), 3000); // 20%; alice's 30% retained
});

test('splitInvoice: a collaborator ineligible at payout -> the 5% pool re-splits across survivors', () => {
  const rs = splitInvoice({ snapshot: snap({ points: [{ member: 'dana', points: 1 }, { member: 'eli', points: 1 }] }), base: 15000, eligible: (m) => m !== 'eli' });
  const by = Object.fromEntries(rs.map((r) => [r.id, r.amount]));
  assert.equal(by.dana, 750); // the whole 5% pool (eli dropped, dana the sole survivor)
  assert.ok(!('eli' in by));
});

test('planSnapshotPayouts: payable invoice + ready Connect -> one transfer per recipient with a stable key', () => {
  const { actions, withheld } = planSnapshotPayouts({
    members: [{ member: 'm1', snapshot: snap(), invoices: [inv({ id: 'in_1', paidAtSec: 0 })] }],
    nowMs: 91 * DAY, recipientConnect: ready,
  });
  assert.equal(withheld.length, 0);
  assert.equal(actions.length, 4); // alice, bob, dana, carol
  const alice = actions.find((a) => a.recipientGithubId === 'alice');
  assert.equal(alice.amount, 4500);
  assert.equal(alice.destination, 'acct_alice');
  assert.equal(alice.idempotencyKey, 'snapshot-payout:m1:in_1:alice');
});

test('planSnapshotPayouts: a member with NO snapshot pays nobody (fail closed, retain 100%)', () => {
  const { actions } = planSnapshotPayouts({
    members: [{ member: 'm1', snapshot: null, invoices: [inv()] }],
    nowMs: 91 * DAY, recipientConnect: ready,
  });
  assert.equal(actions.length, 0);
});

test('planSnapshotPayouts: a held invoice transfers nothing; a renewal past hold does (lifetime)', () => {
  const members = [{ member: 'm1', snapshot: snap({ lastOwner: null, inviter: null, points: [] }), invoices: [
    inv({ id: 'in_1', paidAtSec: 0 }),                 // paid long ago -> payable
    inv({ id: 'in_2', paidAtSec: 90 * DAY / 1000 }),   // paid 90 days in -> still held at nowMs=91d
  ] }];
  const { actions, withheld } = planSnapshotPayouts({ members, nowMs: 91 * DAY, recipientConnect: ready });
  assert.deepEqual(actions.map((a) => a.invoiceId), ['in_1']); // only the matured invoice
  assert.equal(withheld.length, 0);
});

test('planSnapshotPayouts: cross-run dedupe -- an already-transferred (recipient,invoice) is not paid again', () => {
  const members = [{ member: 'm1', snapshot: snap({ lastOwner: null, inviter: null, points: [] }), invoices: [inv({ id: 'in_1' })] }];
  const { actions } = planSnapshotPayouts({ members, nowMs: 91 * DAY, recipientConnect: ready, paidPairs: new Set(['alice:in_1']) });
  assert.equal(actions.length, 0); // alice already paid for in_1
});

test('planSnapshotPayouts: Connect not ready / no account -> withheld with a reason, not paid', () => {
  const members = [{ member: 'm1', snapshot: snap({ lastOwner: null, inviter: null, points: [] }), invoices: [inv({ id: 'in_1' })] }];
  const notReady = planSnapshotPayouts({ members, nowMs: 91 * DAY, recipientConnect: () => ({ ready: false, destination: 'acct_x' }) });
  assert.equal(notReady.actions.length, 0); assert.equal(notReady.withheld[0].reason, 'connect-not-ready');
  const noAcct = planSnapshotPayouts({ members, nowMs: 91 * DAY, recipientConnect: () => ({ ready: false, destination: null }) });
  assert.equal(noAcct.withheld[0].reason, 'no-connect-account');
});

// ---- SOW-083 P2: the per-recipient earnings view (held + payable + paid) ----

test('buildEarningsLedger: a payable invoice gives each recipient a payable earnings entry + totals', () => {
  const members = [{ member: 'm1', snapshot: snap(), invoices: [inv({ id: 'in_1', paidAtSec: 0 })] }];
  const led = buildEarningsLedger({ members, nowMs: 91 * DAY });
  const alice = led.get('alice');
  assert.equal(alice.entries.length, 1);
  assert.deepEqual(alice.entries[0], { from: 'm1', role: 'first', amount: 4500, currency: 'usd', invoice: 'in_1', state: 'payable' });
  assert.equal(alice.totals.payable, 4500); assert.equal(alice.totals.lifetime, 4500);
  assert.equal(led.get('carol').entries[0].role, 'invite');
});

test('buildEarningsLedger: a HELD invoice accrues (state held), a PAID pair shows paid', () => {
  const members = [{ member: 'm1', snapshot: snap({ lastOwner: null, inviter: null, points: [] }), invoices: [
    inv({ id: 'in_held', paidAtSec: 90 * DAY / 1000 }), // still within hold at 91d
    inv({ id: 'in_paid', paidAtSec: 0 }),               // matured + already transferred
  ] }];
  const led = buildEarningsLedger({ members, nowMs: 91 * DAY, paidPairs: new Set(['alice:in_paid']) });
  const states = led.get('alice').entries.reduce((m, e) => (m[e.state] = e.invoice, m), {});
  assert.equal(states.held, 'in_held');
  assert.equal(states.paid, 'in_paid');
  assert.equal(led.get('alice').totals.held, 4500);
  assert.equal(led.get('alice').totals.paid, 4500);
});

test('buildEarningsLedger: an ineligible recipient earns nothing (not in the ledger)', () => {
  const members = [{ member: 'm1', snapshot: snap({ lastOwner: null, inviter: null, points: [] }), invoices: [inv()] }];
  const led = buildEarningsLedger({ members, nowMs: 91 * DAY, eligible: (id) => id !== 'alice' });
  assert.equal(led.has('alice'), false);
});

test('buildEarningsLedger: a voided (refunded) invoice contributes nothing', () => {
  const members = [{ member: 'm1', snapshot: snap(), invoices: [inv({ refunded: 15000 })] }];
  assert.equal(buildEarningsLedger({ members, nowMs: 91 * DAY }).size, 0);
});

test('conservation holds under fuzzed bases (recipients never exceed base)', () => {
  for (const base of [1, 7, 99, 333, 15000, 99999, 1234567]) {
    for (const s of [snap(), snap({ inviter: 'alice' }), snap({ points: [{ member: 'dana', points: 2 }, { member: 'eli', points: 1 }] })]) {
      const rs = splitInvoice({ snapshot: s, base });
      assert.ok(sumAmounts(rs) <= base, `base=${base}: Σ ${sumAmounts(rs)} > base`);
    }
  }
});

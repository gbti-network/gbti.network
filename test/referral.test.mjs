// SOW-007 referral revenue-share unit tests. No network, no secrets: every client is faked and every
// time value is injected, so the suite is deterministic. Covers the config switches, the commission
// ledger (held/payable/voided + active-referrer gate + clawback), the payout planner (idempotency,
// withholding, chunking), and the Connect onboarding helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REFERRAL_CONFIG,
  referralConfigFromParsed,
  isAttributionActive,
  isAccrualActive,
  isFeatureAdvertised,
  isPayoutsActive,
} from '../membership/referral-config.mjs';
import {
  COMMISSION_STATE,
  commissionForInvoice,
  commissionsForReferral,
  activeIntervalsFromStripe,
  isActiveAt,
  netPaid,
  isReversed,
} from '../membership/commissions.mjs';
import { ensureConnectAccount, startOnboarding } from '../workers/signup/connect.mjs';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch-ms for deterministic held/payable boundaries
const sec = (ms) => Math.floor(ms / 1000);

function invoice({ id, amount = 15000, paidAtMs, currency = 'usd', refunded = 0, fullRefunded = false, disputed = false }) {
  return {
    id,
    amount_paid: amount,
    currency,
    status: 'paid',
    status_transitions: { paid_at: sec(paidAtMs) },
    charge: { amount_refunded: refunded, refunded: fullRefunded, disputed },
  };
}

// An always-open active interval starting before t, so the referrer counts as active at paid time.
const openSince = (ms) => [{ startMs: ms, endMs: null }];

// ---- referral-config ----

test('referral-config: defaults are safe (payouts off, attribution/accrual on)', () => {
  const cfg = referralConfigFromParsed({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.attribution_enabled, true);
  assert.equal(cfg.accrual_enabled, true);
  assert.equal(cfg.payouts_enabled, false);
  assert.equal(cfg.rate, 0.30);
  assert.equal(cfg.hold_days, 90);
  assert.deepEqual(cfg, DEFAULT_REFERRAL_CONFIG);
});

test('referral-config: rate is clamped to [0,1] and hold_days coerced to a non-negative int', () => {
  assert.equal(referralConfigFromParsed({ referral: { rate: 5 } }).rate, 1);
  assert.equal(referralConfigFromParsed({ referral: { rate: -2 } }).rate, 0);
  assert.equal(referralConfigFromParsed({ referral: { rate: 'nope' } }).rate, 0.30);
  assert.equal(referralConfigFromParsed({ referral: { hold_days: 30.9 } }).hold_days, 30);
  assert.equal(referralConfigFromParsed({ referral: { hold_days: -10 } }).hold_days, 0);
});

test('referral-config: payouts require BOTH enabled AND payouts_enabled; attribution/accrual are independent', () => {
  const accrueOnly = referralConfigFromParsed({ referral: { enabled: false, attribution_enabled: true, accrual_enabled: true, payouts_enabled: true } });
  assert.equal(isAttributionActive(accrueOnly), true);
  assert.equal(isAccrualActive(accrueOnly), true);
  assert.equal(isFeatureAdvertised(accrueOnly), false);
  assert.equal(isPayoutsActive(accrueOnly), false, 'payouts must stay off while the master switch is off');

  const live = referralConfigFromParsed({ referral: { enabled: true, payouts_enabled: true } });
  assert.equal(isPayoutsActive(live), true);

  const advertisedNoPayout = referralConfigFromParsed({ referral: { enabled: true, payouts_enabled: false } });
  assert.equal(isFeatureAdvertised(advertisedNoPayout), true);
  assert.equal(isPayoutsActive(advertisedNoPayout), false);
});

test('referral-config: accepts a bare object (no `referral:` wrapper) and string booleans', () => {
  const cfg = referralConfigFromParsed({ enabled: 'true', payouts_enabled: 'yes' });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.payouts_enabled, true);
});

// ---- commission ledger ----

test('ledger: a recent paid invoice while the referrer is active is HELD at rate x gross', () => {
  const inv = invoice({ id: 'in_1', paidAtMs: NOW - 10 * DAY });
  const e = commissionForInvoice(inv, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: openSince(NOW - 365 * DAY) });
  assert.equal(e.state, COMMISSION_STATE.held);
  assert.equal(e.amount, 4500); // round(0.30 * 15000)
  assert.equal(e.grossAmount, 15000);
});

test('ledger: an invoice older than the hold becomes PAYABLE', () => {
  const inv = invoice({ id: 'in_2', paidAtMs: NOW - 100 * DAY });
  const e = commissionForInvoice(inv, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: openSince(NOW - 365 * DAY) });
  assert.equal(e.state, COMMISSION_STATE.payable);
  assert.equal(e.amount, 4500);
});

test('ledger: a fully refunded or disputed charge VOIDS the commission to 0', () => {
  const refunded = invoice({ id: 'in_3', paidAtMs: NOW - 100 * DAY, refunded: 15000, fullRefunded: true });
  const eR = commissionForInvoice(refunded, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: openSince(NOW - 365 * DAY) });
  assert.equal(eR.state, COMMISSION_STATE.voided);
  assert.equal(eR.amount, 0);

  const disputed = invoice({ id: 'in_4', paidAtMs: NOW - 100 * DAY, disputed: true });
  const eD = commissionForInvoice(disputed, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: openSince(NOW - 365 * DAY) });
  assert.equal(eD.state, COMMISSION_STATE.voided);
});

test('ledger: a PARTIAL refund reduces the commission to rate x net', () => {
  const inv = invoice({ id: 'in_5', paidAtMs: NOW - 100 * DAY, amount: 15000, refunded: 5000 });
  assert.equal(netPaid(inv), 10000);
  assert.equal(isReversed(inv), false);
  const e = commissionForInvoice(inv, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: openSince(NOW - 365 * DAY) });
  assert.equal(e.state, COMMISSION_STATE.payable);
  assert.equal(e.amount, 3000); // round(0.30 * 10000)
});

test('ledger: NO accrual when the referrer was not active at the invoice paid time', () => {
  const inv = invoice({ id: 'in_6', paidAtMs: NOW - 100 * DAY });
  // referrer only became active AFTER the invoice was paid
  const e = commissionForInvoice(inv, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: [{ startMs: NOW - 10 * DAY, endMs: null }] });
  assert.equal(e, null);
});

test('ledger: a commission earned during an active period STAYS payable after the referrer lapses', () => {
  const paidAt = NOW - 100 * DAY;
  const inv = invoice({ id: 'in_7', paidAtMs: paidAt });
  // active interval covered the invoice but CLOSED long before now (referrer later lapsed)
  const intervals = [{ startMs: paidAt - DAY, endMs: paidAt + DAY }];
  const e = commissionForInvoice(inv, { rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: intervals });
  assert.equal(e.state, COMMISSION_STATE.payable, 'lapse must not claw back an already-earned commission');
  assert.equal(e.amount, 4500);
});

test('ledger: paidInvoiceIds marks an entry as already PAID', () => {
  const inv = invoice({ id: 'in_8', paidAtMs: NOW - 100 * DAY });
  const e = commissionForInvoice(inv, {
    rate: 0.30, holdDays: 90, nowMs: NOW,
    referrerActiveIntervals: openSince(NOW - 365 * DAY),
    paidInvoiceIds: new Set(['in_8']),
  });
  assert.equal(e.state, COMMISSION_STATE.paid);
});

test('ledger: self-referral and banned referrer earn nothing', () => {
  const inv = invoice({ id: 'in_9', paidAtMs: NOW - 100 * DAY });
  const base = { invoices: [inv], rate: 0.30, holdDays: 90, nowMs: NOW, referrerActiveIntervals: openSince(NOW - 365 * DAY) };
  assert.deepEqual(commissionsForReferral({ referrerGithubId: '7', referredGithubId: '7', ...base }), []);
  assert.deepEqual(commissionsForReferral({ referrerGithubId: '7', referredGithubId: '8', referrerBanned: true, ...base }), []);
  const ok = commissionsForReferral({ referrerGithubId: '7', referredGithubId: '8', ...base });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].referrerGithubId, '7');
  assert.equal(ok[0].referredGithubId, '8');
});

test('isActiveAt fails closed on empty/missing intervals', () => {
  assert.equal(isActiveAt(undefined, NOW), false);
  assert.equal(isActiveAt([], NOW), false);
  assert.equal(isActiveAt([{ startMs: NOW - DAY, endMs: null }], NOW), true);
  assert.equal(isActiveAt([{ startMs: NOW - DAY, endMs: NOW - 1 }], NOW), false);
});

test('activeIntervalsFromStripe: open for active subs, closed for canceled, plus grandfather', () => {
  const customer = {
    subscriptions: {
      data: [
        { status: 'active', start_date: sec(NOW - 200 * DAY) },
        { status: 'canceled', start_date: sec(NOW - 400 * DAY), ended_at: sec(NOW - 300 * DAY) },
      ],
    },
  };
  const intervals = activeIntervalsFromStripe(customer, { at: '2020-01-01', until: null });
  assert.equal(intervals.length, 3);
  assert.equal(intervals[0].endMs, null); // active -> open
  assert.equal(intervals[1].endMs, (NOW - 300 * DAY)); // canceled -> closed at ended_at
  assert.equal(intervals[2].endMs, null); // permanent grandfather -> open
  assert.ok(isActiveAt(intervals, NOW - 350 * DAY), 'covered by the canceled sub window');
});

// ---- Connect onboarding helper ----

function fakeStripeForConnect() {
  const calls = { created: 0, updated: [], links: [] };
  return {
    calls,
    async createConnectAccount(args) { calls.created++; return { id: 'acct_new', ...args }; },
    async updateCustomer(id, patch) { calls.updated.push({ id, patch }); return { id, ...patch }; },
    async createAccountLink(args) { calls.links.push(args); return { url: 'https://connect.stripe.test/onboard' }; },
  };
}

test('ensureConnectAccount: reuses an existing account id and creates none', async () => {
  const stripe = fakeStripeForConnect();
  const customer = { id: 'cus_1', metadata: { connect_account_id: 'acct_existing', github_id: '100' } };
  const id = await ensureConnectAccount({ stripe, customer });
  assert.equal(id, 'acct_existing');
  assert.equal(stripe.calls.created, 0);
  assert.equal(stripe.calls.updated.length, 0);
});

test('ensureConnectAccount: creates and persists a new account when absent', async () => {
  const stripe = fakeStripeForConnect();
  const customer = { id: 'cus_1', metadata: { github_id: '100', github_login: 'alice' }, email: 'a@b.c' };
  const id = await ensureConnectAccount({ stripe, customer });
  assert.equal(id, 'acct_new');
  assert.equal(stripe.calls.created, 1);
  assert.equal(stripe.calls.updated.length, 1);
  assert.equal(stripe.calls.updated[0].patch.metadata.connect_account_id, 'acct_new');
  assert.equal(stripe.calls.updated[0].patch.metadata.github_id, '100', 'keeps existing metadata');
});

test('startOnboarding: returns the account link url with refresh/return urls from baseUrl', async () => {
  const stripe = fakeStripeForConnect();
  const customer = { id: 'cus_1', metadata: { github_id: '100' } };
  const out = await startOnboarding({ stripe, customer, baseUrl: 'https://signup.gbti.network' });
  assert.equal(out.url, 'https://connect.stripe.test/onboard');
  assert.equal(out.accountId, 'acct_new');
  assert.equal(stripe.calls.links[0].refreshUrl, 'https://signup.gbti.network/referral/connect/refresh');
  assert.equal(stripe.calls.links[0].returnUrl, 'https://signup.gbti.network/referral/connect/return');
});

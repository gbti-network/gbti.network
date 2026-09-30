// Tests the signup Worker's Stripe webhook handling (SOW-002): the dedupe split (FIX 2), the first-invoice upgrade
// and the SOW-059 conversion freeze, and the renewal no-op (FIX 3). No network, no secrets: in-memory fakes for KV
// and the injected Stripe / Discord clients. Split out of test/worker.test.mjs at the 900-line limit (owner,
// 2026-09-30); the shared fixtures live in test/lib/worker-fixtures.mjs. The entrypoint's bad-signature rejection
// stays in test/worker.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDuplicateEvent, markEventSeen, handleStripeEvent } from '../workers/signup/webhook.mjs';
import { fakeKv } from './lib/worker-fixtures.mjs';

// ---------------------------------------------------------------------------
// Webhook dedupe split (FIX 2) and renewal no-op (FIX 3)
// ---------------------------------------------------------------------------

/** Fake Discord client capturing role mutations for the webhook handler tests. */
function fakeRoleDiscord() {
  const calls = { addRole: [], removeRole: [] };
  return {
    calls,
    async addRole(guildId, userId, roleId) {
      calls.addRole.push({ guildId, userId, roleId });
    },
    async removeRole(guildId, userId, roleId) {
      calls.removeRole.push({ guildId, userId, roleId });
    },
  };
}

/** Fake Stripe client returning a fixed customer for getCustomer (the webhook reverse lookup). */
function fakeWebhookStripe(metadata) {
  return {
    async getCustomer() {
      return { id: 'cus_x', metadata };
    },
  };
}

const WEBHOOK_CONFIG = { guildId: 'guild-1', trialRoleId: 'role-trial', memberRoleId: 'role-member' };

test('isDuplicateEvent only READS (does not mark); markEventSeen persists separately (FIX 2)', async () => {
  const kv = fakeKv();
  // First check: not seen yet, and crucially NOT marked by the read.
  assert.equal(await isDuplicateEvent({ kv, eventId: 'evt_42' }), false);
  assert.equal(kv.store.has('evt:evt_42'), false, 'isDuplicateEvent must not write a seen-mark');
  // A second check still reports not-seen (a transient handler failure can safely re-process).
  assert.equal(await isDuplicateEvent({ kv, eventId: 'evt_42' }), false);
  // Only after the handler succeeds do we mark it; subsequent checks then report duplicate.
  assert.equal(await markEventSeen({ kv, eventId: 'evt_42' }), true);
  assert.equal(kv.store.get('evt:evt_42'), '1');
  assert.equal(await isDuplicateEvent({ kv, eventId: 'evt_42' }), true);
});

test('handleStripeEvent upgrades on the FIRST invoice (billing_reason subscription_create)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  const summary = await handleStripeEvent({
    event: {
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_x', billing_reason: 'subscription_create' } },
    },
    stripe,
    discord,
    config: WEBHOOK_CONFIG,
  });
  assert.match(summary, /upgraded/);
  assert.deepEqual(discord.calls.addRole[0], { guildId: 'guild-1', userId: 'd-1', roleId: 'role-member' });
  assert.deepEqual(discord.calls.removeRole[0], { guildId: 'guild-1', userId: 'd-1', roleId: 'role-trial' });
});

test('SOW-059 P1c-B: handleStripeEvent fires onConversion on the FIRST invoice with paid_at as conversionAt', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5', touch_session: 'x' });
  const seen = [];
  const summary = await handleStripeEvent({
    event: {
      type: 'invoice.payment_succeeded', created: 1700,
      data: { object: { customer: 'cus_x', billing_reason: 'subscription_create', status_transitions: { paid_at: 1500 } } },
    },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async (a) => { seen.push(a); },
  });
  assert.match(summary, /upgraded/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].githubId, '5');
  assert.equal(seen[0].conversionAt, 1500 * 1000); // paid_at (ms), not event.created, not now
  assert.equal(seen[0].customer.metadata.touch_session, 'x');
  // the role swap still happened
  assert.equal(discord.calls.addRole.length, 1);
});

test('SOW-059 P1c-B: a throwing onConversion is fail-soft (role swap still happens, webhook does not fail)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  const summary = await handleStripeEvent({
    event: { type: 'invoice.payment_succeeded', created: 1700, data: { object: { customer: 'cus_x', billing_reason: 'subscription_create' } } },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async () => { throw new Error('kv down'); },
  });
  assert.match(summary, /upgraded/); // did not throw; the conversion freeze never blocks the swap
  assert.equal(discord.calls.addRole[0].roleId, 'role-member');
});

test('SOW: a GitHub-only conversion (no discord_user_id) STILL freezes the SOW-059 snapshot; no role swap', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ github_id: '5' }); // GitHub-only member: no Discord linked yet
  let frozen = null;
  const summary = await handleStripeEvent({
    event: { type: 'invoice.payment_succeeded', created: 1700, data: { object: { customer: 'cus_x', billing_reason: 'subscription_create' } } },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async ({ githubId }) => { frozen = githubId; },
  });
  assert.equal(frozen, '5', 'the freeze fires for a GitHub-only member -> referral attribution is NOT lost');
  assert.equal(discord.calls.addRole.length, 0, 'no role swap without a linked Discord');
  assert.equal(discord.calls.removeRole.length, 0);
  assert.match(summary, /frozen/);
});

test('SOW-059 P1c-B: onConversion does NOT fire on a renewal (only the first invoice freezes)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  let fired = false;
  await handleStripeEvent({
    event: { type: 'invoice.payment_succeeded', data: { object: { customer: 'cus_x', billing_reason: 'subscription_cycle' } } },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async () => { fired = true; },
  });
  assert.equal(fired, false);
});

test('handleStripeEvent is a no-op on annual RENEWAL invoices (FIX 3)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  const summary = await handleStripeEvent({
    event: {
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_x', billing_reason: 'subscription_cycle' } },
    },
    stripe,
    discord,
    config: WEBHOOK_CONFIG,
  });
  assert.match(summary, /renewal/);
  assert.equal(discord.calls.addRole.length, 0, 'no role swap on renewal');
  assert.equal(discord.calls.removeRole.length, 0, 'no role swap on renewal');
});

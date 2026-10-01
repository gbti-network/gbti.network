// Tests the signup orchestration in the signup Worker (SOW-002): runSignup driven against in-memory fakes for the
// injected Stripe / Discord clients + KV. No network, no secrets. Split out of test/worker.test.mjs at the 900-line
// limit (owner, 2026-09-30); the shared fixtures live in test/lib/worker-fixtures.mjs.
//
// Coverage:
//   - signup orchestration: existing customer reused and trial_started_at NOT rewritten; a new
//     customer gets all metadata + the trial role; KV index written
//   - the signup role after the trial retirement: an unset role id, and agreement with reconcile
//   - the guild calls are guarded: a transient Discord error does not discard a completed signup

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runSignup } from '../workers/signup/signup.mjs';
import { discordRoleTarget } from '../scripts/lib/reconcile-plan.mjs'; // the steady state signup must agree with
import { wlog } from '../workers/signup/wlog.mjs'; // the guard tests read its ring rather than capturing console
import { IDENTITY, CONFIG, fakeKv, fakeStripe, fakeDiscord, NOW, mirrorKv, freshMirror, paidCustomer } from './lib/worker-fixtures.mjs';

// ---------------------------------------------------------------------------
// Signup orchestration
// ---------------------------------------------------------------------------

test('signup with an existing customer reuses it and does NOT rewrite trial_started_at', async () => {
  const existing = {
    id: 'cus_existing',
    metadata: { github_id: '12345', trial_started_at: '2020-01-01T00:00:00.000Z' },
  };
  const stripe = fakeStripe({ searchHit: existing });
  const discord = fakeDiscord();
  const kv = fakeKv();

  const result = await runSignup({
    identity: IDENTITY,
    stripe,
    discord,
    kv,
    config: CONFIG,
    refCode: '42',
    now: new Date('2026-06-02T00:00:00.000Z'),
  });

  assert.equal(result.customerId, 'cus_existing');
  assert.equal(result.created, false);
  // No new customer created.
  assert.equal(stripe.calls.create.length, 0);
  // Update was an opportunistic refresh that must NOT contain trial_started_at or referred_by.
  assert.equal(stripe.calls.update.length, 1);
  const updateMeta = stripe.calls.update[0].args.metadata;
  assert.ok(!('trial_started_at' in updateMeta), 'must not rewrite the trial clock on reuse');
  assert.ok(!('referred_by' in updateMeta), 'must not rewrite referral attribution on reuse');
  assert.equal(updateMeta.github_login, 'octocat');
  // KV index written.
  assert.equal(kv.store.get('gh:12345'), 'cus_existing');
  // sow-356: this fixture is a LAPSED account (no subscription, and a trial clock from 2020), so the community
  // is not theirs and the link is refused. The refusal leaves no trace anywhere: no guild member, no role, and
  // no discord_user_id on the record. The last one is the part worth pinning, because writing it would make
  // every surface that reads the link report a member as being in a server they were never added to.
  assert.ok(!('discord_user_id' in updateMeta), 'a refused link is not recorded on the Customer');
  assert.equal(discord.calls.addGuildMember.length, 0, 'and the guild join never happens');
  assert.equal(discord.calls.addRole.length, 0);
  assert.deepEqual(result.discordOutcome, { joined: false, roleAssigned: false, role: null, refused: 'lapsed' });
  assert.equal(result.discordLinked, false, 'a refused link is not a link');
});

test('SOW: GitHub-only signup (Discord deferred) -> Customer omits discord_user_id, no guild join, discordLinked false', async () => {
  const stripe = fakeStripe({ searchHit: null });
  const discord = fakeDiscord();
  const kv = fakeKv();
  const result = await runSignup({
    identity: { githubId: '424242', githubLogin: 'octocat', discordUserId: null, email: 'octo@example.com', discordAccessToken: null },
    stripe, discord, kv, config: CONFIG,
    now: new Date('2026-06-02T00:00:00.000Z'),
  });
  assert.equal(result.created, true);
  assert.equal(result.discordLinked, false);
  const meta = stripe.calls.create[0].args.metadata;
  assert.equal(meta.github_id, '424242');
  assert.ok(!('discord_user_id' in meta), 'GitHub-only signup omits discord_user_id');
  assert.equal(stripe.calls.create[0].args.email, 'octo@example.com'); // email sourced from GitHub
  assert.equal(discord.calls.addGuildMember.length, 0, 'no guild join without Discord');
  assert.equal(discord.calls.addRole.length, 0, 'no role assignment without Discord');
  assert.equal(kv.store.get('gh:424242'), 'cus_new', 'KV index still written');
});

// --- The signup role after the trial retirement (2026-08-11) ----------------------------------------------

test('an UNSET locked role id joins the guild with NO role, never `undefined`', async () => {
  // A missing config value must not become a malformed Discord call. Sending roles:[undefined] turns a
  // config gap into an API error or, worse, a silent partial success, instead of a visible no-op.
  //
  // sow-356: the member here is PAYING with no overrides copy in KV, which is the one combination that still
  // joins holding Locked (the mirror cannot be trusted, so the role falls back and the daily sync corrects it).
  // A free account no longer joins at all, so it can no longer exercise this guard.
  const discord = fakeDiscord();
  await runSignup({
    identity: IDENTITY,
    stripe: fakeStripe({ searchHit: paidCustomer }),
    discord,
    kv: fakeKv(),
    config: { guildId: 'guild-1', signupSource: 'signup-worker' }, // no lockedRoleId
    refCode: '', via: '',
    now: new Date('2026-06-02T12:00:00.000Z'),
  });
  const join = discord.calls.addGuildMember[0];
  assert.ok(join, 'still joins the guild');
  assert.equal(join.opts.roles, undefined, 'no roles key at all, rather than [undefined]');
  assert.equal(discord.calls.addRole.length, 0, 'no role call with an undefined id');
});

test('the signup role EQUALS what reconcile would assign the same member (no drift)', async () => {
  // Signup and reconcile must never disagree about what a member holds. Asserting against discordRoleTarget
  // rather than a hardcoded string means a future change to one side fails here rather than producing a role
  // that silently gets swapped a day later, which is the bug this replaced.
  //
  // sow-356 narrowed this to the members who actually join. A free or lapsed account is refused the guild, so
  // its role is only ever assigned by reconcile to someone ALREADY in the server, and that rule is unchanged:
  // they keep Locked and they stay.
  assert.equal(discordRoleTarget('none'), 'locked');
  assert.equal(discordRoleTarget('paid'), 'member');
  const discord = fakeDiscord();
  await runSignup({
    identity: IDENTITY,
    stripe: fakeStripe({ searchHit: paidCustomer }),
    discord,
    kv: mirrorKv(freshMirror()),
    config: CONFIG,
    refCode: '', via: '',
    now: NOW,
  });
  const ROLE_ID_FOR = { member: CONFIG.memberRoleId, trial: CONFIG.trialRoleId, locked: CONFIG.lockedRoleId };
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, [ROLE_ID_FOR[discordRoleTarget('paid')]]);
});

test('signup with no existing customer creates one with full metadata + KV index, and no Discord for a free account', async () => {
  const stripe = fakeStripe({ searchHit: null });
  const discord = fakeDiscord();
  const kv = fakeKv();
  const now = new Date('2026-06-02T12:00:00.000Z');

  const result = await runSignup({
    identity: IDENTITY,
    stripe,
    discord,
    kv,
    config: CONFIG,
    refCode: '42',
    via: 'post:my-first-post',
    now,
  });

  assert.equal(result.created, true);
  assert.equal(result.customerId, 'cus_new');
  assert.equal(result.referredBy, '42');
  // Exactly one create, with the idempotency key derived from github_id.
  assert.equal(stripe.calls.create.length, 1);
  const { args, idempotencyKey } = stripe.calls.create[0];
  assert.equal(idempotencyKey, 'signup:12345');
  assert.equal(args.email, 'octo@example.com');
  assert.equal(args.metadata.github_id, '12345');
  assert.equal(args.metadata.github_login, 'octocat');
  // sow-356: a brand-new account is a FREE account, so the Discord identity it arrived with is refused and
  // never written. Asserting the ABSENCE here rather than deleting the line: this is the whole ruling, and it
  // belongs pinned in the test that covers what a fresh signup writes.
  assert.equal(args.metadata.discord_user_id, undefined, 'the community is a paid perk: a free account records no link');
  // 2026-08-11: the 90-day trial is RETIRED (owner). Signup no longer mints trial_started_at, which was
  // the single tap that produced the `trialing` status, so a new customer must NOT carry the clock.
  // Asserting its ABSENCE rather than deleting the line: this is the whole retirement, and it belongs
  // pinned in the test that covers what a fresh signup writes.
  assert.equal(args.metadata.trial_started_at, undefined, 'the trial is retired: no clock is minted');
  assert.equal(args.metadata.referred_by, '42');
  assert.equal(args.metadata.via, 'post:my-first-post', 'the landed-on content is captured for the payout split');
  assert.equal(args.metadata.signup_source, 'signup-worker');
  // No update on a fresh create.
  assert.equal(stripe.calls.update.length, 0);
  // KV index written to the new customer id.
  assert.equal(kv.store.get('gh:12345'), 'cus_new');
  // No guild call of any kind for a free account. The symmetry of the join role and the explicit addRole, for
  // the members who DO join, is pinned by "runSignup ASSIGNS the resolved role" in test/worker-signup-role.test.mjs.
  assert.equal(discord.calls.addGuildMember.length, 0, 'not added to the server');
  assert.equal(discord.calls.addRole.length, 0, 'and given no role');
  assert.equal(discord.calls.removeRole.length, 0, 'nor is anything stripped from someone who is not there');
});

test('signup rejects a self-referral at creation (no referred_by stored)', async () => {
  const stripe = fakeStripe({ searchHit: null });
  const discord = fakeDiscord();
  const kv = fakeKv();
  const result = await runSignup({
    identity: IDENTITY,
    stripe,
    discord,
    kv,
    config: CONFIG,
    refCode: '12345', // same as the new member's github_id -> self, must be dropped
    now: new Date('2026-06-02T00:00:00.000Z'),
  });
  assert.equal(result.referredBy, null);
  const meta = stripe.calls.create[0].args.metadata;
  assert.ok(!('referred_by' in meta), 'self-referral must not be persisted');
});

// ---------------------------------------------------------------------------
// The guild calls are guarded: a transient Discord error must not discard a completed signup
//
// The incident these encode: a live member's Discord link returned `internal_error`, and their unchanged
// retry succeeded. Every durable write (Customer, discord_user_id, coupon redemption) had already landed;
// only the guild call failed, and throwing there threw the whole thing away.
// ---------------------------------------------------------------------------

// A Discord double that fails whichever calls it is told to, the way the real client does (DiscordError
// carries a numeric `.status`), so the guard is tested against the error SHAPE it will actually meet.
function failingDiscord(failing = [], status = 500) {
  const calls = { addGuildMember: [], addRole: [], removeRole: [] };
  const maybeThrow = (name) => {
    if (!failing.includes(name)) return;
    const err = new Error(`discord error ${status}: upstream hiccup`);
    err.status = status;
    throw err;
  };
  return {
    calls,
    async addGuildMember(guildId, userId, opts) { calls.addGuildMember.push({ guildId, userId, opts }); maybeThrow('addGuildMember'); return null; },
    async addRole(guildId, userId, roleId) { calls.addRole.push({ guildId, userId, roleId }); maybeThrow('addRole'); return null; },
    async removeRole(guildId, userId, roleId) { calls.removeRole.push({ guildId, userId, roleId }); maybeThrow('removeRole'); return null; },
  };
}

test('a failing guild JOIN no longer throws away a completed signup', async () => {
  const discord = failingDiscord(['addGuildMember']);
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  // The whole point: the call still returns, and it returns the REAL customer, because that half succeeded.
  assert.equal(result.customerId, 'cus_1');
  assert.equal(result.discordOutcome.joined, false, 'and it says plainly that the join did not happen');
});

test('a failing guild join does not stop the role assignment or the stale-role strip', async () => {
  // The failure mode a bare try/catch around the whole block would have introduced. addGuildMember is only
  // needed for a member who is not in the guild YET; for one already there it 204s. So a join error must not
  // skip the role work, or a returning member whose join errors silently keeps whatever role they had.
  const discord = failingDiscord(['addGuildMember']);
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.deepEqual(discord.calls.addRole.map((c) => c.roleId), ['role-member'], 'the role is still assigned');
  assert.deepEqual(discord.calls.removeRole.map((c) => c.roleId).sort(), ['role-locked', 'role-trial'], 'and the stale roles are still stripped');
  assert.equal(result.discordOutcome.roleAssigned, true);
});

test('a failing role assignment is reported separately from the join', async () => {
  const discord = failingDiscord(['addRole']);
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.deepEqual(result.discordOutcome, { joined: true, roleAssigned: false, role: 'member' });
});

test('each guild failure logs WHICH call failed, with its status', async () => {
  // The hour the incident cost was spent not knowing which of the two calls produced the 500, because this
  // file logged nothing at all. A guard that only swallows would have made that permanent.
  wlog.clear();
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord: failingDiscord(['addGuildMember'], 502),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  const [entry] = wlog.recent().filter((e) => e.area === 'signup');
  assert.equal(entry.msg, 'discord addGuildMember failed', 'the message names the call');
  assert.equal(entry.data.status, 502, 'and carries the upstream status');
  assert.equal(entry.data.githubId, '12345', 'and says who it happened to');

  wlog.clear();
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord: failingDiscord(['addRole'], 403),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  const [roleEntry] = wlog.recent().filter((e) => e.area === 'signup');
  assert.equal(roleEntry.msg, 'discord addRole failed');
  assert.equal(roleEntry.data.access, 'member', 'and which role it was trying to grant');
});

test('a clean link reports both halves done, and a GitHub-only signup reports nothing attempted', async () => {
  // `discordOutcome` is null rather than false for the GitHub-only path on purpose: "never attempted" and
  // "attempted and failed" are different facts, and reading both as falsy is how the first one hides.
  const ok = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord: fakeDiscord(),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.deepEqual(ok.discordOutcome, { joined: true, roleAssigned: true, role: 'member' });

  const githubOnly = await runSignup({
    identity: { ...IDENTITY, discordUserId: null, discordAccessToken: null },
    stripe: fakeStripe({ searchHit: paidCustomer }), discord: fakeDiscord(),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.equal(githubOnly.discordLinked, false);
  assert.equal(githubOnly.discordOutcome, null);
});

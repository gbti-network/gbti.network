// sow-356: the Discord community is a paid perk. "Free users should not be added to the discord" (owner,
// 2026-09-17), prompted by a live free account that appeared in the server holding the Locked role. Locked was
// the correct role under the rule as it stood; the JOIN is what the ruling forbids.
//
// What these cover, in the order a refusal has to hold:
//   1. the rule itself (membership/discord-roles.mjs), shared by every screen,
//   2. the join (runSignup): refused BEFORE the Discord id reaches the Customer record,
//   3. the endpoints that could route around it: the link start, the link callback and the invite,
//   4. the screens: the welcome step and the account page.
//
// A refusal leaves NO trace. That is the part worth attacking: if the Discord id were written anyway, the
// welcome would report the step done, the setup card would tick it, and the account page would claim a link to
// a server the member was never added to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { discordJoinAllowed, discordRoleTarget, PUBLISHED_STATUSES, TRIAL_STATUSES } from '../membership/discord-roles.mjs';
import { runSignup, resolveSignupRole, discordJoinEligibility } from '../workers/signup/signup.mjs';
import { handleDiscordInvite } from '../workers/signup/discord-invite.mjs';
import { couponGrantKey } from '../workers/signup/coupons.mjs';
import worker from '../workers/signup/index.mjs';
import { GbtiWelcome } from '../client-ui/src/elements/gbti-welcome.mjs';
import { ONBOARDING_STEPS } from '../membership/onboarding.mjs';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const IDENTITY = { githubId: '12345', githubLogin: 'octocat', discordUserId: 'd-987', email: 'octo@example.com', discordAccessToken: 'discord-user-token' };
const CONFIG = { guildId: 'guild-1', trialRoleId: 'role-trial', memberRoleId: 'role-member', lockedRoleId: 'role-locked', signupSource: 'signup-worker' };

const paidCustomer = { id: 'cus_1', metadata: { github_id: '12345' }, subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: 'price_x' } }] } }] } };
const freeCustomer = { id: 'cus_2', metadata: { github_id: '12345' } };
const lapsedCustomer = { id: 'cus_3', metadata: { github_id: '12345', trial_started_at: '2020-01-01T00:00:00.000Z' } };

const freshMirror = (over = {}) => ({
  generatedAt: NOW.toISOString(), roles: { superadmins: [], admins: [], moderators: [] },
  bans: { bans: [] }, grandfathered: { grandfathered: [] }, ...over,
});
const mirrorKv = (mirror) => ({ get: async (k) => (k === 'overrides:mirror' ? mirror : null), put: async () => {} });

function fakeStripe(searchHit) {
  const calls = { update: [], create: [] };
  return {
    calls,
    async searchCustomerByGithubId() { return searchHit; },
    async findCustomerByGithubId() { return searchHit; },
    async updateCustomer(id, args) { calls.update.push({ id, args }); return { id }; },
    async createCustomer(args) { calls.create.push({ args }); return { id: 'cus_new' }; },
  };
}

function fakeDiscord() {
  const calls = { addGuildMember: [], addRole: [], removeRole: [] };
  return {
    calls,
    async addGuildMember(guildId, userId, opts) { calls.addGuildMember.push({ guildId, userId, opts }); },
    async addRole(guildId, userId, roleId) { calls.addRole.push({ guildId, userId, roleId }); },
    async removeRole(guildId, userId, roleId) { calls.removeRole.push({ guildId, userId, roleId }); },
  };
}

const link = ({ customer, mirror = freshMirror(), config = CONFIG, coupon = undefined }) => {
  const discord = fakeDiscord();
  const stripe = fakeStripe(customer);
  return runSignup({ identity: IDENTITY, stripe, discord, kv: mirrorKv(mirror), config, coupon, now: NOW })
    .then((result) => ({ result, discord, stripe }));
};

// ---------------------------------------------------------------------------
// 1. The rule
// ---------------------------------------------------------------------------

test('sow-356: only a paid or trialing account may be in the server', () => {
  for (const s of ['paid', 'trialing']) assert.equal(discordJoinAllowed(s), true, s);
  for (const s of ['none', 'expired', 'cancelled', 'banned', 'unknown', '', null, undefined, 'PAID', 'member']) {
    assert.equal(discordJoinAllowed(s), false, `${s} may not join`);
  }
});

test('sow-356: the join rule is built from the SAME sets as the role rule, so the two cannot drift', () => {
  // Not a restatement of the test above: it reads the sets rather than the literals, so adding a status to
  // PUBLISHED_STATUSES or TRIAL_STATUSES carries it into the join without anyone remembering to.
  for (const s of [...PUBLISHED_STATUSES, ...TRIAL_STATUSES]) {
    assert.equal(discordJoinAllowed(s), true, `${s} holds an access role, so it is in the community`);
    assert.notEqual(discordRoleTarget(s), 'locked');
  }
  // And the converse: every status that resolves to Locked is refused the join.
  for (const s of ['none', 'expired', 'cancelled', 'banned']) {
    assert.equal(discordRoleTarget(s), 'locked');
    assert.equal(discordJoinAllowed(s), false);
  }
});

test('sow-356: resolveSignupRole names WHY it refused', async () => {
  const ask = (customer, mirror = freshMirror()) => resolveSignupRole({ kv: mirrorKv(mirror), githubId: '12345', customer, now: NOW });
  assert.deepEqual(await ask(freeCustomer), { access: 'locked', creator: false, eligible: false, reason: 'free' });
  assert.deepEqual(await ask(lapsedCustomer), { access: 'locked', creator: false, eligible: false, reason: 'lapsed' });
  assert.deepEqual(await ask(null), { access: 'locked', creator: false, eligible: false, reason: 'free' });
  const banned = freshMirror({ bans: { bans: [{ github_id: '12345', reason: 'spam' }] } });
  assert.deepEqual(await ask(paidCustomer, banned), { access: 'locked', creator: false, eligible: false, reason: 'banned' });
  const paid = await ask(paidCustomer);
  assert.equal(paid.eligible, true);
  assert.equal(paid.reason, 'eligible');
});

test('sow-356: a broken overrides copy does NOT lock out a paying member', async () => {
  // The refusal must not inherit the fail-closed answer of the ROLE. `locked` is what every failure path
  // returns, so reading eligibility as `access !== locked` would refuse a subscriber whenever the mirror is
  // stale or unreadable: today that only delays their role until the daily sync. Both stay true here: the role
  // falls back to locked, and the join still happens.
  const stale = freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' });
  for (const [label, kv] of [['absent', mirrorKv(null)], ['stale', mirrorKv(stale)], ['throwing', { get: async () => { throw new Error('kv down'); } }]]) {
    const r = await resolveSignupRole({ kv, githubId: '12345', customer: paidCustomer, now: NOW });
    assert.equal(r.access, 'locked', `${label}: the role still fails closed`);
    if (label === 'throwing') {
      // A throw is indistinguishable from a bug, so it refuses. The two readable-but-untrustworthy cases do not.
      assert.equal(r.eligible, false, 'a thrown read refuses');
      assert.equal(r.reason, 'unknown');
    } else {
      assert.equal(r.eligible, true, `${label}: a paying member still joins`);
    }
  }
  // And the same fallback refuses a free account, so it is not a hole.
  const free = await resolveSignupRole({ kv: mirrorKv(null), githubId: '12345', customer: freeCustomer, now: NOW });
  assert.deepEqual(free, { access: 'locked', creator: false, eligible: false, reason: 'free' });
});

// ---------------------------------------------------------------------------
// 2. The join
// ---------------------------------------------------------------------------

test('sow-356: a free, lapsed or banned account is neither added to the server nor recorded as linked', async () => {
  const banned = freshMirror({ bans: { bans: [{ github_id: '12345', reason: 'spam' }] } });
  const cases = [
    ['free', { customer: freeCustomer }, 'free'],
    ['lapsed', { customer: lapsedCustomer }, 'lapsed'],
    ['banned', { customer: paidCustomer, mirror: banned }, 'banned'],
    ['no customer at all', { customer: null }, 'free'],
  ];
  for (const [label, args, reason] of cases) {
    const { result, discord, stripe } = await link(args);
    assert.equal(discord.calls.addGuildMember.length, 0, `${label}: not added to the guild`);
    assert.equal(discord.calls.addRole.length, 0, `${label}: given no role`);
    assert.equal(discord.calls.removeRole.length, 0, `${label}: and nothing stripped either`);
    // THE DURABLE HALF. A recorded id would make every surface that reads the link report a member as being in
    // a server they were never added to, and the welcome would count the step done.
    const written = [...stripe.calls.update.map((c) => c.args?.metadata), ...stripe.calls.create.map((c) => c.args?.metadata)];
    for (const meta of written) assert.ok(!('discord_user_id' in (meta || {})), `${label}: no discord id written`);
    assert.equal(result.discordLinked, false, `${label}: reported as not linked`);
    assert.deepEqual(result.discordOutcome, { joined: false, roleAssigned: false, role: null, refused: reason }, label);
  }
});

test('sow-356: a paying member still joins, with the role and the recorded link', async () => {
  const { result, discord, stripe } = await link({ customer: paidCustomer });
  assert.equal(result.discordLinked, true);
  assert.deepEqual(result.discordOutcome, { joined: true, roleAssigned: true, role: 'member' });
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, ['role-member']);
  assert.deepEqual(discord.calls.addRole, [{ guildId: 'guild-1', userId: 'd-987', roleId: 'role-member' }]);
  assert.equal(stripe.calls.update[0].args.metadata.discord_user_id, 'd-987', 'and the link IS recorded');
});

test('sow-356: a live invite grant joins, because an invite is a paid membership', async () => {
  // The coupon population is the reason the rule is not simply "has a Stripe subscription". A grant is
  // authoritative before the nightly fold lands, and resolveSignupRole reads the EXISTING grant from KV, which
  // is what the deferred Discord leg always carries.
  const grant = { until: '2027-09-17T00:00:00.000Z', tier: 'member' };
  const kv = { get: async (k) => (k === 'overrides:mirror' ? freshMirror() : (k === couponGrantKey('12345') ? grant : null)), put: async () => {} };
  const discord = fakeDiscord();
  const stripe = fakeStripe(freeCustomer); // no subscription: the grant is the whole reason they may join
  const result = await runSignup({ identity: IDENTITY, stripe, discord, kv, config: CONFIG, now: NOW });
  assert.equal(result.discordLinked, true, 'an invitee joins');
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, ['role-member']);
});

test('sow-356: the decision is taken BEFORE the Customer write, not after it', async () => {
  // Order, asserted as order. A later check would leave the id on the record and only skip the guild call, which
  // is the half-fix this pins against: the refusal has to be unobservable afterwards.
  const order = [];
  const stripe = {
    calls: { update: [], create: [] },
    async searchCustomerByGithubId() { order.push('search'); return freeCustomer; },
    async findCustomerByGithubId() { return freeCustomer; },
    async updateCustomer(id, args) { order.push(`update:${'discord_user_id' in (args.metadata || {}) ? 'with-discord' : 'no-discord'}`); this.calls.update.push({ id, args }); return { id }; },
    async createCustomer() { order.push('create'); return { id: 'cus_new' }; },
  };
  const kv = { get: async (k) => (k === 'overrides:mirror' ? freshMirror() : null), put: async () => { order.push('kv'); } };
  await runSignup({ identity: IDENTITY, stripe, discord: fakeDiscord(), kv, config: CONFIG, now: NOW });
  assert.deepEqual(order, ['search', 'update:no-discord', 'kv'], 'the Customer is written without the Discord id');
});

// ---------------------------------------------------------------------------
// 3. The endpoints that could route around the join
// ---------------------------------------------------------------------------

test('sow-356: discordJoinEligibility answers from the record, and says when it could not look', async () => {
  const ask = (customer) => discordJoinEligibility({ kv: mirrorKv(freshMirror()), stripe: fakeStripe(customer), githubId: '12345', now: NOW });
  assert.deepEqual(await ask(paidCustomer), { known: true, eligible: true, reason: 'eligible' });
  assert.deepEqual(await ask(freeCustomer), { known: true, eligible: false, reason: 'free' });
  const broken = { findCustomerByGithubId: async () => { throw new Error('stripe down'); } };
  assert.deepEqual(
    await discordJoinEligibility({ kv: mirrorKv(freshMirror()), stripe: broken, githubId: '12345', now: NOW }),
    { known: false, eligible: false, reason: 'unknown' },
    'a failed lookup is not a yes',
  );
});

test('sow-356: the invite endpoint refuses an account that may not be in the server', async () => {
  const req = { headers: { get: (h) => (h === 'Authorization' ? 'Bearer tok' : null) } };
  const fetchUser = async () => ({ githubId: '12345', githubLogin: 'octocat' });
  const env = { DISCORD_INVITE_URL: 'https://discord.gg/vanity' }; // a static fallback IS available
  const kv = { get: async () => null, put: async () => {} };
  const real = (customer) => (githubId) => discordJoinEligibility({ kv: mirrorKv(freshMirror()), stripe: fakeStripe(customer), githubId, now: NOW });

  const free = await handleDiscordInvite(req, env, { fetchUser, kv, checkJoin: real(freeCustomer) });
  assert.equal(free.status, 403);
  assert.equal(free.body.error, 'membership_required');
  assert.ok(!JSON.stringify(free.body).includes('discord.gg'), 'and no invite leaks in the refusal');

  const paid = await handleDiscordInvite(req, env, { fetchUser, kv, checkJoin: real(paidCustomer) });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.url, 'https://discord.gg/vanity');

  // UNWIRED is a refusal. A gate that disappears when someone forgets to pass it prevents nothing.
  const unwired = await handleDiscordInvite(req, env, { fetchUser, kv });
  assert.equal(unwired.status, 403, 'no gate passed -> refuse');
  // As is a gate that throws.
  const boom = await handleDiscordInvite(req, env, { fetchUser, kv, checkJoin: async () => { throw new Error('down'); } });
  assert.equal(boom.status, 403);
});

test('sow-356: the invite ROUTE is wired to the gate, not just the handler', async () => {
  // The handler refuses when the gate says no; this proves the Worker actually passes one. An unwired route
  // would answer 200 with the vanity invite here, and every unit test of the handler would still be green.
  const env = {
    SESSION_SECRET: 'x'.repeat(32), PUBLIC_BASE_URL: 'https://gbti.test', SITE_BASE_URL: 'https://gbti.test',
    SIGNUP_KV: { get: async (k) => (k === 'overrides:mirror' ? freshMirror() : null), put: async () => {} },
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_GUILD_ID: 'guild-1', DISCORD_INVITE_URL: 'https://discord.gg/vanity',
  };
  const drive = async (customer) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      const body = u.includes('api.github.com/user') ? { id: 12345, login: 'octocat' }
        : u.includes('api.stripe.com/v1/customers/search') ? { data: [customer] }
          : {};
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    try {
      const req = new Request('https://gbti.test/membership/discord-invite', { headers: { Authorization: 'Bearer tok' } });
      const res = await worker.fetch(req, env, {});
      return { status: res.status, body: await res.json() };
    } finally { globalThis.fetch = original; }
  };
  const free = await drive(freeCustomer);
  assert.equal(free.status, 403, 'a free account gets no invite from the route either');
  assert.equal(free.body.error, 'membership_required');
  const paid = await drive(paidCustomer);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.url, 'https://discord.gg/vanity');
});

// ---------------------------------------------------------------------------
// 4. The screens
// ---------------------------------------------------------------------------

// The wizard's methods call each other, so a prototype-level receiver needs the prototype behind it. Deriving the
// step list is what load() does as soon as the membership is read (sow-357), so a receiver must do it too.
const self = (membership) => {
  const el = Object.assign(Object.create(GbtiWelcome.prototype), { _membership: membership });
  el._deriveSteps();
  return el;
};

test('sow-356: the welcome Discord step offers a membership link instead of a connect button', () => {
  const card = (membership) => GbtiWelcome.prototype._discordCard.call(Object.assign(Object.create(GbtiWelcome.prototype), { _membership: membership }));
  for (const m of ['none', 'expired', 'cancelled', 'banned']) {
    const html = card(m);
    assert.ok(!html.includes('data-discord-connect'), `${m}: no connect button`);
    assert.ok(!html.includes('data-discord-unlink'), `${m}: nothing to disconnect`);
    assert.match(html, /Network Supporter membership/, `${m}: says what it is part of`);
    assert.match(html, /https:\/\/gbti\.network\/membership\//, `${m}: and where to go`);
  }
  // An unread membership offers NEITHER. Guessing "you cannot" is as wrong as guessing "you can".
  const unknown = card('unknown');
  assert.ok(!unknown.includes('data-discord-connect'), 'unknown: no button');
  assert.ok(!unknown.includes('/membership/'), 'unknown: and no upgrade pitch either');
  assert.match(unknown, /could not check your membership/);
  // A paying member still gets the button.
  const paid = card('paid');
  assert.match(paid, /data-discord-connect/);
  assert.ok(!paid.includes('Network Supporter membership'));
});

test('sow-356/357: resuming never parks an account on a step it cannot finish', () => {
  // sow-356 forced the Discord slot "done" for resume, because a free account would otherwise land there every
  // visit. sow-357 removes the special case at the root: such an account is not OFFERED the step, so there is
  // nothing to step past, and the rail no longer has to show an outstanding step nobody can do.
  const keys = (m) => self(m)._steps.map((s) => s.key);
  assert.ok(!keys('none').includes('discord'), 'a free account is not offered the step at all');
  assert.ok(!keys('expired').includes('discord'), 'nor a lapsed one');
  assert.ok(keys('paid').includes('discord'), 'a member who can join is');
  assert.ok(keys('trialing').includes('discord'), 'and so is a trial');
  // An UNREAD membership keeps the step AND lands on it, which is how they learn the check failed. Found by
  // driving the wizard: before this, every membership, unread included, resumed on step two.
  const unread = self('unknown');
  assert.ok(keys('unknown').includes('discord'));
  assert.deepEqual(GbtiWelcome.prototype._resumeFlags.call(unread), [false, false, false, false, false]);
  // Resume is now simply "what is done, in this account's order": nothing is pre-settled for anybody.
  assert.deepEqual(GbtiWelcome.prototype._resumeFlags.call(self('none')), [false, false, false]);
  assert.deepEqual(GbtiWelcome.prototype._resumeFlags.call(self('paid')), [false, false, false, false, false]);
});

test('sow-356/357: no account is told to connect Discord unless it can', () => {
  // Driven in a browser before it was pinned: the card said the server is for paying members under a heading
  // reading "Connect Discord". The override now matters for exactly one account, the one whose membership could
  // not be read: every other account that cannot join is not offered the step at all (sow-357).
  const heading = (membership, step = 0, done = false) => {
    const el = self(membership);
    el._step = step;
    el._done = done;
    return GbtiWelcome.prototype._headingText.call(el);
  };
  assert.equal(heading('unknown'), 'Discord community', 'shown, but not as an instruction');
  assert.equal(heading('paid'), ONBOARDING_STEPS[0].heading, 'a member who can connect is told to');
  assert.equal(heading('trialing'), ONBOARDING_STEPS[0].heading);
  for (const m of ['none', 'expired', 'banned']) {
    assert.equal(heading(m), 'Follow the channels', `${m} opens on a step it can actually do`);
  }
  assert.equal(heading('none', 0, true), 'You are all set', 'the finished state is untouched');
});

test('sow-356: the account page offers the Discord invite only to an account that may join', () => {
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-account.mjs', import.meta.url), 'utf8');
  assert.match(src, /const invite = \(discordJoinAllowed\(this\._membership\) && this\._invite\?\.url\) \|\| null;/);
  assert.match(src, /import \{ discordJoinAllowed \}/, 'from the shared rule, not a local copy of it');
});

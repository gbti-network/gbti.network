// SOW-005 reconcile tests. Drives the PURE planReconcile with fixtures for each scenario plus an
// idempotency check. No network, no secrets: the planner is pure. The CLI helpers, the enactment and the
// coupon-grant pre-apply were split into reconcile-cli, reconcile-enact and reconcile-coupon-grants at the
// 900-line limit (owner, 2026-09-30), and the shared fixtures live in test/lib/reconcile-fixtures.mjs.
// Run the reconcile suites together:
//   node --test 'test/reconcile*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planReconcile, discordRoleTarget, discordCreatorTarget, CREATOR_DISCORD_ROLE, REMINDER_DAY } from '../scripts/lib/reconcile-plan.mjs';
import { shouldSyncCreatorRole } from '../scripts/reconcile.mjs';
import { NOW, DAY, effective, file, ofKind } from './lib/reconcile-fixtures.mjs';

// ---- cancelled member with published posts -> NO content action, Locked role only (sow-197) ----
// This test used to assert the opposite. A lapse now changes ACCESS, never published work: membership is
// enforced at write time (the gate, the Worker author route, the client), so nothing new can be published,
// and reconcile no longer reaches back into content it did not author. Only a BAN still drafts.
test('cancelled member keeps their published content and only loses the Discord role', () => {
  const members = [
    {
      githubId: '100',
      username: 'casey',
      derived: 'cancelled',
      effective: effective('100', 'cancelled'),
      discordUserId: 'd100',
      discordRoles: ['member'],
    },
  ];
  const repoIndex = {
    casey: {
      files: [
        file('members/casey/profile.md', 'published'),
        file('members/casey/posts/hello/index.md', 'published'),
        file('members/casey/posts/already-draft/index.md', 'draft'),
      ],
    },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'a lapse must not touch content in either direction');
  // cancelled -> the Locked role: add locked, remove the member role they still hold (locked out, not kicked)
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 2);
  assert.deepEqual(discord.find((a) => a.type === 'add-role'), { kind: 'discord', type: 'add-role', githubId: '100', discordUserId: 'd100', role: 'locked' });
  assert.deepEqual(discord.find((a) => a.type === 'remove-role'), { kind: 'discord', type: 'remove-role', githubId: '100', discordUserId: 'd100', role: 'member' });
});

// ---- grandfathered member with no sub -> keep published + member role ----
test('grandfathered member keeps published content and gets the member role', () => {
  const grandfathers = new Map([['200', { github_id: '200' }]]);
  const eff = effective('200', 'none', { grandfathers });
  assert.equal(eff.status, 'paid');
  assert.equal(eff.source, 'grandfather');
  const members = [
    {
      githubId: '200',
      username: 'gwen',
      derived: 'none',
      effective: eff,
      discordUserId: 'd200',
      discordRoles: [], // no role yet
    },
  ];
  const repoIndex = {
    gwen: { files: [file('members/gwen/profile.md', 'published'), file('members/gwen/posts/p1/index.md', 'published')] },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  // already published + grandfather (paid) -> NO content flip (idempotent)
  assert.equal(ofKind(actions, 'content').length, 0);
  // role is added (none -> member)
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 1);
  assert.equal(discord[0].type, 'add-role');
  assert.equal(discord[0].role, 'member');
});

// sow-185: the Content-Creator Discord badge is a SEPARATE, stackable axis (a creator holds member + creator;
// a member holds member only). Gated on creatorRoleEnabled (reconcile passes !!DISCORD_CREATOR_ROLE_ID).
test('discordCreatorTarget: only creator tier wants the badge', () => {
  assert.equal(discordCreatorTarget('creator'), true);
  assert.equal(discordCreatorTarget('member'), false);
  assert.equal(discordCreatorTarget('none'), false);
  assert.equal(discordCreatorTarget(undefined), false);
  assert.equal(CREATOR_DISCORD_ROLE, 'creator');
});

const creatorMember = (over = {}) => ({ githubId: '300', username: 'cr', derived: 'paid', effective: effective('300', 'paid'), discordUserId: 'd300', discordRoles: ['member'], tier: 'creator', ...over });

test('sow-185: a Content Creator gains the @Creator badge on TOP of @Member (member kept, not swapped)', () => {
  const actions = ofKind(planReconcile({ members: [creatorMember()], repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  // no member add (already held), no member remove, exactly one creator add
  assert.deepEqual(actions, [{ kind: 'discord', type: 'add-role', githubId: '300', discordUserId: 'd300', role: 'creator' }]);
});

test('sow-185: a Content Creator already holding member + creator gets NO action (idempotent)', () => {
  const actions = ofKind(planReconcile({ members: [creatorMember({ discordRoles: ['member', 'creator'] })], repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  assert.equal(actions.length, 0);
});

test('sow-185: a Network Member (member tier) never gets @Creator; a downgraded creator LOSES the badge', () => {
  const memberTier = planReconcile({ members: [creatorMember({ tier: 'member', discordRoles: ['member'] })], repoIndex: {}, now: NOW, creatorRoleEnabled: true });
  assert.equal(ofKind(memberTier, 'discord').length, 0); // member tier holds member already -> nothing
  const downgraded = ofKind(planReconcile({ members: [creatorMember({ tier: 'member', discordRoles: ['member', 'creator'] })], repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  assert.deepEqual(downgraded, [{ kind: 'discord', type: 'remove-role', githubId: '300', discordUserId: 'd300', role: 'creator' }]);
});

test('sow-185: with the Creator role UNPROVISIONED (creatorRoleEnabled false) the badge axis emits NOTHING', () => {
  // pre-provision every paid member resolves to creator via the inert price map; the flag keeps the plan clean.
  const actions = ofKind(planReconcile({ members: [creatorMember()], repoIndex: {}, now: NOW }), 'discord');
  assert.equal(actions.filter((a) => a.role === 'creator').length, 0);
});

// ---- a draft is left alone, full stop (the 2026-08-08 incident) ----
// Reconcile published an unfinished article overnight (63c2800) because it republished ANY draft a paid member
// owned: nothing records WHY a file is draft, so it could not tell content it had drafted after a lapse from a
// draft the author was still writing. sow-197 removed the publish path entirely rather than guessing at intent.
// Without this the WorkBench draft review shipped in sow-194 is pointless, since every reviewable draft would
// be one nightly run from going live.
test('a paid member\'s draft is never auto-published', () => {
  const members = [
    {
      githubId: '900', username: 'nia', derived: 'paid', effective: effective('900', 'paid'),
      discordUserId: 'd900', discordRoles: ['member'],
    },
  ];
  const repoIndex = { nia: { files: [file('members/nia/posts/wip/index.md', 'draft')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'an unfinished draft must never be auto-published');
});

test('removing the publish path does NOT weaken the ban path: a banned member is still drafted', () => {
  // ban > staff > grandfather > Stripe exists so a ban deplatforms regardless of payment. The ban branch is
  // the one content path sow-197 kept, and this asserts it: the one direction that must never regress.
  const bans = new Map([['902', { github_id: '902' }]]);
  const members = [
    {
      githubId: '902', username: 'pat', derived: 'paid', effective: effective('902', 'paid', { bans }),
      discordUserId: 'd902', discordRoles: ['member'],
    },
  ];
  const repoIndex = { pat: { files: [file('members/pat/posts/live/index.md', 'published')] } };
  const content = ofKind(planReconcile({ members, repoIndex, now: NOW }), 'content');
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'draft');
});

// ---- grandfathered member with DRAFT content -> still no publish (sow-197) ----
// A grant makes the member effective-paid, and that used to republish anything of theirs sitting in draft.
// It no longer does: a draft is the author's own unpublish state, and only the author republishes it.
test('grandfathered member\'s drafted content is left in draft', () => {
  const grandfathers = new Map([['205', { github_id: '205' }]]);
  const members = [
    {
      githubId: '205',
      username: 'gabe',
      derived: 'none',
      effective: effective('205', 'none', { grandfathers }),
      discordUserId: 'd205',
      discordRoles: ['member'],
    },
  ];
  const repoIndex = { gabe: { files: [file('members/gabe/posts/p1/index.md', 'draft')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'a grant changes access, not content status');
  // role already member -> no discord action
  assert.equal(ofKind(actions, 'discord').length, 0);
});

// ---- banned member who is paid -> draft + roles removed (+ block) ----
test('banned member who is paid is deplatformed (draft + role removed + block)', () => {
  const bans = new Map([['300', { github_id: '300', reason: 'spam' }]]);
  const eff = effective('300', 'paid', { bans });
  assert.equal(eff.status, 'banned'); // ban overrides paid
  const members = [
    {
      githubId: '300',
      username: 'mallory',
      derived: 'paid',
      effective: eff,
      discordUserId: 'd300',
      discordRoles: ['member'],
    },
  ];
  const repoIndex = { mallory: { files: [file('members/mallory/posts/x/index.md', 'published')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  const content = ofKind(actions, 'content');
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'draft');
  // banned -> the Locked role (locked out, NOT kicked): add locked, remove the member role they held
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 2);
  assert.equal(discord.find((a) => a.type === 'add-role').role, 'locked');
  assert.equal(discord.find((a) => a.type === 'remove-role').role, 'member');
  // a block marker is emitted
  assert.equal(ofKind(actions, 'block').length, 1);
});

// ---- trial member at day 88 -> reminder action ----
test('trial member inside the day-87 window gets a reminder', () => {
  const trialStartedAt = new Date(NOW.getTime() - 88 * DAY).toISOString();
  const members = [
    {
      githubId: '400',
      username: 'tori',
      derived: 'trialing',
      effective: effective('400', 'trialing'),
      discordUserId: 'd400',
      email: 'tori@example.com',
      discordRoles: ['trial'],
      trialStartedAt,
      converted: false,
    },
  ];
  const actions = planReconcile({ members, repoIndex: {}, now: NOW });
  const reminders = ofKind(actions, 'reminder');
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].type, 'day-87');
  assert.equal(reminders[0].email, 'tori@example.com');
  // trial role already correct -> no discord action
  assert.equal(ofKind(actions, 'discord').length, 0);
});

test('day-87 window excludes day 86 (too early), day 90 (expired), and converted members', () => {
  const make = (offsetDays, converted, status = 'trialing') => ({
    githubId: 'x',
    username: 'x',
    derived: status,
    effective: { status, source: 'stripe' },
    trialStartedAt: new Date(NOW.getTime() - offsetDays * DAY).toISOString(),
    converted,
  });
  assert.equal(REMINDER_DAY, 87);
  // day 86: before the window
  assert.equal(ofKind(planReconcile({ members: [make(86, false)], now: NOW }), 'reminder').length, 0);
  // day 88: inside
  assert.equal(ofKind(planReconcile({ members: [make(88, false)], now: NOW }), 'reminder').length, 1);
  // day 90: at/after expiry, window closed
  assert.equal(ofKind(planReconcile({ members: [make(90, false)], now: NOW }), 'reminder').length, 0);
  // day 88 but already converted: no reminder
  assert.equal(ofKind(planReconcile({ members: [make(88, true)], now: NOW }), 'reminder').length, 0);
});

// SOW-142: the day-87 nag is gated on the EFFECTIVE status being a trial. A member whose Stripe record is
// a day-88 trial but who is effective-paid another way (grandfather comp, a coupon free year, staff) must
// NOT be told their trial is ending; their entitlement does not end at day 90.
test('day-87 reminder never targets an effective-paid member with a Stripe trial record', () => {
  const make = (source) => ({
    githubId: 'g1',
    username: 'g1',
    derived: 'trialing',
    effective: { status: 'paid', source },
    trialStartedAt: new Date(NOW.getTime() - 88 * DAY).toISOString(),
    converted: false,
  });
  for (const source of ['grandfather', 'staff']) {
    const reminders = ofKind(planReconcile({ members: [make(source)], now: NOW }), 'reminder');
    assert.equal(reminders.filter((r) => r.type === 'day-87').length, 0, `source=${source}`);
  }
  // the plain trial control case still fires
  const plain = { githubId: 't', username: 't', derived: 'trialing', effective: { status: 'trialing', source: 'stripe' }, trialStartedAt: new Date(NOW.getTime() - 88 * DAY).toISOString(), converted: false };
  assert.equal(ofKind(planReconcile({ members: [plain], now: NOW }), 'reminder').filter((r) => r.type === 'day-87').length, 1);
});

// ---- resubscribed member -> member role added, content untouched (sow-197) ----
// Resubscribing restores ACCESS. It does not sweep the member's drafts live: reconcile never drafted them in
// the first place, so there is nothing of its own making left to reverse.
test('resubscribed (paid) member gets the member role and their drafts stay drafts', () => {
  const members = [
    {
      githubId: '500',
      username: 'rhea',
      derived: 'paid',
      effective: effective('500', 'paid'),
      discordUserId: 'd500',
      discordRoles: ['locked'], // was locked out while lapsed
    },
  ];
  const repoIndex = {
    rhea: {
      files: [
        file('members/rhea/profile.md', 'draft'),
        file('members/rhea/posts/p/index.md', 'draft'),
        file('members/rhea/projects/q/index.md', 'published'), // already published, skip
      ],
    },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'resubscribing restores access, not content status');
  // role swap: add member, remove the locked role they held while lapsed
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 2);
  assert.equal(discord.find((a) => a.type === 'add-role').role, 'member');
  assert.equal(discord.find((a) => a.type === 'remove-role').role, 'locked');
});

// ---- idempotency: running against the already-correct state yields no actions ----
test('idempotent: an already-correct paid member yields zero actions', () => {
  const members = [
    {
      githubId: '600',
      username: 'ida',
      derived: 'paid',
      effective: effective('600', 'paid'),
      discordUserId: 'd600',
      discordRoles: ['member'], // already correct
    },
  ];
  const repoIndex = {
    ida: { files: [file('members/ida/profile.md', 'published'), file('members/ida/posts/p/index.md', 'published')] },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(actions, []);
});

test('idempotent: an already-correct expired member (all draft, holds the locked role) yields zero actions', () => {
  const members = [
    {
      githubId: '601',
      username: 'evan',
      derived: 'expired',
      effective: effective('601', 'expired'),
      discordUserId: 'd601',
      discordRoles: ['locked'], // already locked out (the target for an expired member)
    },
  ];
  const repoIndex = { evan: { files: [file('members/evan/posts/p/index.md', 'draft')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(actions, []);
});

// ---- discordRoleTarget mapping ----
test('discordRoleTarget maps statuses to exactly one of the three managed roles', () => {
  assert.equal(discordRoleTarget('paid'), 'member');
  assert.equal(discordRoleTarget('trialing'), 'trial');
  // every non-entitled status maps to the Locked role (locked out of the channels, not kicked)
  assert.equal(discordRoleTarget('expired'), 'locked');
  assert.equal(discordRoleTarget('cancelled'), 'locked');
  assert.equal(discordRoleTarget('banned'), 'locked');
  assert.equal(discordRoleTarget('none'), 'locked');
});

// ---- three-role swaps: exactly one managed role, stray self-heal, never kick ----
test('trial -> paid swap: add member, remove the trial role they held', () => {
  const members = [{ githubId: '110', username: 'tess', derived: 'paid', effective: effective('110', 'paid'), discordUserId: 'd110', discordRoles: ['trial'] }];
  const actions = ofKind(planReconcile({ members, repoIndex: {}, now: NOW }), 'discord');
  assert.equal(actions.length, 2);
  assert.equal(actions.find((a) => a.type === 'add-role').role, 'member');
  assert.equal(actions.find((a) => a.type === 'remove-role').role, 'trial');
});

test('stray self-heal: a paid member who also holds a stray locked role has only the stray removed', () => {
  const members = [{ githubId: '111', username: 'stu', derived: 'paid', effective: effective('111', 'paid'), discordUserId: 'd111', discordRoles: ['member', 'locked'] }];
  const actions = ofKind(planReconcile({ members, repoIndex: {}, now: NOW }), 'discord');
  // target (member) already held -> no add; the stray locked is removed so exactly one managed role remains
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], { kind: 'discord', type: 'remove-role', githubId: '111', discordUserId: 'd111', role: 'locked' });
});

test('sow-185: shouldSyncCreatorRole gates the Content-Creator badge on a POPULATED price map, not the role id alone', () => {
  // The whole safety: with an EMPTY price map, tierForPrice runs legacy mode and resolves EVERY paid member to
  // creator, so the badge must NOT sync on the role id alone (that would stamp @Creator on everyone in the guild).
  assert.equal(shouldSyncCreatorRole({}), false);                                                          // nothing set
  assert.equal(shouldSyncCreatorRole({ DISCORD_CREATOR_ROLE_ID: '1536102140802633788' }), false);          // role id but EMPTY price map -> inert (the guard)
  assert.equal(shouldSyncCreatorRole({ STRIPE_PRICE_CREATOR_ANNUAL: 'price_c' }), false);                  // price map but no role id
  assert.equal(shouldSyncCreatorRole({ DISCORD_CREATOR_ROLE_ID: '1536102140802633788', STRIPE_PRICE_CREATOR_ANNUAL: 'price_c' }), true); // both -> sync
});

// sow-218: the fail-open this closes. A member whose Discord roles could not be read must still have every
// non-target role stripped, because "unknown" was previously indistinguishable from "holds nothing" and the
// removals were skipped entirely. In an ALLOW-based guild that left a lapsed member holding @Member, which is
// the role that actually grants access, until some later run happened to read them cleanly.
test('sow-218: an UNREADABLE member still gets every non-target role stripped', () => {
  const lapsed = {
    githubId: '900', discordUserId: 'd900', effective: { status: 'cancelled' },
    discordRoles: null, // the read failed
  };
  const actions = planReconcile({ members: [lapsed], now: new Date('2026-08-12T00:00:00Z') }).filter((a) => a.kind === 'discord');
  const removed = actions.filter((a) => a.type === 'remove-role').map((a) => a.role).sort();
  const added = actions.filter((a) => a.type === 'add-role').map((a) => a.role);
  assert.deepEqual(added, ['locked'], 'the target is still assigned');
  assert.deepEqual(removed, ['member', 'trial'], 'and BOTH other access roles are stripped despite the failed read');
});

test('sow-218: a member read as holding NOTHING emits no pointless removals', () => {
  // The optimization the null/[] split preserves: a successful read of an empty set still skips the no-op calls.
  const fresh = {
    githubId: '901', discordUserId: 'd901', effective: { status: 'cancelled' },
    discordRoles: [],
  };
  const actions = planReconcile({ members: [fresh], now: new Date('2026-08-12T00:00:00Z') }).filter((a) => a.kind === 'discord');
  assert.deepEqual(actions.filter((a) => a.type === 'remove-role'), [], 'nothing held, nothing to remove');
  assert.deepEqual(actions.filter((a) => a.type === 'add-role').map((a) => a.role), ['locked']);
});

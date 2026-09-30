// SOW-005 reconcile tests: the CLI helpers in scripts/reconcile.mjs that take plain objects (flipStatus,
// parseArgs, memberEntryFor), the fail-closed folder resolution (FIX 1), the Discord current-role reads (FIX 2),
// the override-only enumeration, and the targeted single-member regate (FIX 4). No network, no secrets; two
// tests write a throwaway temp directory. Split out of test/reconcile.test.mjs at the 900-line limit (owner,
// 2026-09-30); the shared fixtures live in test/lib/reconcile-fixtures.mjs.
// Run the reconcile suites together:
//   node --test 'test/reconcile*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planReconcile } from '../scripts/lib/reconcile-plan.mjs';
import {
  flipStatus,
  parseArgs,
  memberEntryFor,
  resolveUsername,
  resolveDiscordRoles,
  targetedGithubId,
  gatherMembers,
  gatherOverrideOnlyMembers,
  parseDiscordUserMap,
} from '../scripts/reconcile.mjs';
import { buildRepoIndex, githubLoginFromUrl, githubLoginFromProfile } from '../scripts/lib/repo-content.mjs';
import { deriveStatusFromCustomer } from '../membership/derive-status.mjs';
import { NOW, DAY, file, ofKind, noOverrides } from './lib/reconcile-fixtures.mjs';

// ---- CLI helper: flipStatus toggles the frontmatter line both directions, leaves others intact ----
test('flipStatus flips published<->draft and leaves other frontmatter alone', () => {
  const md = ['---', 'type: post', 'status: published', 'visibility: public', '---', 'body'].join('\n');
  const drafted = flipStatus(md, 'draft');
  assert.match(drafted, /^status: draft$/m);
  assert.match(drafted, /^visibility: public$/m); // untouched
  const republished = flipStatus(drafted, 'published');
  assert.match(republished, /^status: published$/m);
  // quoted form is handled too
  const quoted = 'status: "draft"\n';
  assert.equal(flipStatus(quoted, 'published'), 'status: published\n');
});

// ---- CLI helper: parseArgs defaults to dry-run ----
test('parseArgs defaults to dry-run; --apply enacts; --dry-run wins over --apply', () => {
  assert.deepEqual(parseArgs([]), { apply: false, dryRun: true });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, dryRun: false });
  assert.deepEqual(parseArgs(['--dry-run']), { apply: false, dryRun: true });
  // explicit dry-run overrides apply (safety)
  assert.deepEqual(parseArgs(['--apply', '--dry-run']), { apply: false, dryRun: true });
});

// ---- CLI helper: memberEntryFor wires Stripe customer + overrides into a planner entry ----
test('memberEntryFor derives status, resolves username via members-index, and reads metadata', () => {
  const trialStartedAt = new Date(NOW.getTime() - 10 * DAY).toISOString();
  const customer = {
    id: 'cus_1',
    email: 'paid@example.com',
    metadata: { github_id: '700', github_login: 'paula', discord_user_id: 'd700', trial_started_at: trialStartedAt },
    subscriptions: { data: [{ status: 'active', created: 1 }] },
  };
  const overrides = {
    roles: new Map(),
    bans: new Map(),
    grandfathers: new Map(),
    membersIndex: new Map([['700', 'paula-folder']]),
  };
  const entry = memberEntryFor(customer, overrides, NOW);
  assert.equal(entry.githubId, '700');
  assert.equal(entry.username, 'paula-folder'); // members-index wins over github_login
  assert.equal(entry.discordUserId, 'd700');
  assert.equal(entry.email, 'paid@example.com');
  assert.equal(entry.derived, 'paid');
  assert.equal(entry.effective.status, 'paid');
  assert.equal(entry.converted, true);
  // sanity: derive directly matches
  assert.equal(deriveStatusFromCustomer(customer, NOW), 'paid');
});

test('sow-185: memberEntryFor resolves the effective TIER override-aware (Stripe price, grandfather, default)', () => {
  const ov = (over = {}) => ({ roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map(), ...over });
  const paidCustomer = (priceId) => ({ id: 'c', metadata: { github_id: '710' }, subscriptions: { data: [{ status: 'active', created: 1, ...(priceId ? { items: { data: [{ price: { id: priceId } }] } } : {}) }] } });
  const priceMap = new Map([['price_m', 'member'], ['price_c', 'creator']]);
  // 2026-08-11: with NO price map, a paid sub now resolves to `none`, not `creator`. The empty-map default
  // was the sow-185 fail-open and has been removed. This is inert for reconcile: the ONLY consumer of a
  // member entry's tier is the Creator Discord badge (reconcile-plan.mjs:185), and that sits behind
  // shouldSyncCreatorRole, which itself requires a NON-empty price map. Verified by execution: with the role
  // id set and no price env it returns false, so nothing reads this value in reconcile's real env.
  assert.equal(memberEntryFor(paidCustomer(), ov(), NOW).tier, 'none');
  // with the map: a member-priced sub -> member, a creator-priced sub -> creator
  assert.equal(memberEntryFor(paidCustomer('price_m'), ov(), NOW, { priceTierMap: priceMap }).tier, 'member');
  assert.equal(memberEntryFor(paidCustomer('price_c'), ov(), NOW, { priceTierMap: priceMap }).tier, 'creator');
  // a grandfathered member (no sub) -> member by default (owner Q15 flip); an explicit tier grant wins
  const noSub = { id: 'c', metadata: { github_id: '720' } };
  assert.equal(memberEntryFor(noSub, ov({ grandfathers: new Map([['720', { github_id: '720' }]]) }), NOW, { priceTierMap: priceMap }).tier, 'member');
  assert.equal(memberEntryFor(noSub, ov({ grandfathers: new Map([['720', { github_id: '720', tier: 'creator' }]]) }), NOW, { priceTierMap: priceMap }).tier, 'creator'); // the escape hatch keeps a comp at creator
  assert.equal(memberEntryFor(noSub, ov({ grandfathers: new Map([['720', { github_id: '720', tier: 'member' }]]) }), NOW, { priceTierMap: priceMap }).tier, 'member');
  // a non-paid (expired) account -> tier none
  assert.equal(memberEntryFor(noSub, ov(), NOW, { priceTierMap: priceMap }).tier, 'none');
});

test('memberEntryFor resolves the folder via repoIndex byGithubLogin (login != folder name)', () => {
  // Real-data shape: folder 'frankfolder' whose profile links.github is github.com/frank.
  const customer = { id: 'cus_2', metadata: { github_id: '701', github_login: 'frank' } };
  const overrides = { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() };
  const repoIndex = {
    byUsername: { frankfolder: { files: [] } },
    byGithubLogin: new Map([['frank', 'frankfolder']]),
    byGithubId: new Map(),
  };
  const entry = memberEntryFor(customer, overrides, NOW, { repoIndex });
  assert.equal(entry.username, 'frankfolder'); // resolved through the login -> folder map, not the raw login
  // 2026-08-11: no sub AND no trial clock now resolves 'none', not 'expired'. The assertion the test
  // actually cares about is unchanged (NOT paid, fail closed); only the word for it moved, because the trial
  // is retired and nothing expired for a member who never had anything.
  assert.equal(entry.effective.status, 'none');
});

test('memberEntryFor leaves username null when no folder resolves (fail closed, warning path)', () => {
  const customer = { id: 'cus_3', metadata: { github_id: '702', github_login: 'nobody' } };
  const overrides = { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() };
  const repoIndex = { byUsername: {}, byGithubLogin: new Map(), byGithubId: new Map() };
  const entry = memberEntryFor(customer, overrides, NOW, { repoIndex });
  assert.equal(entry.username, null);
});

// =============================================================================================
// FIX 1: authoritative, fail-closed folder resolution (login != folder name => still drafts on lapse)
// =============================================================================================

test('githubLoginFromUrl extracts and lowercases the trailing segment', () => {
  assert.equal(githubLoginFromUrl('https://github.com/atwellpub'), 'atwellpub');
  assert.equal(githubLoginFromUrl('https://github.com/atwellpub/'), 'atwellpub');
  assert.equal(githubLoginFromUrl('https://github.com/AtwellPub'), 'atwellpub');
  assert.equal(githubLoginFromUrl('http://github.com/foo/bar'), 'foo');
  assert.equal(githubLoginFromUrl('github.com/baz'), 'baz');
  assert.equal(githubLoginFromUrl('plainlogin'), 'plainlogin');
  assert.equal(githubLoginFromUrl(''), null);
  assert.equal(githubLoginFromUrl(null), null);
});

test('githubLoginFromProfile reads the nested links.github line', () => {
  const profile = [
    '---',
    'type: profile',
    'username: hudson',
    'status: published',
    'links:',
    '  github: "https://github.com/atwellpub"',
    '  x: "https://x.com/atwellpub"',
    '---',
    'body',
  ].join('\n');
  assert.equal(githubLoginFromProfile(profile), 'atwellpub');
});

test('resolveUsername precedence: members-index > byGithubId > byGithubLogin > case-insensitive folder', () => {
  const repoIndex = {
    byUsername: { hudson: { files: [] }, casey: { files: [] } },
    byGithubLogin: new Map([['atwellpub', 'hudson']]),
    byGithubId: new Map([['999', 'casey']]),
  };
  // 1. members-index wins outright
  const ov = noOverrides();
  ov.membersIndex.set('42', 'casey');
  assert.equal(resolveUsername('42', 'atwellpub', ov, repoIndex), 'casey');
  // 2. byGithubId
  assert.equal(resolveUsername('999', 'whatever', noOverrides(), repoIndex), 'casey');
  // 3. byGithubLogin (THE hudson/atwellpub case)
  assert.equal(resolveUsername('1', 'atwellpub', noOverrides(), repoIndex), 'hudson');
  assert.equal(resolveUsername('1', 'AtwellPub', noOverrides(), repoIndex), 'hudson'); // case-insensitive
  // 4. case-insensitive folder name match
  assert.equal(resolveUsername('1', 'Casey', noOverrides(), repoIndex), 'casey');
  // nothing resolves -> null (fail closed; triggers the warning)
  assert.equal(resolveUsername('1', 'ghost', noOverrides(), repoIndex), null);
});

test('FIX 1: a member whose login != folder name (hudson/atwellpub) still resolves, and a BAN reaches their content', () => {
  // The confirmed real-data bug: Stripe github_login is 'atwellpub' but the folder is 'hudson'. Folder
  // resolution still has to be right after sow-197, because the BAN path depends on it: an unresolvable
  // banned member is the one case that must never quietly leave content live.
  const repoIndex = {
    byUsername: { hudson: { files: [file('members/hudson/profile.md', 'published')] } },
    byGithubLogin: new Map([['atwellpub', 'hudson']]),
    byGithubId: new Map(),
  };
  const customer = { id: 'cus_h', metadata: { github_id: '5000', github_login: 'atwellpub' } };
  const entry = memberEntryFor(customer, noOverrides(), NOW, { repoIndex });
  assert.equal(entry.username, 'hudson'); // resolved despite login != folder
  assert.equal(entry.effective.status, 'none'); // no sub, no trial clock -> not paid (see the note above)

  // Plan against the SAME byUsername the production main() passes to the planner.
  // Lapsed: access changes, content does not (sow-197).
  const lapsed = planReconcile({ members: [entry], repoIndex: repoIndex.byUsername, now: NOW });
  assert.deepEqual(ofKind(lapsed, 'content'), [], 'a lapse leaves hudson\'s published profile live');

  // Banned: the same resolution now feeds the one path that DOES draft.
  const bans = new Map([['5000', { github_id: '5000' }]]);
  const bannedEntry = memberEntryFor(customer, { ...noOverrides(), bans }, NOW, { repoIndex });
  assert.equal(bannedEntry.effective.status, 'banned');
  const banned = ofKind(planReconcile({ members: [bannedEntry], repoIndex: repoIndex.byUsername, now: NOW }), 'content');
  assert.equal(banned.length, 1, 'a banned member\'s content must be drafted, not left live');
  assert.equal(banned[0].type, 'draft');
  assert.deepEqual(banned[0].files, ['members/hudson/profile.md']);
});

test('FIX 1: buildRepoIndex parses login + status from a real on-disk member folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-repo-'));
  const dir = path.join(tmp, 'members', 'hudson');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'profile.md'),
    ['---', 'type: profile', 'username: hudson', 'status: published', 'visibility: public', 'links:', '  github: "https://github.com/atwellpub"', '---', 'bio'].join('\n'),
  );
  const postDir = path.join(dir, 'posts', 'hello');
  fs.mkdirSync(postDir, { recursive: true });
  fs.writeFileSync(path.join(postDir, 'index.md'), ['---', 'type: post', 'status: draft', '---', 'hi'].join('\n'));

  const idx = buildRepoIndex(tmp);
  assert.ok(idx.byUsername.hudson, 'folder indexed by username');
  assert.equal(idx.byGithubLogin.get('atwellpub'), 'hudson', 'login parsed from links.github');
  // file statuses parsed
  const statuses = Object.fromEntries(idx.byUsername.hudson.files.map((f) => [f.path.split('/').slice(-1)[0] === 'profile.md' ? 'profile' : 'post', f.status]));
  assert.equal(statuses.profile, 'published');
  assert.equal(statuses.post, 'draft');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// =============================================================================================
// FIX 2: Discord current-role resolution (so remove-role fires on lapse, add-role does not churn)
// =============================================================================================

test('resolveDiscordRoles returns the SET of managed roles held, and NULL when the read fails', async () => {
  const env = { DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const member = (roles) => ({ getMember: async () => ({ roles }) });
  assert.deepEqual(await resolveDiscordRoles(member(['rm', 'other']), 'g', 'u', env), ['member']);
  assert.deepEqual(await resolveDiscordRoles(member(['rt']), 'g', 'u', env), ['trial']);
  assert.deepEqual(await resolveDiscordRoles(member(['rl']), 'g', 'u', env), ['locked']);
  // a corrupted state holding two managed roles is reported in full so the planner can heal it
  assert.deepEqual(await resolveDiscordRoles(member(['rm', 'rl']), 'g', 'u', env), ['member', 'locked']);
  assert.deepEqual(await resolveDiscordRoles(member(['other']), 'g', 'u', env), [], 'read OK, holds none -> EMPTY');
  // sow-218: UNKNOWN is null, not []. Returning [] for both made the planner treat an unreadable member as
  // holding nothing, so it skipped every removal and a lapsed member kept @Member. These two lines are the
  // difference between "we know they hold nothing" and "we could not find out".
  // A null member is the 404 path (clients/discord.mjs getMember maps it): they are NOT in the guild, which
  // is KNOWN, so it stays []. Only a genuine failure is unknown. Treating 404 as unknown took a real dry run
  // from 3 planned actions to 15, every extra one destined to fail against a member who is not there.
  assert.deepEqual(await resolveDiscordRoles({ getMember: async () => null }, 'g', 'u', env), [], '404 -> not in guild -> EMPTY');
  assert.equal(await resolveDiscordRoles({ getMember: async () => { throw new Error('429'); } }, 'g', 'u', env), null, 'error -> UNKNOWN');
  // no client / no guild / no user -> []
  assert.deepEqual(await resolveDiscordRoles(null, 'g', 'u', env), []);
  assert.deepEqual(await resolveDiscordRoles(member(['rm']), null, 'u', env), []);
  assert.deepEqual(await resolveDiscordRoles(member(['rm']), 'g', null, env), []);
});

test('FIX 2: gatherMembers sets discordRoles from getMember so a lapsed member is swapped to locked', async () => {
  const customer = { id: 'c', metadata: { github_id: '6000', github_login: 'atwellpub', discord_user_id: 'd6000' } };
  const stripe = { async *listCustomers() { yield customer; } };
  const discord = { getMember: async () => ({ roles: ['rm'] }) }; // currently holds the member role
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const repoIndex = {
    byUsername: { hudson: { files: [file('members/hudson/profile.md', 'published')] } },
    byGithubLogin: new Map([['atwellpub', 'hudson']]),
    byGithubId: new Map(),
  };
  const members = await gatherMembers(stripe, noOverrides(), NOW, { repoIndex, discord, env });
  assert.equal(members.length, 1);
  assert.deepEqual(members[0].discordRoles, ['member']); // resolved from the live guild member

  const actions = planReconcile({ members, repoIndex: repoIndex.byUsername, now: NOW });
  const discordActions = ofKind(actions, 'discord');
  // lapse (expired): swap member -> locked (add locked, remove member); never a hardcoded-null churn
  assert.equal(discordActions.length, 2);
  assert.equal(discordActions.find((a) => a.type === 'add-role').role, 'locked');
  assert.equal(discordActions.find((a) => a.type === 'remove-role').role, 'member');
});

// =============================================================================================
// Override-only enumeration: grandfathered / banned members with NO Stripe customer still get their
// managed Discord role synced (gatherMembers iterates Stripe customers only and would miss them).
// =============================================================================================

test('parseDiscordUserMap parses login->id JSON, lowercases logins, ignores absent/invalid', () => {
  assert.deepEqual([...parseDiscordUserMap({}).entries()], []);
  assert.deepEqual([...parseDiscordUserMap({ DISCORD_MENTION_OVERRIDES: 'not json' }).entries()], []);
  assert.deepEqual([...parseDiscordUserMap({ DISCORD_MENTION_OVERRIDES: '[]' }).entries()], []); // array -> empty (no string keys)
  const m = parseDiscordUserMap({ DISCORD_MENTION_OVERRIDES: '{"RFilipo":"629","bomsn":"920","blank":""}' });
  assert.equal(m.get('rfilipo'), '629'); // login lowercased
  assert.equal(m.get('bomsn'), '920');
  assert.equal(m.has('blank'), false); // empty id dropped
});

test('gatherOverrideOnlyMembers: a grandfathered member with no Stripe customer gets the Member role', async () => {
  const overrides = {
    roles: new Map(),
    bans: new Map(),
    grandfathers: new Map([['225425', { github_id: '225425', login: 'rfilipo' }]]),
    membersIndex: new Map(),
  };
  const env = {
    DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl',
    DISCORD_MENTION_OVERRIDES: '{"rfilipo":"629903610582663183"}',
  };
  const discord = { getMember: async () => ({ roles: [] }) }; // in the guild, holds no managed role yet
  const members = await gatherOverrideOnlyMembers(overrides, NOW, { seen: new Set(), discord, env });
  assert.equal(members.length, 1);
  assert.equal(members[0].githubId, '225425');
  assert.equal(members[0].discordUserId, '629903610582663183'); // resolved from the override map
  assert.equal(members[0].effective.status, 'paid'); // grandfather -> paid
  assert.equal(members[0].effective.source, 'grandfather');
  assert.equal(members[0].tier, 'member'); // owner Q15: a tierless grandfather now resolves to member (rfilipo is one of the 15 comps)

  const actions = planReconcile({ members, repoIndex: {}, now: NOW });
  const discordActions = ofKind(actions, 'discord');
  assert.equal(discordActions.length, 1);
  assert.equal(discordActions[0].type, 'add-role');
  assert.equal(discordActions[0].role, 'member'); // grandfathered co-op member -> the full Member role
  assert.equal(discordActions[0].discordUserId, '629903610582663183');

  // owner Q15: this tierless co-op comp is now MEMBER tier, so even once the Creator role is provisioned it
  // gets @Member ONLY, never @Creator. This is the Content Creator badge drop the owner accepted for the 15.
  const withCreator = ofKind(planReconcile({ members, repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  assert.deepEqual(withCreator.filter((a) => a.type === 'add-role').map((a) => a.role).sort(), ['member']);
});

test('gatherOverrideOnlyMembers: skips ids already gathered from Stripe and yields no Discord action without an id', async () => {
  const overrides = {
    roles: new Map(),
    bans: new Map([['7000', { github_id: '7000', login: 'banned-guy' }]]),
    grandfathers: new Map([
      ['225425', { github_id: '225425', login: 'rfilipo' }], // already seen -> skipped
      ['9999', { github_id: '9999', login: 'no-discord' }],  // no override-map entry -> no discordUserId
    ]),
    membersIndex: new Map(),
  };
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_LOCKED_ROLE_ID: 'rl', DISCORD_MENTION_OVERRIDES: '{}' };
  const discord = { getMember: async () => ({ roles: [] }) };
  const members = await gatherOverrideOnlyMembers(overrides, NOW, { seen: new Set(['225425']), discord, env });
  // rfilipo skipped (already seen); banned-guy + no-discord remain
  assert.deepEqual(members.map((m) => m.githubId).sort(), ['7000', '9999']);
  const banned = members.find((m) => m.githubId === '7000');
  assert.equal(banned.effective.status, 'banned'); // ban -> Locked target
  // No discordUserId resolves for any of them (empty map) -> the planner emits zero Discord actions.
  const actions = planReconcile({ members, repoIndex: {}, now: NOW });
  assert.equal(ofKind(actions, 'discord').length, 0);
});

// =============================================================================================
// FIX 4: targeted single-member regate from a repository_dispatch event
// =============================================================================================

test('FIX 4: targetedGithubId parses client_payload.github_id from a repository_dispatch event', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-evt-'));
  const eventPath = path.join(tmp, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ action: 'regate', client_payload: { github_id: 583231 } }));

  // wrong event name -> null
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'schedule', GITHUB_EVENT_PATH: eventPath }), null);
  // correct dispatch -> the id as a string
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_EVENT_PATH: eventPath }), '583231');
  // missing path -> null (no throw)
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_EVENT_PATH: path.join(tmp, 'nope.json') }), null);
  // missing payload field -> null
  fs.writeFileSync(eventPath, JSON.stringify({ client_payload: {} }));
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_EVENT_PATH: eventPath }), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

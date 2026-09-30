// SOW-005 reconcile tests: enactPlan, the step that carries out a plan. The locked role maps to its id and
// nobody is kicked, the day-87 email goes out through Resend before the Discord DM (FIX 5), content flips land
// on a uniquely named branch (FIX 6), and one failed action does not abandon the rest (sow-198). No network, no
// secrets: fake GitHub, Discord and Resend clients. Split out of test/reconcile.test.mjs at the 900-line limit
// (owner, 2026-09-30); the shared fixtures live in test/lib/reconcile-fixtures.mjs.
// Run the reconcile suites together:
//   node --test 'test/reconcile*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enactPlan } from '../scripts/reconcile.mjs';
import { createResendClient } from '../clients/resend.mjs';

test('enactPlan maps the locked role to DISCORD_LOCKED_ROLE_ID and never kicks the member', async () => {
  const calls = [];
  const discord = {
    addRole: async (g, u, r) => { calls.push(['add', g, u, r]); },
    removeRole: async (g, u, r) => { calls.push(['remove', g, u, r]); },
    kickMember: async () => { calls.push(['kick']); }, // must never be called
  };
  const env = { DISCORD_GUILD_ID: 'g1', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const actions = [
    { kind: 'discord', type: 'add-role', githubId: '120', discordUserId: 'd120', role: 'locked' },
    { kind: 'discord', type: 'remove-role', githubId: '120', discordUserId: 'd120', role: 'member' },
  ];
  await enactPlan(actions, { github: null, discord, resend: null }, env);
  assert.deepEqual(calls, [['add', 'g1', 'd120', 'rl'], ['remove', 'g1', 'd120', 'rm']]);
  assert.ok(!calls.some((c) => c[0] === 'kick'), 'the reconcile must never kick a member from the guild');
});

// =============================================================================================
// FIX 5: day-87 email via Resend is the PRIMARY channel (attempted before the Discord DM)
// =============================================================================================

test('createResendClient posts the email with Bearer auth and JSON body', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'email_1' }) };
  };
  const resend = createResendClient({ apiKey: 'rk_test', fetch: fakeFetch });
  const out = await resend.sendEmail({ from: 'GBTI <hi@gbti.network>', to: 'tori@example.com', subject: 'Hi', text: 'body' });
  assert.equal(out.id, 'email_1');
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer rk_test');
  assert.equal(captured.opts.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.from, 'GBTI <hi@gbti.network>');
  assert.equal(sent.to, 'tori@example.com');
  assert.equal(sent.text, 'body');
});

test('FIX 5: enactPlan reminder sends the Resend email FIRST, then the optional Discord DM', async () => {
  const order = [];
  const resend = { sendEmail: async (args) => { order.push(['email', args]); return { id: 'e1' }; } };
  const discord = { sendDirectMessage: async (uid, content) => { order.push(['dm', uid, content]); } };
  const action = { kind: 'reminder', type: 'day-87', githubId: '400', email: 'tori@example.com', discordUserId: 'd400' };
  await enactPlan([action], { github: null, discord, resend }, { RESEND_FROM: 'GBTI <hi@gbti.network>' });
  assert.equal(order.length, 2);
  assert.equal(order[0][0], 'email'); // email is attempted BEFORE the DM
  assert.equal(order[0][1].to, 'tori@example.com');
  assert.equal(order[0][1].from, 'GBTI <hi@gbti.network>');
  assert.match(order[0][1].subject, /trial ends/i);
  assert.equal(order[1][0], 'dm');
  assert.equal(order[1][1], 'd400');
});

test('FIX 5: reminder still sends the Discord DM when no Resend client is configured', async () => {
  const order = [];
  const discord = { sendDirectMessage: async (uid) => { order.push(['dm', uid]); } };
  const action = { kind: 'reminder', type: 'day-87', githubId: '400', email: 'tori@example.com', discordUserId: 'd400' };
  await enactPlan([action], { github: null, discord, resend: null }, {});
  assert.deepEqual(order, [['dm', 'd400']]);
});

// =============================================================================================
// FIX 6: flipBranch appends a random suffix so same-second re-runs do not collide
// =============================================================================================

test('FIX 6: enactContent opens a branch (unique name), flips each file, and squash-merges', async () => {
  const created = [];
  const puts = [];
  const merges = [];
  let pullNum = 0;
  const github = {
    getRef: async () => ({ object: { sha: 'basesha' } }),
    createRef: async (branch, sha) => { created.push([branch, sha]); },
    getContent: async (p) => ({ sha: `sha-${p}`, content: Buffer.from(`---\nstatus: published\n---\n`).toString('base64') }),
    putContent: async (p, opts) => { puts.push([p, opts.branch]); },
    createPull: async (opts) => { pullNum += 1; return { number: pullNum, ...opts }; },
    mergePull: async (n, opts) => { merges.push([n, opts.method]); },
  };
  const action = {
    kind: 'content',
    type: 'draft',
    githubId: '700',
    username: 'paula',
    files: ['members/paula/profile.md', 'members/paula/posts/p/index.md'],
  };
  await enactPlan([action], { github, discord: null, resend: null }, {});

  assert.equal(created.length, 1);
  const branch = created[0][0];
  assert.match(branch, /^reconcile\/draft-700-\d{14}-[0-9a-f]{8}$/, 'branch has a random suffix (FIX 6)');
  assert.equal(created[0][1], 'basesha');
  // both files flipped on the new branch
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map((p) => p[0]).sort(), ['members/paula/posts/p/index.md', 'members/paula/profile.md']);
  for (const [, b] of puts) assert.equal(b, branch);
  // squash-merged
  assert.deepEqual(merges, [[1, 'squash']]);

  // Two calls to flipBranch in the same second must differ (random suffix).
  await enactPlan([action], { github, discord: null, resend: null }, {});
  assert.notEqual(created[0][0], created[1][0]);
});

// ---- sow-198: one failed action must not abandon the rest of the plan ----
// enactPlan was the ONE step in main() with no error handling, and its loop had no per-action isolation,
// so a single throw abandoned every action queued behind it. On 2026-08-08 only one action was planned so
// nothing was lost; with several, a failed content flip would silently skip the Discord role swaps and the
// day-87 reminders after it.
test('enactPlan isolates a failing action and still enacts the ones after it', async () => {
  const github = {
    getRef: async () => ({ object: { sha: 'basesha' } }),
    createRef: async () => {},
    getContent: async (p) => ({ sha: `sha-${p}`, content: Buffer.from('---\nstatus: published\n---\n').toString('base64') }),
    putContent: async () => {},
    createPull: async () => ({ number: 1 }),
    mergePull: async () => { throw new Error('github error 405: Base branch was modified'); },
  };
  const roles = [];
  const discord = { addRole: async (g, u, r) => { roles.push(['add', r]); }, removeRole: async (g, u, r) => { roles.push(['remove', r]); } };
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_LOCKED_ROLE_ID: 'rl' };

  const actions = [
    { kind: 'content', type: 'draft', githubId: '800', username: 'quinn', files: ['members/quinn/profile.md'] },
    { kind: 'discord', type: 'add-role', githubId: '800', discordUserId: 'd800', role: 'locked' },
  ];
  const { counts, failures } = await enactPlan(actions, { github, discord, resend: null }, env);

  assert.deepEqual(roles, [['add', 'rl']], 'the Discord action queued behind the failure still ran');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].action.kind, 'content');
  assert.match(failures[0].message, /405/);
  assert.deepEqual(counts, { content: 1, discord: 1 }, 'counts report what was attempted');
});

test('enactPlan reports no failures on a clean plan', async () => {
  const discord = { addRole: async () => {}, removeRole: async () => {} };
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const { failures } = await enactPlan(
    [{ kind: 'discord', type: 'add-role', githubId: '801', discordUserId: 'd801', role: 'locked' }],
    { github: null, discord, resend: null }, env,
  );
  assert.deepEqual(failures, []);
});

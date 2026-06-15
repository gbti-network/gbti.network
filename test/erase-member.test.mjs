// SOW-024: the right-to-erasure tool. The KV DELETE (CF REST API) + the activity erase + the runbook plan,
// all injectable (env + fetch), so no network and no secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteKvKey, eraseActivity, eraseFollows, eraseLookupCache, planErasure, runErasure,
  eraseDiscordRoles, eraseContent, eraseStripeCustomer, ACTIVITY_KEY, FOLLOWS_KEY, LOOKUP_KEY, MEMBERS_INDEX_PATH,
} from '../scripts/lib/erase-member.mjs';
import { parseArgs } from '../scripts/erase-member.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('deleteKvKey is a reported no-op without CF credentials (never throws)', async () => {
  const r = await deleteKvKey({ key: 'activity:1', env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.deleted, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('deleteKvKey DELETEs the right CF URL with the bearer token', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true }; };
  const r = await deleteKvKey({ key: 'activity:42', env: CF, fetchImpl });
  assert.equal(r.deleted, true);
  assert.equal(seen.init.method, 'DELETE');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.ok(seen.url.includes('/accounts/acct/storage/kv/namespaces/ns/values/activity%3A42'));
});

test('deleteKvKey throws on a real API error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, async text() { return 'boom'; } });
  await assert.rejects(() => deleteKvKey({ key: 'k', env: CF, fetchImpl }), /KV delete failed: 500/);
});

test('eraseActivity targets activity:<github_id> and requires an id', async () => {
  let key;
  await eraseActivity({ githubId: 7, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, ACTIVITY_KEY('7'));
  await assert.rejects(() => eraseActivity({ githubId: '' }), /github_id is required/);
});

test('eraseFollows targets follows:<github_id> (SOW-023)', async () => {
  let key;
  await eraseFollows({ githubId: 7, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, FOLLOWS_KEY('7'));
  await assert.rejects(() => eraseFollows({ githubId: '' }), /github_id is required/);
});

test('eraseLookupCache targets gh:<github_id> (the Stripe-customer lookup cache)', async () => {
  let key;
  await eraseLookupCache({ githubId: 42, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, LOOKUP_KEY('42'));
});

// --- Discord role removal -----------------------------------------------------------------------------------

const DENV = { ...CF, DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };

test('eraseDiscordRoles removes only the managed roles the member actually holds', async () => {
  const calls = [];
  const stripe = { findCustomerByGithubId: async () => ({ metadata: { discord_user_id: 'u1' } }) };
  const discord = {
    getMember: async () => ({ roles: ['rm', 'other-unmanaged'] }), // holds Member + an unmanaged role
    removeRole: async (g, u, r) => { calls.push([g, u, r]); },
  };
  const res = await eraseDiscordRoles({ githubId: 1, stripe, discord, env: DENV });
  assert.deepEqual(res.removed, ['member']);
  assert.deepEqual(calls, [['g', 'u1', 'rm']]); // only the held managed role, not the unmanaged one
});

test('eraseDiscordRoles is a reported no-op without a client, guild, or discord_user_id', async () => {
  assert.match((await eraseDiscordRoles({ githubId: 1, discord: null, env: DENV })).reason, /no Discord client/);
  assert.match((await eraseDiscordRoles({ githubId: 1, discord: {}, env: { ...DENV, DISCORD_GUILD_ID: '' } })).reason, /DISCORD_GUILD_ID/);
  const stripe = { findCustomerByGithubId: async () => ({ metadata: {} }) }; // no discord_user_id
  assert.match((await eraseDiscordRoles({ githubId: 1, stripe, discord: { getMember: async () => ({}) }, env: DENV })).reason, /no discord_user_id/);
});

// --- Content draft-flip + members-index removal (one PR) -----------------------------------------------------

function fakeGithub({ contents }) {
  // contents keyed by PATH only: a branch created from base has the same content at creation, so getContent
  // returns the same blob whether read from base (phase 1) or the new branch (phase 2). This also exercises
  // the TOCTOU-safe ordering: phase 2 reads from the branch before putContent.
  const seen = { puts: [], pull: null, merged: null, branch: null, reads: [] };
  return {
    seen,
    getRef: async () => ({ object: { sha: 'BASE' } }),
    createRef: async (branch) => { seen.branch = branch; },
    getContent: async (p, ref) => { seen.reads.push({ p, ref }); return contents[p] ?? null; },
    putContent: async (p, opts) => { seen.puts.push({ path: p, text: Buffer.from(opts.content, 'base64').toString('utf8'), branch: opts.branch, sha: opts.sha }); },
    createPull: async (o) => { seen.pull = o; return { number: 77 }; },
    mergePull: async (n, o) => { seen.merged = { n, ...o }; },
  };
}

test('eraseContent flips published files to draft and removes the members-index entry in one merged PR', async () => {
  const post = '---\ntitle: x\nstatus: published\nvisibility: public\n---\nbody\n';
  const index = 'members:\n  "9": alice\n  "10": bob\n';
  const github = fakeGithub({
    contents: {
      'members/alice/posts/x/index.md': { sha: 's1', content: b64(post) },
      [MEMBERS_INDEX_PATH]: { sha: 'si', content: b64(index) },
    },
  });
  const res = await eraseContent({
    github, githubId: '9', username: 'alice',
    files: [{ path: 'members/alice/posts/x/index.md', status: 'published' }],
    now: new Date('2026-06-13T00:00:00Z'),
  });
  assert.equal(res.pr, 77);
  assert.equal(res.flipped, 1);
  assert.equal(res.indexRemoved, true);
  const postPut = github.seen.puts.find((p) => p.path.endsWith('index.md') && p.path.includes('posts'));
  assert.match(postPut.text, /status: draft/);
  assert.equal(postPut.branch, github.seen.branch, 'committed on the erase branch, not base');
  assert.equal(postPut.sha, 's1', 'used the blob sha read from the branch (TOCTOU-safe)');
  const idxPut = github.seen.puts.find((p) => p.path === MEMBERS_INDEX_PATH);
  assert.ok(!idxPut.text.includes('alice'), 'the erased member is gone from the index');
  assert.ok(idxPut.text.includes('bob'), 'other members are untouched');
  assert.equal(github.seen.merged.method, 'squash');
  // TOCTOU-safe ordering: the branch is created before the committing reads.
  const branchCreatedAtRead = github.seen.reads.findIndex((r) => r.ref && r.ref.startsWith('erase/'));
  assert.ok(branchCreatedAtRead >= 0, 'phase 2 reads each target from the new branch before putContent');
});

test('eraseContent is a no-op (no branch, no PR) when there is nothing to change', async () => {
  const draft = '---\nstatus: draft\n---\nbody\n';
  const github = fakeGithub({
    contents: {
      'members/alice/posts/x/index.md': { sha: 's1', content: b64(draft) }, // already draft
      [MEMBERS_INDEX_PATH]: { sha: 'si', content: b64('members:\n  "10": bob\n') }, // no entry for 9
    },
  });
  const res = await eraseContent({ github, githubId: '9', username: 'alice', files: [{ path: 'members/alice/posts/x/index.md' }] });
  assert.equal(res.skipped, true);
  assert.equal(github.seen.branch, null, 'no branch created');
  assert.equal(github.seen.pull, null, 'no PR opened');
});

test('eraseContent skips without a github client or a username', async () => {
  assert.match((await eraseContent({ github: null, githubId: '9', username: 'alice' })).reason, /no GitHub client/);
  assert.match((await eraseContent({ github: {}, githubId: '9', username: null })).reason, /no member folder/);
});

// --- Stripe delete (opt-in) ---------------------------------------------------------------------------------

test('eraseStripeCustomer deletes the resolved customer; skips without a client/customer', async () => {
  let deletedId = null;
  const stripe = { findCustomerByGithubId: async () => ({ id: 'cus_1' }), deleteCustomer: async (id) => { deletedId = id; return { id, deleted: true }; } };
  const r = await eraseStripeCustomer({ githubId: 1, stripe });
  assert.equal(r.deletedCustomer, true);
  assert.equal(deletedId, 'cus_1');
  assert.match((await eraseStripeCustomer({ githubId: 1, stripe: null })).reason, /no Stripe client/);
  const none = { findCustomerByGithubId: async () => null };
  assert.match((await eraseStripeCustomer({ githubId: 1, stripe: none })).reason, /no Stripe customer/);
});

// --- Orchestrator -------------------------------------------------------------------------------------------

test('runErasure dry-run returns the plan and changes nothing', async () => {
  const r = await runErasure({ githubId: '9', username: 'alice', apply: false });
  assert.equal(r.apply, false);
  assert.ok(Array.isArray(r.plan));
});

test('runErasure --apply composes the auto steps, fail-isolates a thrown step, and records the audit', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, method: init.method });
    if (init.method === 'PUT') return { ok: true }; // the audit write
    return { ok: true }; // the KV deletes
  };
  // discord throws -> must become an 'error' outcome, not abort the run
  const clients = {
    discord: { getMember: async () => { throw new Error('discord down'); }, removeRole: async () => {} },
    stripe: { findCustomerByGithubId: async () => ({ metadata: { discord_user_id: 'u1' } }) },
    github: null,
  };
  const r = await runErasure({ githubId: '9', username: 'alice', apply: true, env: CF, fetchImpl, clients, files: [] });
  assert.equal(r.apply, true);
  const byStep = Object.fromEntries(r.steps.map((s) => [s.step, s.outcome]));
  assert.equal(byStep['activity'], 'deleted');
  assert.equal(byStep['follows'], 'deleted');
  assert.equal(byStep['lookup-cache'], 'deleted');
  assert.equal(byStep['content'], 'skipped'); // no github client
  // discord getMember threw inside eraseDiscordRoles, which catches it -> member null -> skipped (not error)
  assert.ok(['skipped', 'error'].includes(byStep['discord']));
  assert.equal(r.audit.recorded, true);
  // the audit record is identity-minimal: github_id pseudonym only, no username/email/discord id
  assert.equal(r.record.githubId, '9');
  assert.ok(!JSON.stringify(r.record).includes('alice'), 'no username in the audit record');
  assert.ok(!JSON.stringify(r.record).includes('u1'), 'no discord id in the audit record');
  assert.ok(fetchCalls.some((c) => c.method === 'PUT'), 'an audit PUT was issued');
});

test('runErasure skips the Stripe step unless --delete-stripe (deleteStripe) is set', async () => {
  let stripeDeleted = false;
  const clients = { stripe: { findCustomerByGithubId: async () => ({ id: 'cus_1', metadata: {} }), deleteCustomer: async () => { stripeDeleted = true; } } };
  const fetchImpl = async () => ({ ok: true });
  const without = await runErasure({ githubId: '9', apply: true, env: CF, fetchImpl, clients, deleteStripe: false });
  assert.ok(!without.steps.find((s) => s.step === 'stripe'), 'no stripe step without the opt-in');
  assert.equal(stripeDeleted, false);
  const withFlag = await runErasure({ githubId: '9', apply: true, env: CF, fetchImpl, clients, deleteStripe: true });
  assert.equal(withFlag.steps.find((s) => s.step === 'stripe').outcome, 'deleted');
  assert.equal(stripeDeleted, true);
});

test('planErasure marks the auto-driven steps auto and keeps the irreversible ones manual', () => {
  const plan = planErasure({ githubId: '9', username: 'alice' });
  const activity = plan.find((s) => s.step === 'activity');
  assert.ok(activity.action.includes('activity:9'));
  assert.ok(activity.action.includes('follows:9'), 'the auto step also deletes the follow graph');
  // SOW-024: content, activity, lookup-cache, discord, members-index are now AUTO-DRIVEN
  for (const step of ['content', 'activity', 'lookup-cache', 'discord', 'members-index']) {
    assert.equal(plan.find((s) => s.step === step).auto, true, step);
  }
  // crypto-shred, stripe (irreversible, opt-in), kv-mirror, de-index stay MANUAL
  for (const step of ['crypto-shred', 'stripe', 'kv-mirror', 'de-index']) {
    assert.equal(plan.find((s) => s.step === step).auto, false, step);
  }
});

test('CLI parseArgs: dry-run default, --apply opt-in, --delete-stripe + --operator read', () => {
  assert.deepEqual(parseArgs(['--github-id', '5', '--username', 'bob']), { githubId: '5', username: 'bob', operator: null, apply: false, deleteStripe: false });
  assert.equal(parseArgs(['--github-id', '5', '--apply']).apply, true);
  assert.equal(parseArgs(['--github-id', '5', '--apply', '--dry-run']).apply, false); // dry-run wins
  assert.equal(parseArgs(['--github-id', '5', '--apply', '--delete-stripe']).deleteStripe, true);
  assert.equal(parseArgs(['--github-id', '5', '--operator', 'hudson']).operator, 'hudson');
  assert.equal(parseArgs([]).githubId, null);
});

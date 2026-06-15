// Tests the thin REST clients by asserting the requests they build against a recording fake fetch.
// No network. Confirms Stripe form-encoding, pagination, idempotency header, Discord 204 handling,
// and GitHub status/label/paths shaping.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStripeClient, encodeForm, toFormPairs } from '../clients/stripe.mjs';
import { createDiscordClient } from '../clients/discord.mjs';
import { createGitHubClient } from '../clients/github.mjs';

/** Build a fake fetch that returns scripted responses and records every call. */
function recorder(responses) {
  const calls = [];
  let i = 0;
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    const r = typeof responses === 'function' ? responses(url, opts, i) : responses[i] ?? responses[responses.length - 1];
    i++;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return { fetch, calls };
}

// ---- Stripe form encoding ----
test('toFormPairs flattens nested metadata, arrays and expand', () => {
  const pairs = toFormPairs({ metadata: { github_id: '100', referred_by: '7' }, expand: ['data.subscriptions'] });
  const s = encodeForm({ metadata: { github_id: '100' }, expand: ['data.subscriptions'] });
  assert.ok(pairs.some(([k, v]) => k === 'metadata[github_id]' && v === '100'));
  assert.ok(pairs.some(([k, v]) => k === 'expand[]' && v === 'data.subscriptions'));
  assert.equal(s, 'metadata%5Bgithub_id%5D=100&expand%5B%5D=data.subscriptions');
});

test('stripe search builds the metadata query and returns the first match', async () => {
  const { fetch, calls } = recorder([{ body: { data: [{ id: 'cus_1', metadata: { github_id: '100' } }] } }]);
  const stripe = createStripeClient({ apiKey: 'sk_test', fetch });
  const c = await stripe.searchCustomerByGithubId('100');
  assert.equal(c.id, 'cus_1');
  assert.match(calls[0].url, /\/customers\/search\?/);
  assert.match(decodeURIComponent(calls[0].url), /metadata\['github_id'\]:'100'/);
  assert.match(calls[0].url, /expand%5B%5D=data\.subscriptions/);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk_test');
});

test('stripe createCustomer posts form body and sends the idempotency header', async () => {
  const { fetch, calls } = recorder([{ body: { id: 'cus_new' } }]);
  const stripe = createStripeClient({ apiKey: 'sk_test', fetch });
  await stripe.createCustomer({ email: 'a@b.co', metadata: { github_id: '100' } }, 'idem-100');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Idempotency-Key'], 'idem-100');
  assert.match(calls[0].body, /metadata%5Bgithub_id%5D=100/);
  assert.match(calls[0].body, /email=a%40b\.co/);
});

test('stripe listCustomers paginates via starting_after until has_more is false', async () => {
  const { fetch, calls } = recorder([
    { body: { data: [{ id: 'c1' }, { id: 'c2' }], has_more: true } },
    { body: { data: [{ id: 'c3' }], has_more: false } },
  ]);
  const stripe = createStripeClient({ apiKey: 'sk_test', fetch });
  const ids = [];
  for await (const c of stripe.listCustomers({ limit: 2 })) ids.push(c.id);
  assert.deepEqual(ids, ['c1', 'c2', 'c3']);
  assert.match(calls[1].url, /starting_after=c2/);
});

// ---- Discord ----
test('discord addGuildMember PUTs access_token + roles; 204 becomes null', async () => {
  const { fetch, calls } = recorder([{ status: 204 }]);
  const discord = createDiscordClient({ botToken: 'bot', fetch });
  const out = await discord.addGuildMember('g1', 'u1', { accessToken: 'tok', roles: ['rTrial'] });
  assert.equal(out, null);
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].url, /\/guilds\/g1\/members\/u1$/);
  assert.equal(calls[0].headers.Authorization, 'Bot bot');
  assert.deepEqual(JSON.parse(calls[0].body), { access_token: 'tok', roles: ['rTrial'] });
});

test('discord addRole / removeRole hit the role endpoints', async () => {
  const { fetch, calls } = recorder([{ status: 204 }, { status: 204 }]);
  const discord = createDiscordClient({ botToken: 'bot', fetch });
  await discord.addRole('g1', 'u1', 'rMember');
  await discord.removeRole('g1', 'u1', 'rTrial');
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].url, /\/members\/u1\/roles\/rMember$/);
  assert.equal(calls[1].method, 'DELETE');
  assert.match(calls[1].url, /\/members\/u1\/roles\/rTrial$/);
});

// ---- GitHub ----
test('github setStatus posts state + context and truncates description', async () => {
  const { fetch, calls } = recorder([{ body: { id: 1 } }]);
  const gh = createGitHubClient({ token: 't', repo: 'gbti-network/site', fetch });
  await gh.setStatus('abc123', { state: 'failure', context: 'membership-gate', description: 'x'.repeat(200) });
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/repos\/gbti-network\/site\/statuses\/abc123$/);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.state, 'failure');
  assert.equal(body.context, 'membership-gate');
  assert.equal(body.description.length, 140);
});

test('github listPullFilePaths paginates and returns only filenames', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `members/octocat/posts/p${i}/index.md` }));
  const page2 = [{ filename: 'members/octocat/profile.md' }];
  const { fetch, calls } = recorder([{ body: page1 }, { body: page2 }]);
  const gh = createGitHubClient({ token: 't', repo: 'o/r', fetch });
  const paths = await gh.listPullFilePaths(42);
  assert.equal(paths.length, 101);
  assert.equal(paths[100], 'members/octocat/profile.md');
  assert.match(calls[1].url, /page=2/);
});

test('github setLabels PUTs the label array', async () => {
  const { fetch, calls } = recorder([{ body: [] }]);
  const gh = createGitHubClient({ token: 't', repo: 'o/r', fetch });
  await gh.setLabels(42, ['rejected-not-paid']);
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].url, /\/issues\/42\/labels$/);
  assert.deepEqual(JSON.parse(calls[0].body), { labels: ['rejected-not-paid'] });
});

test('github listReviews returns reviews with user id, state and commit_id', async () => {
  const reviews = [
    { user: { id: 100 }, state: 'APPROVED', commit_id: 'sha1' },
    { user: { id: 200 }, state: 'COMMENTED', commit_id: 'sha1' },
  ];
  const { fetch, calls } = recorder([{ body: reviews }, { body: [] }]);
  const gh = createGitHubClient({ token: 't', repo: 'o/r', fetch });
  const out = await gh.listReviews(42);
  assert.equal(out.length, 2);
  assert.equal(out[0].state, 'APPROVED');
  assert.match(calls[0].url, /\/pulls\/42\/reviews\?per_page=100&page=1$/);
});

test('github closePull posts a comment then closes the PR', async () => {
  const { fetch, calls } = recorder([{ body: { id: 1 } }, { body: { state: 'closed' } }]);
  const gh = createGitHubClient({ token: 't', repo: 'o/r', fetch });
  await gh.closePull(42, { comment: 'please sign up' });
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/issues\/42\/comments$/);
  assert.deepEqual(JSON.parse(calls[0].body), { body: 'please sign up' });
  assert.equal(calls[1].method, 'PATCH');
  assert.match(calls[1].url, /\/pulls\/42$/);
  assert.deepEqual(JSON.parse(calls[1].body), { state: 'closed' });
});

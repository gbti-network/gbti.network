// Tests the pure, testable logic factored out of the signup Worker (SOW-002). The Worker entrypoint
// (index.mjs) is glue and is exercised indirectly through these units. No network, no secrets: a
// recording fake fetch and in-memory fakes for the injected Stripe / Discord clients + KV.
//
// Coverage:
//   - referral: self-reject, first-touch, empty handling
//   - decideCustomer: reuse on a search hit, create on a miss
//   - session: sign + verify round trip, tamper rejection, expiry
//   - Turnstile: request shaping + fail-closed
//   - signup orchestration: existing customer reused and trial_started_at NOT rewritten; a new
//     customer gets all metadata + the trial role; KV index written

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveReferral, normalizeRefCode } from '../workers/signup/referral.mjs';
import { decideCustomer, buildNewCustomerMetadata, buildRefreshMetadata, runSignup, normalizeVia } from '../workers/signup/signup.mjs';
import { signSession, verifySession } from '../workers/signup/session.mjs';
import { sessionCookieHeader } from '../workers/signup/session.mjs';
import { verifyTurnstile } from '../workers/signup/abuse.mjs';
import { isDuplicateEvent, markEventSeen, handleStripeEvent } from '../workers/signup/webhook.mjs';
import worker, { packState, unpackState } from '../workers/signup/index.mjs';

const SECRET = 'test-session-secret-0123456789';

/** A recording fake fetch that returns scripted responses. */
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

/** In-memory KV with the get/put surface the Worker uses. */
function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

/** Fake Stripe client capturing create/update/search; scriptable search hit. */
function fakeStripe({ searchHit = null } = {}) {
  const calls = { search: [], create: [], update: [] };
  return {
    calls,
    async searchCustomerByGithubId(githubId) {
      calls.search.push(githubId);
      return searchHit;
    },
    async createCustomer(args, idempotencyKey) {
      calls.create.push({ args, idempotencyKey });
      return { id: 'cus_new', metadata: args.metadata };
    },
    async updateCustomer(customerId, args) {
      calls.update.push({ customerId, args });
      return { id: customerId };
    },
  };
}

/** Fake Discord client capturing addGuildMember + addRole. */
function fakeDiscord() {
  const calls = { addGuildMember: [], addRole: [] };
  return {
    calls,
    async addGuildMember(guildId, userId, opts) {
      calls.addGuildMember.push({ guildId, userId, opts });
      return null;
    },
    async addRole(guildId, userId, roleId) {
      calls.addRole.push({ guildId, userId, roleId });
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

test('referral rejects self-referral (ref === new member github_id)', () => {
  const out = resolveReferral({ refCode: '777', newMemberGithubId: '777' });
  assert.equal(out, null);
});

test('referral first-touch resolves a different referrer id', () => {
  const out = resolveReferral({ refCode: ' 42 ', newMemberGithubId: '777' });
  assert.equal(out, '42');
});

test('referral with no code or empty code returns null', () => {
  assert.equal(resolveReferral({ refCode: undefined, newMemberGithubId: '1' }), null);
  assert.equal(resolveReferral({ refCode: '   ', newMemberGithubId: '1' }), null);
  assert.equal(normalizeRefCode(''), null);
  assert.equal(normalizeRefCode('x'), 'x');
});

test('referral resolver mapping a code to a different id is honored, self still rejected', () => {
  const resolve = (c) => (c === 'alice' ? '999' : null);
  assert.equal(resolveReferral({ refCode: 'alice', newMemberGithubId: '1', resolve }), '999');
  // resolver maps to the new member itself -> reject
  const resolveSelf = () => '1';
  assert.equal(resolveReferral({ refCode: 'alice', newMemberGithubId: '1', resolve: resolveSelf }), null);
});

// ---------------------------------------------------------------------------
// Idempotent customer decision
// ---------------------------------------------------------------------------

test('decideCustomer reuses on a search hit', () => {
  const plan = decideCustomer({ id: 'cus_existing', metadata: { github_id: '5' } });
  assert.deepEqual(plan, { action: 'reuse', customerId: 'cus_existing' });
});

test('decideCustomer creates on a miss (null)', () => {
  assert.deepEqual(decideCustomer(null), { action: 'create' });
  assert.deepEqual(decideCustomer(undefined), { action: 'create' });
});

test('buildNewCustomerMetadata includes trial_started_at and optional referred_by; refresh omits trial', () => {
  const meta = buildNewCustomerMetadata({
    githubId: '5',
    githubLogin: 'octocat',
    discordUserId: 'd9',
    trialStartedAt: '2026-06-02T00:00:00.000Z',
    signupSource: 'signup-worker',
    referredBy: '42',
  });
  assert.equal(meta.github_id, '5');
  assert.equal(meta.trial_started_at, '2026-06-02T00:00:00.000Z');
  assert.equal(meta.referred_by, '42');
  assert.equal(meta.signup_source, 'signup-worker');

  const refresh = buildRefreshMetadata({ githubLogin: 'octocat-renamed', discordUserId: 'd9' });
  assert.equal(refresh.github_login, 'octocat-renamed');
  assert.ok(!('trial_started_at' in refresh), 'refresh metadata must never carry trial_started_at');
  assert.ok(!('referred_by' in refresh), 'refresh metadata must never carry referred_by');
  assert.ok(!('via' in refresh), 'refresh metadata must never rewrite the first-touch via');
});

test('normalizeVia accepts a strict <type>:<kebab-slug> and drops anything else (fail safe)', () => {
  assert.equal(normalizeVia('post:my-slug'), 'post:my-slug');
  assert.equal(normalizeVia('product:cool-thing'), 'product:cool-thing');
  assert.equal(normalizeVia('prompt:do-x'), 'prompt:do-x');
  // dropped: wrong type, path traversal, spaces, uppercase, empty, overlong
  assert.equal(normalizeVia('page:home'), null);
  assert.equal(normalizeVia('post:../../etc/passwd'), null);
  assert.equal(normalizeVia('post: with space'), null);
  assert.equal(normalizeVia('post:UPPER'), null);
  assert.equal(normalizeVia(''), null);
  assert.equal(normalizeVia(undefined), null);
  assert.equal(normalizeVia('post:' + 'a'.repeat(500)), 'post:' + 'a'.repeat(195)); // trimmed to 200 chars total
});

test('buildNewCustomerMetadata captures a valid via and omits an invalid one', () => {
  const ok = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', via: 'product:thing' });
  assert.equal(ok.via, 'product:thing');
  const bad = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', via: 'evil payload' });
  assert.ok(!('via' in bad), 'an invalid via is dropped, never written to Stripe metadata');
});

// ---------------------------------------------------------------------------
// Session sign + verify
// ---------------------------------------------------------------------------

test('session sign + verify round trip preserves github_id and login', async () => {
  const token = await signSession({ githubId: '12345', githubLogin: 'octocat' }, SECRET);
  const payload = await verifySession(token, SECRET);
  assert.ok(payload);
  assert.equal(payload.github_id, '12345');
  assert.equal(payload.github_login, 'octocat');
});

test('session verify rejects a tampered payload', async () => {
  const token = await signSession({ githubId: '12345', githubLogin: 'octocat' }, SECRET);
  const [body, sig] = token.split('.');
  // Flip the payload (different github_id) but keep the old signature -> must fail.
  const forgedBody = Buffer.from(JSON.stringify({ github_id: '999', iat: 1, exp: 9999999999 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const tampered = `${forgedBody}.${sig}`;
  assert.equal(await verifySession(tampered, SECRET), null);
  // Wrong secret also fails.
  assert.equal(await verifySession(token, 'a-different-secret'), null);
  // Malformed token fails.
  assert.equal(await verifySession('garbage', SECRET), null);
  assert.equal(await verifySession(`${body}.`, SECRET), null);
});

test('session verify rejects an expired token', async () => {
  const past = Date.now() - 10_000;
  const token = await signSession({ githubId: '7' }, SECRET, { ttlSeconds: 1, now: past });
  assert.equal(await verifySession(token, SECRET, { now: Date.now() }), null);
});

// ---------------------------------------------------------------------------
// Turnstile verify request shaping + fail closed
// ---------------------------------------------------------------------------

test('verifyTurnstile posts secret + response (+ remoteip) to siteverify and returns success', async () => {
  const { fetch, calls } = recorder([{ body: { success: true } }]);
  const ok = await verifyTurnstile({ token: 'tok', secret: 'sek', remoteIp: '1.2.3.4' }, fetch);
  assert.equal(ok, true);
  assert.match(calls[0].url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers['Content-Type'], /application\/x-www-form-urlencoded/);
  const params = new URLSearchParams(calls[0].body);
  assert.equal(params.get('secret'), 'sek');
  assert.equal(params.get('response'), 'tok');
  assert.equal(params.get('remoteip'), '1.2.3.4');
});

test('verifyTurnstile fails closed on success:false, non-2xx, and missing inputs', async () => {
  const r1 = recorder([{ body: { success: false } }]);
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, r1.fetch), false);
  const r2 = recorder([{ status: 500, body: 'err' }]);
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, r2.fetch), false);
  // No token or no secret short-circuits to false without a fetch.
  const r3 = recorder([{ body: { success: true } }]);
  assert.equal(await verifyTurnstile({ token: '', secret: 's' }, r3.fetch), false);
  assert.equal(r3.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Signup orchestration
// ---------------------------------------------------------------------------

const IDENTITY = {
  githubId: '12345',
  githubLogin: 'octocat',
  discordUserId: 'd-987',
  email: 'octo@example.com',
  discordAccessToken: 'discord-user-token',
};
const CONFIG = { guildId: 'guild-1', trialRoleId: 'role-trial', signupSource: 'signup-worker' };

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
  // Trial role assigned via guilds.join with the user's access token.
  assert.equal(discord.calls.addGuildMember.length, 1);
  const join = discord.calls.addGuildMember[0];
  assert.equal(join.guildId, 'guild-1');
  assert.equal(join.userId, 'd-987');
  assert.deepEqual(join.opts.roles, ['role-trial']);
  assert.equal(join.opts.accessToken, 'discord-user-token');
});

test('signup with no existing customer creates one with full metadata + trial role + KV index', async () => {
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
  assert.equal(args.metadata.discord_user_id, 'd-987');
  assert.equal(args.metadata.trial_started_at, now.toISOString());
  assert.equal(args.metadata.referred_by, '42');
  assert.equal(args.metadata.via, 'post:my-first-post', 'the landed-on content is captured for the payout split');
  assert.equal(args.metadata.signup_source, 'signup-worker');
  // No update on a fresh create.
  assert.equal(stripe.calls.update.length, 0);
  // KV index written to the new customer id.
  assert.equal(kv.store.get('gh:12345'), 'cus_new');
  // Trial role assigned on join AND explicitly via addRole (so existing guild members get it too,
  // since Discord ignores the join `roles` for a user already in the guild).
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, ['role-trial']);
  assert.equal(discord.calls.addRole.length, 1);
  assert.deepEqual(discord.calls.addRole[0], { guildId: 'guild-1', userId: 'd-987', roleId: 'role-trial' });
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
// Entrypoint coverage (FIX 5): drive the default fetch handler with synthetic Request objects and a
// fake env (fake KV + a stubbed global fetch). The OAuth helpers and the frozen Stripe / Discord
// clients all call globalThis.fetch, so we swap it per test and restore it afterward. No network and
// no real secrets.
// ---------------------------------------------------------------------------

/** A minimal env that satisfies every code path the entrypoint tests exercise. */
function fakeEnv(overrides = {}) {
  return {
    SESSION_SECRET: SECRET,
    PUBLIC_BASE_URL: 'https://gbti.test',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    SIGNUP_KV: fakeKv(),
    GITHUB_OAUTH_CLIENT_ID: 'gh-client',
    GITHUB_OAUTH_CLIENT_SECRET: 'gh-secret',
    DISCORD_OAUTH_CLIENT_ID: 'dc-client',
    DISCORD_OAUTH_CLIENT_SECRET: 'dc-secret',
    DISCORD_BOT_TOKEN: 'bot-token',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PRICE_ID: 'price_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    DISCORD_GUILD_ID: 'guild-1',
    DISCORD_TRIAL_ROLE_ID: 'role-trial',
    DISCORD_MEMBER_ROLE_ID: 'role-member',
    REGATE_DISPATCH_TOKEN: 'dispatch-token',
    GITHUB_CONTENT_REPO: 'gbti-network/content',
    ...overrides,
  };
}

/**
 * Install a stubbed globalThis.fetch that routes by URL substring to a scripted handler, runs `fn`,
 * then restores the original fetch. The handler returns { status?, body? } and we shape a minimal
 * Response-like object (the clients and OAuth helpers only use .ok, .status, .text()).
 */
async function withFetch(router, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method, headers: opts.headers, body: opts.body });
    const r = router(u, opts) ?? { status: 200, body: '' };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function req(method, path, { headers = {}, body } = {}) {
  return new Request(`https://gbti.test${path}`, { method, headers, body });
}

test('GET /signup/start passes abuse checks and redirects to GitHub with a signed state', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => {
      if (url.includes('siteverify')) return { status: 200, body: { success: true } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=tok&ref=alice', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      const location = res.headers.get('Location');
      assert.ok(location.startsWith('https://github.com/login/oauth/authorize'), 'redirects to GitHub authorize');
      const stateParam = new URL(location).searchParams.get('state');
      assert.ok(stateParam, 'carries a state param');
      // The state must verify and round-trip the referral code (HMAC-signed; this is the CSRF control).
      const unpacked = await unpackState(stateParam, env);
      assert.ok(unpacked, 'state verifies with SESSION_SECRET');
      assert.equal(unpacked.ref, 'alice');
      assert.ok(!('nonce' in unpacked), 'no unused browser nonce is carried (FIX 4)');
    },
  );
});

test('GET /signup/start fails closed (403) when Turnstile rejects', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => (url.includes('siteverify') ? { status: 200, body: { success: false } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=bad', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }),
        env,
        {},
      );
      assert.equal(res.status, 403);
    },
  );
});

test('GET /signup/github/callback round-trips github_id into the discord-hop state', async () => {
  const env = fakeEnv();
  // Issue the first-hop state ourselves (as /signup/start would), carrying only the ref.
  const startState = await packState({ ref: 'bob' }, env);
  await withFetch(
    (url) => {
      if (url.includes('login/oauth/access_token')) return { status: 200, body: { access_token: 'gho_token' } };
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 424242, login: 'octocat' } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`),
        env,
        {},
      );
      assert.equal(res.status, 302);
      const location = res.headers.get('Location');
      assert.ok(location.startsWith('https://discord.com/api/oauth2/authorize'), 'redirects to Discord authorize');
      const nextState = new URL(location).searchParams.get('state');
      const unpacked = await unpackState(nextState, env);
      assert.ok(unpacked, 'next state verifies');
      assert.equal(unpacked.githubId, '424242', 'resolved github_id is carried into the Discord hop');
      assert.equal(unpacked.githubLogin, 'octocat');
      assert.equal(unpacked.ref, 'bob', 'referral survives the first hop');
    },
  );
});

test('GET /signup/github/callback rejects a forged/unsigned state with 400', async () => {
  const env = fakeEnv();
  await withFetch(
    () => ({ status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(req('GET', '/signup/github/callback?code=ghcode&state=not-a-valid-token'), env, {});
      assert.equal(res.status, 400);
    },
  );
});

test('POST /webhook with a bad signature returns 400 (fail closed)', async () => {
  const env = fakeEnv();
  await withFetch(
    () => ({ status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('POST', '/webhook', {
          headers: { 'Stripe-Signature': 't=1,v1=deadbeef' },
          body: JSON.stringify({ id: 'evt_1', type: 'invoice.payment_succeeded' }),
        }),
        env,
        {},
      );
      assert.equal(res.status, 400);
    },
  );
});

test('GET /checkout/success with a matching session kicks regate and redirects to /account', async () => {
  const env = fakeEnv();
  const session = await signSession({ githubId: '424242', githubLogin: 'octocat' }, SECRET);
  let dispatched = null;
  await withFetch(
    (url, opts) => {
      if (url.includes('/dispatches')) {
        dispatched = JSON.parse(opts.body);
        return { status: 204 }; // GitHub repository_dispatch accepted
      }
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/checkout/success?gh=424242&session_id=cs_test', {
          headers: { Cookie: sessionCookieHeader(session) },
        }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account');
      assert.ok(dispatched, 'a repository_dispatch was kicked');
      assert.equal(dispatched.event_type, 'regate');
      assert.equal(dispatched.client_payload.github_id, '424242');
    },
  );
});

test('GET /checkout/success without a session redirects to /account but does NOT kick regate (fail closed)', async () => {
  const env = fakeEnv();
  let dispatched = false;
  await withFetch(
    (url) => {
      if (url.includes('/dispatches')) dispatched = true;
      return { status: 204 };
    },
    async () => {
      const res = await worker.fetch(req('GET', '/checkout/success?gh=424242'), env, {});
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account');
      assert.equal(dispatched, false, 'no re-gate without a valid session');
    },
  );
});

test('GET /checkout/success with a session that does not match gh does NOT kick regate (fail closed)', async () => {
  const env = fakeEnv();
  const session = await signSession({ githubId: '111', githubLogin: 'someone' }, SECRET);
  let dispatched = false;
  await withFetch(
    (url) => {
      if (url.includes('/dispatches')) dispatched = true;
      return { status: 204 };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/checkout/success?gh=424242', { headers: { Cookie: sessionCookieHeader(session) } }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account');
      assert.equal(dispatched, false, 'gh must equal the session github_id to nudge');
    },
  );
});

test('unknown route returns 404', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(req('GET', '/nope'), env, {});
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// packState / unpackState round-trip + tamper rejection (FIX 5 + FIX 4 CSRF control)
// ---------------------------------------------------------------------------

test('packState/unpackState round-trips the payload and rejects tampering', async () => {
  const env = { SESSION_SECRET: SECRET };
  const token = await packState({ ref: 'carol', githubId: '999', githubLogin: 'carol-dev' }, env);
  const unpacked = await unpackState(token, env);
  assert.ok(unpacked);
  assert.equal(unpacked.ref, 'carol');
  assert.equal(unpacked.githubId, '999');
  assert.equal(unpacked.githubLogin, 'carol-dev');

  // Tamper with the signed body: flip a character in the first segment, keep the signature.
  const [body, sig] = token.split('.');
  const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
  assert.equal(await unpackState(`${flipped}.${sig}`, env), null, 'tampered body must be rejected');

  // A wrong secret must also reject (the HMAC signature is the CSRF control).
  assert.equal(await unpackState(token, { SESSION_SECRET: 'a-different-secret' }), null);

  // Garbage and empty tokens fail closed.
  assert.equal(await unpackState('garbage', env), null);
  assert.equal(await unpackState('', env), null);
});

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

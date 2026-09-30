// Shared fixtures for the signup Worker suites (SOW-002). They were declared inside test/worker.test.mjs until it
// passed the 900-line limit (owner, 2026-09-30) and was split into worker-signup-core, worker-signup,
// worker-signup-role, worker-discord-link, worker-webhook and the entrypoint suite that kept the old name. No
// network, no secrets: a recording fake fetch, in-memory fakes for the injected Stripe / Discord clients + KV, the
// identity and config a signup runs with, a fake env and a global fetch swap for driving the entrypoint, and the
// overrides-mirror fixtures the role resolution reads.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own. withFetch swaps
// globalThis.fetch for the length of one call and restores it afterward; that is safe because each test file runs in
// its own process.

export const SECRET = 'test-session-secret-0123456789';

/** A recording fake fetch that returns scripted responses. */
export function recorder(responses) {
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
export function fakeKv() {
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
export function fakeStripe({ searchHit = null } = {}) {
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
export function fakeDiscord() {
  const calls = { addGuildMember: [], addRole: [], removeRole: [] };
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
    // sow-218: signup now SWAPS (add target, strip the other access roles) instead of only adding.
    async removeRole(guildId, userId, roleId) {
      calls.removeRole.push({ guildId, userId, roleId });
      return null;
    },
  };
}

// ---- Signup orchestration: the identity a signup arrives with and the config it runs under ----

export const IDENTITY = {
  githubId: '12345',
  githubLogin: 'octocat',
  discordUserId: 'd-987',
  email: 'octo@example.com',
  discordAccessToken: 'discord-user-token',
};
// lockedRoleId is what a FRESH signup receives since the trial retirement (2026-08-11). trialRoleId stays in
// the fixture deliberately: if signup ever reaches for it again, these tests must fail rather than pass by
// its absence.
export const CONFIG = { guildId: 'guild-1', trialRoleId: 'role-trial', memberRoleId: 'role-member', lockedRoleId: 'role-locked', signupSource: 'signup-worker' };

// ---- Entrypoint: a fake env, a global fetch swap and a request builder for driving worker.fetch ----

/** A minimal env that satisfies every code path the entrypoint tests exercise. */
export function fakeEnv(overrides = {}) {
  return {
    SESSION_SECRET: SECRET,
    PUBLIC_BASE_URL: 'https://gbti.test',
    SITE_BASE_URL: 'https://gbti.test',
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
export async function withFetch(router, fn) {
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

export function req(method, path, { headers = {}, body } = {}) {
  return new Request(`https://gbti.test${path}`, { method, headers, body });
}

// ---- The overrides mirror and a paying Customer, read by the role resolution (sow-218, sow-185) ----

export const NOW = new Date('2026-08-11T12:00:00.000Z');
export const mirrorKv = (mirror) => ({ get: async (k, t) => (k === 'overrides:mirror' ? mirror : null), put: async () => {} });
export const freshMirror = (over = {}) => ({
  generatedAt: NOW.toISOString(), bans: { bans: [] }, roles: { roles: [] }, grandfathered: { grandfathered: [] }, ...over,
});
export const paidCustomer = { id: 'cus_1', metadata: { github_id: '12345' }, subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: 'price_x' } }] } }] } };

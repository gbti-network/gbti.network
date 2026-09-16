// sow-343 Phase 4: a new account meets the welcome steps before anything else, and the reset clears the record.
//
// Owner decision 2026-09-16: "fix the redirect so a new signup meets the wizard before it ever meets the nag".
// Measured before the fix: the login page always carried a return path (defaulting to /account/), so a walk-up
// signup never saw the welcome steps; and the one path that did land there (no return path) sent RETURNING
// members through them again too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import worker, { packState } from '../workers/signup/index.mjs';
import { signinLanding } from '../workers/signup/signin-landing.mjs';
import { setClient } from '../client-ui/src/base.mjs';
import { GbtiAccount } from '../client-ui/src/elements/gbti-account.mjs';

// ---- the rule ----

test('a new account goes to the welcome steps, carrying where it was headed', () => {
  assert.equal(signinLanding({ created: true }), '/welcome/');
  assert.equal(signinLanding({ created: true, returnTo: '/account/' }), '/welcome/', 'the login page default is not worth carrying');
  assert.equal(signinLanding({ created: true, returnTo: '/articles/hello/' }), '/welcome/?next=%2Farticles%2Fhello%2F');
  assert.equal(signinLanding({ created: true, returnTo: '/welcome/' }), '/welcome/');
  assert.equal(signinLanding({ created: true, returnTo: '/welcome/?step=topics' }), '/welcome/');
});

test('a new account headed to checkout keeps going to checkout', () => {
  assert.equal(signinLanding({ created: true, returnTo: '/membership/?plan=member' }), '/membership/?plan=member');
  assert.equal(signinLanding({ created: true, returnTo: '/membership/' }), '/membership/');
  assert.equal(signinLanding({ created: true, returnTo: '/membershipx/' }), '/welcome/?next=%2Fmembershipx%2F', 'only the real checkout path');
});

test('a returning account lands where it was headed, or on its account page, never on the welcome steps', () => {
  assert.equal(signinLanding({ created: false, returnTo: '/workbench/' }), '/workbench/');
  assert.equal(signinLanding({ created: false }), '/account/');
  assert.equal(signinLanding({}), '/account/', 'an unknown answer is treated as returning');
  assert.equal(signinLanding({ created: 'true' }), '/account/', 'strictly true');
});

// ---- the callback, end to end ----

const SECRET = 'test-session-secret-0123456789';
function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) { const v = store.get(key); if (v === undefined) return null; return opts?.type === 'json' || opts === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list() { return { keys: [], list_complete: true }; },
  };
}
const fakeEnv = () => ({
  SESSION_SECRET: SECRET, PUBLIC_BASE_URL: 'https://gbti.test', SITE_BASE_URL: 'https://gbti.test', TURNSTILE_SECRET_KEY: 't',
  SIGNUP_KV: fakeKv(), GITHUB_OAUTH_CLIENT_ID: 'gh', GITHUB_OAUTH_CLIENT_SECRET: 'ghs', DISCORD_OAUTH_CLIENT_ID: 'dc',
  DISCORD_OAUTH_CLIENT_SECRET: 'dcs', DISCORD_BOT_TOKEN: 'bot', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x', DISCORD_GUILD_ID: 'g', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_MEMBER_ROLE_ID: 'rm',
  REGATE_DISPATCH_TOKEN: 'd', GITHUB_CONTENT_REPO: 'gbti-network/content',
});

async function callback({ returnTo, existing }) {
  const env = fakeEnv();
  const jti = `jti-${Math.random().toString(36).slice(2)}`;
  const state = await packState({ nonce: 'n1', jti, ...(returnTo ? { returnTo } : {}) }, env);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body = '';
    if (u.includes('login/oauth/access_token')) body = { access_token: 'gho_token' };
    else if (u.includes('api.github.com/user/emails')) body = [{ email: 'o@example.com', primary: true, verified: true }];
    else if (u.includes('api.github.com/user')) body = { id: 424242, login: 'octocat' };
    else if (u.includes('api.stripe.com/v1/customers/search')) body = { data: existing ? [{ id: 'cus_x', metadata: { github_id: '424242', trial_started_at: '2026-09-01T00:00:00.000Z' } }] : [] };
    else if (u.includes('api.stripe.com/v1/customers')) body = { id: existing ? 'cus_x' : 'cus_new', metadata: {} };
    return { ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  try {
    const res = await worker.fetch(
      new Request(`https://gbti.test/signup/github/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { Cookie: 'gbti_oauth_nonce=n1', 'CF-Connecting-IP': '9.9.9.9' } }),
      env, {},
    );
    return { status: res.status, location: res.headers.get('Location') };
  } finally {
    globalThis.fetch = original;
  }
}

test('the real callback: a new account from an article goes to the welcome steps with next', async () => {
  const r = await callback({ returnTo: '/articles/hello/' });
  assert.equal(r.status, 302);
  assert.equal(r.location, 'https://gbti.test/welcome/?next=%2Farticles%2Fhello%2F');
});

test('the real callback: a returning account with no return path lands on its account page', async () => {
  const r = await callback({ existing: true });
  assert.equal(r.status, 302);
  assert.equal(r.location, 'https://gbti.test/account/');
});

test('the real callback: a returning account lands back where it was', async () => {
  const r = await callback({ existing: true, returnTo: '/workbench/' });
  assert.equal(r.location, 'https://gbti.test/workbench/');
});

test('the real callback: an unsafe return path in the state is dropped, for new and returning accounts', async () => {
  assert.equal((await callback({ existing: true, returnTo: '//evil.example/' })).location, 'https://gbti.test/account/');
  assert.equal((await callback({ returnTo: '//evil.example/' })).location, 'https://gbti.test/welcome/');
});

// ---- the welcome page sends a new member on ----

const WELCOME = readFileSync(new URL('../src/pages/welcome.astro', import.meta.url), 'utf8');

test('the welcome page accepts only a same-site next path', () => {
  const fnSrc = WELCOME.match(/function safeNext\(\): string \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(fnSrc, 'safeNext is where the page reads next');
  const safeNext = (search) => new Function('location', `${fnSrc.replace('(): string', '()')}; return safeNext();`)({ search });
  assert.equal(safeNext('?next=%2Farticles%2Fhello%2F'), '/articles/hello/');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', '/a\\b', 'javascript:alert(1)', '/a\nb', '']) {
    assert.equal(safeNext(`?next=${encodeURIComponent(bad)}`), '', `accepted ${JSON.stringify(bad)}`);
  }
  assert.match(WELCOME, /if \(skip && next\) \{ skip\.href = next;/);
  assert.match(WELCOME, /<a href="\/account\/" data-welcome-skip>/, 'without next, the skip link still goes to the account page');
});

// ---- the account page reset ----

function account(client) {
  setClient(client);
  const el = new GbtiAccount();
  const said = [];
  el._say = (sel, text, kind) => said.push({ text, kind });
  return { el, said };
}

test('the welcome reset clears the record on the account, and says what it cleared', async () => {
  const sent = [];
  const { el, said } = account({ setPrefs: async (p) => { sent.push(p); return {}; } });
  await el._resetWelcome();
  assert.deepEqual(sent, [{ onboarding: null }]);
  assert.equal(said.at(-1).kind, 'ok');
  assert.match(said.at(-1).text, /Skipped steps and the channels you marked as followed are cleared/);
});

test('a reset that cannot reach the account says so', async () => {
  const { el, said } = account({ setPrefs: async () => { throw new Error('offline'); } });
  await el._resetWelcome();
  assert.equal(said.at(-1).kind, 'err');
  assert.match(said.at(-1).text, /only this device was reset/);
  const none = account({});
  await none.el._resetWelcome();
  assert.equal(none.said.at(-1).kind, 'err', 'a host with no prefs write did not clear anything');
});

test('the copy follows the writing rules', () => {
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-account.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('async _resetWelcome()'), src.indexOf('async _copy('));
  assert.doesNotMatch(block, /[–—]/);
  assert.doesNotMatch(block, /\b(can't|don't|isn't|won't|we're|it's)\b/i);
});

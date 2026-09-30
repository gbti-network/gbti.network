// Tests the signup Worker's Discord link routes (SOW Part C, sow-207, sow-356) end to end through the entrypoint:
// /discord/link/start, /discord/link/init, /discord/link/status and the Discord-link callback. No network, no
// secrets: a stubbed global fetch routes GitHub, Discord and Stripe. Split out of test/worker.test.mjs at the
// 900-line limit (owner, 2026-09-30); the shared fixtures live in test/lib/worker-fixtures.mjs.
//
// Coverage:
//   - link start: a session or a link token is required, a free account is turned back before Discord, a
//     replayed link token is refused
//   - link callback: a paying member is linked and joined, a lapsed one is refused and recorded nowhere, the
//     nonce is checked
//   - link status: the bearer and the website cookie session, fail-closed
//   - link init: a signed link URL carrying the server-verified github_id

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signSession } from '../workers/signup/session.mjs';
import worker, { packState, unpackState } from '../workers/signup/index.mjs';
import { fakeEnv, withFetch, req } from './lib/worker-fixtures.mjs';

// sow-356: the link start now reads the Customer to decide whether this account may be in the server at all, so
// these cases route Stripe explicitly. Without it the route would reach the real api.stripe.com, and the test
// would pass on a failed lookup (which continues, by design) rather than on the case it names.
const stripeSearch = (customer) => (url) => {
  if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: customer ? [customer] : [] } };
  return { status: 200, body: '' };
};

test('SOW Part C: /discord/link/start with a session -> Discord OAuth carrying the verified github_id + a nonce', async () => {
  const env = fakeEnv();
  const session = await signSession({ githubId: '424242', githubLogin: 'octocat' }, env.SESSION_SECRET);
  const paying = { id: 'cus_x', metadata: { github_id: '424242' }, subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: 'price_x' } }] } }] } };
  await withFetch(stripeSearch(paying), async () => {
    const res = await worker.fetch(req('GET', '/discord/link/start', { headers: { Cookie: 'gbti_session=' + session } }), env, {});
    assert.equal(res.status, 302);
    const location = res.headers.get('Location');
    assert.ok(location.startsWith('https://discord.com/api/oauth2/authorize'), 'redirects to Discord authorize');
    const state = await unpackState(new URL(location).searchParams.get('state'), env);
    assert.equal(state.githubId, '424242');
    assert.equal(state.link, true);
    assert.ok(state.nonce, 'carries a per-browser nonce');
    assert.match(res.headers.get('Set-Cookie') || '', new RegExp('gbti_oauth_nonce=' + state.nonce));
  });
});

test('sow-356: /discord/link/start turns a free account back BEFORE the Discord sign-in', async () => {
  // Refusing at the callback alone would walk a free account through a Discord consent screen for something it
  // cannot have. A failed Stripe read still continues, because the callback resolves again and refuses there: a
  // billing hiccup should cost a paying member a click, not the ability to join.
  const env = fakeEnv();
  const session = await signSession({ githubId: '424242', githubLogin: 'octocat' }, env.SESSION_SECRET);
  const free = { id: 'cus_x', metadata: { github_id: '424242' } };
  await withFetch(stripeSearch(free), async () => {
    const res = await worker.fetch(req('GET', '/discord/link/start', { headers: { Cookie: 'gbti_session=' + session } }), env, {});
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://gbti.test/membership/?discord=members-only');
  });
  await withFetch(() => ({ status: 500, body: 'stripe down' }), async () => {
    const res = await worker.fetch(req('GET', '/discord/link/start', { headers: { Cookie: 'gbti_session=' + session } }), env, {});
    assert.ok((res.headers.get('Location') || '').startsWith('https://discord.com/api/oauth2/authorize'), 'an unreadable record continues');
  });
});

test('SOW Part C: /discord/link/start with NO session -> no Discord OAuth, lands on the welcome flow', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(req('GET', '/discord/link/start'), env, {});
  assert.equal(res.status, 302);
  const loc = res.headers.get('Location') || '';
  assert.ok(loc.includes('/welcome/'), 'sow-207: lands on the website welcome flow');
  assert.ok(!loc.includes('discord.com'), 'never starts Discord OAuth without a verified identity');
});

// The Discord-link callback, driven end to end through worker.fetch. sow-356 split it in two, because the
// destination now depends on whether the member may be in the server at all, and the FIXTURE decided the answer:
// the customer here carried a 2020 trial clock, which is a lapsed account, so the one assertion that existed was
// the refusal case wearing the success case's name.
const discordCallback = (customer) => (url) => {
  if (url.includes('discord.com/api') && url.includes('oauth2/token')) return { status: 200, body: { access_token: 'dtok' } };
  if (url.includes('discord.com/api') && url.includes('users/@me')) return { status: 200, body: { id: 'd-99', email: 'd@e.com' } };
  if (url.includes('discord.com/api') && url.includes('guilds')) return { status: 204, body: '' };
  if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [customer] } };
  if (url.includes('api.stripe.com/v1/customers')) return { status: 200, body: { id: customer.id } };
  return { status: 200, body: '' };
};

test('SOW Part C: the Discord-link callback links discord_user_id + role to the EXISTING Customer (nonce-checked)', async () => {
  const env = fakeEnv({ DISCORD_INVITE_URL: 'https://discord.gg/test' });
  const startState = await packState({ githubId: '5', githubLogin: 'octocat', nonce: 'n1', link: true }, env);
  const paying = { id: 'cus_x', metadata: { github_id: '5' }, subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: 'price_x' } }] } }] } };
  await withFetch(discordCallback(paying), async (calls) => {
    const res = await worker.fetch(
      req('GET', '/signup/discord/callback?code=dcode&state=' + encodeURIComponent(startState), { headers: { Cookie: 'gbti_oauth_nonce=n1' } }),
      env, {},
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://discord.gg/test', 'redirects the member INTO Discord, not back to the site');
    const joined = calls.filter((c) => c.url.includes('/guilds/guild-1/members/d-99'));
    assert.ok(joined.length > 0, 'and the guild join happened');
    const update = calls.find((c) => c.url.includes('api.stripe.com/v1/customers/cus_x'));
    assert.ok(String(update?.body || '').includes('discord_user_id'), 'the link is recorded on the Customer');
  });
});

test('sow-356: a lapsed account is refused the link, recorded nowhere, and lands on the membership page', async () => {
  // The whole refusal, end to end, in the order it has to hold: no guild call, nothing written to Stripe, and a
  // destination that is NOT the server invite. The invite URL is configured here, so landing on the membership
  // page is a decision rather than a fallback.
  const env = fakeEnv({ DISCORD_INVITE_URL: 'https://discord.gg/test' });
  const startState = await packState({ githubId: '5', githubLogin: 'octocat', nonce: 'n1', link: true }, env);
  const lapsed = { id: 'cus_x', metadata: { github_id: '5', trial_started_at: '2020-01-01T00:00:00.000Z' } };
  await withFetch(discordCallback(lapsed), async (calls) => {
    const res = await worker.fetch(
      req('GET', '/signup/discord/callback?code=dcode&state=' + encodeURIComponent(startState), { headers: { Cookie: 'gbti_oauth_nonce=n1' } }),
      env, {},
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://gbti.test/membership/?discord=members-only');
    assert.equal(calls.filter((c) => c.url.includes('/guilds/')).length, 0, 'never added to the server');
    const wrote = calls.filter((c) => c.url.includes('api.stripe.com/v1/customers') && String(c.body || '').includes('discord_user_id'));
    assert.deepEqual(wrote, [], 'and the Discord id reaches the Customer record nowhere');
    // They stay signed in: a refused perk is not a sign-out.
    assert.ok((res.headers.get('Set-Cookie') || '').length > 0 || res.headers.has('Set-Cookie'), 'the session is still issued');
  });
});

test('SOW: /discord/link/status reports the Customer Discord-link state, fail-closed', async () => {
  const env = fakeEnv();
  const linkedFetch = (url) => {
    if (url.includes('api.github.com/user')) return { status: 200, body: { id: 777, login: 'octocat' } };
    if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '777', discord_user_id: 'd-1' } }] } };
    return { status: 200, body: '' };
  };
  await withFetch(linkedFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Authorization: 'Bearer tok' } }), env, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: true });
  });
  // No discord_user_id on the Customer -> not linked.
  const unlinkedFetch = (url) => {
    if (url.includes('api.github.com/user')) return { status: 200, body: { id: 777, login: 'octocat' } };
    if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '777' } }] } };
    return { status: 200, body: '' };
  };
  await withFetch(unlinkedFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Authorization: 'Bearer tok' } }), env, {});
    assert.deepEqual(await res.json(), { linked: false });
  });
  // No bearer token -> fail closed to not-linked (never throws, never opens).
  const res = await worker.fetch(req('GET', '/discord/link/status'), env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { linked: false });
});

test('sow-207: /discord/link/status resolves the WEBSITE cookie session with credentialed CORS, fail-closed', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const session = await signSession({ githubId: '777', githubLogin: 'octocat' }, env.SESSION_SECRET);
  // A cookie member whose Customer has a linked Discord -> { linked: true } + credentialed CORS for the site origin.
  const linkedFetch = (url) => {
    if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '777', discord_user_id: 'd-1' } }] } };
    return { status: 200, body: '' };
  };
  await withFetch(linkedFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Cookie: 'gbti_session=' + session, Origin: 'https://gbti.test' } }), env, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: true });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test', 'reflects the allow-listed site origin');
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true', 'credentialed so the browser can read the cookie response');
  });
  // A forged/invalid session cookie -> fail closed to not-linked, and it must NOT reach Stripe.
  let stripeHit = false;
  const guardFetch = (url) => { if (url.includes('api.stripe.com')) stripeHit = true; return { status: 200, body: '' }; };
  await withFetch(guardFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Cookie: 'gbti_session=not-a-real-token', Origin: 'https://gbti.test' } }), env, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: false });
  });
  assert.equal(stripeHit, false, 'a forged session never triggers a Stripe lookup');
});

test('SOW Part C: the Discord-link callback REJECTS a state with no matching nonce cookie', async () => {
  const env = fakeEnv();
  const startState = await packState({ githubId: '5', githubLogin: 'octocat', nonce: 'n1', link: true }, env);
  const res = await worker.fetch(
    req('GET', '/signup/discord/callback?code=dcode&state=' + encodeURIComponent(startState), { headers: { Cookie: 'gbti_oauth_nonce=WRONG' } }),
    env, {},
  );
  assert.equal(res.status, 400);
});

test('SOW Part C: /discord/link/init verifies the GitHub token -> a SIGNED link URL carrying the verified github_id', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 777, login: 'octocat' } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(req('GET', '/discord/link/init', { headers: { Authorization: 'Bearer gho_tok' } }), env, {});
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.url.includes('/discord/link/start?lt='));
      const lt = new URL(data.url).searchParams.get('lt');
      const tok = await unpackState(lt, env);
      assert.equal(tok.githubId, '777', 'the github_id is the SERVER-verified one (from the token), not user input');
      assert.equal(tok.linkInit, true);
    },
  );
});

test('SOW Part C: /discord/link/init rejects a missing token (401)', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(req('GET', '/discord/link/init'), env, {});
  assert.equal(res.status, 401);
});

test('SOW Part C: /discord/link/start with a link token starts Discord OAuth (no website session needed)', async () => {
  const env = fakeEnv();
  const lt = await packState({ githubId: '777', githubLogin: 'octocat', linkInit: true, jti: 'jti-ok' }, env);
  const res = await worker.fetch(req('GET', '/discord/link/start?lt=' + encodeURIComponent(lt)), env, {});
  assert.equal(res.status, 302);
  const location = res.headers.get('Location');
  assert.ok(location.startsWith('https://discord.com/api/oauth2/authorize'), 'starts Discord OAuth from the token (no session)');
  const state = await unpackState(new URL(location).searchParams.get('state'), env);
  assert.equal(state.githubId, '777');
  assert.equal(state.link, true);
  assert.ok(state.nonce);
});

test('SOW Part C: a REPLAYED link token (same jti, second use) is rejected -> no Discord OAuth (hijack defense)', async () => {
  const env = fakeEnv();
  const lt = await packState({ githubId: '777', githubLogin: 'octocat', linkInit: true, jti: 'jti-replay' }, env);
  await worker.fetch(req('GET', '/discord/link/start?lt=' + encodeURIComponent(lt)), env, {}); // first use consumes the jti
  const res2 = await worker.fetch(req('GET', '/discord/link/start?lt=' + encodeURIComponent(lt)), env, {});
  assert.equal(res2.status, 302);
  const loc = res2.headers.get('Location') || '';
  assert.ok(loc.includes('/welcome/'), 'sow-207: a replayed lt lands on the website welcome flow, not Discord');
  assert.ok(!loc.includes('discord.com'), 'a replayed lt never starts Discord OAuth');
});

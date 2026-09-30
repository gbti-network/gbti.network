// Tests the signup Worker (SOW-002) through its entrypoint: the default fetch handler driven with synthetic Request
// objects, a fake env and a stubbed global fetch. No network, no secrets.
//
// The pure units and the other route groups were split out at the 900-line limit (owner, 2026-09-30), and the
// shared fixtures moved to test/lib/worker-fixtures.mjs:
//   - worker-signup-core.test.mjs: referral, decideCustomer, metadata, session, Turnstile, packState
//   - worker-signup.test.mjs: runSignup orchestration and the guild-failure guard
//   - worker-signup-role.test.mjs: the Discord role and Content Creator badge resolution
//   - worker-discord-link.test.mjs: the Discord link start, callback, status and init routes
//   - worker-webhook.test.mjs: the Stripe webhook dedupe and invoice handling
//
// Coverage:
//   - /signup/start: the Turnstile gate, the signed state and its per-browser nonce, return_to threading
//   - /signup/github/callback: signup on GitHub alone; a transplanted or forged state rejected
//   - sow-158: the cookie session + CSRF, credentialed CORS, the extension auth bridge
//   - /webhook signature fail-closed, the /checkout/success regate nudge, unknown route 404
//   - /auth/refresh: the secretless token refresh

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signSession, sessionCookieHeader } from '../workers/signup/session.mjs';
import worker, { packState, unpackState, safeReturnTo } from '../workers/signup/index.mjs';
import { githubRefreshToken } from '../workers/signup/oauth.mjs';
import { SECRET, fakeEnv, withFetch, req } from './lib/worker-fixtures.mjs';

// ---------------------------------------------------------------------------
// Entrypoint coverage (FIX 5): drive the default fetch handler with synthetic Request objects and a
// fake env (fake KV + a stubbed global fetch). The OAuth helpers and the frozen Stripe / Discord
// clients all call globalThis.fetch, so we swap it per test and restore it afterward. No network and
// no real secrets.
// ---------------------------------------------------------------------------

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
      assert.ok(unpacked.nonce, 'the state carries a per-browser nonce (state-browser binding)');
      const setCookie = res.headers.get('Set-Cookie') || '';
      assert.match(setCookie, new RegExp('gbti_oauth_nonce=' + unpacked.nonce), 'the same nonce is set as a cookie');
      assert.match(setCookie, /HttpOnly/);
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

test('GET /signup/github/callback completes the trial signup on GitHub ALONE (Discord deferred)', async () => {
  const env = fakeEnv();
  // sow-236: a real state now carries a one-time jti, KV-consumed at the callback. The fixture reflects the new
  // state shape rather than the assertion being relaxed; a state without one is rejected, which is its own test.
  const startState = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-happy-path' }, env);
  await withFetch(
    (url) => {
      if (url.includes('login/oauth/access_token')) return { status: 200, body: { access_token: 'gho_token' } };
      if (url.includes('api.github.com/user/emails')) return { status: 200, body: [{ email: 'octo@example.com', primary: true, verified: true }] };
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 424242, login: 'octocat' } };
      if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [] } };
      if (url.includes('api.stripe.com/v1/customers')) return { status: 200, body: { id: 'cus_new', metadata: {} } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`, { headers: { Cookie: 'gbti_oauth_nonce=n1', 'CF-Connecting-IP': '9.9.9.9' } }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      const location = res.headers.get('Location');
      assert.ok(location.includes('/welcome/'), 'sow-207: completes signup -> the website welcome flow, not the extension page or a Discord redirect');
      assert.ok(!location.includes('discord.com'), 'no Discord hop in the signup flow');
      assert.ok(res.headers.get('Set-Cookie'), 'a session cookie is set (signup completed on GitHub alone)');
      // sow-158 Phase 1b: the callback now mints BOTH the HttpOnly session cookie and the readable CSRF cookie.
      const setCookies = res.headers.getSetCookie();
      assert.ok(setCookies.some((c) => c.startsWith('gbti_session=') && /HttpOnly/.test(c)), 'the HttpOnly session cookie is set');
      assert.ok(setCookies.some((c) => c.startsWith('gbti_csrf=') && !/HttpOnly/.test(c)), 'the readable (non-HttpOnly) CSRF cookie is set');
      assert.equal(env.SIGNUP_KV.store.get('gh:424242'), 'cus_new', 'the trial Customer was created + indexed');
    },
  );
});

// sow-236 RENAMED. This was called "REJECTS a replayed state with no matching nonce cookie", and it never tested
// replay: it tests a state TRANSPLANTED into a different browser. The nonce is client-held, so it cannot defend
// against a client replaying its OWN state, and the old name is why nobody looked for the missing consume. Anyone
// grepping for replay coverage found this and stopped. Real replay is covered in test/oauth-state-replay.test.mjs.
test('GET /signup/github/callback REJECTS a state TRANSPLANTED into another browser (login-CSRF / session-fixation defense)', async () => {
  const env = fakeEnv();
  // Carries a valid jti, so the nonce mismatch is the ONLY thing that can reject it. Without one this would 400 for
  // the sow-236 reason instead and would silently stop testing the nonce at all.
  const startState = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-transplant' }, env); // legitimately signed...
  // ...delivered into a DIFFERENT browser, which lacks the matching gbti_oauth_nonce cookie. Rejected BEFORE any
  // code exchange or session mint (no global fetch needed -- the handler returns 400 first).
  const res = await worker.fetch(
    req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`, { headers: { Cookie: 'gbti_oauth_nonce=WRONG' } }),
    env,
    {},
  );
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('Set-Cookie'), 'no session is minted for a transplanted state');
  assert.equal(env.SIGNUP_KV.store.get('statejti:jti-transplant'), undefined, 'a rejected state does NOT burn its jti');
});

// ---- sow-158 Phase 1b: website cookie session + CSRF (router integration; these paths short-circuit before Stripe/KV) ----

test('sow-158: a cookie POST to /membership/activity with NO CSRF is rejected (403 csrf check failed)', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const session = await signSession({ githubId: '42', githubLogin: 'gwen' }, env.SESSION_SECRET);
  const res = await worker.fetch(
    req('POST', '/membership/activity', { headers: { Cookie: 'gbti_session=' + session, Origin: 'https://gbti.test' }, body: '{}' }),
    env, {},
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).message, 'csrf check failed');
});

test('sow-158: POST /auth/logout 403s without CSRF and clears both cookies with a valid one', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const bad = await worker.fetch(req('POST', '/auth/logout', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(bad.status, 403);

  const ok = await worker.fetch(
    req('POST', '/auth/logout', { headers: { Cookie: 'gbti_csrf=T', 'X-GBTI-CSRF': 'T', Origin: 'https://gbti.test' } }),
    env, {},
  );
  assert.equal(ok.status, 200);
  const cleared = ok.headers.getSetCookie();
  assert.ok(cleared.some((c) => c.startsWith('gbti_session=') && /Max-Age=0/.test(c)), 'the session cookie is expired');
  assert.ok(cleared.some((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c)), 'the csrf cookie is expired');
});

// web-login fix: a user who first signed in before the fix carries BOTH a stale host-only gbti_csrf and the
// Domain=gbti.network one. The site echoes only the Domain value, which may sort second in the Cookie header;
// logout must still succeed (match-any) and must expire BOTH variants so the stale one stops colliding.
test('sow-158: logout succeeds with a stale+fresh gbti_csrf pair and clears host-only AND Domain csrf', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  const res = await worker.fetch(
    req('POST', '/auth/logout', { headers: { Cookie: 'gbti_csrf=stale; gbti_csrf=fresh', 'X-GBTI-CSRF': 'fresh', Origin: 'https://gbti.test' } }),
    env, {},
  );
  assert.equal(res.status, 200, 'the echoed header matches the second (fresh) cookie -> not a 403');
  const cleared = res.headers.getSetCookie().filter((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c));
  assert.ok(cleared.some((c) => !/Domain=/.test(c)), 'a host-only csrf clear is emitted');
  assert.ok(cleared.some((c) => /Domain=gbti\.test/.test(c)), 'a Domain-scoped csrf clear is emitted');
});

test('sow-158: OPTIONS /membership/status reflects an allow-listed Origin with credentials, blocks others', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const ok = await worker.fetch(req('OPTIONS', '/membership/status', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test');
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');

  const blocked = await worker.fetch(req('OPTIONS', '/membership/status', { headers: { Origin: 'https://evil.example' } }), env, {});
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
});

// sow-158 auth bridge: mint the website cookie session from the extension's already-verified GitHub token, so one
// extension sign-in also signs the member into gbti.network. Bearer-authenticated; token -> own-session (no escalation).
test('sow-158: POST /auth/session-from-token mints the session + Domain-csrf cookies from a verified bearer', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  await withFetch(
    (url) => (url.includes('api.github.com/user') ? { status: 200, body: { id: 42, login: 'octocat' } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(req('POST', '/auth/session-from-token', { headers: { Authorization: 'Bearer good', Origin: 'https://gbti.test', 'CF-Connecting-IP': '1.2.3.4' } }), env, {});
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.github_id, '42');
      assert.equal(body.login, 'octocat');
      assert.ok(!JSON.stringify(body).includes('good'), 'the token is never echoed back');
      const cookies = res.headers.getSetCookie();
      assert.ok(cookies.some((c) => c.startsWith('gbti_session=') && /HttpOnly/.test(c) && !/Domain=/.test(c)), 'a host-only httpOnly session cookie is set');
      assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Domain=gbti\.test/.test(c) && !/HttpOnly/.test(c)), 'a readable Domain-scoped csrf cookie is set');
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test', 'credentialed CORS reflects the allow-listed origin');
      assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
    },
  );
});

test('sow-158: /auth/session-from-token 401s with no bearer or an unverifiable token, minting no cookie', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const noAuth = await worker.fetch(req('POST', '/auth/session-from-token', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.getSetCookie().length, 0);
  await withFetch(
    (url) => (url.includes('api.github.com/user') ? { status: 401, body: 'bad creds' } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(req('POST', '/auth/session-from-token', { headers: { Authorization: 'Bearer bad', Origin: 'https://gbti.test', 'CF-Connecting-IP': '1.2.3.5' } }), env, {});
      assert.equal(res.status, 401);
      assert.equal(res.headers.getSetCookie().length, 0, 'no session is minted on an unverifiable token');
    },
  );
});

// sow-158 auth bridge, sign-out counterpart: an extension sign-out expires the bridged website cookie session.
// Clearing cookies is capability-free, so it does NOT verify the token against GitHub (a signing-out token may be
// mid-revocation) -> it clears with any present bearer, and mirrors /auth/logout's dual host-only + Domain clear.
test('sow-158: POST /auth/session-clear expires the session + both csrf cookies with a present bearer', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  const res = await worker.fetch(req('POST', '/auth/session-clear', { headers: { Authorization: 'Bearer anything', Origin: 'https://gbti.test', 'CF-Connecting-IP': '1.2.3.6' } }), env, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('gbti_session=') && /Max-Age=0/.test(c) && !/Domain=/.test(c)), 'host-only session cleared');
  assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c) && !/Domain=/.test(c)), 'host-only csrf cleared');
  assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c) && /Domain=gbti\.test/.test(c)), 'Domain csrf cleared');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('sow-158: /auth/session-clear 401s with no bearer, clearing nothing', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  const res = await worker.fetch(req('POST', '/auth/session-clear', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(res.status, 401);
  assert.equal(res.headers.getSetCookie().length, 0, 'no clear without a bearer');
});

// sow-158 News track: the news read + engagement routes are now cookie-readable (credentialed reflected-origin
// CORS), so the website /news mount can call them with the session cookie. news-publish stays bearer-only (curator).
test('sow-158 News: news routes reflect an allow-listed Origin with credentials; news-publish stays wildcard', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  for (const path of ['/membership/news', '/membership/news-categories', '/membership/news-sources', '/membership/news-opened', '/membership/news-discussed']) {
    const ok = await worker.fetch(req('OPTIONS', path, { headers: { Origin: 'https://gbti.test' } }), env, {});
    assert.equal(ok.status, 204, `${path} preflight`);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test', `${path} reflects the origin`);
    assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true', `${path} allows credentials`);
    const blocked = await worker.fetch(req('OPTIONS', path, { headers: { Origin: 'https://evil.example' } }), env, {});
    assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null, `${path} blocks a foreign origin`);
  }
  // news-publish is the curator (bearer-only) path: it keeps the wildcard MEMBERSHIP_CORS, never credentialed.
  const pub = await worker.fetch(req('OPTIONS', '/membership/news-publish', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.notEqual(pub.headers.get('Access-Control-Allow-Credentials'), 'true', 'news-publish must not be credentialed');
});

// sow-161 admin surface (read): the per-member Stripe status route is cookie-enabled (credentialed reflected-origin
// CORS) so the website admin dashboard reads it over the session; a foreign origin is not reflected.
test('sow-161: /membership/admin/statuses reflects an allow-listed Origin with credentials', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const ok = await worker.fetch(req('OPTIONS', '/membership/admin/statuses', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test');
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
  const blocked = await worker.fetch(req('OPTIONS', '/membership/admin/statuses', { headers: { Origin: 'https://evil.example' } }), env, {});
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null, 'a foreign origin is blocked');
});

// sow-158 in-app browse reader: the content-open engagement beacon is cookie-enabled so the website /browse reader
// fires it over the session cookie (credentialed reflected-origin CORS), reflecting only an allow-listed origin.
test('sow-158 Phase 2: safeReturnTo allows a same-site path and rejects open-redirect attempts', () => {
  assert.equal(safeReturnTo('/account/'), '/account/');
  assert.equal(safeReturnTo('/articles/foo/?x=1#h'), '/articles/foo/?x=1#h');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'http:/evil', '', 'account', 'javascript:alert(1)', '/x\ty']) {
    assert.equal(safeReturnTo(bad), '', `must reject ${JSON.stringify(bad)}`);
  }
  assert.equal(safeReturnTo('/' + 'a'.repeat(600)), ''); // length cap
});

test('sow-158 Phase 2: return_to threads through the signed state', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => (url.includes('siteverify') ? { status: 200, body: { success: true } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=tok&return_to=%2Faccount%2F', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
        env, {},
      );
      assert.equal(res.status, 302);
      const state = new URL(res.headers.get('Location')).searchParams.get('state');
      assert.equal((await unpackState(state, env)).returnTo, '/account/');
    },
  );
});

test('sow-158 Phase 2: an open-redirect return_to is dropped from the state', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => (url.includes('siteverify') ? { status: 200, body: { success: true } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=tok&return_to=' + encodeURIComponent('//evil.example'), { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
        env, {},
      );
      assert.equal((await unpackState(new URL(res.headers.get('Location')).searchParams.get('state'), env)).returnTo, undefined);
    },
  );
});

test('sow-158 Phase 2 + sow-343: a NEW account carries return_to to the welcome steps as next (returning: onboarding-landing)', async () => {
  const env = fakeEnv();
  const startState = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-return-to', returnTo: '/workbench/' }, env);
  await withFetch(
    (url) => {
      if (url.includes('login/oauth/access_token')) return { status: 200, body: { access_token: 'gho_token' } };
      if (url.includes('api.github.com/user/emails')) return { status: 200, body: [{ email: 'o@example.com', primary: true, verified: true }] };
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 424242, login: 'octocat' } };
      if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [] } };
      if (url.includes('api.stripe.com/v1/customers')) return { status: 200, body: { id: 'cus_new', metadata: {} } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`, { headers: { Cookie: 'gbti_oauth_nonce=n1', 'CF-Connecting-IP': '9.9.9.9' } }),
        env, {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/welcome/?next=%2Fworkbench%2F');
      const cookies = res.headers.getSetCookie();
      assert.ok(cookies.some((c) => c.startsWith('gbti_session=')) && cookies.some((c) => c.startsWith('gbti_csrf=')), 'both cookies set');
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

// SOW: POST /auth/refresh — the secretless token-refresh endpoint. The extension sends only its rotating
// refresh_token; the Worker adds the App client_id+secret and returns fresh tokens. githubRefreshToken (oauth.mjs)
// uses globalThis.fetch, so we stub it for the GitHub round-trip.

function refreshReq(body) {
  return new Request('https://signup.gbti.network/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const REFRESH_ENV = { GITHUB_PUBLISHER_CLIENT_ID: 'Iv1.app', GITHUB_PUBLISHER_CLIENT_SECRET: 'sec' };

test('githubRefreshToken: posts grant_type=refresh_token and maps the rotated response', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, body: opts.body }; return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 }) }; };
  const r = await githubRefreshToken({ clientId: 'Iv1.app', clientSecret: 'sec', refreshToken: 'ghr_old' }, fetchImpl);
  assert.match(sent.url, /login\/oauth\/access_token/);
  assert.match(sent.body, /grant_type=refresh_token/);
  assert.match(sent.body, /refresh_token=ghr_old/);
  assert.deepEqual(r, { accessToken: 'gho_new', refreshToken: 'ghr_new', expiresIn: 28800, refreshTokenExpiresIn: 15897600 });
});

test('POST /auth/refresh: returns fresh tokens on success', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 }) });
  try {
    const res = await worker.fetch(refreshReq({ refresh_token: 'ghr_old' }), REFRESH_ENV, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.access_token, 'gho_new');
    assert.equal(body.refresh_token, 'ghr_new');
    assert.equal(body.expires_in, 28800);
  } finally { globalThis.fetch = realFetch; }
});

test('POST /auth/refresh: 501 when the App secret is not configured', async () => {
  const res = await worker.fetch(refreshReq({ refresh_token: 'x' }), { GITHUB_PUBLISHER_CLIENT_ID: 'Iv1.app' }, {});
  assert.equal(res.status, 501);
});

test('POST /auth/refresh: 400 without a refresh_token', async () => {
  const res = await worker.fetch(refreshReq({}), REFRESH_ENV, {});
  assert.equal(res.status, 400);
});

test('POST /auth/refresh: 401 when GitHub rejects the refresh token (expired/revoked)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ error: 'bad_refresh_token' }) });
  try {
    const res = await worker.fetch(refreshReq({ refresh_token: 'dead' }), REFRESH_ENV, {});
    assert.equal(res.status, 401);
  } finally { globalThis.fetch = realFetch; }
});

// sow-393: the extension signs in through the website. The three Worker routes, driven through the real router:
// start -> GitHub -> callback -> https://<extension id>.chromiumapp.org/signed-in#code -> claim with the PKCE verifier.
// The code must only ever be sent to an allow-listed chromiumapp.org address: Chrome hands that to the extension that
// opened its sign-in window and to nothing else. Sending it anywhere a page can read is how a token gets stolen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { packState } from '../workers/signup/index.mjs';
import { s256, EXT_HANDOFF_PREFIX, EXT_STATE_KIND, STORE_EXTENSION_ID, allowedRedirectId, nonceCookieName } from '../workers/signup/extension-signin.mjs';
import { githubAuthorizeUrl } from '../workers/signup/oauth.mjs';

const VERIFIER = 'v'.repeat(20) + 'erifier-0123456789abcdefghijklmnop'; // 54 chars, RFC 7636 alphabet
const ATTACKER_VERIFIER = 'a'.repeat(60);
const EXT = STORE_EXTENSION_ID;
const REDIRECT = `https://${EXT}.chromiumapp.org/signed-in`;

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) { const v = store.get(key); if (v === undefined) return null; return opts?.type === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function fakeEnv(extra = {}) {
  return {
    SESSION_SECRET: 'test-session-secret-0123456789',
    SIGNUP_KV: fakeKv(),
    GITHUB_PUBLISHER_CLIENT_ID: 'Iv-app-client',
    GITHUB_PUBLISHER_CLIENT_SECRET: 'app-secret',
    PUBLIC_BASE_URL: 'https://signup.gbti.test',
    SITE_BASE_URL: 'https://gbti.test',
    COOKIE_DOMAIN: 'gbti.test',
    ...extra,
  };
}

const req = (method, path, { headers = {}, body } = {}) => new Request(`https://signup.gbti.test${path}`, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body });

/** GitHub stand-in: the App code exchange and the user read. Records every call. */
async function withGithub(fn, { exchange = { status: 200, body: { access_token: 'ghu_access', refresh_token: 'ghr_refresh', expires_in: 28800, refresh_token_expires_in: 15811200 } } } = {}) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body });
    const r = String(url).includes('login/oauth/access_token') ? exchange : String(url).includes('api.github.com/user') ? { status: 200, body: { id: 4242, login: 'octo' } } : { status: 404, body: '' };
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text, json: async () => JSON.parse(text) };
  };
  try { return await fn(calls); } finally { globalThis.fetch = orig; }
}

async function start(env, verifier = VERIFIER, { redirect = REDIRECT, login = '' } = {}) {
  const res = await worker.fetch(req('GET', `/auth/extension/start?challenge=${await s256(verifier)}&redirect=${encodeURIComponent(redirect)}${login ? `&login=${login}` : ''}`), env, {});
  const location = res.headers.get('Location');
  const loc = location ? new URL(location) : null; // a refused start redirects nowhere
  const set = (res.headers.get('Set-Cookie') || '').match(/^(__Host-gbti_ext_[A-Za-z0-9_-]{16})=([^;]+)/);
  return { res, loc, state: loc?.searchParams.get('state') ?? null, cookie: set ? `${set[1]}=${set[2]}` : null, nonce: set?.[2] ?? null };
}

// `cookie` is the whole Cookie header the member's browser would send; `nonce` alone is sent under the start's name.
const callback = (env, { state, cookie, code = 'ghcode' }) => worker.fetch(
  req('GET', `/auth/extension/callback?code=${code}&state=${encodeURIComponent(state)}`, { headers: cookie ? { Cookie: cookie } : {} }), env, {});

const claim = (env, body) => worker.fetch(req('POST', '/auth/extension/claim', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, {});

const handoffOf = (res) => {
  const loc = new URL(res.headers.get('Location'));
  assert.equal(`${loc.origin}${loc.pathname}`, REDIRECT, 'a code only ever goes to the extension\'s chromiumapp.org address');
  return loc.hash.match(/^#code=([A-Za-z0-9_-]{43})$/)?.[1];
};

test('start: sends the member to the GitHub App authorize page, bound to this browser, asking for no scope', async () => {
  const env = fakeEnv();
  const { res, loc, state, nonce } = await start(env);
  assert.equal(res.status, 302);
  assert.equal(loc.searchParams.get('prompt'), 'select_account', 'GitHub always shows its account picker, so no sign-in completes without a click');
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'Iv-app-client', 'the GitHub App, not the website OAuth App');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://signup.gbti.test/auth/extension/callback');
  assert.equal(loc.searchParams.has('scope'), false, 'no scope is requested');
  assert.ok(state && nonce, 'a signed state and a nonce cookie');
  const setCookie = res.headers.get('Set-Cookie');
  assert.ok(setCookie.startsWith(`${nonceCookieName(await s256(VERIFIER))}=`), 'named for this sign-in, __Host- so no sibling subdomain can plant it');
  assert.match(setCookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  assert.doesNotMatch(setCookie, /Domain=/, '__Host- cookies carry no Domain');
});

test('start: refuses a malformed challenge, and answers 501 when the App is not configured', async () => {
  const bad = await worker.fetch(req('GET', `/auth/extension/start?challenge=short&redirect=${encodeURIComponent(REDIRECT)}`), fakeEnv(), {});
  assert.equal(bad.status, 400);
  const unset = await start(fakeEnv({ GITHUB_PUBLISHER_CLIENT_SECRET: '' }));
  assert.equal(unset.res.status, 501);
});

test('start: sends a sign-in only to an allow-listed extension\'s chromiumapp.org address, never to a page', async () => {
  const other = 'b'.repeat(32);
  for (const redirect of [
    'https://gbti.network/extension/signed-in/', // a web page: any script there could read the code
    `https://${other}.chromiumapp.org/signed-in`, // some other extension
    `http://${EXT}.chromiumapp.org/signed-in`,
    `https://${EXT}.chromiumapp.org/other`,
    `https://${EXT}.chromiumapp.org.evil.test/signed-in`,
    `https://x.${EXT}.chromiumapp.org/signed-in`,
    '',
  ]) {
    const { res } = await start(fakeEnv(), VERIFIER, { redirect });
    assert.equal(res.status, 400, `refused: ${redirect}`);
    assert.equal(res.headers.get('Location'), null);
  }
  assert.equal(allowedRedirectId(`https://${other}.chromiumapp.org/signed-in`, { EXTENSION_IDS: `${EXT}, ${other}` }), other, 'EXTENSION_IDS adds an id');
  assert.equal(allowedRedirectId(REDIRECT, { EXTENSION_IDS: other }), null, 'and when set, it is the whole list');
});

test('start: a known website account is suggested to GitHub', async () => {
  const { loc } = await start(fakeEnv(), VERIFIER, { login: 'octo' });
  assert.equal(loc.searchParams.get('login'), 'octo');
  const { loc: none } = await start(fakeEnv(), VERIFIER, { login: '<b>' });
  assert.equal(none.searchParams.has('login'), false, 'a malformed login is dropped');
});

test('githubAuthorizeUrl omits scope when passed null, and keeps the website default otherwise', () => {
  assert.ok(!githubAuthorizeUrl({ clientId: 'c', redirectUri: 'r', state: 's', scope: null }).includes('scope='));
  assert.ok(githubAuthorizeUrl({ clientId: 'c', redirectUri: 'r', state: 's' }).includes('scope=read%3Auser'));
});

test('the whole flow: callback parks the tokens and signs the website in; the verifier claims them exactly once', async () => {
  const env = fakeEnv();
  const { state, cookie } = await start(env);
  await withGithub(async (calls) => {
    const res = await callback(env, { state, cookie });
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location');
    assert.ok(loc.startsWith(`${REDIRECT}#code=`), loc);
    const exchange = calls.find((c) => c.url.includes('access_token'));
    assert.match(exchange.body, /client_id=Iv-app-client/);
    assert.match(exchange.body, /client_secret=app-secret/);
    const cookies = res.headers.getSetCookie();
    const spent = `${nonceCookieName(await s256(VERIFIER))}=;`;
    assert.ok(cookies.some((c) => c.startsWith('gbti_session=') && /HttpOnly/.test(c)), 'the website session is minted in the same step');
    assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Domain=gbti\.test/.test(c)));
    assert.ok(cookies.some((c) => c.startsWith(spent) && /Max-Age=0/.test(c)), 'the nonce is spent');
    assert.ok(!loc.includes('ghu_access'), 'the token never rides in the URL');

    const code = handoffOf(res);
    assert.ok(env.SIGNUP_KV.store.has(`${EXT_HANDOFF_PREFIX}${code}`));

    const wrong = await claim(env, { code, verifier: ATTACKER_VERIFIER });
    assert.equal(wrong.status, 400, 'the handoff code alone is not enough');
    assert.ok(env.SIGNUP_KV.store.has(`${EXT_HANDOFF_PREFIX}${code}`), 'a wrong verifier does not cancel the member\'s sign-in');

    // Sent as gbti.network script would send it, to an env that allow-lists that origin elsewhere: still no CORS.
    const ok = await worker.fetch(req('POST', '/auth/extension/claim', { headers: { 'Content-Type': 'application/json', Origin: 'https://gbti.network' }, body: JSON.stringify({ code, verifier: VERIFIER }) }), { ...env, CORS_ALLOWED_ORIGINS: 'https://gbti.network' }, {});
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), null, 'no CORS even for an allow-listed origin: no web page can read a claim');
    const body = await ok.json();
    assert.deepEqual(body, { access_token: 'ghu_access', refresh_token: 'ghr_refresh', expires_in: 28800, refresh_token_expires_in: 15811200, github_id: '4242', login: 'octo' });
    assert.equal(env.SIGNUP_KV.store.has(`${EXT_HANDOFF_PREFIX}${code}`), false, 'claimed once, then gone');

    const again = await claim(env, { code, verifier: VERIFIER });
    assert.equal(again.status, 400, 'a second claim finds nothing');
  });
});

test('the code without the verifier, or the verifier without the code, claims nothing', async () => {
  const env = fakeEnv();
  // The attacker starts with THEIR verifier and gets a member's browser to finish it. The attacker holds the verifier,
  // so the only protection is where the code goes: the extension's chromiumapp.org address, which Chrome gives to no
  // page and, outside a sign-in window the extension opened, to no one at all (handoffOf asserts the address).
  const { state, cookie } = await start(env, ATTACKER_VERIFIER);
  await withGithub(async () => {
    const res = await callback(env, { state, cookie });
    const memberTabCode = handoffOf(res);
    assert.ok(memberTabCode);
    const guessed = 'A'.repeat(43);
    assert.equal((await claim(env, { code: guessed, verifier: ATTACKER_VERIFIER })).status, 400, 'the attacker has no code');
    // And the member's own extension, which never made this challenge, cannot claim it either.
    assert.equal((await claim(env, { code: memberTabCode, verifier: VERIFIER })).status, 400, 'a different verifier cannot claim it');
  });
});

test('callback: declined, transplanted, replayed and website states mint nothing, and a stranger cannot cancel a sign-in', async () => {
  const env = fakeEnv();
  const { state, cookie } = await start(env);
  const declined = await worker.fetch(req('GET', `/auth/extension/callback?error=access_denied&state=${encodeURIComponent(state)}`), env, {});
  assert.equal(declined.headers.get('Location'), `${REDIRECT}#error=declined`);
  assert.equal(declined.headers.get('Set-Cookie'), null, 'a failure leaves the nonce cookie, so a page that sends the browser here cannot cancel a sign-in');

  const unusable = await worker.fetch(req('GET', '/auth/extension/callback?code=c&state=forged'), env, {});
  assert.equal(unusable.status, 400, 'with no usable state there is nowhere to send a code, and none is sent');
  assert.equal(unusable.headers.get('Location'), null);

  await withGithub(async (calls) => {
    const transplanted = await callback(env, { state, cookie: `${cookie.split('=')[0]}=someone-elses` });
    assert.match(transplanted.headers.get('Location'), /#error=expired$/);
    assert.equal(transplanted.headers.get('Set-Cookie'), null, 'no session for a transplanted state, and its nonce cookie is not touched');
    const unprefixed = await callback(env, { state, cookie: `gbti_ext_${cookie.split('=')[0].slice(-16)}=${cookie.split('=')[1]}` });
    assert.match(unprefixed.headers.get('Location'), /#error=expired$/, 'only the __Host- cookie counts, which a sibling subdomain cannot set');

    const first = await callback(env, { state, cookie });
    assert.ok(handoffOf(first));
    const replay = await callback(env, { state, cookie });
    assert.match(replay.headers.get('Location'), /#error=expired$/, 'a state is single-use');

    const website = await packState({ ref: '', nonce: 'n1', jti: 'jti-web' }, env); // a website signup state has no kind
    const crossed = await callback(env, { state: website, cookie: 'gbti_oauth_nonce=n1' });
    assert.equal(crossed.status, 400, 'a website state never completes an extension sign-in');
    assert.equal(calls.filter((c) => c.url.includes('access_token')).length, 1, 'only the one good callback reached GitHub');
  });
});

test('callback: a signed state of any other kind is refused, even one carrying a well-formed challenge and id', async () => {
  const env = fakeEnv();
  // Only the kind tells these apart: the challenge, id, nonce and jti are all valid, so the kind check alone rejects it.
  const challenge = await s256(VERIFIER);
  const other = await packState({ challenge, rid: EXT, nonce: 'n3', jti: 'jti-other' }, env);
  const wrongKind = await packState({ kind: 'x', challenge, rid: EXT, nonce: 'n3', jti: 'jti-x' }, env);
  await withGithub(async (calls) => {
    const res = await callback(env, { state: other, cookie: `${nonceCookieName(challenge)}=n3` });
    assert.equal(res.status, 400);
    const res2 = await callback(env, { state: wrongKind, cookie: `${nonceCookieName(challenge)}=n3` });
    assert.equal(res2.status, 400, 'a state of some other kind is refused too, not just one with no kind');
    assert.equal(calls.length, 0, 'refused before GitHub is asked anything');
    assert.equal(env.SIGNUP_KV.store.get('statejti:jti-other'), undefined, 'and before the state is consumed');
  });
});

test('callback: a failed code exchange parks nothing and signs nothing in', async () => {
  const env = fakeEnv();
  const { state, cookie } = await start(env);
  await withGithub(async () => {
    const res = await callback(env, { state, cookie });
    assert.equal(res.headers.get('Location'), `${REDIRECT}#error=failed`);
    assert.equal([...env.SIGNUP_KV.store.keys()].filter((k) => k.startsWith(EXT_HANDOFF_PREFIX)).length, 0);
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith('gbti_session=')));
  }, { exchange: { status: 200, body: { error: 'bad_verification_code' } } });
});

test('a second sign-in started in the same browser does not break the first (a page cannot cancel one by starting another)', async () => {
  const env = fakeEnv();
  const first = await start(env);
  const second = await start(env, ATTACKER_VERIFIER);
  assert.notEqual(first.cookie.split('=')[0], second.cookie.split('=')[0], 'each sign-in has its own cookie');
  await withGithub(async () => {
    const res = await callback(env, { state: first.state, cookie: `${second.cookie}; ${first.cookie}` });
    assert.ok(handoffOf(res), 'the first sign-in still completes');
  });
});

test('callback: an id dropped from the allow-list after the sign-in started gets nothing', async () => {
  const env = fakeEnv();
  const { state, cookie } = await start(env);
  env.EXTENSION_IDS = 'c'.repeat(32);
  await withGithub(async (calls) => {
    const res = await callback(env, { state, cookie });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('the website signup callback refuses an extension sign-in state', async () => {
  const env = fakeEnv();
  const extState = await packState({ kind: EXT_STATE_KIND, challenge: await s256(VERIFIER), rid: EXT, nonce: 'n2', jti: 'jti-ext' }, env);
  const res = await worker.fetch(req('GET', `/signup/github/callback?code=c&state=${encodeURIComponent(extState)}`, { headers: { Cookie: 'gbti_oauth_nonce=n2' } }), env, {});
  assert.equal(res.status, 400);
  assert.equal(env.SIGNUP_KV.store.get('statejti:jti-ext'), undefined, 'refused before anything is consumed');
});

test('claim: only POST, and malformed bodies are refused', async () => {
  const env = fakeEnv();
  assert.equal((await worker.fetch(req('GET', '/auth/extension/claim'), env, {})).status, 405);
  assert.equal((await claim(env, { code: 'x', verifier: VERIFIER })).status, 400);
  assert.equal((await claim(env, { code: 'A'.repeat(43), verifier: 'short' })).status, 400);
});

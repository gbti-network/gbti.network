// sow-399: SYNDICATION MOVED FROM THE EXTENSION TO THE WEBSITE, so its five Worker routes accept the website's
// cookie session as well as a bearer token. These tests drive the REAL admin gate (authorizeAdmin ->
// resolveCaller -> resolveIdentity) with a real signed session cookie and the real double-submit CSRF check,
// rather than an injected authorize stub, because the property under test is the gate itself: a stub that says
// "ok" would pass whether or not the cookie branch was reached.
//
// What must hold:
//   - a superadmin's website session reaches the queue, approve, cancel, the Social Queue and manual syndication;
//   - every website WRITE needs the CSRF header and an allow-listed Origin (a session cookie alone is refused);
//   - an admin who is not a superadmin is still refused every write, exactly as over a bearer token;
//   - the cookie branch opens only because the route asks for it (allowCookie), never by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../workers/signup/index.mjs';
import { handleSyndicationTracker, handleSyndicationApprove, handleSyndicationCancel } from '../workers/signup/syndication-admin.mjs';
import { handleSocialQueueGet, handleSocialQueueAction } from '../workers/signup/social-queue-admin.mjs';
import { handleSyndicateNowInfo, handleSyndicateNow } from '../workers/signup/membership-syndicate-now.mjs';
import { signSession } from '../workers/signup/session.mjs';

const SECRET = 'test-session-secret';
const ORIGIN = 'https://gbti.network';
const CSRF = 'csrf-token-abc';
const SUPER = { githubId: '1', githubLogin: 'super' };
const ADMIN = { githubId: '2', githubLogin: 'admin' };

function makeKv() {
  const store = new Map();
  store.set('overrides:mirror', JSON.stringify({
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    roles: { superadmins: [{ github_id: '1' }], admins: [{ github_id: '2' }], moderators: [] },
    bans: { bans: [] }, grandfathered: { grandfathered: [] },
  }));
  return {
    async get(key, type) { const v = store.has(key) ? store.get(key) : null; return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const envFor = () => ({ SIGNUP_KV: makeKv(), SESSION_SECRET: SECRET, CORS_ALLOWED_ORIGINS: ORIGIN });

async function websiteRequest(path, { who = SUPER, method = 'GET', body, csrf = true, origin = ORIGIN } = {}) {
  const session = await signSession(who, SECRET);
  const headers = { Cookie: `gbti_session=${session}; gbti_csrf=${CSRF}` };
  if (origin) headers.Origin = origin;
  if (csrf && method !== 'GET') headers['X-GBTI-CSRF'] = CSRF;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://signup.gbti.network${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const cookieOn = { allowCookie: true };

test('a superadmin website session reads the publishing queue', async () => {
  const r = await handleSyndicationTracker(await websiteRequest('/membership/syndication'), envFor(), cookieOn);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.pending, []);
});

test('the cookie branch opens only when the route asks for it', async () => {
  const r = await handleSyndicationTracker(await websiteRequest('/membership/syndication'), envFor());
  assert.equal(r.status, 401);
  assert.match(r.body.message, /bearer token is required/);
});

for (const [name, handler, path] of [
  ['approve', handleSyndicationApprove, '/membership/syndication/approve'],
  ['cancel', handleSyndicationCancel, '/membership/syndication/cancel'],
]) {
  test(`${name}: a superadmin website session with the CSRF echo passes the gate`, async () => {
    const r = await handler(await websiteRequest(path, { method: 'POST', body: { id: 'no-such-item' } }), envFor(), cookieOn);
    assert.equal(r.status, 404, `expected the item lookup (past the gate), got ${r.status} ${JSON.stringify(r.body)}`);
  });
  test(`${name}: a website session WITHOUT the CSRF header is refused`, async () => {
    const r = await handler(await websiteRequest(path, { method: 'POST', body: { id: 'x' }, csrf: false }), envFor(), cookieOn);
    assert.equal(r.status, 403);
  });
  test(`${name}: a website session from a foreign Origin is refused`, async () => {
    const r = await handler(await websiteRequest(path, { method: 'POST', body: { id: 'x' }, origin: 'https://evil.example' }), envFor(), cookieOn);
    assert.equal(r.status, 403);
  });
  test(`${name}: an admin who is not a superadmin is refused`, async () => {
    const r = await handler(await websiteRequest(path, { who: ADMIN, method: 'POST', body: { id: 'x' } }), envFor(), cookieOn);
    assert.equal(r.status, 403);
    assert.match(r.body.message, /superadmin/);
  });
}

test('an approve over the website session really approves a held item', async () => {
  const env = envFor();
  const item = { id: 'itm1', status: 'pending', source: 'post', targetSlug: 'held-article', title: 'Held', enqueuedAt: Date.now() - 1000, availableAt: Date.now() + 3_600_000 };
  await env.SIGNUP_KV.put('synd:item:itm1', JSON.stringify(item));
  await env.SIGNUP_KV.put('synd:pending', JSON.stringify({ ids: ['itm1'] }));
  const r = await handleSyndicationApprove(await websiteRequest('/membership/syndication/approve', { method: 'POST', body: { id: 'itm1' } }), env, cookieOn);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.approved, true);
  assert.equal((await env.SIGNUP_KV.get('synd:item:itm1', 'json')).status, 'approved');
});

test('Social Queue: a superadmin website session reads it; an admin is refused', async () => {
  const ok = await handleSocialQueueGet(await websiteRequest('/membership/social-queue'), envFor(), cookieOn);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const no = await handleSocialQueueGet(await websiteRequest('/membership/social-queue', { who: ADMIN }), envFor(), cookieOn);
  assert.equal(no.status, 403);
});

test('Social Queue: a website action needs the CSRF header, and a superadmin with it passes the gate', async () => {
  const bare = await handleSocialQueueAction(await websiteRequest('/membership/social-queue', { method: 'POST', body: { action: 'done', id: 'x' }, csrf: false }), envFor(), cookieOn);
  assert.equal(bare.status, 403);
  const withCsrf = await handleSocialQueueAction(await websiteRequest('/membership/social-queue', { method: 'POST', body: { action: 'done', id: 'x' } }), envFor(), cookieOn);
  assert.notEqual(withCsrf.status, 401);
  assert.notEqual(withCsrf.status, 403, `a superadmin with the CSRF echo must pass the gate: ${JSON.stringify(withCsrf.body)}`);
});

test('Manually syndicate: a superadmin website session reads the destinations; an admin is refused', async () => {
  const ok = await handleSyndicateNowInfo(await websiteRequest('/membership/syndicate-now'), envFor(), cookieOn);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const no = await handleSyndicateNowInfo(await websiteRequest('/membership/syndicate-now', { who: ADMIN }), envFor(), cookieOn);
  assert.equal(no.status, 403);
});

test('Manually syndicate: a website post needs the CSRF header, and an admin is refused even with it', async () => {
  const bare = await handleSyndicateNow(await websiteRequest('/membership/syndicate-now', { method: 'POST', body: {}, csrf: false }), envFor(), cookieOn);
  assert.equal(bare.status, 403);
  const admin = await handleSyndicateNow(await websiteRequest('/membership/syndicate-now', { who: ADMIN, method: 'POST', body: {} }), envFor(), cookieOn);
  assert.equal(admin.status, 403);
  assert.match(admin.body.message, /superadmin/);
  const sa = await handleSyndicateNow(await websiteRequest('/membership/syndicate-now', { method: 'POST', body: {} }), envFor(), cookieOn);
  assert.ok(sa.status !== 401 && sa.status !== 403, `a superadmin with the CSRF echo must pass the gate: ${sa.status} ${JSON.stringify(sa.body)}`);
});

// Through the whole Worker: the routes answer the website's preflight with credentialed CORS, and a cookie GET
// is served with the headers a browser needs to hand the answer to the page.
test('the Worker routes answer the website with credentialed CORS and pass the session through', async () => {
  for (const path of ['/membership/syndication', '/membership/syndication/approve', '/membership/syndication/cancel', '/membership/social-queue', '/membership/syndicate-now']) {
    const pre = await worker.fetch(new Request(`https://signup.gbti.network${path}`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), envFor(), {});
    assert.equal(pre.status, 204, path);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN, `${path}: the website origin is not reflected`);
    assert.equal(pre.headers.get('Access-Control-Allow-Credentials'), 'true', `${path}: no credentialed CORS, so the browser sends no cookie`);
    assert.match(pre.headers.get('Access-Control-Allow-Headers') || '', /X-GBTI-CSRF/i, `${path}: the CSRF header is not allowed`);
  }
  const res = await worker.fetch(await websiteRequest('/membership/syndication'), envFor(), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(res.headers.get('Vary') || '', /Origin/);
  assert.match(res.headers.get('Vary') || '', /Cookie/);
  const sq = await worker.fetch(await websiteRequest('/membership/social-queue'), envFor(), {});
  assert.equal(sq.status, 200);
});

test('the routes table names all five and opts every one into the cookie session', () => {
  const idx = readFileSync(new URL('../workers/signup/index.mjs', import.meta.url), 'utf8');
  const start = idx.indexOf('const SYNDICATION_ROUTES = {');
  assert.ok(start > 0, 'the syndication routes table is missing');
  const block = idx.slice(start, start + 1400);
  for (const path of ['/membership/syndication', '/membership/syndication/approve', '/membership/syndication/cancel', '/membership/social-queue', '/membership/syndicate-now']) {
    assert.ok(block.includes(`'${path}'`), `${path} is not in the table`);
  }
  assert.match(block, /allowCookie: true/);
  assert.match(block, /credentials: true/);
  assert.match(block, /'Cache-Control': 'no-store'/);
});

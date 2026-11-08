// sow-494: the Community routes and the Durable Object transport. The router, the gates, the frame format and the
// object's op table run for real here; the object is a real node:sqlite store behind a stand-in namespace, and only
// the Stripe search inside authorizePaid is replaced (as `paid`), because it is a network call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../workers/signup/index.mjs';
import { signSession } from '../workers/signup/session.mjs';
import {
  handleCommunity, COMMUNITY_ROUTES, communityOkKey, COMMUNITY_OK_TTL, adminCall,
  membershipAdminCommunity, membershipAdminCommunityMembers, imageHeaders,
} from '../workers/signup/membership-community.mjs';
import { encodeRpc, decodeRpc, runOp, doSqlAdapter, WriteLimiter, WRITE_LIMITS, OPS } from '../workers/signup/community-do.mjs';
import { makeStore, SUPER, PRIYA, BEN, PNG, toB64 } from './lib/community-sqlite.mjs';

const SECRET = 'test-session-secret-for-community';
const ORIGIN = 'https://gbti.network';
const ctx = { waitUntil() {}, passThroughOnException() {} };

function fakeKv(seed = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const puts = [];
  return {
    map, puts,
    async get(key, type) {
      const v = map.has(key) ? map.get(key) : null;
      const t = typeof type === 'string' ? type : type?.type;
      return v != null && t === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts) { puts.push({ key, value, opts }); map.set(key, value); },
  };
}
const mirror = ({ bans = [], superadmins = [{ github_id: SUPER.githubId, login: SUPER.login }], at = new Date() } = {}) => ({
  generatedAt: at.toISOString(), roles: { superadmins }, bans: { bans }, grandfathered: { grandfathered: [] },
});

/** A namespace whose one object runs the real op table over a real store, through the real frame format. */
function namespace(store, { limiter = null } = {}) {
  const seen = [];
  return {
    seen,
    idFromName: (n) => n,
    get: () => ({
      fetch: async (_url, init) => {
        const { msg, bytes } = decodeRpc(init.body);
        seen.push(msg);
        return runOp(store, msg, bytes, { limiter });
      },
    }),
  };
}

function setup({ kvSeed = {}, mirrorOpts = {} } = {}) {
  const { store, advance } = makeStore();
  const kv = fakeKv({ 'overrides:mirror': mirror(mirrorOpts), ...kvSeed });
  const ns = namespace(store);
  const env = { SIGNUP_KV: kv, SESSION_SECRET: SECRET, CORS_ALLOWED_ORIGINS: ORIGIN, COMMUNITY: ns };
  return { store, advance, kv, ns, env };
}

async function cookie(who) {
  return `gbti_session=${await signSession({ githubId: who.githubId, githubLogin: who.login }, SECRET)}; gbti_csrf=tok`;
}
function req(path, { method = 'GET', cookie: c, body, csrf = true } = {}) {
  const headers = { Origin: ORIGIN };
  if (c) headers.Cookie = c;
  if (csrf && method !== 'GET') headers['X-GBTI-CSRF'] = 'tok';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://signup.gbti.network${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const route = (path, method) => COMMUNITY_ROUTES[path][method];

/** The full gate with the Stripe search replaced: `paidIds` are effective paid, everyone else is not. */
function paidGate(paidIds, calls = []) {
  return async (request, env, deps) => {
    calls.push(deps);
    const c = request.headers.get('Cookie') || '';
    const who = [SUPER, PRIYA, BEN].find((p) => c.includes(`gid=${p.githubId}`)) || null;
    if (!who) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'authentication is required' } };
    if (!paidIds.includes(who.githubId)) return { ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } };
    return { ok: true, githubId: who.githubId, login: who.login, status: 'paid' };
  };
}
const as = (who) => ({ Cookie: `gid=${who.githubId}` });
function hreq(path, who, { method = 'GET', body } = {}) {
  return new Request(`https://signup.gbti.network${path}`, { method, headers: { ...(who ? as(who) : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}

// ---- the router ------------------------------------------------------------------------------------------------

test('signed out, every Community route answers 401 before anything is read', async () => {
  const { env, ns } = setup();
  for (const [path, verbs] of Object.entries(COMMUNITY_ROUTES)) {
    for (const method of Object.keys(verbs)) {
      const res = await worker.fetch(req(`${path}?id=abcdefghjkmnpqrs`, { method, body: method === 'POST' ? {} : undefined }), env, ctx);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
    }
  }
  assert.equal(ns.seen.length, 0, 'the object is never called for a signed-out request');
});

test('a cookie POST without the CSRF token is refused, on member and superadmin routes alike', async () => {
  const { env, ns } = setup();
  const c = await cookie(SUPER);
  for (const path of ['/membership/community/post', '/membership/community/answer', '/membership/admin/community']) {
    const res = await worker.fetch(req(path, { method: 'POST', cookie: c, body: { op: 'create' }, csrf: false }), env, ctx);
    assert.equal(res.status, 403, path);
  }
  assert.equal(ns.seen.length, 0);
});

test('preflight is credentialed for our origin, and an unserved method falls through to the 404', async () => {
  const { env } = setup();
  const pre = await worker.fetch(req('/membership/community/image', { method: 'OPTIONS' }), env, ctx);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(pre.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /GET, POST/);
  const del = await worker.fetch(req('/membership/community/entry?id=x', { method: 'DELETE', cookie: await cookie(PRIYA) }), env, ctx);
  assert.notEqual(del.status, 200);
});

test('the superadmin route creates an entry through the real gate, and a member is refused', async () => {
  const { env, ns, store } = setup();
  const res = await worker.fetch(req('/membership/admin/community', {
    method: 'POST', cookie: await cookie(SUPER),
    body: { op: 'create', input: { kind: 'typed', title: 'What is one movie that everyone watched in the last several months that you thought was great?', settings: { hint: 'A movie title' } } },
  }), env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.id);
  assert.equal(ns.seen.at(-1).viewer.superadmin, true);
  assert.equal(ns.seen.at(-1).viewer.login, 'gbtilabs', 'the viewer is named from the session, never the body');
  assert.equal(store.getEntry(SUPER, body.id).entry.status, 'draft', 'saved, not opened');

  const member = await worker.fetch(req('/membership/admin/community', { method: 'POST', cookie: await cookie(PRIYA), body: { op: 'open', id: body.id } }), env, ctx);
  assert.equal(member.status, 403);
  assert.equal(store.getEntry(SUPER, body.id).entry.status, 'draft');
});

test('a banned superadmin is refused, and a stale mirror refuses everyone', async () => {
  const banned = setup({ mirrorOpts: { bans: [{ github_id: SUPER.githubId }] } });
  const r1 = await worker.fetch(req('/membership/admin/community', { method: 'POST', cookie: await cookie(SUPER), body: { op: 'create', input: {} } }), banned.env, ctx);
  assert.equal(r1.status, 403);
  const stale = setup({ mirrorOpts: { at: new Date(Date.now() - 49 * 3600_000) } });
  const r2 = await worker.fetch(req('/membership/admin/community', { method: 'POST', cookie: await cookie(SUPER), body: { op: 'create', input: {} } }), stale.env, ctx);
  assert.equal(r2.status, 403);
  assert.equal(banned.ns.seen.length + stale.ns.seen.length, 0);
});

// ---- the cheap gate --------------------------------------------------------------------------------------------

test('the live poll and images take the cheap gate: a remembered paid check, with the mirror read every time', async () => {
  const { env, store, ns } = setup({ kvSeed: { [communityOkKey(PRIYA.githubId)]: '1' } });
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Show your desk' }, { open: true });
  const c = await cookie(PRIYA);
  const first = await worker.fetch(req(`/membership/community/updates?id=${id}&v=0`, { cookie: c }), env, ctx);
  assert.equal(first.status, 200);
  const full = await first.json();
  assert.equal(full.entry.id, id);
  const again = await worker.fetch(req(`/membership/community/updates?id=${id}&v=${full.version}`, { cookie: c }), env, ctx);
  assert.deepEqual(await again.json(), { ok: true, unchanged: true, version: full.version });
  assert.equal(ns.seen.at(-1).viewer.superadmin, false);

  // A ban lands at the next request, cache or no cache.
  env.SIGNUP_KV.map.set('overrides:mirror', JSON.stringify(mirror({ bans: [{ github_id: PRIYA.githubId }] })));
  const after = await worker.fetch(req(`/membership/community/updates?id=${id}&v=0`, { cookie: c }), env, ctx);
  assert.equal(after.status, 403);
});

test('with no remembered check the cheap gate runs the full one, which then remembers it for ten minutes', async () => {
  const { env, store, kv } = setup();
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Show your desk' }, { open: true });
  const calls = [];
  const deps = { paid: paidGate([PRIYA.githubId], calls) };
  // The cheap gate resolves identity first; here the identity comes from a stand-in so the full gate's stand-in agrees.
  deps.resolve = async () => ({ ok: true, githubId: PRIYA.githubId, login: PRIYA.login, via: 'cookie' });
  const r = await handleCommunity(hreq(`/membership/community/updates?id=${id}&v=0`, PRIYA), env, route('/membership/community/updates', 'GET'), deps);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1, 'the full check ran');
  const put = kv.puts.find((p) => p.key === communityOkKey(PRIYA.githubId));
  assert.equal(put.opts.expirationTtl, COMMUNITY_OK_TTL);
  assert.equal(COMMUNITY_OK_TTL, 600);
  await handleCommunity(hreq(`/membership/community/updates?id=${id}&v=0`, PRIYA), env, route('/membership/community/updates', 'GET'), deps);
  assert.equal(calls.length, 1, 'the second poll used the remembered check');
  assert.equal(kv.puts.filter((p) => p.key === communityOkKey(PRIYA.githubId)).length, 1, 'remembered once, not rewritten per call');
  for (let i = 0; i < 3; i++) await handleCommunity(hreq(`/membership/community/entry?id=${id}`, PRIYA), env, route('/membership/community/entry', 'GET'), deps);
  assert.equal(calls.length, 4, 'a first load always takes the full check');
  assert.equal(kv.puts.filter((p) => p.key === communityOkKey(PRIYA.githubId)).length, 1, 'and still does not rewrite a check that is remembered');
});

test('a member who is not paid is refused by the cheap gate too, once nothing is remembered', async () => {
  const { env, store } = setup();
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Desks' }, { open: true });
  const deps = { paid: paidGate([]), resolve: async () => ({ ok: true, githubId: BEN.githubId, login: BEN.login }) };
  const r = await handleCommunity(hreq(`/membership/community/image?id=${id}&img=abcdefghjkmnpqrs`, BEN), env, route('/membership/community/image', 'GET'), deps);
  assert.equal(r.status, 403);
  assert.equal(env.SIGNUP_KV.puts.length, 0, 'a refusal is never remembered');
});

// ---- access, through the routes --------------------------------------------------------------------------------

test('an entry the member is not on answers exactly like an entry that does not exist', async () => {
  const { env, store } = setup();
  const priv = store.createEntry(SUPER, { kind: 'topic', title: 'Hangout', access: { mode: 'chosen', members: [PRIYA.githubId] } }, { open: true }).id;
  const draft = store.createEntry(SUPER, { kind: 'topic', title: 'Not yet' }).id;
  const deps = { paid: paidGate([PRIYA.githubId, BEN.githubId, SUPER.githubId]) };
  const get = (id, who) => handleCommunity(hreq(`/membership/community/entry?id=${id}`, who), env, route('/membership/community/entry', 'GET'), deps);
  const missing = await get('abcdefghjkmnpqrs', BEN);
  const hidden = await get(priv, BEN);
  const notYet = await get(draft, BEN);
  assert.equal(missing.status, 404);
  assert.deepEqual(hidden, missing, 'same status and the same body: a private entry names nothing');
  assert.deepEqual(notYet, missing);
  assert.equal((await get(priv, PRIYA)).status, 200);
  const superView = await get(draft, SUPER);
  assert.equal(superView.status, 200);
  assert.equal(superView.body.entry.status, 'draft');
  const list = await handleCommunity(hreq('/membership/community/entries', BEN), env, route('/membership/community/entries', 'GET'), deps);
  assert.deepEqual(list.body.entries.map((e) => e.id), [], 'Ben meets neither');
});

test('answers, posts and reactions go through, and the viewer is never read from the body', async () => {
  const { env, store, ns } = setup();
  const { id } = store.createEntry(SUPER, { kind: 'poll', title: 'Which topic next?', options: ['Agents', 'Testing'] }, { open: true });
  const deps = { paid: paidGate([PRIYA.githubId]) };
  const post = (path, body) => handleCommunity(hreq(path, PRIYA, { method: 'POST', body }), env, route(path, 'POST'), deps);
  assert.equal((await post('/membership/community/answer', { id, choice: 1, viewer: SUPER, githubId: SUPER.githubId })).status, 200);
  assert.equal(ns.seen.at(-1).viewer.githubId, PRIYA.githubId);
  assert.equal(ns.seen.at(-1).viewer.superadmin, false);
  const p = await post('/membership/community/post', { id, body: 'Testing, because our suite is slow.' });
  assert.equal(p.status, 200);
  const postId = p.body.id;
  assert.equal((await post('/membership/community/react', { id, postId, name: 'heart' })).status, 200);
  assert.equal((await post('/membership/community/react', { id, postId, name: '<script>' })).status, 400);
  assert.equal((await post('/membership/community/post-edit', { id, postId, body: 'Testing. Our suite takes nine minutes.' })).status, 200);
  const view = store.getEntry(SUPER, id);
  assert.equal(view.discussion.posts[0].body, 'Testing. Our suite takes nine minutes.');
  assert.equal(view.results.total, 1);
  assert.equal((await post('/membership/community/post-delete', { id, postId })).status, 200);
  const bad = await handleCommunity(new Request('https://signup.gbti.network/membership/community/post', { method: 'POST', headers: as(PRIYA), body: 'not json' }), env, route('/membership/community/post', 'POST'), deps);
  assert.equal(bad.status, 400);
  const huge = await post('/membership/community/post', { id, body: 'x'.repeat(70 * 1024) });
  assert.equal(huge.status, 413);
});

// ---- images ----------------------------------------------------------------------------------------------------

test('an image is uploaded, judged by its bytes, and read back privately with safe headers', async () => {
  const { env, store } = setup({ kvSeed: { [communityOkKey(PRIYA.githubId)]: '1' } });
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Show your desk' }, { open: true });
  const deps = { paid: paidGate([PRIYA.githubId]) };
  const up = await handleCommunity(hreq('/membership/community/image', PRIYA, { method: 'POST', body: { id, name: 'desk.png', dataBase64: toB64(PNG) } }), env, route('/membership/community/image', 'POST'), deps);
  assert.equal(up.status, 200);
  const img = up.body.id;
  const svg = await handleCommunity(hreq('/membership/community/image', PRIYA, { method: 'POST', body: { id, name: 'evil.png', dataBase64: toB64(new TextEncoder().encode('<svg onload=alert(1)>')) } }), env, route('/membership/community/image', 'POST'), deps);
  assert.equal(svg.status, 400);
  const big = await handleCommunity(hreq('/membership/community/image', PRIYA, { method: 'POST', body: { id, name: 'big.png', dataBase64: 'A'.repeat(2_000_000) } }), env, route('/membership/community/image', 'POST'), deps);
  assert.equal(big.status, 413);

  // Read it back through the real router and the real cheap gate.
  const res = await worker.fetch(req(`/membership/community/image?id=${id}&img=${img}`, { cookie: await cookie(PRIYA) }), env, ctx);
  assert.equal(res.status, 200);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...PNG]);
  for (const [k, v] of Object.entries(imageHeaders('image/png'))) assert.equal(res.headers.get(k), v, k);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(res.headers.get('Cache-Control'), /^private/);

  // A staged image belongs to its uploader until it is posted.
  const benReq = await worker.fetch(req(`/membership/community/image?id=${id}&img=${img}`, { cookie: await cookie(BEN) }), { ...env, SIGNUP_KV: fakeKv({ 'overrides:mirror': mirror(), [communityOkKey(BEN.githubId)]: '1' }) }, ctx);
  assert.equal(benReq.status, 404);
});

// ---- the object ------------------------------------------------------------------------------------------------

test('the object judges an image by its bytes again before storing it', async () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Desks' }, { open: true });
  const svg = runOp(store, { op: 'putImage', viewer: PRIYA, args: { id, name: 'x.png' } }, new TextEncoder().encode('<svg onload=alert(1)>'));
  assert.equal(svg.status, 400);
  const none = runOp(store, { op: 'putImage', viewer: PRIYA, args: { id, name: 'x.png' } }, null);
  assert.equal(none.status, 400);
  const big = new Uint8Array(2 * 1024 * 1024);
  big.set(PNG);
  assert.equal(runOp(store, { op: 'putImage', viewer: PRIYA, args: { id, name: 'x.png' } }, big).status, 400);
  const ok = runOp(store, { op: 'putImage', viewer: PRIYA, args: { id, name: 'x.png', contentType: 'text/html' } }, PNG);
  assert.equal(ok.status, 200);
  const back = runOp(store, { op: 'image', viewer: PRIYA, args: { id, img: (await ok.json()).id } }, null);
  assert.equal(back.headers.get('Content-Type'), 'image/png', 'the stored type is the sniffed one, never the one sent');
});

test('the frame carries a message and raw bytes intact, and a broken frame is refused', () => {
  const bytes = new Uint8Array([0, 255, 1, 2, 3, 0]);
  const out = decodeRpc(encodeRpc({ op: 'putImage', args: { name: 'Café desk.png' } }, bytes));
  assert.deepEqual(out.msg, { op: 'putImage', args: { name: 'Café desk.png' } });
  assert.deepEqual([...out.bytes], [...bytes]);
  assert.equal(decodeRpc(encodeRpc({ op: 'list' })).bytes, null);
  assert.throws(() => decodeRpc(new Uint8Array([0, 0, 0, 99, 1])));
  assert.throws(() => decodeRpc(new Uint8Array([1])));
});

test('the Durable Object adapter binds bytes as an ArrayBuffer and reads rows with toArray', () => {
  const calls = [];
  const sql = { exec: (q, ...b) => { calls.push(b); return { toArray: () => [{ x: 1 }] }; } };
  const rows = doSqlAdapter(sql).exec('SELECT ?', new Uint8Array([7, 8]).subarray(1), 'a', 2, null);
  assert.deepEqual(rows, [{ x: 1 }]);
  assert.ok(calls[0][0] instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(calls[0][0])], [8], 'only the viewed bytes, not the whole backing buffer');
  assert.deepEqual(calls[0].slice(1), ['a', 2, null]);
});

test('the object refuses unknown ops, superadmin ops from a member, and runs every op inside one transaction', async () => {
  const { store } = makeStore();
  const r1 = runOp(store, { op: 'migrate', viewer: SUPER, args: {} }, null);
  assert.equal(r1.status, 400, 'only the op table, never an arbitrary store method');
  const r2 = runOp(store, { op: 'erase', viewer: PRIYA, args: { githubId: BEN.githubId } }, null);
  assert.equal(r2.status, 403);
  const r3 = runOp(store, { op: 'list', args: {} }, null);
  assert.equal(r3.status, 401);
  let n = 0;
  const r4 = runOp(store, { op: 'create', viewer: SUPER, args: { input: { kind: 'topic', title: 'x' } } }, null, { transact: (fn) => { n++; return fn(); } });
  assert.equal(r4.status, 200);
  assert.equal(n, 1);
  const r5 = runOp(store, { op: 'get', viewer: PRIYA, args: { id: 'abcdefghjkmnpqrs' } }, null);
  assert.equal(r5.status, 404);
  assert.deepEqual(await r5.json(), { ok: false, error: 'not_found', message: 'That entry was not found.' });
  const r6 = runOp(store, { op: 'list', viewer: SUPER, args: {} }, null, { transact: () => { throw new Error('disk on fire'); }, log: () => {} });
  assert.equal(r6.status, 500);
  assert.doesNotMatch(await r6.text(), /disk on fire/, 'an internal error never reaches the caller');
  for (const name of Object.keys(OPS)) assert.ok(['read', 'write', 'upload', 'bytes', 'admin'].includes(OPS[name].kind), name);
});

test('writes are limited per member inside the object, and superadmins are not', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, { kind: 'poll', title: 'Q', options: ['a', 'b'] }, { open: true });
  const limiter = new WriteLimiter();
  let t = 0;
  const answer = (who) => runOp(store, { op: 'answer', viewer: who, args: { id, input: { choice: 0 } } }, null, { limiter, now: () => t });
  for (let i = 0; i < WRITE_LIMITS.write.limit; i++) assert.equal(answer(PRIYA).status, 200, `write ${i + 1}`);
  assert.equal(answer(PRIYA).status, 429);
  assert.equal(answer(BEN).status, 200, 'one member hitting the limit does not limit another');
  for (let i = 0; i < 60; i++) assert.equal(answer(SUPER).status, 200);
  t += WRITE_LIMITS.write.windowMs;
  assert.equal(answer(PRIYA).status, 200, 'the window moves on');
  const reads = Array.from({ length: 100 }, () => runOp(store, { op: 'get', viewer: PRIYA, args: { id } }, null, { limiter, now: () => t }).status);
  assert.ok(reads.every((s) => s === 200), 'reads are never limited');
});

// ---- superadmin ops --------------------------------------------------------------------------------------------

test('every superadmin op maps onto one store call, and an unknown one is refused', () => {
  for (const op of ['open', 'close', 'publish', 'unpublish', 'lock', 'unlock', 'delete']) assert.deepEqual(adminCall({ op, id: 'x' }), { op: 'status', args: { id: 'x', action: op } });
  assert.equal(adminCall({ op: 'create', input: { a: 1 }, open: 'yes' }).args.open, false, 'only true opens');
  assert.equal(adminCall({ op: 'erase-member', githubId: 5 }).args.githubId, '5');
  assert.equal(adminCall({ op: 'tidy', id: 'x', action: 'merge', norm: 'a', into: 'b' }).args.tidy.into, 'b');
  assert.equal(adminCall({ op: 'migrate' }), null);
  assert.equal(adminCall({}), null);
});

test('the superadmin route runs the meeting: open, tidy, publish and erase', async () => {
  const { env, store } = setup();
  const superadmin = async () => ({ ok: true, viewer: SUPER });
  const admin = (body) => membershipAdminCommunity(hreq('/membership/admin/community', SUPER, { method: 'POST', body }), env, { superadmin });
  const created = await admin({ op: 'create', input: { kind: 'typed', title: 'Movie?' } });
  const id = created.body.id;
  assert.equal((await admin({ op: 'open', id })).status, 200);
  store.answer(PRIYA, id, { text: 'Project Hail Mary' });
  store.answer(BEN, id, { text: 'Hail Mary' });
  const merged = await admin({ op: 'tidy', id, action: 'merge', norm: 'hail mary', into: 'project hail mary' });
  assert.equal(merged.status, 200);
  assert.equal((await admin({ op: 'publish', id })).status, 409, 'voting closes before results publish');
  assert.equal((await admin({ op: 'close', id })).status, 200);
  assert.equal((await admin({ op: 'publish', id })).status, 200);
  assert.equal(store.getEntry(PRIYA, id).results.groups[0].count, 2);
  const erased = await admin({ op: 'erase-member', githubId: BEN.githubId });
  assert.equal(erased.status, 200);
  assert.equal(erased.body.answers, 1);
  assert.equal((await admin({ op: 'nonsense', id })).status, 400);
  const refused = await membershipAdminCommunity(hreq('/membership/admin/community', PRIYA, { method: 'POST', body: { op: 'delete', id } }), env, { superadmin: async () => ({ ok: false, status: 403, body: { error: 'forbidden' } }) });
  assert.equal(refused.status, 403);
});

test('the member picker lists every member folder by name, and an unreadable index says so', async () => {
  const superadmin = async () => ({ ok: true, viewer: SUPER });
  const ok = await membershipAdminCommunityMembers(hreq('/x', SUPER), {}, { superadmin, readIndex: async () => new Map([['2002', 'ben'], ['2001', 'priya'], ['3', 'atwellpub']]) });
  assert.deepEqual(ok.body.members.map((m) => m.username), ['atwellpub', 'ben', 'priya']);
  assert.deepEqual(ok.body.members[0], { githubId: '3', username: 'atwellpub' });
  const down = await membershipAdminCommunityMembers(hreq('/x', SUPER), {}, { superadmin, readIndex: async () => { throw new Error('502'); } });
  assert.equal(down.status, 502);
  const no = await membershipAdminCommunityMembers(hreq('/x', PRIYA), {}, { superadmin: async () => ({ ok: false, status: 403, body: {} }), readIndex: async () => new Map() });
  assert.equal(no.status, 403);
});

test('a missing binding answers 503, never a crash', async () => {
  const { env, store } = setup();
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'x' }, { open: true });
  const r = await handleCommunity(hreq(`/membership/community/entry?id=${id}`, PRIYA), { ...env, COMMUNITY: undefined }, route('/membership/community/entry', 'GET'), { paid: paidGate([PRIYA.githubId]) });
  assert.equal(r.status, 503);
});

// ---- wiring ----------------------------------------------------------------------------------------------------

test('the Worker exports the object by the name wrangler binds, in both environments, with one migration', () => {
  assert.equal(typeof worker.fetch, 'function');
  const index = fs.readFileSync(new URL('../workers/signup/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /export \{ CommunityDO \} from '\.\/community-do\.mjs';/);
  const toml = fs.readFileSync(new URL('../workers/signup/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[\[durable_objects\.bindings\]\]\nname = "COMMUNITY"\nclass_name = "CommunityDO"/);
  assert.match(toml, /\[\[env\.production\.durable_objects\.bindings\]\]\nname = "COMMUNITY"\nclass_name = "CommunityDO"/);
  assert.match(toml, /\[\[migrations\]\]\ntag = "community-v1"\nnew_sqlite_classes = \["CommunityDO"\]/);
  assert.equal((toml.match(/new_sqlite_classes/g) || []).length, 1, 'declared once: migrations are inherited by environments');
  const routes = fs.readFileSync(new URL('../workers/signup/member-routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /Object\.prototype\.hasOwnProperty\.call\(COMMUNITY_ROUTES, pathname\)/, 'a path like /membership/community/constructor cannot reach a prototype key');
});

test('a first call that fails inside its transaction does not leave the store without its tables', () => {
  // Production's object wraps every op in transactionSync, which ROLLS BACK on a throw, including the table creation
  // the first op ran. The very first live call was a lookup of a missing id: tables made, not_found thrown, tables
  // rolled back, and every later call failed on a missing table. Reproduce it with a real BEGIN/ROLLBACK.
  const { store } = makeStore();
  const db = store.sql.db;
  const transact = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const first = runOp(store, { op: 'get', viewer: SUPER, args: { id: 'abcdefghjkmnpqrs' } }, null, { transact });
  assert.equal(first.status, 404);
  const list = runOp(store, { op: 'list', viewer: SUPER, args: {} }, null, { transact });
  assert.equal(list.status, 200, 'the next call still finds its tables');
  const made = runOp(store, { op: 'create', viewer: SUPER, args: { input: { kind: 'topic', title: 'After a failed first call' } } }, null, { transact });
  assert.equal(made.status, 200);
});

test('the Durable Object class itself: start-up creates the tables, and a failing first call cannot undo them', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { CommunityDO } = await import('../workers/signup/community-do.mjs');
  const db = new DatabaseSync(':memory:');
  // The parts of ctx.storage the object uses: sql.exec(...).toArray() (BLOBs as ArrayBuffer), and transactionSync,
  // which rolls back on a throw exactly as the platform's does.
  const sql = { exec: (q, ...b) => ({ toArray: () => db.prepare(q).all(...b.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))).map((r) => ({ ...r })) }) };
  const storage = { sql, transactionSync: (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  let started = 0;
  const ctx = { storage, blockConcurrencyWhile: (fn) => { started++; return fn(); } };
  const obj = new CommunityDO(ctx, {});
  assert.equal(started, 1);
  const send = (msg, bytes) => obj.fetch(new Request('https://community.internal/rpc', { method: 'POST', body: encodeRpc(msg, bytes) }));
  assert.equal((await send({ op: 'get', viewer: SUPER, args: { id: 'abcdefghjkmnpqrs' } })).status, 404);
  assert.equal((await send({ op: 'list', viewer: SUPER, args: {} })).status, 200);
  const made = await (await send({ op: 'create', viewer: SUPER, args: { input: { kind: 'topic', title: 'Desks' }, open: true } })).json();
  const up = await send({ op: 'putImage', viewer: PRIYA, args: { id: made.id, name: 'desk.png' } }, PNG);
  assert.equal(up.status, 200);
  const img = await send({ op: 'image', viewer: PRIYA, args: { id: made.id, img: (await up.json()).id } });
  assert.deepEqual([...new Uint8Array(await img.arrayBuffer())], [...PNG], 'bytes survive the ArrayBuffer round trip');
  assert.equal((await obj.fetch(new Request('https://community.internal/rpc', { method: 'GET' }))).status, 405);
  assert.equal((await obj.fetch(new Request('https://community.internal/rpc', { method: 'POST', body: new Uint8Array([1]) }))).status, 400);
});

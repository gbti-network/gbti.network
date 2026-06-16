// On-demand Discord invite endpoint (GET /membership/discord-invite): pure cache logic + the handler's
// auth-fail-closed, cache-reuse, fresh-mint, and static-fallback behavior. No network (injected fetch/discord/kv).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleDiscordInvite, shouldReuseInvite, inviteUrlFromCode, INVITE_KV_KEY } from '../workers/signup/discord-invite.mjs';
import { getDiscordInvite as clientGetDiscordInvite, InviteClientError } from '../client/src/member-invite-client.mjs';
import { getDiscordInvite as opGetDiscordInvite, OperationError } from '../client/src/operations.mjs';

const NOW = 1_000_000_000_000;
const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : null) } });
const okUser = async () => ({ githubId: '42', githubLogin: 'alice' });
// A KV stub backed by a Map.
function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { store: m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}

test('shouldReuseInvite: reuse a fresh, well-formed cache; mint otherwise', () => {
  assert.equal(shouldReuseInvite({ url: 'https://discord.gg/x', expiresAt: NOW + 5 * 86400_000 }, NOW), true);
  assert.equal(shouldReuseInvite({ url: 'https://discord.gg/x', expiresAt: NOW + 1000 }, NOW), false); // within the margin
  assert.equal(shouldReuseInvite({ url: 'https://discord.gg/x', expiresAt: 'nope' }, NOW), false);
  assert.equal(shouldReuseInvite({ url: '', expiresAt: NOW + 999999999 }, NOW), false);
  assert.equal(shouldReuseInvite(null, NOW), false);
});

test('inviteUrlFromCode', () => {
  assert.equal(inviteUrlFromCode('abc'), 'https://discord.gg/abc');
  assert.equal(inviteUrlFromCode(''), null);
});

test('handler: missing/invalid token -> 401 (fail-closed)', async () => {
  const r1 = await handleDiscordInvite(req(null), {}, { fetchUser: okUser });
  assert.equal(r1.status, 401);
  const r2 = await handleDiscordInvite(req('bad'), {}, { fetchUser: async () => { throw new Error('bad token'); } });
  assert.equal(r2.status, 401);
});

test('handler: reuses a fresh cached invite without minting', async () => {
  const kv = fakeKv({ [INVITE_KV_KEY]: JSON.stringify({ url: 'https://discord.gg/cached', expiresAt: NOW + 5 * 86400_000 }) });
  let minted = false;
  const discord = { createInvite: async () => { minted = true; return { code: 'new', url: 'https://discord.gg/new' }; } };
  const r = await handleDiscordInvite(req('t'), { DISCORD_INVITE_CHANNEL_ID: 'c1' }, { fetchUser: okUser, discord, kv, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://discord.gg/cached');
  assert.equal(r.body.source, 'cache');
  assert.equal(minted, false, 'a fresh cache must not mint a new invite');
});

test('handler: mints + caches a fresh invite when the cache is empty', async () => {
  const kv = fakeKv();
  const discord = { createInvite: async (chan, opts) => { assert.equal(chan, 'c1'); assert.equal(opts.maxUses, 0); return { code: 'fresh1', url: 'https://discord.gg/fresh1' }; } };
  const r = await handleDiscordInvite(req('t'), { DISCORD_INVITE_CHANNEL_ID: 'c1' }, { fetchUser: okUser, discord, kv, now: NOW, ttlSeconds: 604800 });
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://discord.gg/fresh1');
  assert.equal(r.body.source, 'fresh');
  const cached = JSON.parse(kv.store.get(INVITE_KV_KEY));
  assert.equal(cached.url, 'https://discord.gg/fresh1');
  assert.equal(cached.expiresAt, NOW + 604800 * 1000);
});

test('handler: falls back to the static DISCORD_INVITE_URL when minting fails or no channel', async () => {
  const env = { DISCORD_INVITE_URL: 'https://discord.gg/vanity' };
  // no channel/discord configured
  const r1 = await handleDiscordInvite(req('t'), env, { fetchUser: okUser, kv: fakeKv(), now: NOW });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.url, 'https://discord.gg/vanity');
  assert.equal(r1.body.source, 'static');
  // mint throws -> static fallback
  const discord = { createInvite: async () => { throw new Error('discord 403'); } };
  const r2 = await handleDiscordInvite(req('t'), { ...env, DISCORD_INVITE_CHANNEL_ID: 'c1' }, { fetchUser: okUser, discord, kv: fakeKv(), now: NOW });
  assert.equal(r2.body.url, 'https://discord.gg/vanity');
  assert.equal(r2.body.source, 'static');
});

test('handler: 502 when neither a mint nor a static fallback is available', async () => {
  const r = await handleDiscordInvite(req('t'), {}, { fetchUser: okUser, kv: fakeKv(), now: NOW });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'invite_unavailable');
});

// ---- client side: the fetch wrapper + the operation ----

test('client member-invite-client: sends the bearer, returns the body; not-signed-in without a token', async () => {
  let seen = null;
  const fetch = async (url, init) => { seen = { url, auth: init.headers.Authorization }; return { ok: true, status: 200, json: async () => ({ ok: true, url: 'https://discord.gg/x', source: 'fresh' }) }; };
  const r = await clientGetDiscordInvite({ token: 'tok', signupBase: 'https://signup.gbti.network/', fetch });
  assert.equal(r.url, 'https://discord.gg/x');
  assert.match(seen.url, /\/membership\/discord-invite$/);
  assert.equal(seen.auth, 'Bearer tok');
  await assert.rejects(() => clientGetDiscordInvite({ token: '', signupBase: 'x', fetch }), (e) => e instanceof InviteClientError);
});

test('op getDiscordInvite: requires identity, returns { url, source }, maps errors', async () => {
  await assert.rejects(() => opGetDiscordInvite({ identity: () => null }), (e) => e instanceof OperationError && e.code === 'no-identity');
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, url: 'https://discord.gg/y', source: 'cache' }) });
  const ctx = { identity: () => ({ username: 'alice' }), store: { get: () => 'tok' }, fetch };
  assert.deepEqual(await opGetDiscordInvite(ctx), { url: 'https://discord.gg/y', source: 'cache' });
  const failCtx = { identity: () => ({ username: 'alice' }), store: { get: () => 'tok' }, fetch: async () => ({ ok: false, status: 502, json: async () => ({ error: 'invite_unavailable' }) }) };
  await assert.rejects(() => opGetDiscordInvite(failCtx), (e) => e instanceof OperationError && e.code === 'invite-failed');
});

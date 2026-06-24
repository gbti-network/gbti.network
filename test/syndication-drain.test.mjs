// SOW-058: the cron drain. Fake KV + fake adapters; injected now. Hold enforcement, per-channel idempotency,
// cancel-vs-drain, retry-then-fail, skip-on-missing-secret. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, getItem, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const at = (t) => () => t;
const AFTER_HOLD = 4 * 60 * 60_000;
// The mechanics tests below exercise the legacy auto-hold path (require_approval:false); the approval-model gate
// (the default) is covered by the dedicated block at the end.
const cfg = (channels) => JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels } });
const env = (extra = {}) => ({ DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'c', ...extra });

function discordOk(calls) {
  return { discord: { name: 'discord', enabled: () => true, post: async (i) => { calls.push(i.id); return { ok: true, id: 'm1', url: 'u' }; } } };
}

test('drain posts a due item to the ready channel and marks it sent', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(out.drained, 1);
  assert.equal(calls.length, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.status, 'sent');
  assert.equal(item.perChannel.discord.status, 'sent');
});

test('drain respects the hold (a not-yet-due item is not posted)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(1000), adapters: discordOk(calls) });
  assert.equal(out.drained, 0);
  assert.equal(calls.length, 0);
});

test('drain is disabled when the config master switch is off', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: false, channels: { discord: true } } }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x' }, { kv, now: at(0), cfg: { enabled: true, hold_minutes: 60 } });
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk([]) });
  assert.equal(out.reason, 'disabled');
});

test('drain honors a cancel landing before the tick (cancelled item is skipped)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  // simulate a cancel: flip the stored item to cancelled
  const stored = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...stored, status: 'cancelled' }));
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(calls.length, 0);
  assert.equal(out.drained, 0);
});

test('drain never re-posts a channel already marked sent (per-channel idempotency)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  const stored = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...stored, perChannel: { discord: { status: 'sent', id: 'old' } } }));
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(calls.length, 0, 'discord not called again');
  assert.equal((await getItem(kv, r.id)).status, 'sent');
});

test('drain retries a failed channel, then marks failed after maxAttempts', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  const failing = { discord: { name: 'discord', enabled: () => true, post: async () => ({ ok: false, error: '500' }) } };
  // attempt 1: stays pending for retry
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: failing, maxAttempts: 2 });
  let item = await getItem(kv, r.id);
  assert.equal(item.status, 'pending');
  assert.equal(item.attempts, 1);
  assert.equal(item.claimedAt, null); // claim cleared so it can be retried
  // attempt 2: reaches the cap -> failed
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: failing, maxAttempts: 2 });
  item = await getItem(kv, r.id);
  assert.equal(item.status, 'failed');
});

test('a config-enabled channel with no secret is recorded skipped, not failed', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true, x: true }) }); // x enabled but no X secrets in env
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk([]) });
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.x.status, 'skipped');
  assert.equal(item.status, 'sent'); // discord sent, x skipped -> no failure
});

// SOW-058 approval model (the DEFAULT): nothing posts until a superadmin approves it.
const cfgApproval = (channels) => JSON.stringify({ syndication: { enabled: true, channels } }); // require_approval defaults true

test('with approval required (the default), a PENDING item is NEVER posted, even past the hold', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfgApproval({ discord: true }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(calls.length, 0, 'an unapproved item must never reach a brand channel');
  assert.equal(out.drained, 0);
});

test('an APPROVED item IS posted on the next drain tick', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfgApproval({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const stored = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...stored, status: 'approved', approvedAt: 1 }));
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(out.drained, 1);
  assert.equal(calls.length, 1);
  assert.equal((await getItem(kv, r.id)).status, 'sent');
});

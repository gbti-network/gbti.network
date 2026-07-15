// SOW-121: the Social Queue KV store + the drain/manual manual-assist enqueue. Fake KV, injected now; no
// network. Verifies a manual-assist channel NEVER posts (no adapter call) and instead enqueues a task, and
// that the manual Publish path enqueues too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putTask, getTask, listTasks, deleteTask, SOCIAL_TASK_KEY } from '../workers/signup/social-queue-store.mjs';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, getItem, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';
import { handleSyndicateNow } from '../workers/signup/membership-syndicate-now.mjs';
import { handleSocialQueueGet, handleSocialQueueAction } from '../workers/signup/social-queue-admin.mjs';

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

test('store: put/get/list/delete round-trips a task', async () => {
  const kv = fakeKV();
  await putTask(kv, { id: 'a::x', channel: 'x', status: 'pending', text: 'hi' });
  await putTask(kv, { id: 'b::x', channel: 'x', status: 'done', text: 'yo' });
  assert.equal((await getTask(kv, 'a::x')).text, 'hi');
  assert.ok(kv.store.has(SOCIAL_TASK_KEY('a::x')));
  const all = await listTasks(kv);
  assert.equal(all.length, 2);
  await deleteTask(kv, 'a::x');
  assert.equal(await getTask(kv, 'a::x'), null);
  assert.equal((await listTasks(kv)).length, 1);
});

test('drain: a manual-assist channel enqueues a task and NEVER calls an adapter', async () => {
  const cfg = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels: { discord: false }, manual_assist_channels: ['x'] } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'alice/hello', title: 'Hello World', url: 'https://gbti.network/articles/hello/', visibility: 'public' }, { kv, now: at(0) });
  // An adapter set that would THROW if X were ever posted (it must not be).
  const adapters = { x: { name: 'x', enabled: () => true, post: async () => { throw new Error('X must not be posted on the manual-assist path'); } } };
  const out = await drainSyndication({}, { kv, now: at(AFTER_HOLD), adapters });
  assert.equal(out.drained, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.status, 'sent'); // terminalized (the drain did its job)
  assert.equal(item.perChannel.x.status, 'queued-manual');
  const tasks = await listTasks(kv);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].channel, 'x');
  assert.equal(tasks[0].status, 'pending');
  assert.equal(tasks[0].trigger, 'auto');
  assert.ok(tasks[0].text.includes('Hello World') && tasks[0].text.includes('https://gbti.network/articles/hello/'));
});

test('drain: does not re-task a channel already queued-manual on a prior tick', async () => {
  const cfg = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels: {}, manual_assist_channels: ['x'] } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/b', title: 'T', url: 'https://e.com/x', visibility: 'public' }, { kv, now: at(0) });
  await drainSyndication({}, { kv, now: at(AFTER_HOLD), adapters: {} });
  const first = (await listTasks(kv)).length;
  // A second drain over the (now terminal) item is a no-op; the task count stays 1.
  await drainSyndication({}, { kv, now: at(AFTER_HOLD + 1000), adapters: {} });
  assert.equal(first, 1);
  assert.equal((await listTasks(kv)).length, 1);
});

test('manual Publish: a manual-assist destination enqueues a task instead of posting', async () => {
  const cfg = JSON.stringify({ syndication: { enabled: true, manual_assist_channels: ['x'] } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  const payload = { destination: 'x', template: 'New {content-type}: "{title}" {url}', item: { source: 'post', targetSlug: 'alice/hello', title: 'Hello', url: 'https://gbti.network/articles/hello/', visibility: 'public', author: 'alice' } };
  const req = new Request('https://x/', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
  const authorize = async () => ({ ok: true, role: 'superadmin', githubId: '1' });
  const res = await handleSyndicateNow(req, { SIGNUP_KV: kv }, { kv, now: at(1000), authorize });
  assert.equal(res.status, 200);
  assert.equal(res.body.queued, true);
  const tasks = await listTasks(kv);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].trigger, 'manual');
  assert.ok(tasks[0].text.includes('Hello'));
});

const superAuth = async () => ({ ok: true, role: 'superadmin', githubId: '1' });
const req = (body) => new Request('https://x/', body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {});

test('endpoint GET: superadmin gets pending+done; others denied', async () => {
  const kv = fakeKV();
  await putTask(kv, { id: 'a::x', channel: 'x', status: 'pending', text: 't', createdAt: 2 });
  await putTask(kv, { id: 'b::x', channel: 'x', status: 'done', text: 't', doneAt: 5 });
  const r = await handleSocialQueueGet(req(), { SIGNUP_KV: kv }, { kv, authorize: superAuth });
  assert.equal(r.status, 200);
  assert.equal(r.body.pending.length, 1);
  assert.equal(r.body.done.length, 1);
  assert.equal((await handleSocialQueueGet(req(), { SIGNUP_KV: kv }, { kv, authorize: async () => ({ ok: true, role: 'admin' }) })).status, 403);
  assert.equal((await handleSocialQueueGet(req(), { SIGNUP_KV: kv }, { kv, authorize: async () => ({ ok: false, status: 401, body: {} }) })).status, 401);
});

test('endpoint POST: done stamps + delete removes; superadmin only', async () => {
  const kv = fakeKV();
  await putTask(kv, { id: 'a::x', channel: 'x', status: 'pending', text: 't' });
  const done = await handleSocialQueueAction(req({ action: 'done', id: 'a::x' }), { SIGNUP_KV: kv }, { kv, now: at(77), authorize: superAuth });
  assert.equal(done.status, 200);
  assert.equal((await getTask(kv, 'a::x')).status, 'done');
  assert.equal((await getTask(kv, 'a::x')).doneAt, 77);
  const del = await handleSocialQueueAction(req({ action: 'delete', id: 'a::x' }), { SIGNUP_KV: kv }, { kv, authorize: superAuth });
  assert.equal(del.body.removed, true);
  assert.equal(await getTask(kv, 'a::x'), null);
  assert.equal((await handleSocialQueueAction(req({ action: 'done', id: 'z' }), { SIGNUP_KV: kv }, { kv, authorize: async () => ({ ok: true, role: 'moderator' }) })).status, 403);
  assert.equal((await handleSocialQueueAction(req({ action: 'bogus', id: 'a::x' }), { SIGNUP_KV: kv }, { kv, authorize: superAuth })).status, 400);
});

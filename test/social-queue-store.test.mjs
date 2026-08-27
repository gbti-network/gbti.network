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
  const cfg = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels: { discord: false }, manual_assist_channels: ['x'], auto_matrix: { post: { linkedin: 'off', dailydev: 'off', hashnode: 'off', reddit: 'off' } } } });
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
  const cfg = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels: {}, manual_assist_channels: ['x'], auto_matrix: { post: { linkedin: 'off', dailydev: 'off', hashnode: 'off', reddit: 'off' } } } });
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

test('endpoint POST action=post: the adapter posts the reviewed text and the task completes', async () => {
  const kv = fakeKV();
  await putTask(kv, { id: 'a::bluesky', itemId: 'a', channel: 'bluesky', source: 'post', title: 'T', url: 'https://e.com/t',
    text: 'Reviewed text', item: { source: 'post', targetSlug: 'a/x', title: 'T', url: 'https://e.com/t' }, status: 'pending', createdAt: 1 });
  const calls = [];
  const adapters = { bluesky: { name: 'bluesky', enabled: () => true, post: async (i) => { calls.push(i); return { ok: true, id: 'p1', url: 'https://bsky.app/p1' }; } } };
  const res = await handleSocialQueueAction(req({ action: 'post', id: 'a::bluesky' }),
    { SIGNUP_KV: kv, BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' }, { kv, now: at(9), authorize: superAuth, adapters });
  assert.equal(res.status, 200);
  assert.equal(res.body.posted, true);
  assert.equal(res.body.postedUrl, 'https://bsky.app/p1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].textOverride, 'Reviewed text'); // the reviewed text is exactly what posts
  assert.equal(calls[0].targetSlug, 'a/x'); // the task's item snapshot feeds the adapter
  const done = await getTask(kv, 'a::bluesky');
  assert.equal(done.status, 'done');
  assert.equal(done.postedVia, 'adapter');
  assert.equal(done.postedUrl, 'https://bsky.app/p1');
});

test('endpoint POST action=post: manual-capability channels, missing secrets, and failures are refused', async () => {
  const kv = fakeKV();
  await putTask(kv, { id: 'a::x', channel: 'x', text: 't', status: 'pending', createdAt: 1 });
  await putTask(kv, { id: 'a::bluesky', channel: 'bluesky', text: 't', status: 'pending', createdAt: 1 });
  await putTask(kv, { id: 'b::bluesky', channel: 'bluesky', text: 't', status: 'done', doneAt: 2 });
  // x cannot post automatically, ever
  const rx = await handleSocialQueueAction(req({ action: 'post', id: 'a::x' }), { SIGNUP_KV: kv }, { kv, authorize: superAuth });
  assert.equal(rx.status, 400);
  // a missing secret is a clear not-configured answer, the task stays pending
  const rs = await handleSocialQueueAction(req({ action: 'post', id: 'a::bluesky' }), { SIGNUP_KV: kv }, { kv, authorize: superAuth });
  assert.equal(rs.status, 409);
  assert.equal((await getTask(kv, 'a::bluesky')).status, 'pending');
  // an adapter failure leaves the task pending and reports the error
  const failing = { bluesky: { name: 'bluesky', enabled: () => true, post: async () => ({ ok: false, error: 'boom' }) } };
  const rf = await handleSocialQueueAction(req({ action: 'post', id: 'a::bluesky' }),
    { SIGNUP_KV: kv, BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' }, { kv, authorize: superAuth, adapters: failing });
  assert.equal(rf.status, 502);
  assert.equal((await getTask(kv, 'a::bluesky')).status, 'pending');
  // a done task cannot re-post
  const rd = await handleSocialQueueAction(req({ action: 'post', id: 'b::bluesky' }),
    { SIGNUP_KV: kv, BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' }, { kv, authorize: superAuth });
  assert.equal(rd.status, 400);
});

// sow-260: Reddit lost its API. Reddit banned the posting account for self-promotion on 2026-08-25 and the ban
// destroyed the OAuth app the adapter authenticated as; self-service app creation has been closed since
// November 2025, so it cannot be recreated. Reddit is manual-assist now, like x/linkedin/dailydev.
//
// It is the FIRST manual channel whose submission is not one block of text: a Reddit post is a title, a url and
// a description under the link. This asserts all three reach the queue, because a task carrying only the title
// would send a superadmin to Reddit with nothing to paste and no way to know something was missing.
test('sow-260: reddit enqueues a manual task carrying the title AND the body, and never calls an adapter', async () => {
  const cfg = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    auto_matrix: { post: { discord: 'off', 'discord-category': 'off', bluesky: 'off', devto: 'off', x: 'off', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  const r = await enqueue({ SIGNUP_KV: kv }, {
    source: 'post', targetSlug: 'alice/hello', title: 'Hello World', url: 'https://gbti.network/articles/hello/',
    visibility: 'public', authorNote: 'I built this because the tooling kept losing my drafts.', blurb: 'A short description.',
  }, { kv, now: at(0) });
  // An adapter that THROWS if reddit is ever posted. A manual channel must reach zero API calls, and the whole
  // point of the change is that we no longer hold a credential that could make one.
  const adapters = { reddit: { name: 'reddit', enabled: () => true, post: async () => { throw new Error('reddit must not be posted through an adapter'); } } };
  const out = await drainSyndication({}, { kv, now: at(AFTER_HOLD), adapters });
  assert.equal(out.drained, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.reddit.status, 'queued-manual');
  const tasks = await listTasks(kv);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].channel, 'reddit');
  // The TITLE. A Reddit title cannot hold a line break (SOW-223), so assert the absence directly.
  assert.ok(tasks[0].text.includes('Hello World'), 'the task text is the post title');
  assert.ok(!tasks[0].text.includes('\n'), 'a reddit title can never contain a newline');
  // Reddit carries the link in its own url field. A title that ALSO contains the URL duplicates it in the
  // submission and eats the 300-char cap. This shipped once: routing the title through renderChannelText
  // inherited its generic '{title} {url}' fallback instead of the adapter's '{title}', and a live queue task
  // showed the URL glued onto the title. Assert the absence, not just the presence of the title.
  assert.ok(!tasks[0].text.includes('https://'), 'the url belongs in the url field, never in the title');
  assert.equal(tasks[0].url, 'https://gbti.network/articles/hello/', 'and it IS carried, separately');
  // The BODY, author note FIRST (sow-260: the note is the main content, the blurb rides with it).
  assert.ok(tasks[0].bodyText.includes('I built this because'), 'the author note is in the body');
  assert.ok(tasks[0].bodyText.includes('A short description.'), 'the short description rides with it');
  assert.ok(tasks[0].bodyText.indexOf('I built this') < tasks[0].bodyText.indexOf('A short description'),
    'the author note LEADS; it is the main content, not a footnote');
  // No recruitment CTA anywhere in what we hand the human to paste.
  assert.ok(!/gbti\.network\/members/.test(tasks[0].bodyText), 'no join-our-community CTA in the body');
});

// The note is optional (an article may have none), and sow-220 shipped after a note-less article posted a lone
// `""` to Reddit. The blurb must stand alone cleanly, with no dangling punctuation and no leading blank line.
test('sow-260/sow-220: a note-less item degrades to the description alone, with no empty-quote debris', async () => {
  const cfg = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    auto_matrix: { post: { discord: 'off', 'discord-category': 'off', bluesky: 'off', devto: 'off', x: 'off', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg });
  await enqueue({ SIGNUP_KV: kv }, {
    source: 'post', targetSlug: 'alice/no-note', title: 'No Note', url: 'https://gbti.network/articles/no-note/',
    visibility: 'public', blurb: 'Only a description.',
  }, { kv, now: at(0) });
  await drainSyndication({}, { kv, now: at(AFTER_HOLD), adapters: {} });
  const t = (await listTasks(kv))[0];
  assert.equal(t.bodyText, 'Only a description.', 'the blurb stands alone, trimmed, with nothing around it');
  assert.ok(!/["'']{2}/.test(t.bodyText), 'no empty quote pair, which is the sow-220 defect');
});

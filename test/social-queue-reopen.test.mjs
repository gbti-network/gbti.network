// 2026-10-23, owner: "I need to be able to revert manually done items (accidentally marked done)." A Social Queue
// task marked done by mistake goes back to To do with `reopen`. One that Post now actually sent stays done, because
// back in To do it could be posted twice. Pins the rule, the Worker route, the optimistic core and the panel.
// Fake KV, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTaskAction, canReopenTask, splitTasks } from '../membership/social-queue.mjs';
import { applyQueueAction, revertQueueAction } from '../client-ui/src/social-queue-core.mjs';
import { handleSocialQueueAction } from '../workers/signup/social-queue-admin.mjs';
import { SOCIAL_TASK_KEY } from '../workers/signup/social-queue-store.mjs';

const handDone = { id: 'jr::x', status: 'done', channel: 'x', title: 'Jockey Radio', createdAt: 200, doneAt: 900, doneBy: '1' };
const adapterDone = { id: 'jr::bluesky', status: 'done', channel: 'bluesky', title: 'Jockey Radio', createdAt: 200, doneAt: 950, doneBy: '1', postedVia: 'adapter', postedUrl: 'https://bsky.app/p/1' };
const pending = { id: 'jr::linkedin', status: 'pending', channel: 'linkedin', title: 'Jockey Radio', createdAt: 200, doneAt: null };

// ---- the rule ------------------------------------------------------------------------------------------------------

test('reopen puts a task marked done by hand back in To do, keeping its place and clearing the done stamps', () => {
  const { task, ok, remove } = applyTaskAction({ ...handDone, postingAt: 5 }, 'reopen', { githubId: '1' }, 1000);
  assert.equal(ok, true);
  assert.equal(remove, false);
  assert.equal(task.status, 'pending');
  assert.equal(task.doneAt, null);
  assert.equal(task.doneBy, null);
  assert.equal(task.postingAt, null);
  assert.equal(task.createdAt, 200, 'createdAt is kept, so it returns to its old place');
  assert.equal(task.title, 'Jockey Radio');
  assert.deepEqual(splitTasks([task]).pending.map((t) => t.id), ['jr::x']);
});

test('reopen refuses a task Post now sent, and one that is not done', () => {
  for (const t of [adapterDone, pending]) {
    const r = applyTaskAction(t, 'reopen', { githubId: '1' }, 1000);
    assert.equal(r.ok, false, t.id);
    assert.equal(r.task, t, `${t.id}: left exactly as it was`);
  }
  assert.equal(canReopenTask(handDone), true);
  assert.equal(canReopenTask(adapterDone), false);
  assert.equal(canReopenTask(pending), false);
  assert.equal(canReopenTask(null), false);
});

// ---- the Worker route ----------------------------------------------------------------------------------------------

function fakeKV(seed = []) {
  const store = new Map(seed.map((t) => [SOCIAL_TASK_KEY(t.id), JSON.stringify(t)]));
  const puts = [];
  return {
    store, puts,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value, opts) { puts.push({ key, opts }); store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const req = (body) => new Request('https://signup.gbti.network/membership/social-queue', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const superAuth = async () => ({ ok: true, role: 'superadmin', githubId: '1', login: 'owner' });
const adminAuth = async () => ({ ok: true, role: 'admin', githubId: '2', login: 'mod' });

test('Worker: reopen writes a hand-done task back as pending, with no expiry on the write', async () => {
  const kv = fakeKV([handDone]);
  const r = await handleSocialQueueAction(req({ action: 'reopen', id: handDone.id }), {}, { kv, authorize: superAuth, now: () => 1000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending');
  const stored = JSON.parse(kv.store.get(SOCIAL_TASK_KEY(handDone.id)));
  assert.equal(stored.status, 'pending');
  assert.equal(stored.doneAt, null);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].opts, undefined, 'a pending task carries no expiry (a done one has 30 days)');
});

test('Worker: reopen is refused for a task Post now sent, and for anyone but a superadmin', async () => {
  const kv = fakeKV([adapterDone, handDone]);
  const sent = await handleSocialQueueAction(req({ action: 'reopen', id: adapterDone.id }), {}, { kv, authorize: superAuth, now: () => 1000 });
  assert.equal(sent.status, 400);
  assert.match(sent.body.message, /only a task marked done by hand/);
  assert.equal(JSON.parse(kv.store.get(SOCIAL_TASK_KEY(adapterDone.id))).status, 'done', 'left done');
  const admin = await handleSocialQueueAction(req({ action: 'reopen', id: handDone.id }), {}, { kv, authorize: adminAuth, now: () => 1000 });
  assert.equal(admin.status, 403);
  assert.equal(kv.puts.length, 0, 'nothing was written');
  const unknown = await handleSocialQueueAction(req({ action: 'undo', id: handDone.id }), {}, { kv, authorize: superAuth, now: () => 1000 });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.message, /done, delete, reopen, or post/);
});

// ---- the optimistic core -------------------------------------------------------------------------------------------

const queue = () => ({
  pending: [{ id: 'p1', createdAt: 100 }, { id: 'p3', createdAt: 300 }],
  done: [{ id: 'd2', status: 'done', createdAt: 200, doneAt: 900, doneBy: '1' }, { ...adapterDone }],
});

test('core: reopen moves the row into To do at its createdAt place, and a failed call restores it exactly', () => {
  const before = queue();
  const r = applyQueueAction(before, 'reopen', 'd2');
  assert.deepEqual(r.next.pending.map((t) => t.id), ['p1', 'd2', 'p3'], 'oldest first, so it lands between 100 and 300');
  const moved = r.next.pending[1];
  assert.equal(moved.status, 'pending');
  assert.equal('doneAt' in moved, false);
  assert.deepEqual(r.next.done.map((t) => t.id), [adapterDone.id]);
  const back = revertQueueAction(r.next, r.undo);
  assert.deepEqual(back, before, 'rollback restores both lists exactly');
  assert.deepEqual(queue(), before, 'the input is not mutated');
});

test('core: reopen is null for a row Post now sent and for a pending row, so the panel never shows a refused move', () => {
  assert.equal(applyQueueAction(queue(), 'reopen', adapterDone.id), null);
  assert.equal(applyQueueAction(queue(), 'reopen', 'p1'), null);
});

// ---- the panel -----------------------------------------------------------------------------------------------------

test('panel: a hand-done row offers Move to To do by the same rule, routed through the optimistic reopen', () => {
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-social-queue.mjs', import.meta.url), 'utf8');
  const row = src.slice(src.indexOf('_doneRow(t) {'), src.indexOf('_autoRow(it) {'));
  assert.match(row, /canReopenTask\(\{ status: 'done', \.\.\.t \}\) \? `<button class="btn reopen" data-reopen="\$\{esc\(t\.id\)\}" type="button">Move to To do<\/button>` : ''/);
  assert.ok(row.indexOf('data-reopen') < row.indexOf('data-del'), 'before Delete');
  assert.match(src, /this\.\$\$\('\[data-reopen\]'\)\.forEach\(\(b\) => b\.addEventListener\('click', \(\) => this\._action\('reopen', b\.dataset\.reopen\)\)\);/);
  assert.match(src, /action === 'reopen' \? 'Moved back to To do\.'/);
});

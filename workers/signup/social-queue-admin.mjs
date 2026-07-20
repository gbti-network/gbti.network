// SOW-121: the superadmin Social Queue endpoints (manual-assist syndication worklist).
//   GET  /membership/social-queue   -> { ok, pending, done }   (the manual-assist tasks; SUPERADMIN only)
//   POST /membership/social-queue   -> { action: 'done'|'delete'|'post', id }  (SUPERADMIN only)
// `post` is the review-then-send action for a task on an AUTO-capability channel (an On-Manual matrix
// cell): the reviewed task text posts through the channel adapter, then the task completes like `done`.
// Gate fail-closed via the reconcile-written overrides mirror (authorizeAdmin) plus the superadmin role, the
// same boundary as the syndication tracker. Pure over injected deps (unit-tested with a fake KV).

import { authorizeAdmin } from './membership-admin.mjs';
import { ROLE } from '../../membership/overrides-core.mjs';
import { applyTaskAction, splitTasks } from '../../membership/social-queue.mjs';
import { channelCapability } from '../../membership/syndication-config-core.mjs';
import { buildAdapters } from '../../membership/syndication-adapters.mjs';
import { secretsPresent } from '../../membership/syndication-channels.mjs';
import { listTasks, getTask, putTask, deleteTask } from './social-queue-store.mjs';
import { readSyndicationConfig, readContentChannels } from './syndication-store.mjs';

async function gate(request, env, { fetchImpl, authorize }) {
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return { deny: auth };
  if (auth.role !== ROLE.superadmin) return { deny: { status: 403, body: { error: 'forbidden', message: 'superadmin access is required for the Social Queue' } } };
  return { auth };
}

/** GET the manual-assist tasks split into pending (to do) + done (manual history). */
export async function handleSocialQueueGet(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, fetchImpl = globalThis.fetch, authorize = authorizeAdmin, limit = 500 } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the social queue store is not configured' } };
  const { deny } = await gate(request, env, { fetchImpl, authorize });
  if (deny) return deny;
  const { pending, done } = splitTasks(await listTasks(kv, { limit }));
  return { status: 200, body: { ok: true, pending, done } };
}

/** POST an action on one task: `done` (posted by hand -> history), `delete` (discard), or `post`
 *  (review-then-send: the adapter posts the reviewed text; auto-capability channels only). */
export async function handleSocialQueueAction(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin, adapters = null } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the social queue store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const { auth, deny } = await gate(request, env, { fetchImpl, authorize });
  if (deny) return deny;

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const id = String(payload?.id || '');
  const action = String(payload?.action || '');
  if (!id) return { status: 400, body: { error: 'invalid', message: 'a task id is required' } };
  if (action !== 'done' && action !== 'delete' && action !== 'post') return { status: 400, body: { error: 'invalid', message: 'action must be done, delete, or post' } };

  const task = await getTask(kv, id);
  if (!task) return { status: 404, body: { error: 'not_found', message: 'no such social task' } };

  if (action === 'post') {
    // Review-then-send. Only an AUTO-capability channel can post through its adapter; an x/linkedin task
    // stays hand-posted (Assist/Copy, then done). The REVIEWED task text is what posts (textOverride); the
    // task's public item snapshot feeds the adapter for everything else (category, handles, image).
    if (task.status !== 'pending') return { status: 400, body: { error: 'invalid', message: 'only a pending task can post' } };
    // A best-effort claim: KV has no compare-and-set, so a short postingAt stamp narrows the double-post
    // window between two concurrent superadmins to the write-propagation gap (each request is also behind a
    // UI confirm). A crash mid-post leaves the task pending with an EXPIRED stamp, so it stays postable.
    const claimMs = 2 * 60_000;
    if (Number(task.postingAt) > 0 && Number(now()) - Number(task.postingAt) < claimMs) {
      return { status: 409, body: { error: 'posting', message: 'another session is posting this task right now' } };
    }
    if (channelCapability(task.channel) !== 'auto') {
      return { status: 400, body: { error: 'invalid', message: `${task.channel} cannot post automatically; use Assist or Copy, then mark it done` } };
    }
    if (!secretsPresent(env, task.channel)) {
      return { status: 409, body: { error: 'not_configured', message: `the ${task.channel} channel is not configured` } };
    }
    const cfg = await readSyndicationConfig(kv);
    const channelMap = await readContentChannels(kv);
    const all = adapters ?? buildAdapters({ env, fetchImpl, channelMap, cfg });
    const adapter = all[task.channel];
    if (!adapter?.enabled?.()) return { status: 409, body: { error: 'not_configured', message: `the ${task.channel} channel is not configured` } };
    await putTask(kv, { ...task, postingAt: Number(now()) }); // the claim stamp (see above)
    const base = task.item && typeof task.item === 'object' ? task.item : { source: task.source, targetSlug: task.itemId, author: task.author, title: task.title, url: task.url };
    let result;
    try { result = await adapter.post({ ...base, textOverride: task.text }); }
    catch (e) { result = { ok: false, error: String(e?.message || e) }; }
    if (result?.ok && result.skipped) {
      await putTask(kv, { ...task, postingAt: null }); // release the claim; the task stays postable
      return { status: 409, body: { error: 'skipped', message: result.reason || 'the channel skipped this post' } };
    }
    if (!result?.ok) {
      await putTask(kv, { ...task, postingAt: null }); // release the claim; the task stays postable
      return { status: 502, body: { error: 'post_failed', message: result?.error || 'post failed' } };
    }
    const { task: posted } = applyTaskAction(task, 'done', { githubId: auth.githubId, login: auth.login }, Number(now()));
    const next = { ...posted, postedId: result.id ?? null, postedUrl: result.url ?? null, postedVia: 'adapter' };
    await putTask(kv, next);
    return { status: 200, body: { ok: true, id, status: 'done', posted: true, postedUrl: next.postedUrl } };
  }

  const { task: next, remove, ok } = applyTaskAction(task, action, { githubId: auth.githubId, login: auth.login }, Number(now()));
  if (!ok) return { status: 400, body: { error: 'invalid', message: 'the action could not be applied' } };
  if (remove) { await deleteTask(kv, id); return { status: 200, body: { ok: true, id, removed: true } }; }
  await putTask(kv, next);
  return { status: 200, body: { ok: true, id, status: next.status } };
}

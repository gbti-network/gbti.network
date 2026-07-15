// SOW-121: the superadmin Social Queue endpoints (manual-assist syndication worklist).
//   GET  /membership/social-queue   -> { ok, pending, done }   (the manual-assist tasks; SUPERADMIN only)
//   POST /membership/social-queue   -> { action: 'done'|'delete', id }  (SUPERADMIN only)
// Gate fail-closed via the reconcile-written overrides mirror (authorizeAdmin) plus the superadmin role, the
// same boundary as the syndication tracker. Pure over injected deps (unit-tested with a fake KV).

import { authorizeAdmin } from './membership-admin.mjs';
import { ROLE } from '../../membership/overrides-core.mjs';
import { applyTaskAction, splitTasks } from '../../membership/social-queue.mjs';
import { listTasks, getTask, putTask, deleteTask } from './social-queue-store.mjs';

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

/** POST an action on one task: `done` (posted by hand -> history) or `delete` (discard). */
export async function handleSocialQueueAction(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the social queue store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const { auth, deny } = await gate(request, env, { fetchImpl, authorize });
  if (deny) return deny;

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const id = String(payload?.id || '');
  const action = String(payload?.action || '');
  if (!id) return { status: 400, body: { error: 'invalid', message: 'a task id is required' } };
  if (action !== 'done' && action !== 'delete') return { status: 400, body: { error: 'invalid', message: 'action must be done or delete' } };

  const task = await getTask(kv, id);
  if (!task) return { status: 404, body: { error: 'not_found', message: 'no such social task' } };

  const { task: next, remove, ok } = applyTaskAction(task, action, { githubId: auth.githubId, login: auth.login }, Number(now()));
  if (!ok) return { status: 400, body: { error: 'invalid', message: 'the action could not be applied' } };
  if (remove) { await deleteTask(kv, id); return { status: 200, body: { ok: true, id, removed: true } }; }
  await putTask(kv, next);
  return { status: 200, body: { ok: true, id, status: next.status } };
}

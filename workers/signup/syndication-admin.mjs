// SOW-058: the superadmin-facing syndication endpoints.
//   GET  /membership/syndication           -> { ok, pending, approved, sent, cancelled, failed }  (admin read)
//   POST /membership/syndication/approve    -> approve a pending item; it posts next drain tick (SUPERADMIN only)
//   POST /membership/syndication/cancel     -> reject/cancel a pending or approved item (SUPERADMIN only)
// All gate fail-closed via the reconcile-written overrides mirror (authorizeAdmin), so a missing/stale mirror or a
// non-admin token is denied. Approve + cancel additionally require the superadmin role. Pure over injected deps.

import { authorizeAdmin } from './membership-admin.mjs';
import { ROLE } from '../../membership/overrides-core.mjs';
import { canCancel, markCancelled, canApprove, markApproved } from '../../membership/syndication-queue.mjs';
import { getItem, putItem, listAll, removeFromPending } from './syndication-store.mjs';

function bucketize(items, now) {
  const out = { pending: [], approved: [], sent: [], cancelled: [], failed: [] };
  const t = Number(now());
  for (const it of items) {
    if (it.status === 'pending') {
      out.pending.push({ ...it, secondsUntilAvailable: Math.max(0, Math.ceil((it.availableAt - t) / 1000)) });
    } else if (out[it.status]) {
      out[it.status].push(it);
    }
  }
  // newest-first within each bucket
  for (const k of Object.keys(out)) out[k].sort((a, b) => (b.enqueuedAt || 0) - (a.enqueuedAt || 0));
  return out;
}

/** GET the four-bucket queue view for the superadmin dashboard (admin/superadmin). */
export async function handleSyndicationTracker(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin, limit = 500 } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return auth;
  const items = await listAll(kv, { limit });
  return { status: 200, body: { ok: true, ...bucketize(items, now) } };
}

/** POST cancel a pending item (SUPERADMIN only). Idempotent: an already-terminal item returns cancelled:false. */
export async function handleSyndicationCancel(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return auth;
  if (auth.role !== ROLE.superadmin) return { status: 403, body: { error: 'forbidden', message: 'superadmin access is required to cancel syndication' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const id = String(payload?.id || '');
  if (!id) return { status: 400, body: { error: 'invalid', message: 'an item id is required' } };

  const item = await getItem(kv, id);
  if (!item) return { status: 404, body: { error: 'not_found', message: 'no such syndication item' } };
  if (!canCancel(item)) return { status: 200, body: { ok: true, cancelled: false, status: item.status, message: 'the item is no longer pending' } };

  const next = markCancelled(item, { now, actor: auth.githubId });
  await putItem(kv, next);
  await removeFromPending(kv, id);
  return { status: 200, body: { ok: true, cancelled: true, id, status: 'cancelled' } };
}

/**
 * POST approve a pending item (SUPERADMIN only). pending -> approved, so the next drain tick posts it to every
 * enabled channel. Idempotent: a non-pending item returns approved:false. The item STAYS in the pending index (it
 * is still not-terminal) so the drain finds it.
 */
export async function handleSyndicationApprove(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return auth;
  if (auth.role !== ROLE.superadmin) return { status: 403, body: { error: 'forbidden', message: 'superadmin access is required to approve syndication' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const id = String(payload?.id || '');
  if (!id) return { status: 400, body: { error: 'invalid', message: 'an item id is required' } };

  const item = await getItem(kv, id);
  if (!item) return { status: 404, body: { error: 'not_found', message: 'no such syndication item' } };
  if (!canApprove(item)) return { status: 200, body: { ok: true, approved: false, status: item.status, message: 'the item is not pending approval' } };

  const next = markApproved(item, { now, actor: auth.githubId });
  await putItem(kv, next);
  return { status: 200, body: { ok: true, approved: true, id, status: 'approved' } };
}

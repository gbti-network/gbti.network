// sow-338: a superadmin pulls one story out of the news index, and puts it back.
//
// Requested by the owner on 2026-09-15, looking at a news item page: "we need a superadmin sidebar action to
// remove a news item from our index". Until now nothing could: the only deletion in NEWS_KV was retention
// pruning of whole day shards, so a bad story sat in the feed for its full thirty days.
//
// A REMOVAL IS A TOMBSTONE, not a deletion, and the reasoning lives beside the store (news/src/store.mjs): the
// guid map alone cannot hold a removal, because a guid leaves with its day after thirty days while a feed may
// list the same item for longer. The tombstone carries a copy of the item, which is what makes Undo exact.
//
// WHY THIS IS NOT IN membership-admin-author.mjs. Every action there opens a pull request against a file in the
// repository; this writes KV. The two need different failure handling, and that module is already 863 lines
// against the project's 900-line cap.
//
// The route is superadmin-gated on the SERVER (authorizeSuperadmin). The news item page reveals the controls from
// the member signal, which is presentation only: an admin, a news editor or a forged signal gets 403 here and
// changes nothing.
import { authorizeSuperadmin } from './membership-admin.mjs';
import { removeItem, restoreItem, loadRemoved } from './news/src/store.mjs';

const bad = (status, error, message) => ({ status, body: { ok: false, error, message } });

// A feed guid is opaque (usually a URL or a source-issued id), so this bounds it rather than shaping it: long
// enough for a real URL guid, short enough that nothing can be smuggled in as one.
const GUID_MAX = 512;

/** The guid a request is asking about, or null when it is not one. Pure. */
export function readGuid(payload) {
  const guid = typeof payload?.guid === 'string' ? payload.guid.trim() : '';
  if (!guid || guid.length > GUID_MAX) return null;
  // No control characters. Written as a code check rather than a regex class, because a class of literal
  // control characters is invisible in the file and in every diff of it.
  for (let i = 0; i < guid.length; i += 1) { const c = guid.charCodeAt(i); if (c < 0x20 || c === 0x7f) return null; }
  return guid;
}

/**
 * POST /membership/admin/news-item { action: 'remove' | 'restore', guid }
 *
 * Superadmin only, cookie-capable (the website page calls it), CSRF-gated through resolveIdentity like every
 * other credentialed write. Idempotent in both directions: removing what is already removed, or restoring what
 * was never removed, answers without changing anything.
 */
export async function newsItemDecide(request, env, deps = {}) {
  const { authorize = authorizeSuperadmin, now = Math.floor(Date.now() / 1000) } = deps;
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!env?.NEWS_KV) return bad(503, 'unavailable', 'the news store is not reachable right now');

  let payload;
  try { payload = await request.json(); } catch { payload = null; }
  const action = String(payload?.action ?? '').trim();
  if (action !== 'remove' && action !== 'restore') return bad(400, 'bad_request', 'action must be remove or restore');
  const guid = readGuid(payload);
  if (!guid) return bad(400, 'bad_request', 'a story guid is required');

  try {
    if (action === 'remove') {
      // `by` is the acting superadmin, so a removal can be attributed later. It is the only identity stored.
      const r = await removeItem(env, { guid, by: auth.login ?? String(auth.githubId ?? '') ?? null, now });
      if (!r.ok) return bad(404, 'not_found', 'that story is not in the news index');
      return { status: 200, body: { ok: true, guid, already: Boolean(r.already), restorable: r.restorable !== false } };
    }
    const r = await restoreItem(env, { guid, now });
    if (!r.ok && r.error === 'expired') return bad(409, 'expired', 'that story is older than the news window, so there is nothing to put back');
    if (!r.ok) return bad(404, 'not_found', 'that story was not removed');
    return { status: 200, body: { ok: true, guid, restored: Boolean(r.restored) } };
  } catch {
    // A KV failure must not read as "done". The caller retries; nothing half-written survives, because each
    // operation writes the shard and the index before the tombstone that hides them.
    return bad(503, 'unavailable', 'the news store did not answer; please try again');
  }
}

/** GET /membership/admin/news-item -> what is currently removed, newest first. Superadmin only. */
export async function newsRemovedList(request, env, deps = {}) {
  const { authorize = authorizeSuperadmin } = deps;
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!env?.NEWS_KV) return bad(503, 'unavailable', 'the news store is not reachable right now');
  let removed = {};
  try { removed = await loadRemoved(env); } catch { return bad(503, 'unavailable', 'the news store did not answer; please try again'); }
  const items = Object.entries(removed)
    .map(([guid, r]) => ({ guid, at: r?.at ?? 0, by: r?.by ?? null, source: r?.source ?? null, day: r?.day ?? null, title: r?.item?.title ?? null }))
    .sort((a, b) => b.at - a.at);
  return { status: 200, body: { ok: true, items } };
}

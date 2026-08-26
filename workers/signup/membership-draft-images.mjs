// The staged-image store's IO half, modelled on membership-drafts.mjs (same shape of problem: per-member,
// private, erasable, one read-modify-write behind an authorizer).
//
//   GET  /membership/draft-image?name=<file>            -> { ok, dataBase64, contentType } | 404
//   POST /membership/draft-image {op:'put', name, dataBase64}   -> { ok, name, bytes }
//   POST /membership/draft-image {op:'delete', name}            -> { ok }
//
// Auth = SIGNED-IN, non-banned (authorizeMember), the same bar as the draft store itself: SOW-011 lets a
// trial author drafts, and an image is part of a draft. Keyed `draftimg:<github_id>:<name>`, so the key is
// built ENTIRELY from the authenticated identity plus a sanitized file name. A caller never supplies a path
// and cannot address another member's key; there is no cross-member case to reject because there is no way
// to express one.
//
// Bytes travel as base64 inside JSON rather than as a raw body. That reuses the existing JSON plumbing on
// both ends, needs no content-type or caching work, and the payload is capped at 1 MB anyway.
//
// The lifetime is short by design: publish() commits the image into the PR and deletes the key, so the
// editor and preview fall back to jsDelivr the moment the real file exists on main. Nothing here is
// permanent storage, and eraseMemberDraftImages hard-deletes the lot for the SOW-024 right-to-erasure
// runbook.

import { authorizeMember } from './membership-content.mjs';
import {
  DraftImageError, draftImageKey, draftImagePrefix, imageNameOf,
  validateDraftImage, checkDraftImageQuota, contentTypeFor,
} from '../../membership/draft-images.mjs';

/** Every staged image a member holds, as `[{ name, bytes }]`, read from key metadata so no value is fetched. */
export async function listStagedImages(kv, githubId) {
  const prefix = draftImagePrefix(githubId);
  const out = [];
  let cursor;
  // The cursor-paged list idiom from mail-compile.mjs. A member is capped at 40 images, so this is one page
  // in practice; the loop exists so a store that somehow grew past a page is still fully counted rather than
  // silently under-counted, which would quietly raise the quota.
  for (;;) {
    let res;
    try { res = await kv.list({ prefix, cursor }); } catch { break; }
    for (const k of res?.keys || []) {
      out.push({ name: String(k.name).slice(prefix.length), bytes: Number(k.metadata?.bytes) || 0 });
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

export async function handleDraftImage(request, env, { kv = env?.SIGNUP_KV, now, authorize = authorizeMember, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the staged image store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, allowCookie: true }); // the website session cookie, as the drafts route does
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const method = request.method;

  if (method === 'GET') {
    const name = imageNameOf(new URL(request.url).searchParams.get('name'));
    if (!name) return { status: 400, body: { error: 'bad_request', message: 'a valid image name is required' } };
    const stored = await kv.get(draftImageKey(auth.githubId, name), 'json');
    // A miss is the NORMAL steady state, not an error: once the image is committed and merged, the key is
    // gone and the caller is expected to fall back to the CDN. Say so plainly so the client can tell the
    // difference between "not staged" and "something broke".
    if (!stored) return { status: 404, body: { error: 'not_found', message: 'that image is not staged' } };
    return { status: 200, body: { ok: true, name, dataBase64: stored.dataBase64, contentType: stored.contentType || contentTypeFor(name) } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

  if (payload?.op === 'delete') {
    const name = imageNameOf(payload.name);
    if (!name) return { status: 400, body: { error: 'bad_request', message: 'a valid image name is required' } };
    await kv.delete(draftImageKey(auth.githubId, name));
    return { status: 200, body: { ok: true, name } };
  }
  if (payload?.op !== 'put') return { status: 400, body: { error: 'bad_request', message: 'op must be put or delete' } };

  let checked;
  try {
    checked = validateDraftImage({ name: payload.name, dataBase64: payload.dataBase64 });
    checkDraftImageQuota(await listStagedImages(kv, auth.githubId), checked);
  } catch (err) {
    if (err instanceof DraftImageError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }

  const at = now ? now() : Date.now();
  const value = { dataBase64: String(payload.dataBase64), contentType: contentTypeFor(checked.name), bytes: checked.bytes, at };
  // The size also rides in key METADATA so the quota check above can total a member's usage from a list()
  // without fetching every image body.
  await kv.put(draftImageKey(auth.githubId, checked.name), JSON.stringify(value), { metadata: { bytes: checked.bytes } });
  return { status: 200, body: { ok: true, name: checked.name, bytes: checked.bytes } };
}

/** SOW-024 right-to-erasure: hard-delete every staged image a member holds. */
export async function eraseMemberDraftImages(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the staged image store is not configured' };
  const staged = await listStagedImages(kv, githubId);
  for (const s of staged) await kv.delete(draftImageKey(githubId, s.name));
  return { ok: true, deleted: staged.length, prefix: draftImagePrefix(githubId) };
}

// sow-483 Phase 3: the staged-recording store's IO half, beside membership-draft-images.mjs and shaped like it.
//
//   PUT    /membership/draft-audio?item=<type>:<slug>&name=<file>   raw bytes      -> { ok, name, bytes }
//   GET    /membership/draft-audio?item=...&name=...                               -> the bytes | 404
//   GET    /membership/draft-audio?item=...&name=...&meta=1                        -> { ok, name, bytes } | 404
//   DELETE /membership/draft-audio?item=...&name=...                               -> { ok }
//
// Auth = effective PAID (owner, 2026-10-27: "Every paid member" can upload), cookie or bearer, so only a member who can
// publish can stage. Keyed `draftaudio:<github_id>:<type>:<slug>:<name>`, built ENTIRELY from the authenticated
// identity plus validated input: a caller never supplies a path and cannot address another member's key.
//
// The bytes travel RAW, not as base64 in JSON (the image store's way): a recording is up to 20 MB, a third larger
// again as base64, and the editor shows upload progress on the raw request. A staged recording lives 30 days at most;
// publish commits it (membership-author.mjs reads it by reference) and the editor deletes the key afterwards.
// eraseMemberDraftAudio hard-deletes the lot for the SOW-024 right-to-erasure runbook.

import { authorizePaid } from './membership-content.mjs';
import { rateLimit } from './abuse.mjs';
import {
  DraftAudioError, DRAFT_AUDIO_MAX_BYTES, DRAFT_AUDIO_TTL_SECONDS, draftAudioKey, draftAudioPrefix, itemTokenOf, audioNameOf,
  audioContentType, validateDraftAudio, checkDraftAudioQuota,
} from '../../membership/draft-audio.mjs';

/** Every staged recording a member holds, as `[{ key, id, bytes }]`, from key metadata alone (no value is fetched). */
export async function listStagedAudio(kv, githubId) {
  const prefix = draftAudioPrefix(githubId);
  const out = [];
  let cursor;
  for (;;) {
    let res;
    try { res = await kv.list({ prefix, cursor }); } catch { break; }
    for (const k of res?.keys || []) out.push({ key: String(k.name), id: String(k.name).slice(prefix.length), bytes: Number(k.metadata?.bytes) || 0 });
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

/**
 * The staged bytes of one recording as base64, for the publish (membership-author.mjs), or null when nothing is staged
 * under that key. Encoded in 32 KB slices so a 20 MB recording never builds one giant argument list.
 */
export async function readStagedAudioBase64(kv, githubId, item, name) {
  const it = itemTokenOf(item);
  const n = audioNameOf(name);
  if (!kv || !it || !n) return null;
  const buf = await kv.get(draftAudioKey(githubId, it, n), 'arrayBuffer');
  if (!buf) return null;
  return bytesToBase64(new Uint8Array(buf));
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const bad = (message, status = 400, error = 'invalid') => ({ status, body: { error, message } });

export async function handleDraftAudio(request, env, { kv = env?.SIGNUP_KV, now, authorize = authorizePaid, limiter = rateLimit, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the staged recording store is not configured' } };
  const auth = await authorize(request, env, { ...authDeps, allowCookie: true }); // the website session cookie, as /membership/author
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const params = new URL(request.url).searchParams;
  const item = itemTokenOf(params.get('item'));
  const name = audioNameOf(params.get('name'));
  if (!item || !name) return bad('a valid item and recording name are required', 400, 'bad_request');
  const key = draftAudioKey(auth.githubId, item, name);
  const method = request.method;

  if (method === 'GET') {
    if (params.get('meta') === '1') {
      // A list of one key reads its metadata without fetching 20 MB just to learn it is there.
      const found = (await listStagedAudio(kv, auth.githubId)).find((x) => x.key === key);
      return found ? { status: 200, body: { ok: true, name, bytes: found.bytes } } : bad('that recording is not staged', 404, 'not_found');
    }
    const buf = await kv.get(key, 'arrayBuffer');
    // A miss is the normal state once a recording is published and merged: the key is gone and the site serves it.
    if (!buf) return bad('that recording is not staged', 404, 'not_found');
    return { status: 200, raw: buf, contentType: audioContentType(name) };
  }
  if (method === 'DELETE') {
    await kv.delete(key);
    return { status: 200, body: { ok: true, name } };
  }
  if (method !== 'PUT') return bad('use GET, PUT or DELETE', 405, 'method_not_allowed');

  // Refuse an oversized body before reading it, when the client says how big it is.
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > DRAFT_AUDIO_MAX_BYTES) return bad('That file is over 20 MB. Export it at a lower bitrate, then choose it again.', 413, 'too_large');
  const rl = await limiter({ kv, ip: auth.githubId, limit: 20, windowSeconds: 3600, prefix: 'rl:draftaudio:' });
  if (!rl.allowed) return bad('Too many uploads in the last hour. Try again later.', 429, 'rate_limited');

  let bytes;
  try { bytes = await request.arrayBuffer(); } catch { return bad('the upload could not be read', 400, 'bad_request'); }
  try {
    validateDraftAudio({ item, name, bytes });
    checkDraftAudioQuota(await listStagedAudio(kv, auth.githubId), { id: `${item}:${name}`, bytes: bytes.byteLength });
  } catch (err) {
    if (err instanceof DraftAudioError) return bad(err.message);
    throw err;
  }
  const at = now ? now() : Date.now();
  await kv.put(key, bytes, { metadata: { bytes: bytes.byteLength, at }, expirationTtl: DRAFT_AUDIO_TTL_SECONDS });
  return { status: 200, body: { ok: true, name, bytes: bytes.byteLength } };
}

/** SOW-024 right-to-erasure: hard-delete every staged recording a member holds. */
export async function eraseMemberDraftAudio(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the staged recording store is not configured' };
  const staged = await listStagedAudio(kv, githubId);
  for (const s of staged) await kv.delete(s.key);
  return { ok: true, deleted: staged.length, prefix: draftAudioPrefix(githubId) };
}

// sow-494: the Community routes. Members read entries, answer polls and take part in each entry's discussion; a
// superadmin creates entries, decides who may see each one, runs it through its states and moderates. Everything is
// stored in one Durable Object (community-do.mjs); the rules are in membership/community-store.mjs.
//
//   GET  /membership/community/entries?kind=&meeting=   the forum list
//   GET  /membership/community/entry?id=                one entry, with its discussion
//   GET  /membership/community/updates?id=&v=           the live poll: { unchanged } or the fresh entry
//   GET  /membership/community/image?id=&img=           an image's bytes, private
//   POST /membership/community/answer                   { id, choice } or { id, text }
//   POST /membership/community/post                     { id, body, images, parentId }
//   POST /membership/community/post-edit                { id, postId, body, images }
//   POST /membership/community/post-delete              { id, postId }
//   POST /membership/community/react                    { id, postId, name }
//   POST /membership/community/image                    { id, name, dataBase64 }
//   POST /membership/community/image-drop               { id, img }
//   POST /membership/admin/community                    { op, ... }  superadmin
//   GET  /membership/admin/community/members            the member picker for chosen access, superadmin
//
// TWO GATES, BECAUSE THE FULL ONE COSTS A STRIPE SEARCH. Members only means effective paid (authorizePaid), and that
// makes one Stripe search per call. Writes and the first loads of a page pay it, and a success is remembered in KV as
// `community:ok:<github_id>` for ten minutes. The calls that repeat (the live poll every few seconds, every image on
// the page) take the CHEAP gate: the verified identity, the overrides mirror read fresh every time (so a ban lands at
// the next request and a stale mirror fails closed), and that remembered success. With no remembered success the
// cheap gate runs the full one. A lapse therefore takes effect within ten minutes, a ban immediately.
//
// The viewer handed to the store is built here from the verified identity, never from the request body.

import { authorizePaid } from './membership-content.mjs';
import { mirrorRole } from './membership-admin.mjs';
import { resolveIdentity } from './identity.mjs';
import { readMembersIndexCached } from './member-folder.mjs';
import { encodeRpc, COMMUNITY_OBJECT_NAME } from './community-do.mjs';
import { validateImageUpload, MAX_IMAGE_BASE64 } from '../../membership/community-shared.mjs';

export const COMMUNITY_OK_TTL = 600; // seconds: how long a paid check is trusted by the cheap gate
export const communityOkKey = (githubId) => `community:ok:${githubId}`;

const fail = (status, error, message) => ({ ok: false, status, body: { error, message } });
const JSON_CAP = 64 * 1024;
const UPLOAD_CAP = MAX_IMAGE_BASE64 + 4096;

// ---- gates ------------------------------------------------------------------------------------------------------

/** The full gate: effective paid (one Stripe search), then the role for the superadmin flag. */
export async function communityMember(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, paid = authorizePaid, role = mirrorRole, now = new Date(), ...rest } = deps;
  const auth = await paid(request, env, { ...rest, now, kv, allowCookie: true });
  if (!auth.ok) return auth;
  const m = await role(env, auth.githubId, { now });
  if (!m.ok) return m;
  try {
    if (!(await kv?.get(communityOkKey(auth.githubId)))) await kv?.put(communityOkKey(auth.githubId), '1', { expirationTtl: COMMUNITY_OK_TTL });
  } catch { /* best effort: without it the cheap gate runs the full check again */ }
  return { ok: true, viewer: { githubId: String(auth.githubId), login: auth.login || '', superadmin: m.role === 'superadmin' } };
}

/** The cheap gate: identity, a fresh mirror (ban and role), and a remembered paid check. */
export async function communityMemberCheap(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, resolve = resolveIdentity, role = mirrorRole, now = new Date() } = deps;
  const id = await resolve(request, env, { ...deps, now, allowCookie: true });
  if (!id.ok) return id;
  const m = await role(env, id.githubId, { now });
  if (!m.ok) return m;
  const superadmin = m.role === 'superadmin';
  if (!superadmin) {
    let remembered = null;
    try { remembered = await kv?.get(communityOkKey(id.githubId)); } catch { remembered = null; }
    if (!remembered) return communityMember(request, env, deps);
  }
  return { ok: true, viewer: { githubId: String(id.githubId), login: id.login || '', superadmin } };
}

/** A superadmin, with no Stripe call: staff are paid-equivalent, and the role is what decides. */
export async function communitySuperadmin(request, env, deps = {}) {
  const { resolve = resolveIdentity, role = mirrorRole, now = new Date() } = deps;
  const id = await resolve(request, env, { ...deps, now, allowCookie: true, retries: 2 });
  if (!id.ok) return id;
  const m = await role(env, id.githubId, { now });
  if (!m.ok) return m;
  if (m.role !== 'superadmin') return fail(403, 'forbidden', 'superadmin access is required');
  return { ok: true, viewer: { githubId: String(id.githubId), login: id.login || '', superadmin: true } };
}

// ---- the object ---------------------------------------------------------------------------------------------------

/** Send one call to the Community object. Returns its Response, or null when the binding is missing. */
export async function callCommunity(env, msg, bytes = null) {
  const ns = env?.COMMUNITY;
  if (!ns) return null;
  const stub = ns.get(ns.idFromName(COMMUNITY_OBJECT_NAME));
  return stub.fetch('https://community.internal/rpc', { method: 'POST', body: encodeRpc(msg, bytes) });
}

async function relay(env, msg, bytes, call) {
  let res;
  try { res = await call(env, msg, bytes); } catch { res = null; }
  if (!res) return fail(503, 'unavailable', 'Community is unavailable right now. Try again in a moment.');
  const type = res.headers.get('Content-Type') || '';
  if (res.ok && !type.startsWith('application/json')) {
    return { ok: true, status: 200, raw: new Uint8Array(await res.arrayBuffer()), contentType: type };
  }
  let body;
  try { body = await res.json(); } catch { body = { error: 'internal', message: 'Something went wrong. Try again.' }; }
  if (!res.ok) return { ok: false, status: res.status, body: { error: body.error || 'error', message: body.message || 'Something went wrong.' } };
  return { ok: true, status: 200, body };
}

async function readBody(request, cap) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > cap) return { ok: false, tooBig: true };
  let text;
  try { text = await request.text(); } catch { return { ok: false }; }
  if (text.length > cap) return { ok: false, tooBig: true };
  try {
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v } : { ok: false };
  } catch { return { ok: false }; }
}

// ---- member routes ------------------------------------------------------------------------------------------------

const q = (url, k) => url.searchParams.get(k) || '';

// Each path and method: the gate, the op, and how its arguments are read. Matched exactly, and nothing else.
export const COMMUNITY_ROUTES = {
  '/membership/community/entries': { GET: { gate: 'full', op: 'list', args: (u) => ({ kind: q(u, 'kind'), meeting: q(u, 'meeting') }) } },
  '/membership/community/entry': { GET: { gate: 'full', op: 'get', args: (u) => ({ id: q(u, 'id') }) } },
  '/membership/community/updates': { GET: { gate: 'cheap', op: 'updates', args: (u) => ({ id: q(u, 'id'), since: Number(q(u, 'v')) }) } },
  '/membership/community/image': {
    GET: { gate: 'cheap', op: 'image', args: (u) => ({ id: q(u, 'id'), img: q(u, 'img') }) },
    POST: { gate: 'full', op: 'putImage', upload: true },
  },
  '/membership/community/answer': { POST: { gate: 'full', op: 'answer', body: (b) => ({ id: b.id, input: { choice: b.choice, text: b.text } }) } },
  '/membership/community/post': { POST: { gate: 'full', op: 'post', body: (b) => ({ id: b.id, input: { body: b.body, images: b.images, parentId: b.parentId } }) } },
  '/membership/community/post-edit': { POST: { gate: 'full', op: 'editPost', body: (b) => ({ id: b.id, postId: b.postId, input: { body: b.body, images: b.images } }) } },
  '/membership/community/post-delete': { POST: { gate: 'full', op: 'deletePost', body: (b) => ({ id: b.id, postId: b.postId }) } },
  '/membership/community/react': { POST: { gate: 'full', op: 'react', body: (b) => ({ id: b.id, postId: b.postId, name: b.name }) } },
  '/membership/community/image-drop': { POST: { gate: 'full', op: 'dropImage', body: (b) => ({ id: b.id, img: b.img }) } },
};

/**
 * One member route. Returns { status, body } for JSON, or { status, raw, contentType } for an image's bytes.
 * `route` is COMMUNITY_ROUTES[pathname][method], chosen by the router.
 */
export async function handleCommunity(request, env, route, deps = {}) {
  const { call = callCommunity, full = communityMember, cheap = communityMemberCheap } = deps;
  const gate = route.gate === 'cheap' ? cheap : full;
  const auth = await gate(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const url = new URL(request.url);
  let args = route.args ? route.args(url) : {};
  let bytes = null;
  if (route.upload || route.body) {
    const b = await readBody(request, route.upload ? UPLOAD_CAP : JSON_CAP);
    if (!b.ok) return b.tooBig
      ? { status: 413, body: { error: 'too_large', message: route.upload ? 'Images can be up to 1 MB each.' : 'That is too long to send.' } }
      : { status: 400, body: { error: 'bad_request', message: 'The request could not be read.' } };
    if (route.upload) {
      const up = validateImageUpload({ name: b.value.name, dataBase64: b.value.dataBase64 });
      if (!up.ok) return { status: 400, body: { error: 'bad_request', message: up.problem } };
      args = { id: String(b.value.id || ''), name: up.value.name };
      bytes = up.value.bytes;
    } else {
      args = route.body(b.value);
    }
  }
  const r = await relay(env, { op: route.op, viewer: auth.viewer, args }, bytes, call);
  if (!r.ok) return { status: r.status, body: r.body };
  if (r.raw) return { status: 200, raw: r.raw, contentType: r.contentType };
  return { status: 200, body: r.body };
}

/** The headers an image is served with: private to the viewer, and never sniffed into anything but an image. */
export function imageHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'",
    Vary: 'Cookie, Authorization',
  };
}

// ---- superadmin -----------------------------------------------------------------------------------------------------

const STATUS_OPS = new Set(['open', 'close', 'publish', 'unpublish', 'lock', 'unlock', 'delete']);

/** The superadmin op names the route accepts, each mapped onto one store call. */
export function adminCall(b) {
  const op = String(b?.op || '');
  const id = String(b?.id || '');
  if (op === 'create') return { op: 'create', args: { input: b.input || {}, open: b.open === true } };
  if (op === 'edit') return { op: 'edit', args: { id, input: b.input || {} } };
  if (STATUS_OPS.has(op)) return { op: 'status', args: { id, action: op } };
  if (op === 'access') return { op: 'access', args: { id, access: b.access || {} } };
  if (op === 'moderate') return { op: 'moderate', args: { id, postId: String(b.postId || ''), action: String(b.action || ''), imageId: b.imageId ? String(b.imageId) : null } };
  if (op === 'tidy') return { op: 'tidy', args: { id, tidy: { action: b.action, norm: b.norm, label: b.label, into: b.into } } };
  if (op === 'erase-member') return { op: 'erase', args: { githubId: String(b.githubId || '') } };
  return null;
}

export async function membershipAdminCommunity(request, env, deps = {}) {
  const { call = callCommunity, superadmin = communitySuperadmin } = deps;
  const auth = await superadmin(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const b = await readBody(request, JSON_CAP);
  if (!b.ok) return b.tooBig
    ? { status: 413, body: { error: 'too_large', message: 'That is too long to send.' } }
    : { status: 400, body: { error: 'bad_request', message: 'The request could not be read.' } };
  const c = adminCall(b.value);
  if (!c) return { status: 400, body: { error: 'bad_request', message: 'Unknown operation.' } };
  const r = await relay(env, { op: c.op, viewer: auth.viewer, args: c.args }, null, call);
  return { status: r.status, body: r.body };
}

/** The picker for chosen access: every member folder in the members index, by GBTI name. */
export async function membershipAdminCommunityMembers(request, env, deps = {}) {
  const { superadmin = communitySuperadmin, readIndex = readMembersIndexCached } = deps;
  const auth = await superadmin(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  let map;
  try { map = await readIndex(env, deps); } catch { return { status: 502, body: { error: 'index_unavailable', message: 'The member list could not be read. Try again in a moment.' } }; }
  const members = [...map.entries()]
    .map(([githubId, username]) => ({ githubId: String(githubId), username: String(username) }))
    .sort((a, b) => a.username.localeCompare(b.username));
  return { status: 200, body: { ok: true, members } };
}

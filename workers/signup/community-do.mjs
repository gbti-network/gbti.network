// sow-494: the one Durable Object that holds Community (entries, answers, discussion posts, reactions, images). Every
// rule lives in membership/community-store.mjs; this file is only the transport onto it.
//
// WHO CAN REACH IT. A Durable Object namespace has no public address: only this Worker's own code, through the
// COMMUNITY binding, can send it a request. The Worker authenticates the caller first and builds the viewer
// `{ githubId, login, superadmin }` from the verified identity, so the object trusts the viewer it is handed and
// never reads one from member input. The store still checks visibility on every call, and the superadmin ops are
// refused here as well unless the viewer is a superadmin.
//
// THE WIRE FORMAT. One POST per call, a frame of [4-byte big-endian JSON length][JSON message][optional raw bytes].
// The bytes are an image upload, so a 1 MB picture crosses as 1 MB rather than as base64. The reply is JSON
// (`{ ok, ... }` with the HTTP status of the result), or the raw bytes of an image for the `image` op.
//
// No `cloudflare:workers` import: the class is a plain fetch-handler Durable Object, so index.mjs, which the unit
// suite imports in Node, keeps loading there.

import { CommunityStore, CommunityError } from '../../membership/community-store.mjs';
import { sniffImage, LIMITS } from '../../membership/community-shared.mjs';

/** The binding's single object. One store holds everything (see community-store.mjs for why). */
export const COMMUNITY_OBJECT_NAME = 'community';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeRpc(msg, bytes = null) {
  const head = enc.encode(JSON.stringify(msg));
  const body = bytes instanceof Uint8Array ? bytes : null;
  const out = new Uint8Array(4 + head.length + (body ? body.length : 0));
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  if (body) out.set(body, 4 + head.length);
  return out;
}

export function decodeRpc(frame) {
  const buf = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (buf.length < 4) throw new Error('short frame');
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  if (4 + n > buf.length) throw new Error('bad frame length');
  const msg = JSON.parse(dec.decode(buf.subarray(4, 4 + n)));
  const rest = buf.subarray(4 + n);
  return { msg, bytes: rest.length ? rest : null };
}

/**
 * The store's adapter over a Durable Object's `ctx.storage.sql`. A Durable Object binds a BLOB from an ArrayBuffer and
 * returns one as an ArrayBuffer; the store speaks Uint8Array (as node:sqlite does), so convert on the way in.
 */
export function doSqlAdapter(sql) {
  return {
    exec(query, ...bindings) {
      const b = bindings.map((x) => (x instanceof Uint8Array ? x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) : x));
      return sql.exec(query, ...b).toArray();
    },
  };
}

// Per-member write limits, counted inside the object. A KV counter would add a read and a write to every answer and
// reaction, and KV accepts one write per second to a key, so two quick reactions would trip it. The object is single
// threaded and sees every call, so a plain in-memory window is exact while it runs, and resets if it is evicted, which
// only ever errs towards letting a member through. Superadmins run the meeting and are not limited.
export const WRITE_LIMITS = {
  write: { limit: 40, windowMs: 60_000 },
  upload: { limit: 24, windowMs: 10 * 60_000 },
};

export class WriteLimiter {
  constructor() { this.hits = new Map(); }
  take(key, { limit, windowMs }, t) {
    const recent = (this.hits.get(key) || []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) { this.hits.set(key, recent); return false; }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.hits.clear(); // a backstop against unbounded growth, never reached at our size
    return true;
  }
}

const str = (x) => (typeof x === 'string' ? x : '');

// The ops the Worker may call, and nothing else. `kind` says how each is limited and answered: read, write, upload,
// bytes (an image read, answered as raw bytes) and admin (superadmin only).
export const OPS = {
  list: { kind: 'read', run: (s, v, a) => s.listEntries(v, { kind: str(a.kind), meeting: str(a.meeting) }) },
  get: { kind: 'read', run: (s, v, a) => s.getEntry(v, str(a.id)) },
  updates: {
    kind: 'read',
    run: (s, v, a) => {
      const cur = s.version(v, str(a.id));
      return cur.version === Number(a.since) ? { unchanged: true, version: cur.version } : s.getEntry(v, str(a.id));
    },
  },
  image: { kind: 'bytes', run: (s, v, a) => s.getImage(v, str(a.id), str(a.img)) },
  answer: { kind: 'write', run: (s, v, a) => s.answer(v, str(a.id), a.input || {}) },
  post: { kind: 'write', run: (s, v, a) => s.post(v, str(a.id), a.input || {}) },
  editPost: { kind: 'write', run: (s, v, a) => s.editPost(v, str(a.id), str(a.postId), a.input || {}) },
  deletePost: { kind: 'write', run: (s, v, a) => s.deletePost(v, str(a.id), str(a.postId)) },
  react: { kind: 'write', run: (s, v, a) => s.react(v, str(a.id), str(a.postId), str(a.name)) },
  dropImage: { kind: 'write', run: (s, v, a) => s.dropImage(v, str(a.id), str(a.img)) },
  putImage: {
    kind: 'upload',
    run: (s, v, a, bytes) => {
      // The Worker validated the upload already. Judge the bytes again here, because this is where they are stored.
      const contentType = bytes ? sniffImage(bytes) : null;
      if (!contentType) throw new CommunityError(400, 'bad_request', 'Images must be PNG, JPG, GIF or WebP.');
      if (bytes.length > LIMITS.imageBytes) throw new CommunityError(400, 'bad_request', 'Images can be up to 1 MB each.');
      return s.putImage(v, str(a.id), { name: str(a.name) || 'image', contentType, bytes });
    },
  },
  create: { kind: 'admin', run: (s, v, a) => s.createEntry(v, a.input || {}, { open: a.open === true }) },
  edit: { kind: 'admin', run: (s, v, a) => s.editEntry(v, str(a.id), a.input || {}) },
  access: { kind: 'admin', run: (s, v, a) => s.setAccess(v, str(a.id), a.access || {}) },
  status: { kind: 'admin', run: (s, v, a) => s.setStatus(v, str(a.id), str(a.action)) },
  tidy: { kind: 'admin', run: (s, v, a) => s.tidy(v, str(a.id), a.tidy || {}) },
  moderate: { kind: 'admin', run: (s, v, a) => s.moderate(v, str(a.id), str(a.postId), str(a.action), a.imageId ? str(a.imageId) : null) },
  erase: { kind: 'admin', run: (s, v, a) => s.eraseMember(str(a.githubId)) },
};

const replyJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (status, error, message) => replyJson({ ok: false, error, message }, status);

/**
 * Run one call against the store. Pure over its arguments, so the route tests drive a real node:sqlite store through
 * exactly this function. `transact(fn)` makes the op all-or-nothing (the object passes ctx.storage.transactionSync).
 */
export function runOp(store, msg, bytes, { transact = (fn) => fn(), limiter = null, now = () => Date.now(), log = () => {} } = {}) {
  const op = Object.prototype.hasOwnProperty.call(OPS, msg?.op) ? OPS[msg.op] : null;
  if (!op) return failure(400, 'bad_request', 'Unknown operation.');
  const viewer = msg.viewer;
  if (!viewer || typeof viewer.githubId !== 'string') return failure(401, 'not-authenticated', 'Sign in to continue.');
  if (op.kind === 'admin' && viewer.superadmin !== true) return failure(403, 'forbidden', 'Only a superadmin can do that.');
  if (limiter && viewer.superadmin !== true && (op.kind === 'write' || op.kind === 'upload')) {
    if (!limiter.take(`${op.kind}:${viewer.githubId}`, WRITE_LIMITS[op.kind], now())) {
      return failure(429, 'rate_limited', 'That is a lot at once. Wait a minute and try again.');
    }
  }
  try {
    const value = transact(() => op.run(store, viewer, msg.args || {}, bytes));
    if (op.kind === 'bytes') {
      return new Response(value.bytes, {
        status: 200,
        headers: { 'Content-Type': value.contentType, 'X-Image-Name': encodeURIComponent(value.name || 'image') },
      });
    }
    return replyJson({ ok: true, ...(value && typeof value === 'object' ? value : {}) });
  } catch (e) {
    if (e instanceof CommunityError) return failure(e.status, e.code, e.message);
    log(e);
    return failure(500, 'internal', 'Something went wrong. Try again.');
  }
}

/** The Durable Object class, bound as COMMUNITY in wrangler.toml (class_name "CommunityDO"). */
export class CommunityDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.store = new CommunityStore(doSqlAdapter(ctx.storage.sql), { randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    this.limiter = new WriteLimiter();
  }

  async fetch(request) {
    if (request.method !== 'POST') return failure(405, 'method_not_allowed', 'POST only.');
    let frame;
    try {
      frame = decodeRpc(new Uint8Array(await request.arrayBuffer()));
    } catch {
      return failure(400, 'bad_request', 'The request could not be read.');
    }
    return runOp(this.store, frame.msg, frame.bytes, {
      transact: (fn) => this.ctx.storage.transactionSync(fn),
      limiter: this.limiter,
      log: (e) => console.error('community op failed', frame.msg?.op, e?.message || String(e)),
    });
  }
}

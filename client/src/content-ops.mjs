// Content operations (SOW-006): the managed-abstraction core that both the CMS UI and the MCP tools call
// to author content. It resolves the member's own folder from their immutable github_id, builds + validates
// frontmatter against the canonical schema, FORCES the gated fields (author/username, system-managed
// fields stripped), and serializes a content file. It never decides privilege: it scopes writes to the
// member's own folder so the client does not open PRs the SOW-005 gate would reject, but the gate remains
// the real boundary.

import yaml from 'js-yaml';
import { AUTHORABLE_TYPES, SYSTEM_MANAGED, schemaFor, shareSchema, commentSchema } from './schemas.mjs';

const SUBDIR = Object.freeze({ post: 'posts', product: 'products', prompt: 'prompts' });
const MAX_BODY_BYTES = 1_000_000; // 1MB cap on a content body (well under GitHub's per-file limit + the 2MB HTTP cap)

/** Resolve a github_id to its folder username via the members-index (Map or plain object). */
export function resolveUsername(githubId, membersIndex) {
  const id = String(githubId);
  if (membersIndex instanceof Map) return membersIndex.get(id) ?? null;
  if (membersIndex && typeof membersIndex === 'object') return membersIndex[id] ?? null;
  return null;
}

/** The repo path for a content item of the given type in a member's folder. */
export function contentPath(type, username, slug) {
  if (!username) throw new Error('contentPath: username is required');
  if (type === 'profile') return `members/${username}/profile.md`;
  const sub = SUBDIR[type];
  if (!sub) throw new Error(`contentPath: unknown type ${type}`);
  if (!slug) throw new Error(`contentPath: ${type} requires a slug`);
  // NESTED layout (matches the SOW-001 migration + validate-content + the Astro glob): one folder per item
  // (so assets can co-locate); the slug folder name == the slug.
  return `members/${username}/${sub}/${slug}/index.md`;
}

export function ownFolderPrefix(username) {
  return `members/${username}/`;
}

/** A member may author ONLY inside their own folder. Rejects traversal + other folders (UX scoping). */
export function canAuthorPath(path, username) {
  if (typeof path !== 'string' || !username) return false;
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  return path.startsWith(ownFolderPrefix(username));
}

/**
 * Remove system-managed fields and FORCE owner-controlled ones. The client must never let a member set
 * `contributors` (merge automation owns it), their `tier`/`joinedAt` (membership system owns it), or claim
 * a different `author`/`username` than themselves.
 */
export function sanitizeInput(type, input, username) {
  const out = { ...(input ?? {}) };
  for (const field of SYSTEM_MANAGED[type] ?? []) delete out[field];
  out.type = type;
  if (type === 'profile') out.username = username;
  else out.author = username;
  return out;
}

export class ContentValidationError extends Error {
  constructor(type, issues) {
    const detail = issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    super(`invalid ${type}: ${detail}`);
    this.name = 'ContentValidationError';
    this.contentType = type;
    this.issues = issues;
  }
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Build a validated content file for a member's own folder.
 * @returns {{ path, frontmatter, markdown, type, username, slug }}
 * @throws ContentValidationError on schema failure; Error on a non-authorable type / missing username.
 */
export function buildContentFile({ type, username, input, body = '' }) {
  if (!AUTHORABLE_TYPES.includes(type)) throw new Error(`buildContentFile: ${type} is not an authorable type`);
  if (!username) throw new Error('buildContentFile: username is required');

  const schema = schemaFor(type);
  const cleaned = sanitizeInput(type, input, username);

  const result = schema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError(type, result.error.issues);

  // Bound the body so a single publish cannot stage a runaway file (well under GitHub's per-file limit).
  const bodyStr = String(body ?? '').trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError(type, [{ path: ['body'], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }

  const slug = type === 'profile' ? null : cleaned.slug;
  const path = contentPath(type, username, slug);

  // Serialize the cleaned input (validity already proven) so we preserve the author's original date
  // strings and omit defaulted noise; the gate / CI apply schema defaults at build time.
  const frontmatter = stripUndefined(cleaned);
  const markdown = serializeContentFile(frontmatter, body);

  return { path, frontmatter, markdown, type, username, slug };
}

/** SOW-018: derive a filesystem-safe, sortable Share id (a timestamp-slug) from its createdAt + optional title.
 *  e.g. ("2026-06-10T13:22:09Z", "Astro is great") -> "20260610132209-astro-is-great". Pure (no clock). */
export function shareId(createdAt, title) {
  const ts = String(createdAt ?? '').replace(/[^0-9]/g, '').slice(0, 14);
  const slug = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const stamp = ts || '00000000000000';
  return slug ? `${stamp}-${slug}` : `${stamp}-share`;
}

/**
 * Build a validated Share file (SOW-018) for a member's own shares/ folder. A Share is one flat file with a
 * dedicated layout (members/<username>/shares/<id>.md), NOT the generic <slug>/index.md form, so it has its own
 * builder. FORCES author = the owner and type = 'share'. Returns the buildContentFile-compatible shape so the
 * SOW-016 member-only encrypt path (planMemberFiles) and publishFiles can consume it unchanged.
 * @returns {{ path, frontmatter, markdown, type:'share', username, slug, id }}
 * @throws ContentValidationError on schema failure; Error on a missing username.
 */
export function buildShareFile({ username, input, body = '' }) {
  if (!username) throw new Error('buildShareFile: username is required');
  const cleaned = stripUndefined({ ...(input ?? {}), type: 'share', author: username });
  const result = shareSchema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError('share', result.error.issues);
  const id = cleaned.id;
  const bodyStr = String(body ?? '').trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError('share', [{ path: ['body'], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const path = `members/${username}/shares/${id}.md`;
  const markdown = serializeContentFile(cleaned, body);
  // slug = id so planMemberFiles (which keys encryption on built.slug + built.type) treats the Share like a
  // body-bearing item; encAssetFor('share', username, id) puts the .enc under members/<u>/_enc/ (SOW-016).
  return { path, frontmatter: cleaned, markdown, type: 'share', username, slug: id, id };
}

/**
 * SOW-018: summarize a Share file (frontmatter + body) into the feed item the Shares reading feed renders.
 * Shared by BOTH readers (repo-fs + github-reader) so they emit an identical shape. The `body` field carries
 * the PUBLIC markdown for a public Share only; a members Share's body lives in its `.enc` (and its stub `.md`
 * body is empty anyway), so the plaintext never travels through the list — the client decrypts `encryptedBody`
 * via the Worker. createdAt is normalized to an ISO string (yaml may parse it to a Date).
 */
export function shareSummary(relPath, frontmatter = {}, body = '') {
  const fm = frontmatter || {};
  const isPublic = fm.visibility !== 'members';
  let createdAt = null;
  if (fm.createdAt != null) {
    const d = fm.createdAt instanceof Date ? fm.createdAt : new Date(fm.createdAt);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return {
    path: relPath,
    id: fm.id ?? null,
    author: fm.author ?? null,
    title: fm.title ?? null,
    shortDescription: fm.shortDescription ?? null, // SOW-032
    url: fm.url ?? null,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    visibility: fm.visibility ?? 'members',
    status: fm.status ?? null,
    encryptedBody: typeof fm.encryptedBody === 'string' ? fm.encryptedBody : null,
    createdAt,
    body: isPublic ? String(body ?? '') : '', // members body is gated; never surfaced here
  };
}

/** SOW-032: a comment summary for the in-extension discussion (the Shares discussion thread). Like shareSummary,
 *  a members comment's plaintext is NOT surfaced here (the .enc is decrypted client-side via the Worker); only a
 *  public comment carries its body. The from-the-author authorNote flag is passed through so a thread can style
 *  it if needed (not used for Shares, which have no intro requirement). */
export function commentSummary(relPath, frontmatter = {}, body = '') {
  const fm = frontmatter || {};
  const isPublic = fm.visibility !== 'members';
  let createdAt = null;
  if (fm.createdAt != null) {
    const d = fm.createdAt instanceof Date ? fm.createdAt : new Date(fm.createdAt);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return {
    path: relPath,
    id: fm.id ?? null,
    author: fm.author ?? null,
    targetType: fm.targetType ?? null,
    targetSlug: fm.targetSlug ?? null,
    parentId: fm.parentId ?? null,
    authorNote: fm.authorNote === true,
    visibility: fm.visibility ?? 'public',
    status: fm.status ?? null,
    encryptedBody: typeof fm.encryptedBody === 'string' ? fm.encryptedBody : null,
    createdAt,
    body: isPublic ? String(body ?? '') : '', // members body is gated; decrypted client-side via the Worker
  };
}

/** Oldest-first for a discussion thread (conversations read top-down). Deterministic id/path tie-break. */
export function byCommentOldest(a, b) {
  const t = String(a?.createdAt ?? '').localeCompare(String(b?.createdAt ?? ''));
  if (t !== 0) return t;
  return String(a?.id ?? a?.path ?? '').localeCompare(String(b?.id ?? b?.path ?? ''));
}

/** Sort Share summaries newest-first by createdAt (ISO strings compare lexically), undated last. A deterministic
 *  id/path tie-break keeps BOTH hosts (npm fs order vs extension tree order) ordering identical-timestamp shares
 *  the same way (stable-sort input order would otherwise differ between hosts). */
export function byShareNewest(a, b) {
  const t = String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? ''));
  if (t !== 0) return t;
  return String(b?.id ?? b?.path ?? '').localeCompare(String(a?.id ?? a?.path ?? ''));
}

/** SOW-027: a sortable comment id = a timestamp stem + a short suffix (the spec's "sortable ULID/timestamp",
 *  no new dependency; same family as shareId). Pure given createdAt + an injected suffix. */
export function commentId(createdAt, suffix) {
  const ts = String(createdAt ?? '').replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const s = String(suffix ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'c';
  return `${ts}-${s}`;
}

/**
 * Build a validated comment file (SOW-027) for a member's own comments/ folder. One flat file per comment
 * (members/<username>/comments/<id>.md), NOT the generic <slug>/index.md form, so it has its own builder.
 * FORCES author = the owner and type = 'comment'. Returns the buildContentFile-compatible shape so the SOW-016
 * member-only encrypt path (planMemberFiles) and publishFiles can consume it unchanged.
 * @returns {{ path, frontmatter, markdown, type:'comment', username, slug, id }}
 */
export function buildCommentFile({ username, input, body = '' }) {
  if (!username) throw new Error('buildCommentFile: username is required');
  const cleaned = stripUndefined({ ...(input ?? {}), type: 'comment', author: username });
  const result = commentSchema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError('comment', result.error.issues);
  const id = cleaned.id;
  const bodyStr = String(body ?? '').trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError('comment', [{ path: ['body'], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const path = `members/${username}/comments/${id}.md`;
  const markdown = serializeContentFile(cleaned, body);
  // slug = id so planMemberFiles (which keys encryption on built.slug + built.type) treats a members comment
  // like a body-bearing item; encAssetFor('comment', username, id) puts the .enc under members/<u>/_enc/.
  return { path, frontmatter: cleaned, markdown, type: 'comment', username, slug: id, id };
}

/** Serialize a frontmatter object + body into a content file string (the same shape buildContentFile emits).
 *  Exported so the SOW-016 member-only publish path can rebuild index.md with a public teaser + encryptedBody. */
export function serializeContentFile(frontmatter, body) {
  const front = yaml.dump(stripUndefined(frontmatter), { lineWidth: 100, noRefs: true }).trimEnd();
  return `---\n${front}\n---\n\n${String(body ?? '').trim()}\n`;
}

/** Split a content file into { frontmatter, body } for editing an existing item. */
export function parseContentFile(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text ?? ''));
  if (!m) return { frontmatter: {}, body: String(text ?? '') };
  return { frontmatter: yaml.load(m[1]) ?? {}, body: (m[2] ?? '').replace(/^\n+/, '') };
}

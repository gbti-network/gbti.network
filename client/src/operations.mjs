// Shared operations core (SOW-006). The managed abstractions, transport-agnostic: the CMS HTTP API
// (api.mjs) and the MCP tools (mcp-tools.mjs) both call these, so the human UI and a member's agents drive
// the EXACT same content-ops + publish flow. None of this decides privilege: it scopes to the member's own
// folder and forces the gated fields (via content-ops), but the SOW-005 gate remains authoritative.
//
// Errors are typed OperationError(code, ...) so each transport can map a code to its own shape (HTTP status
// or MCP isError). Codes: no-identity | not-authenticated | not-found | bad-request | invalid-content.

import { buildContentFile, buildShareFile, shareId as makeShareId, buildCommentFile, commentId as makeCommentId, serializeContentFile, parseContentFile, ContentValidationError } from './content-ops.mjs';
import { publishContent, publishFiles, branchName } from './publish.mjs';
import { canPublish, isBlockedFromPublishing } from './membership.mjs';
import { splitMemberMarkdown, encAssetFor, encryptViaWorker, decryptViaWorker, MemberContentLockedError } from './member-content.mjs';
import {
  getActivity as workerGetActivity, setFavorite as workerSetFavorite, createCollection as workerCreateCollection,
  renameCollection as workerRenameCollection, deleteCollection as workerDeleteCollection,
  setCollectionItem as workerSetCollectionItem, ActivityClientError,
} from './member-activity-client.mjs';
import { getFollows as workerGetFollows, setFollow as workerSetFollow, FollowsClientError } from './member-follows-client.mjs';
import { getDiscordInvite as workerGetDiscordInvite, InviteClientError } from './member-invite-client.mjs';
import { workerGetNews, NewsClientError } from './news-client.mjs'; // SOW-043: members-only news proxy
import { probeReadiness } from './github-app-probe.mjs';
import {
  nextStep as onboardingNextStep, STEPS as ONBOARDING_STEPS, forkFullName,
  deviceVerificationUrl, forkUrl, appInstallUrl, manageInstallsUrl,
} from './onboarding.mjs';
import { SIGNUP_BASE, GITHUB_APP_SLUG, UPSTREAM_REPO, isAppMode } from './signup-base.mjs';
import { isContributionToFolder } from '../../membership/classify-pr.mjs';
import yaml from 'js-yaml';
import { rolesFromParsed, roleOf, isAdminRole } from '../../membership/overrides-core.mjs';
import { buildRoster } from '../../membership/superadmin-roster.mjs';
import { getRosterStatuses as workerGetRosterStatuses } from './member-admin-client.mjs';

export const CLIENT_VERSION = '0.1.0';

export class OperationError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'OperationError';
    this.code = code;
    this.details = details;
  }
}

function requireIdentity(ctx) {
  const id = ctx.identity?.();
  if (!id?.username) throw new OperationError('no-identity', 'no signed-in identity; run `gbti login`');
  return id;
}

function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'not authenticated; run `gbti login` first');
  return repo;
}

export function getStatus(ctx) {
  const id = ctx.identity?.() ?? null;
  // SOW-011: the cached membership (paid/trialing/...) drives the "membership required to publish" notice in
  // the UI and gates publish below. 'unknown' until the status oracle has been fetched at login.
  const membership = ctx.membership?.() ?? 'unknown';
  return {
    version: CLIENT_VERSION,
    identity: id,
    role: ctx.role?.() ?? 'member',
    authenticated: Boolean(ctx.store?.get('githubToken')),
    repoPath: ctx.store?.get('repoPath') ?? null,
    mcpEnabled: ctx.store?.get('mcpEnabled') ?? null,
    membership,
    canPublish: canPublish(membership),
  };
}

export function listContent(ctx, { type } = {}) {
  const id = requireIdentity(ctx);
  return { items: ctx.reader.list(id.username, type || undefined) };
}

/** List members-only content (visibility: members) across all folders, for the members-only portal. */
export function listMembersOnly(ctx) {
  requireIdentity(ctx);
  return { items: ctx.reader.listMembersOnly() };
}

/**
 * SOW-018: list PUBLISHED Shares across all members for the extension/client Shares feed (newest-first, capped).
 * Returns metadata + the PUBLIC body only; a members Share's body is decrypted client-side via decryptMemberAsset
 * (the Worker allows an active trial to read a Share, paid too; lapsed/banned are denied). Async so the SAME op
 * works over the sync npm reader and the async extension (GitHub) reader. requireIdentity only: the listed
 * metadata is public-repo stub data; the Worker gates the encrypted bodies.
 */
export async function listShares(ctx, { limit } = {}) {
  requireIdentity(ctx);
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 40;
  if (typeof ctx.reader?.listShares !== 'function') return { items: [] };
  return { items: (await ctx.reader.listShares(n)) ?? [] };
}

/**
 * SOW-032: list PUBLISHED comments for one Share's discussion thread (oldest-first). targetSlug is the composite
 * "<author>/<shareId>" the share carries. Like listShares, this returns public-repo stub metadata + the PUBLIC
 * body only; a members comment's body is decrypted client-side via decryptMemberAsset (Worker-gated). Async so
 * the SAME op serves the sync npm reader and the async extension (GitHub) reader. requireIdentity only.
 */
export async function listShareComments(ctx, { targetSlug, limit } = {}) {
  requireIdentity(ctx);
  if (!targetSlug || typeof targetSlug !== 'string') throw new OperationError('bad-request', 'targetSlug is required');
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  if (typeof ctx.reader?.listShareComments !== 'function') return { items: [] };
  return { items: (await ctx.reader.listShareComments(targetSlug, n)) ?? [] };
}

// SOW-041: the generic comment thread for ANY content type (post/product/prompt/share). Powers the shared
// <gbti-discussion> in the expanded reader; listShareComments is the 'share' specialization. Same read surface
// (the COMMENT_PATH enumeration + the published filter), just parameterized on targetType.
const COMMENT_TARGET_TYPES = new Set(['post', 'product', 'prompt', 'share']);
export async function listComments(ctx, { targetType, targetSlug, limit } = {}) {
  requireIdentity(ctx);
  if (!COMMENT_TARGET_TYPES.has(targetType)) throw new OperationError('bad-request', 'a valid targetType is required');
  if (!targetSlug || typeof targetSlug !== 'string') throw new OperationError('bad-request', 'targetSlug is required');
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  if (typeof ctx.reader?.listComments !== 'function') return { items: [] };
  return { items: (await ctx.reader.listComments(targetType, targetSlug, n)) ?? [] };
}

/**
 * SOW-031: read ANY published content index.md for the in-extension reader (cross-member, allowlist-gated),
 * unlike getContentItem which is own-folder-scoped for editing. The reader's `read` enforces isReadablePath
 * (only posts/products/prompts index.md, no traversal), so the member token / local clone cannot become a
 * general file-exfil oracle. Async so the SAME op serves the sync npm reader (repo-fs) and the async extension
 * (github) reader. requireIdentity only: the body is public-repo content (a members body comes back gated, its
 * .enc decrypted client-side via the Worker), but gating on a signed-in identity matches the extension dispatch.
 */
export async function readContent(ctx, { path } = {}) {
  requireIdentity(ctx);
  if (!path || typeof path !== 'string') throw new OperationError('bad-request', 'path is required');
  if (typeof ctx.reader?.read !== 'function') throw new OperationError('not-found', 'no such readable content');
  const item = await ctx.reader.read(path);
  if (!item) throw new OperationError('not-found', 'no such readable content');
  return item;
}

export function getContentItem(ctx, { path } = {}) {
  const id = requireIdentity(ctx);
  if (!path) throw new OperationError('bad-request', 'path is required');
  const item = ctx.reader.get(id.username, path);
  if (!item) throw new OperationError('not-found', 'no such item in your folder');
  return item;
}

/** Validate WITHOUT publishing. Never throws on a content error: returns { valid:false, ... } so a UI/agent can show it. */
export function validateContent(ctx, { type, input, body } = {}) {
  const id = requireIdentity(ctx);
  try {
    const built = buildContentFile({ type, username: id.username, input, body });
    return { valid: true, path: built.path };
  } catch (err) {
    if (err instanceof ContentValidationError) return { valid: false, error: err.message, issues: err.issues };
    return { valid: false, error: err.message };
  }
}

/** Build + publish a content change as (or into) a PR through the gate. */
export async function publish(ctx, { type, input, body, message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  // SOW-011: publishing to the canonical repo is paid-only. Block a KNOWN non-paid (trial / lapsed) member
  // BEFORE opening any PR, so their draft stays on their own fork and nothing reaches the canonical repo.
  // 'unknown' (oracle unreachable) fails OPEN to the SOW-005 gate, which is the real authority and rejects a
  // genuinely non-paid PR anyway, so a paid member is never wrongly blocked when the oracle is down.
  const membership = (await ctx.membership?.()) ?? 'unknown';
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError(
      'membership-required',
      'Publishing on gbti.network requires a paid membership. Your draft is saved; upgrade at https://gbti.network and publish your work.',
      { membership },
    );
  }
  let built;
  try {
    built = buildContentFile({ type, username: id.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }

  // SOW-016: if the content is whole-item members-only or has a `<!-- members-only -->` section, encrypt the
  // gated markdown SERVER-SIDE (the Worker holds the key; it never reaches us) and commit the ciphertext plus
  // the public stub as ONE PR. Plain public content takes the unchanged single-file path.
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    // The Worker rejected encrypt with 401/403 (the author is not effective-paid). This is the fail-CLOSED
    // path when the local oracle was 'unknown': surface a clean upgrade nudge, and NO PR is opened.
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Publishing member-only content requires a paid membership. Your draft is saved; upgrade at https://gbti.network and publish.', { membership });
    }
    throw err;
  }
  if (plan) {
    return publishFiles({ repo, branch: branchName(built.type, built.slug), files: plan.files, message, title, body: prBody });
  }
  return publishContent({ repo, change: built, message, title, body: prBody });
}

/**
 * SOW-016: plan the files for a member-only publish. Whole-item members-only, or a `<!-- members-only -->`
 * section, has its gated markdown encrypted (via the injected `encrypt`, which calls the Worker) and committed
 * as a sibling .enc, while index.md keeps only the public teaser plus an `encryptedBody` reference. Returns
 * { files, encPath, assetId } or null for plain public content. Pure over `encrypt`, so it is unit-testable.
 */
export async function planMemberFiles({ built, body, encrypt }) {
  if (!built?.slug) return null; // profiles + slugless types are never body-gated
  const vis = built.frontmatter?.visibility ?? 'public';
  let publicPart = '';
  let memberPart = null;
  if (vis === 'members') {
    memberPart = String(body ?? '').trim(); // whole-item: the ENTIRE body is gated (Mode A or B)
    if (!memberPart) return null; // a members item with an empty body: nothing to encrypt (plain publish)
  } else {
    const split = splitMemberMarkdown(body);
    if (split.memberPart == null) return null; // plain public content (no marker): no encryption
    publicPart = split.publicPart;
    memberPart = split.memberPart;
    if (!memberPart) {
      // The marker is present but the gated tail is empty. STRIP the marker (publicPart already excludes it)
      // and publish the public part as a plain post, so the literal `<!-- members-only -->` never reaches index.md.
      return { files: [{ path: built.path, content: serializeContentFile(built.frontmatter, publicPart) }] };
    }
  }
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug);
  const envelope = await encrypt(memberPart, assetId);
  const markdown = serializeContentFile({ ...built.frontmatter, encryptedBody: encPath }, publicPart);
  return {
    files: [
      { path: built.path, content: markdown },
      { path: encPath, content: JSON.stringify(envelope) },
    ],
    encPath,
    assetId,
  };
}

/**
 * SOW-016 read path: decrypt a member-only .enc asset for the signed-in member. The host reads the ciphertext
 * via its reader (fs / GitHub Contents API) and asks the Worker to decrypt it; the AES key never reaches the
 * client. Returns { text } (the plaintext markdown). A non-effective-paid member -> membership-required.
 */
// A member-only asset path is ALWAYS members/<owner>/_enc/<name>.enc or house/_enc/<name>.enc (encAssetFor).
// Validate it so the decrypt route cannot be pointed at an arbitrary repo file (a member can hand-edit their
// frontmatter encryptedBody): only an .enc under an _enc/ dir, no traversal. SOW-031 hardening.
const ENC_PATH_RE = /^(members\/[a-z0-9][a-z0-9-]*|house)\/_enc\/[a-z0-9][a-z0-9._-]*\.enc$/;

export async function decryptMemberAsset(ctx, { encPath } = {}) {
  requireIdentity(ctx);
  if (!encPath || typeof encPath !== 'string') throw new OperationError('bad-request', 'encPath is required');
  if (!ENC_PATH_RE.test(encPath)) throw new OperationError('bad-request', 'invalid encrypted-asset path');
  let raw;
  try {
    raw = await ctx.reader.readFile(encPath);
  } catch {
    throw new OperationError('not-found', `could not read the encrypted asset: ${encPath}`);
  }
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new OperationError('bad-request', 'the encrypted asset is not a valid envelope'); }
  const token = ctx.store?.get?.('githubToken');
  try {
    const text = await decryptViaWorker({ envelope, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { text };
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'This content is for paid members. Upgrade at https://gbti.network to unlock.');
    }
    throw new OperationError('decrypt-failed', err?.message || 'could not decrypt the asset');
  }
}

/**
 * SOW-018: publish a member "Share" (a status update) into the member's own shares/ folder. A members Share
 * (the default) has its body encrypted SERVER-SIDE (the Worker holds the key, SOW-016) and is committed as a
 * stub .md + a sibling .enc in ONE PR; a public Share is a single plain .md. Paid-only (SOW-011): a known
 * non-paid member is blocked BEFORE any PR opens. The id is a sortable timestamp-slug derived from createdAt.
 */
export async function publishShare(ctx, { input = {}, body = '', message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = (await ctx.membership?.()) ?? 'unknown';
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Publishing Shares on gbti.network requires a paid membership. Upgrade at https://gbti.network and post your Share.', { membership });
  }
  // INVARIANT (SOW-018): a Share's id ENCODES its createdAt (makeShareId derives the timestamp-slug from it),
  // and Shares are append-only — never re-timestamped after publish. So the id-filename order always tracks the
  // createdAt order, which is what lets the extension feed select the newest Shares by filename before reading.
  const createdAt = input.createdAt ?? (ctx.now?.() ?? new Date().toISOString());
  const id_ = input.id ?? makeShareId(createdAt, input.title);
  let built;
  try {
    built = buildShareFile({ username: id.username, input: { ...input, id: id_, createdAt }, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt }); // members Share -> encrypts the whole body to .enc
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Publishing a members-only Share requires a paid membership. Upgrade at https://gbti.network.', { membership });
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  await publishFiles({
    repo,
    branch: `gbti/share-${id_}`, // idempotent by branch: re-publishing the same id updates the same PR
    files,
    message: message ?? `Share: ${built.frontmatter.title || id_}`,
    title: title ?? `New Share${built.frontmatter.title ? `: ${built.frontmatter.title}` : ''}`,
    body: prBody,
  });
  return { id: id_, path: built.path, visibility: built.frontmatter.visibility ?? 'members', encrypted: Boolean(plan?.encPath) };
}

// SOW-027: member comment authoring. Comments are one flat file per comment in the member's own comments/
// folder (auto-merge own-folder, SOW-005), paid-only to publish (SOW-011). A public comment is plain; a members
// comment encrypts its body (SOW-016, like shares). Editing re-publishes the same id with `updatedAt` set, so
// the SOW-014 "edited . view history" link (the git history) appears. The data model + render already exist.
const commentSuffix = () => Math.random().toString(36).slice(2, 8); // short collision-avoidance suffix for the id

async function planAndPublishComment(ctx, repo, built, body, { message, title, prBody }) {
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt }); // members comment -> encrypt the body to .enc
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Posting a members-only comment requires a paid membership. Upgrade at https://gbti.network.');
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  // Idempotent by branch: re-editing the same comment id updates the same PR.
  await publishFiles({ repo, branch: `gbti/comment-${built.id}`, files, message, title, body: prBody });
  return { id: built.id, path: built.path, visibility: built.frontmatter.visibility ?? 'public', encrypted: Boolean(plan?.encPath) };
}

export async function publishComment(ctx, { targetType, targetSlug, body, authorNote, parentId, visibility, message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = (await ctx.membership?.()) ?? 'unknown';
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Commenting on gbti.network requires a paid membership. Upgrade at https://gbti.network.', { membership });
  }
  const createdAt = ctx.now?.() ?? new Date().toISOString();
  const cid = makeCommentId(createdAt, commentSuffix());
  const input = { id: cid, targetType, targetSlug, createdAt, status: 'published' };
  // SOW-044: comments are members-only + encrypted. The ONLY public comment is a from-the-author intro
  // (authorNote) on a post/product/prompt; a discussion reply, and ANY comment on a Share, is always members. The
  // server is the boundary: coerce anything that is not a legitimate public intro to members, regardless of what
  // the client sent (a members body is then encrypted by planMemberFiles, never committed plaintext).
  const isPublicIntro = authorNote === true && ['post', 'product', 'prompt'].includes(targetType);
  input.visibility = (visibility === 'public' && isPublicIntro) ? 'public' : 'members';
  if (authorNote) input.authorNote = true;
  if (parentId) input.parentId = parentId;
  let built;
  try {
    built = buildCommentFile({ username: id.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: message ?? `Comment on ${targetType} ${targetSlug}`,
    title: title ?? `Comment on ${targetType}: ${targetSlug}`,
    prBody,
  });
  return { ...r, targetType: built.frontmatter.targetType, targetSlug: built.frontmatter.targetSlug };
}

/** Read one of the member's OWN comments (frontmatter + body), for the edit-form prefill. A members comment
 *  stores its body in the .enc (the stub .md body is EMPTY), so decrypt it for the prefill — otherwise editing
 *  would start from a blank textarea and a save would replace the gated text (silent data loss). The signed-in
 *  author IS the owner + effective-paid, so the Worker decrypt succeeds. */
export async function getComment(ctx, { id } = {}) {
  const idn = requireIdentity(ctx);
  if (!id || typeof id !== 'string') throw new OperationError('bad-request', 'a comment id is required');
  const item = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!item) throw new OperationError('not-found', 'no such comment in your folder');
  const enc = item.frontmatter?.encryptedBody;
  if (enc) {
    const { text } = await decryptMemberAsset(ctx, { encPath: enc }); // reads the .enc + Worker-decrypts; key stays in the Worker
    return { ...item, body: text };
  }
  return item;
}

export async function editComment(ctx, { id, body, authorNote } = {}) {
  const idn = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (!id || typeof id !== 'string') throw new OperationError('bad-request', 'a comment id is required');
  const membership = (await ctx.membership?.()) ?? 'unknown';
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Editing a comment on gbti.network requires a paid membership. Upgrade at https://gbti.network.', { membership });
  }
  const existing = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!existing) throw new OperationError('not-found', 'no such comment in your folder');
  // Own-folder scope is enforced by reader.get (rejects out-of-folder paths) AND re-checked here.
  if (existing.frontmatter?.author && existing.frontmatter.author !== idn.username) {
    throw new OperationError('not-authorized', 'you can only edit your own comments');
  }
  const fm = existing.frontmatter ?? {};
  const updatedAt = ctx.now?.() ?? new Date().toISOString();
  // SOW-044: re-derive visibility the SAME way publishComment does, so an edit can NEVER strand a comment as a
  // public non-intro (or a public Share comment) with a plaintext body. A comment is public only as a
  // from-the-author intro (authorNote) on a post/product/prompt; anything else is coerced to members and its body
  // is re-encrypted on re-publish. Symmetric with publishComment (the CI guards are the backstop, not the boundary).
  const effAuthorNote = authorNote !== undefined ? Boolean(authorNote) : Boolean(fm.authorNote);
  const isPublicIntro = effAuthorNote && ['post', 'product', 'prompt'].includes(fm.targetType);
  // Preserve identity-defining fields; set updatedAt so the "edited . view history" link renders.
  const input = {
    id,
    targetType: fm.targetType,
    targetSlug: fm.targetSlug,
    status: fm.status ?? 'published',
    visibility: (fm.visibility === 'public' && isPublicIntro) ? 'public' : 'members',
    authorNote: effAuthorNote,
    parentId: fm.parentId,
    createdAt: fm.createdAt,
    updatedAt,
  };
  let built;
  try {
    built = buildCommentFile({ username: idn.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: `Edit comment ${id}`,
    title: `Edit comment on ${fm.targetType}: ${fm.targetSlug}`,
    prBody: undefined,
  });
  // Carry the target back (mirrors publishComment) so the gbti-comment-edited event can refresh the right open
  // thread (e.g. the SOW-032 Shares discussion, keyed on the composite targetSlug).
  return { ...r, edited: true, targetType: fm.targetType, targetSlug: fm.targetSlug };
}

// SOW-024: member activity (favorites + collections) in the deletable edge store, via the signup Worker.
// Collections let a member organize prompts (and posts/products) into named lists, in addition to favoriting.
// The host holds the member's GitHub token; signupBase is the Worker. Errors map to OperationError codes.
function mapActivityError(err) {
  if (err instanceof ActivityClientError && /not signed in/i.test(err.message)) {
    return new OperationError('not-authenticated', 'Sign in to manage favorites and collections.');
  }
  return new OperationError('activity-failed', err?.message || 'the activity request failed');
}

export async function getMemberActivity(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetActivity({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.activity ?? { favorites: [], collections: [] };
  } catch (err) {
    throw mapActivityError(err);
  }
}

export async function mutateMemberActivity(ctx, payload = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  const opts = { token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  try {
    switch (payload.action) {
      case 'favorite': return await workerSetFavorite({ ...payload, ...opts });
      case 'collection.create': return await workerCreateCollection({ ...payload, ...opts });
      case 'collection.rename': return await workerRenameCollection({ ...payload, ...opts });
      case 'collection.delete': return await workerDeleteCollection({ ...payload, ...opts });
      case 'collection.item': return await workerSetCollectionItem({ ...payload, ...opts });
      default: throw new OperationError('bad-request', 'unknown activity action');
    }
  } catch (err) {
    if (err instanceof OperationError) throw err;
    throw mapActivityError(err);
  }
}

// SOW-023: the follow graph (subscriptions). Effective-paid only (the Worker is the authority, fail-closed);
// a follow writes the private, erasable edge store, never a PR.
function mapFollowsError(err) {
  if (err instanceof FollowsClientError && /not signed in/i.test(err.message)) {
    return new OperationError('not-authenticated', 'Sign in to follow members.');
  }
  return new OperationError('follows-failed', err?.message || 'the follows request failed');
}

/** The signed-in member's follow list ({ following: [{ username, addedAt }] }). */
export async function getFollows(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetFollows({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}

/** Follow (on:true) or unfollow (on:false) a member by username. Returns the updated following list. */
export async function setFollow(ctx, { username, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerSetFollow({ username, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}

/**
 * The on-demand Discord invite for the welcome view. The bot mints/caches the invite in the Worker (token never
 * leaves it); this returns { url, source }. requireIdentity only; the Worker re-verifies the token. Failures map
 * to an OperationError so the welcome view can fall back to the static DISCORD_INVITE_URL.
 */
// SOW-043: the members-only news feed (proxied through the signup Worker, which holds NEWS_API_KEY). Effective-paid
// gated server-side; a non-paid/locked caller -> membership-required. Returns { items, updatedAt }.
export async function getNews(ctx, { category, since, limit } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerGetNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, category, since, limit });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in to read the news.');
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', 'News is a members-only perk. Upgrade at https://gbti.network.');
    throw new OperationError('news-failed', err?.message || 'the news request failed');
  }
}

export async function getDiscordInvite(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetDiscordInvite({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { url: r?.url ?? null, source: r?.source ?? null };
  } catch (err) {
    if (err instanceof InviteClientError && /not signed in/i.test(err.message)) {
      throw new OperationError('not-authenticated', 'Sign in to get a Discord invite.');
    }
    throw new OperationError('invite-failed', err?.message || 'the Discord invite request failed');
  }
}

// SOW-026: first-run onboarding readiness. Reads durable GitHub state (token, fork, App install) and returns the
// first not-yet-done step, so the wizard never loops on a cleared store. Only meaningful in app-mode (classic
// has no fork/install onboarding); in classic mode the wizard is dormant (ready once signed in).
export async function getOnboardingStatus(ctx) {
  const token = ctx.store?.get?.('githubToken');
  if (!isAppMode()) {
    // Classic mode: there is no fork/install step. Signed-in = ready.
    return { appMode: false, signedIn: !!token, forkReady: true, installReady: true, activeStep: token ? 'ready' : 'signin', ready: !!token, reachedGithub: true };
  }
  const r = await probeReadiness({ token, appSlug: GITHUB_APP_SLUG, upstream: UPSTREAM_REPO, fetch: ctx.fetch ?? globalThis.fetch });
  // Self-heal a DEAD token: if GitHub reached us and rejected the token (reachedGithub && !signedIn) while a token
  // was stored, the App user token is expired/revoked and the public client cannot refresh it. Clear the stale
  // token + identity so the UI shows ONE clean "sign in" prompt instead of "Signed in as @x" alongside "0 of 3".
  // probeReadiness sets reachedGithub on a definitive 401 only, never a transient error, so this never signs a
  // member out on a GitHub blip. (The ROOT fix is the App's "Expire user authorization tokens" = OFF.)
  if (token && r.reachedGithub && !r.signedIn) {
    try { ctx.store?.set?.({ githubToken: null, identity: null }); } catch { /* best-effort */ }
  }
  const activeStep = onboardingNextStep(r);
  // Enrich with the step copy + the resolved deep-links so the UI component is purely data-driven (no
  // cross-package import). The install link preselects the member account via their numeric id.
  return {
    appMode: true, ...r, activeStep, ready: activeStep === 'ready',
    forkName: r.login ? forkFullName(r.login) : null,
    steps: ONBOARDING_STEPS,
    links: { device: deviceVerificationUrl(), fork: forkUrl(), install: appInstallUrl({ targetId: r.githubId }), manage: manageInstallsUrl() },
  };
}

// SOW-024: favorites are RETIRED from git. A favorite used to be written to members/<me>/favorites.yml via an
// auto-merged PR (SOW-013), but that put behavioral personal data (who-favorited-what) into the immutable public
// repo, which cannot honor a right-to-erasure. Favorites now flow through mutateMemberActivity (action
// 'favorite') into the deletable edge store (KV), keyed by github_id; the public site only ever sees the
// member-identity-free aggregate counts in house/favorite-counts.yml (synced KV -> git by reconcile). There is
// no longer a git favorites write path here, no favorites gate carve-out, and no favorites.yml validation.

// SOW-038 P2: the superadmin dashboard roster. Reads the four PUBLIC override files via the host reader (sync on
// the npm host, async on the extension; `await` handles both) and returns every known member with their
// OVERRIDE-derived effective status (ban > staff > grandfather). ADMIN-gated: the caller's own role is derived
// from the roles.yml this op already reads, so it needs no host role() and works in both hosts. Governance status
// (who is banned/grandfathered) is sensitive, so it is never published — it only flows to an admin+ caller here.
// Live per-member Stripe paid/trial is NOT included (it needs a Stripe-key Worker endpoint); buildRoster marks
// that tier 'unknown'.
// Admin gate for the superadmin surfaces. Derives the caller's OWN role from the roles.yml it reads (no
// dependency on a host-provided role(), so it works identically in both hosts), fail-closed. Returns the parsed
// roles + a reader so a caller that also needs the other house files does not re-read roles.yml.
async function requireAdmin(ctx) {
  const id = requireIdentity(ctx);
  const readText = async (p) => { try { return (await ctx.reader?.readFile?.(p)) || ''; } catch { return ''; } };
  const rolesParsed = yaml.load(await readText('house/roles.yml')) || {};
  const role = roleOf(String(id.githubId), rolesFromParsed(rolesParsed));
  if (!isAdminRole(role)) throw new OperationError('forbidden', `this requires admin (you are ${role})`);
  return { id, role, rolesParsed, readText };
}

export async function getOverridesRoster(ctx) {
  const { rolesParsed, readText } = await requireAdmin(ctx);
  const [bansParsed, gfParsed, idxParsed] = await Promise.all([
    readText('house/bans.yml').then((t) => yaml.load(t) || {}),
    readText('house/grandfathered.yml').then((t) => yaml.load(t) || {}),
    readText('house/members-index.yml').then((t) => yaml.load(t) || {}),
  ]);
  // Best-effort: merge the live Stripe tier from the admin Worker endpoint (SOW-038 P2). On any failure (the
  // Worker is down, test mode, or the caller is not admin to it) the roster still renders with 'unknown' Stripe
  // tiers — the override-derived status (the authoritative part) never depends on this call.
  let stripeStatuses = null;
  try {
    const token = ctx.store?.get?.('githubToken');
    if (token) stripeStatuses = await workerGetRosterStatuses({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch { stripeStatuses = null; }
  return buildRoster({ roles: rolesParsed, bans: bansParsed, grandfathered: gfParsed, membersIndex: idxParsed, stripeStatuses });
}

// SOW-038 P2: the open content-PR queue for the superadmin dashboard. Admin-gated. Lists every OPEN upstream PR
// (newest first) so an admin sees what is awaiting the gate / review at a glance. Open PRs are public on the
// repo, but this lives behind the admin gate alongside the roster. Returns { pulls: [{number, title, html_url,
// author, createdAt, ...}] } from the repo client (classic reads the upstream; app mode via the Worker proxy).
export async function getOpenPulls(ctx) {
  await requireAdmin(ctx);
  const repo = requireRepo(ctx);
  return { pulls: await repo.listOpenPulls() };
}

export async function listPRs(ctx) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  return { prs: await repo.listMyPulls(id.login) };
}

export async function prStatus(ctx, { number } = {}) {
  requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new OperationError('bad-request', 'a positive PR number is required');
  return repo.gateStatus(n);
}

/**
 * SOW-028 P1: the signed-in member's contribution inbox. Returns the OPEN upstream PRs that another member
 * opened against THIS member's folder (the gate's `contribution-pending-owner` set), awaiting this owner's
 * review. It reuses the gate's own owner-side classifier (isContributionToFolder), so the inbox shows exactly
 * the PRs the gate treats as a contribution to this folder, never a mixed or privilege-escalating PR. The
 * owner's own PRs are excluded (those are the workspace "Pull requests" tab). Fail-soft per PR: a PR whose
 * files cannot be read is skipped, not fatal. Read-only; approve/request-changes/decline is P3.
 */
export async function listIncomingContributions(ctx) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const open = await repo.listOpenPulls();
  const myId = id.githubId != null ? String(id.githubId) : null;
  const myLogin = String(id.login || '').toLowerCase();
  const out = [];
  for (const pr of open) {
    // Exclude the owner's own PRs (own-folder edits live in the workspace PR tab, not the review inbox).
    const aId = pr.author?.id != null ? String(pr.author.id) : null;
    const aLogin = String(pr.author?.login || '').toLowerCase();
    if ((myId && aId && aId === myId) || (myLogin && aLogin && aLogin === myLogin)) continue;
    let files;
    try {
      files = await repo.listPullFiles(pr.number);
    } catch {
      continue; // cannot read this PR's files -> skip it rather than fail the whole inbox
    }
    const paths = files.map((f) => f.filename);
    if (!isContributionToFolder(paths, id.username)) continue;
    out.push({
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      author: pr.author ?? null,
      headSha: pr.headSha ?? null,
      createdAt: pr.createdAt ?? null,
      updatedAt: pr.updatedAt ?? null,
      files,
      fileCount: files.length,
      additions: files.reduce((s, f) => s + (f.additions || 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
    });
  }
  return { contributions: out };
}

/**
 * SOW-028 P2/P3: load ONE incoming contribution, fail-closed. Resolves the PR by number and confirms it is a
 * reviewable contribution to the signed-in owner: another member opened it (not the owner) AND every changed
 * path sits inside members/<owner>/ (isContributionToFolder, the gate's own classifier). Anything else throws
 * `forbidden`, so the client review/decide path can only ever touch the owner's legitimate inbox items, never
 * an arbitrary PR. Returns { id, repo, n, pr, files } (files carry the unified patch).
 */
async function loadOwnContribution(ctx, number) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new OperationError('bad-request', 'a positive PR number is required');
  const pr = await repo.getPull(n);
  const aId = pr.author?.id != null ? String(pr.author.id) : null;
  const aLogin = String(pr.author?.login || '').toLowerCase();
  const myId = id.githubId != null ? String(id.githubId) : null;
  const myLogin = String(id.login || '').toLowerCase();
  if ((myId && aId && aId === myId) || (myLogin && aLogin && aLogin === myLogin)) {
    throw new OperationError('forbidden', 'this is your own pull request, not an incoming contribution');
  }
  const files = await repo.getPullDiffFiles(n);
  if (!isContributionToFolder(files.map((f) => f.filename), id.username)) {
    throw new OperationError('forbidden', 'this pull request is not a contribution to your folder');
  }
  return { id, repo, n, pr, files };
}

/**
 * SOW-028 P2: the full review payload for one incoming contribution: its metadata, the per-file unified diff,
 * and the proposed NEW body of each changed markdown file at the PR head (so the owner can "preview as merged"
 * by passing `proposed[].body` to client.preview(), the same renderer the editor uses). Fail-closed via
 * loadOwnContribution.
 */
export async function getContributionReview(ctx, { number } = {}) {
  const { repo, n, pr, files } = await loadOwnContribution(ctx, number);
  const proposed = [];
  let delegation = null; // SOW-028 P4: the as-merged revenue split, so the owner sees what approving pays out
  for (const f of files) {
    if (!/\.md$/i.test(f.filename) || f.status === 'removed') continue;
    let text = null;
    try { text = await repo.getFileContent(f.filename, pr.headSha); } catch { text = null; }
    if (text == null) continue;
    const { frontmatter, body } = parseContentFile(text);
    proposed.push({ filename: f.filename, body });
    const del = frontmatter && typeof frontmatter === 'object' ? frontmatter.delegation : null;
    if (delegation == null && del && typeof del === 'object') {
      delegation = { contributions: Number(del.contributions) || 0, comments: Number(del.comments) || 0 };
    }
  }
  return {
    number: n,
    title: pr.title,
    html_url: pr.html_url,
    headSha: pr.headSha,
    author: pr.author,
    files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })),
    proposed,
    delegation, // { contributions, comments } as it will be after merge, or null when the content sets none
    // SOW-028: in app mode (SOW-026) the member's fork-scoped token cannot post a review the gate would honor by
    // their github_id, so the decision is taken on github.com. The UI shows decide buttons only when this is true.
    canActInClient: !isAppMode(),
  };
}

const DECLINE_NOTE =
  'Thank you for the contribution. The folder owner has decided not to merge this change right now. You are welcome to discuss it here or open a revised proposal.';

/**
 * SOW-028 P3: the owner's decision on an incoming contribution. The client NEVER merges directly: an APPROVE is
 * a GitHub PR review on the current head SHA, which the SOW-005 gate reads (by the owner's github_id) and then
 * auto-merges + runs the SOW-008 award. `request-changes` is a REQUEST_CHANGES review with a message. `decline`
 * posts a note and closes the PR (the draft stays on the contributor's fork). Fail-closed via loadOwnContribution.
 */
export async function reviewContribution(ctx, { number, decision, message } = {}) {
  // App mode (SOW-026): a fork-scoped token cannot post a review the gate would honor by the owner's github_id,
  // and the installation token must not act as a universal approver, so the decision is taken on github.com.
  // Fail fast with a clear message (the UI hides the decide buttons in app mode; this guards the MCP/agent path).
  if (isAppMode()) {
    throw new OperationError('forbidden', 'in app mode, approve or decline this contribution on github.com (the gate records your GitHub identity as the reviewer)');
  }
  const { repo, n, pr } = await loadOwnContribution(ctx, number);
  const msg = typeof message === 'string' ? message.trim() : '';
  switch (decision) {
    case 'approve':
      // The gate only honors an approval whose commit_id is the CURRENT head SHA, so use the freshly-read head.
      await repo.submitReview(n, { event: 'APPROVE', body: msg, commitId: pr.headSha });
      return { ok: true, decision, number: n };
    case 'request-changes':
      if (!msg) throw new OperationError('bad-request', 'request-changes needs a message describing what to change');
      await repo.submitReview(n, { event: 'REQUEST_CHANGES', body: msg, commitId: pr.headSha });
      return { ok: true, decision, number: n };
    case 'decline':
      // The owner cannot merge-close another member's PR (they are not a collaborator), so decline is a
      // REQUEST_CHANGES review carrying the decline note (authored by the owner, which the contributor sees), plus
      // a best-effort close. A close failure is non-fatal: the declining review stands and the contributor can
      // close their own PR or revise it.
      await repo.submitReview(n, { event: 'REQUEST_CHANGES', body: msg || DECLINE_NOTE, commitId: pr.headSha });
      try { await repo.closePull(n); } catch { /* owner lacks permission to close a non-own PR; the review stands */ }
      return { ok: true, decision, number: n };
    default:
      throw new OperationError('bad-request', `unknown decision "${decision}" (approve | request-changes | decline)`);
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Stage an image (base64) into the member's own images/ folder via the host Stager. Returns the repo path.
 * Pure: the actual write is delegated to ctx.stager (node = working copy, extension = GitHub Contents API). */
export function stageImage(ctx, { filename, dataBase64 } = {}) {
  const id = requireIdentity(ctx);
  if (!ctx.stager) throw new OperationError('bad-request', 'no local working copy configured');
  if (!filename || /[\\/]/.test(filename) || filename.includes('..')) throw new OperationError('bad-request', 'invalid filename');
  if (!IMAGE_EXT.test(filename)) throw new OperationError('bad-request', 'unsupported image type (png/jpg/gif/webp/svg)');
  if (!dataBase64) throw new OperationError('bad-request', 'no image data');
  const rel = `members/${id.username}/images/${filename}`;
  ctx.stager.writeImage(rel, dataBase64);
  return { ok: true, path: rel };
}

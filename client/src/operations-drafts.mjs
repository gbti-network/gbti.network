// Operations, DRAFT staging (SOW-006 + SOW-082 + SOW-157): a draft is staged in the member's private, erasable
// store on the network, never in the canonical repo. authorContent lives here because it dispatches between
// saveDraft and publish, and putting it here keeps operations-publish.mjs free of a back-edge to this module.
//
// sow-274 Part 2: drafts used to be staged on a per-item branch of the member's own copy of the repository when
// the member was in fork mode. That mode is retired, so the private store is the only place a draft lives. The
// SOW-011 trial invariant survives the change of mechanism: nothing staged here ever reaches the canonical repo.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { buildContentFile, parseContentFile, contentPath, ContentValidationError } from './content-ops.mjs';
import { branchName } from './hosted-publish.mjs';
import { canStageDrafts, isBlockedFromPublishing } from './membership.mjs';
import { decryptViaWorker, MemberContentLockedError } from './member-content.mjs';
import { SIGNUP_BASE } from './signup-base.mjs';
import { workerListDrafts, workerPutDraft, workerDeleteDraft } from './drafts-client.mjs';
import { workerListRepoDrafts } from './repo-drafts-client.mjs';
import { mergeRepoDrafts } from './repo-drafts-core.mjs';
import { OperationError, membershipOf, requireIdentity } from './operations-core.mjs';
import { publish, renameOriginOf, setOwnContentStatus } from './operations-publish.mjs';

/**
 * SOW-106: the MCP author entry. The caller MUST declare intent via `status`: "published" publishes (merge into
 * the network repo, which is public) and "draft" stages it privately for review. The status is the INTENT
 * and is NOT written into the content input (publish/saveDraft set the content status themselves, defaulting to
 * published), so nothing silently drafts. Throws `status-required` if the caller omits or mis-spells it.
 *
 * sow-193: `path` and `scope` are FORWARDED now. Before this they were simply absent from the signature while
 * publish() accepted both, and the three consequences were all silent:
 *   - a RENAME was impossible. publish() derives one from `path` via renameOriginOf, so with `path` undefined
 *     an agent re-publishing under a changed slug created a SECOND item and left the old page live.
 *   - `redirectFrom` was dropped, because the merge only happens inside the `if (oldFm)` branch that `path`
 *     unlocks, so the old URL never got its 301.
 *   - `scope: 'house'` could not be expressed at all from this entry point.
 * saveDraft takes `path` too (it stages a pending rename on the item's own branch) but has no house scope by
 * design (sow-145: house content publishes directly), so `scope` is only meaningful on the publish arm.
 */
export async function authorContent(ctx, { type, input, body, status, title, authorNote, path, scope } = {}) {
  if (status !== 'draft' && status !== 'published') {
    throw new OperationError('status-required', 'Specify status: "published" to publish (merge and go live on the network) or "draft" to save it privately for review before publishing.');
  }
  if (status === 'draft') return saveDraft(ctx, { type, input, body, path });
  return publish(ctx, { type, input, body, title, authorNote, path, scope });
}


/** Save (stage) a content draft in the member's private store on the network, WITHOUT opening a PR. Trial + paid
 *  may stage (canStageDrafts); 'unknown' fails open (the store is the member's own and private). The body is
 *  stored plain: encryption of a members-only body happens at PUBLISH time through the normal plan. */
export async function saveDraft(ctx, { type, input, body, path } = {}) {
  const id = requireIdentity(ctx);
  const membership = await membershipOf(ctx);
  if (membership !== 'unknown' && !canStageDrafts(membership)) {
    throw new OperationError('forbidden', 'Saving drafts requires an active trial or paid membership.', { membership });
  }
  let built;
  try {
    // SOW-106: a staged draft carries status: published (it is ready to publish; "draft" is where it is kept,
    // not a field). status: draft is reserved for the unpublish/disable state in the canonical repo.
    built = buildContentFile({ type, username: id.username, input: { ...(input ?? {}), status: (input && input.status) || 'published' }, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  // SOW-112 v2: a permalink change stages under the item's OLD identity (the frontmatter slug is the pending new
  // value; the path names what the item still is). The publish event performs the actual move.
  const origin = renameOriginOf({ path, username: id.username, type: built.type });
  const staging = origin && built.slug !== origin.oldSlug ? origin : null;
  const branch = branchName(built.type, staging ? staging.oldSlug : built.slug);
  let fm = {};
  try { fm = parseContentFile(built.markdown).frontmatter ?? {}; } catch { fm = {}; }
  await workerPutDraft({
    draft: {
      type: built.type, slug: staging ? staging.oldSlug : built.slug,
      pendingSlug: staging ? built.slug : null,
      path: staging ? staging.oldPath : built.path, frontmatter: fm, body,
    },
    token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch,
  });
  return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: 'staged', hosted: true, ...(staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {}) };
}


/**
 * sow-194: fetch the caller's committed repo drafts (status:draft items in the public repo) and merge them into
 * the fork/KV draft rows. FAIL-SOFT: a repo-drafts error (route down, not signed in) must NOT blank the Drafts
 * list, so a member still sees their fork/KV drafts. mergeRepoDrafts drops a repo row whose (type,slug) already
 * has a fork/KV draft (the editable copy wins) and filters repo rows to `type` when one is given.
 */
export async function foldRepoDrafts(ctx, drafts, type) {
  let items = [];
  // sow-315: the same envelope carries the CONTENT COMMIT the index was built from. It rides back to the UI
  // so the editors can pin their jsDelivr image URLs to a commit instead of to `main`, whose URLs the
  // viewer's browser caches for seven days (a replaced image would keep showing the old picture). Null when
  // unavailable, which leaves the old `main` behaviour rather than half-pinning.
  let contentRef = null;
  try {
    const token = ctx.store?.get?.('githubToken');
    const r = await workerListRepoDrafts({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    items = Array.isArray(r?.items) ? r.items : [];
    contentRef = typeof r?.sha === 'string' ? r.sha : null;
  } catch { items = []; }
  return { drafts: mergeRepoDrafts(drafts, items, { type }), contentRef };
}


/** List the member's staged drafts from the private store, plus their committed repo drafts (sow-194). Each row
 *  carries enough to render a row and open the editor. Drafts never open a pull request, so `pull` is null. */
export async function listDrafts(ctx, { type } = {}) {
  const id = requireIdentity(ctx);
  const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  const { drafts: recs } = await workerListDrafts(opts);
  const drafts = [];
  for (const r of recs ?? []) {
    if (type && r.type !== type) continue;
    // SOW-106 Phase C: schema-drift check. A draft saved under an older schema may no longer validate; surface
    // that on the row instead of failing at publish time. Never throws the listing.
    let valid = true;
    let invalidReason = null;
    try {
      buildContentFile({ type: r.type, username: id.username, input: r.frontmatter ?? {}, body: r.body ?? '' });
    } catch (err) {
      valid = false;
      invalidReason = err?.message || 'this draft no longer matches the current schema';
    }
    let rowPath = r.path;
    if (!rowPath) { try { rowPath = contentPath(r.type, id.username, r.slug); } catch { rowPath = null; } }
    drafts.push({
      type: r.type, slug: r.slug, branch: branchName(r.type, r.slug), path: rowPath,
      pendingSlug: r.pendingSlug ?? null,
      title: r.frontmatter?.title || r.frontmatter?.displayName || r.slug || r.type,
      visibility: r.frontmatter?.visibility || 'public',
      status: r.frontmatter?.status || 'draft',
      valid, invalidReason, pull: null,
      store: 'kv', // sow-194: the store discriminator, so a repo draft never collides with a staged one
    });
  }
  return foldRepoDrafts(ctx, drafts, type); // sow-315: { drafts, contentRef }
}


/** Read one draft (frontmatter + body) for the editor prefill: a staged draft from the private store, or a
 *  committed repo draft, whose members-only body is decrypted so a re-save never replaces it with a stub. */
export async function readDraft(ctx, { type, slug, store, path: repoPath } = {}) {
  const id = requireIdentity(ctx);
  if (!type) throw new OperationError('bad-request', 'type is required');
  // sow-194: a repo draft is a committed status:draft item at its canonical path in the PUBLIC repo. Read it via
  // the reader (upstream/canonical, not the private store), decrypting a members-only body. Route it first so a
  // repo draft never reads the wrong record.
  if (store === 'repo') {
    let rel = repoPath;
    if (!rel) { try { rel = contentPath(type, id.username, slug); } catch { rel = null; } }
    if (!rel) throw new OperationError('bad-request', 'a repo draft needs its path');
    let text = null;
    try { text = await ctx.reader?.readFile?.(rel); } catch { text = null; }
    if (text == null) throw new OperationError('not-found', `could not read the repo draft: ${rel}`);
    const { frontmatter, body } = parseContentFile(text);
    if (frontmatter?.encryptedBody) {
      try {
        const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter.encryptedBody });
        return { path: rel, branch: null, store: 'repo', frontmatter, body: plain };
      } catch { /* the decrypt is unavailable (not paid): fall through to the public part */ }
    }
    return { path: rel, branch: null, store: 'repo', frontmatter, body };
  }
  // SOW-157: a staged draft's restore state (frontmatter + plain body) comes straight from the store record.
  const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  const { drafts: recs } = await workerListDrafts(opts);
  const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
  if (!rec) throw new OperationError('not-found', 'no such draft');
  let recPath = rec.path;
  if (!recPath) { try { recPath = contentPath(type, id.username, slug); } catch { recPath = null; } }
  return { path: recPath, branch: branchName(type, slug), frontmatter: rec.frontmatter ?? {}, body: rec.body ?? '' };
}


/** Discard a staged draft (delete its record from the private store; idempotent, no pull request to strand). */
export async function discardDraft(ctx, { type, slug, store } = {}) {
  requireIdentity(ctx);
  if (!type) throw new OperationError('bad-request', 'type is required');
  // sow-194: a repo draft is committed to the public repo; discarding it is a delete request, not a from-here
  // action. Refuse with a recognizable code (never a silent no-op, and never a delete of the wrong record).
  if (store === 'repo') throw new OperationError('unsupported', 'This draft is committed to the network and cannot be discarded here. Publish it, or open a removal request.');
  await workerDeleteDraft({ type, slug, token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  return { ok: true, branch: branchName(type, slug), hosted: true };
}


/** Publish a staged draft to the network through the normal publish op (validation, member-content encryption,
 *  the network commit), then drop the staged record. Paid-only; the gate stays the backstop. */
export async function publishDraft(ctx, { type, slug, title, store, path } = {}) {
  const id = requireIdentity(ctx);
  // sow-194: publishing a repo draft is the draft->published status flip on the canonical item. setOwnContentStatus
  // handles member-vs-house scope and the paid gate, so route to it first.
  if (store === 'repo') {
    let rel = path;
    if (!rel) { try { rel = contentPath(type, id.username, slug); } catch { rel = null; } }
    if (!rel) throw new OperationError('bad-request', 'a repo draft needs its path to publish');
    return setOwnContentStatus(ctx, { path: rel, status: 'published' });
  }
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Publishing on gbti.network requires a paid membership. Your draft is saved privately. Upgrade to a paid membership at https://gbti.network, then publish it.', { membership });
  }
  const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  const { drafts: recs } = await workerListDrafts(opts);
  const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
  if (!rec) throw new OperationError('not-found', 'no such draft');
  // Publishing IS the publish event, so the status is forced to published. A staged record can carry
  // status: draft (an explicit draft save, or a record written before SOW-106 made published the default), and
  // publish() honours an explicit status, so without this the item would merge as a hidden draft. The removed
  // fork arm did the same for the rename case (the PR #67 fix); the network arm had lost it.
  const r = await publish(ctx, {
    type, input: { ...(rec.frontmatter ?? {}), status: 'published' }, body: rec.body ?? '', title,
    ...(rec.pendingSlug && rec.path ? { path: rec.path } : {}), // a pending rename applies at the publish event (SOW-112)
  });
  try { await workerDeleteDraft({ type, slug, ...opts }); } catch { /* best-effort; a stale staged copy is harmless */ }
  return { ...r, ok: true, hosted: true };
}


/**
 * SOW-016 read path: decrypt a member-only .enc asset for the signed-in member. The host reads the ciphertext
 * via its reader (fs / GitHub Contents API) and asks the Worker to decrypt it; the AES key never reaches the
 * client. Returns { text } (the plaintext markdown). A non-effective-paid member -> membership-required.
 */
// A member-only asset path is ALWAYS members/<owner>/_enc/<name>.enc or house/_enc/<name>.enc (encAssetFor).
// Validate it so the decrypt route cannot be pointed at an arbitrary repo file (a member can hand-edit their
// frontmatter encryptedBody): only an .enc under an _enc/ dir, no traversal. SOW-031 hardening.
export const ENC_PATH_RE = /^(members\/[a-z0-9][a-z0-9-]*|house)\/_enc\/[a-z0-9][a-z0-9._-]*\.enc$/;


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


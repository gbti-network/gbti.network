// Operations, PUBLISH side (SOW-006): building, renaming, status-flipping and publishing an item through a
// PR. This decides no privilege: it scopes to the member's own folder and forces the gated fields (via
// content-ops), but the SOW-005 gate remains authoritative.
//
// sow-274 Part 2: every write here goes to the network (SOW-156/157), which commits against live main with
// GBTI's own credentials. The fork arm each operation used to carry is gone, and with it the SOW-106 fork sync
// and the SOW-112 rename workaround, both of which existed only because a fork branch bases on a stale main.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { buildContentFile, flipContentStatus, buildCommentFile, serializeContentFile, parseContentFile, contentPath, ContentValidationError } from './content-ops.mjs';
import { isBlockedFromPublishing } from './membership.mjs';
import { splitMemberMarkdown, encAssetFor, encryptViaWorker, MemberContentLockedError, MEMBER_MARKER } from './member-content.mjs';
import { workerDeleteDraft } from './drafts-client.mjs'; // sow-326: a publish clears its own staged record
import { SIGNUP_BASE } from './signup-base.mjs';
import { hostedAuthor, hostedItemId, hostedPublishFiles } from './hosted-publish.mjs';
import { NETWORK_CONTENT_PATH_RE, OperationError, isNetworkContentPath, membershipOf, requireIdentity, requireRepo, requireSuperadminForHouse } from './operations-core.mjs';
import { AUTHOR_NOTE_TYPES } from './operations-read.mjs';

/** Build + publish a content change as (or into) a PR through the gate. */
// SOW-112: the TRUE permalink rename. One PR moves the item to the new slug (redirectFrom carries the old
// public URL so the build emits a 301 and every slug-keyed reader aliases the old slug), deletes the old
// path, byte-moves the .enc sibling (the envelope AAD is self-referential, never path-bound), and moves +
// retargets the author's intro comment (the SOW-014 diff-scoped check demands it at the new slug). Fail-CLOSED
// when the old file cannot be read from the network (the delete half needs it), so it is never a half-move.
// Paid-only, own-folder, post/project/prompt only. publishedAt is preserved (feeds stay stable).
export const RENAME_URL_BASE = { post: '/articles', project: '/projects', product: '/projects', prompt: '/prompts' }; // sow-196: the retired type name maps to the SAME current URL

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;


// SOW-112 v2: resolve the ORIGIN of an edit — the canonical own-folder item the editor loaded (`path` in the
// publish/saveDraft payload). Returns { oldSlug, oldPath } when the path is the member's own item of the same
// type, else null. Identity threading: the slug in the FORM is the (possibly new) value; the path names what
// it was.
export function renameOriginOf({ path, username, type }) {
  const m = OWN_STATUS_PATH_RE.exec(String(path || ''));
  if (!m) return null;
  if (m[1] !== String(username).toLowerCase()) return null;
  if (m[2].slice(0, -1) !== type) return null;
  return { oldSlug: m[3], oldPath: String(path) };
}


// SOW-112 v2: the intro-comment move files (project/prompt): read intro-<old>.md, rewrite id + targetSlug to
// the new slug, emit the new file + the old delete. Empty when no intro exists. Shared by renameContent and
// the publish-time rename.
export async function introMoveFiles(ctx, { username, type, oldSlug, newSlug }) {
  if (!['project', 'prompt'].includes(type)) return [];
  const oldIntro = `members/${username}/comments/intro-${oldSlug}.md`;
  const introText = await ctx.reader?.readFile?.(oldIntro);
  if (introText == null) return [];
  const intro = parseContentFile(introText);
  const introFm = { ...(intro.frontmatter ?? {}), id: `intro-${newSlug}`, targetSlug: newSlug };
  return [
    { path: `members/${username}/comments/intro-${newSlug}.md`, content: serializeContentFile(introFm, intro.body) },
    { path: oldIntro, content: null },
  ];
}


export async function renameContent(ctx, { path: rel, newSlug } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const m = OWN_STATUS_PATH_RE.exec(String(rel || ''));
  if (!m) throw new OperationError('bad-request', 'path must be members/<you>/(posts|projects|products|prompts)/<slug>/index.md');
  if (m[1] !== String(id.username).toLowerCase()) {
    throw new OperationError('forbidden', 'you may only rename your own content');
  }
  const type = m[2].slice(0, -1);
  const oldSlug = m[3];
  const slug = String(newSlug || '').trim();
  if (!SLUG_RE.test(slug)) throw new OperationError('bad-request', 'the new permalink must be lowercase letters, digits, and hyphens');
  if (slug === oldSlug) return { ok: true, noop: true, slug };
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Renaming a published item requires a paid membership.', { membership });
  }

  const newPath = contentPath(type, id.username, slug);
  const collision = await repo.getFileContent(newPath).catch(() => null);
  if (collision != null) throw new OperationError('bad-request', `the permalink "${slug}" is already taken`);
  const oldText = await ctx.reader?.readFile?.(rel);
  if (oldText == null) throw new OperationError('not-found', `no such file: ${rel}`);

  const { frontmatter, body } = parseContentFile(oldText);
  const fm = { ...(frontmatter ?? {}) };
  const oldUrl = `${RENAME_URL_BASE[type]}/${oldSlug}/`;
  fm.slug = slug;
  fm.redirectFrom = [...new Set([...(Array.isArray(fm.redirectFrom) ? fm.redirectFrom : []), oldUrl])];
  fm.updatedAt = ctx.now?.() ?? new Date().toISOString(); // publishedAt is deliberately untouched

  const files = [];
  // The .enc sibling byte-moves (the envelope decrypts anywhere; nothing cross-checks its aad).
  if (typeof fm.encryptedBody === 'string' && fm.encryptedBody) {
    const oldEnc = fm.encryptedBody;
    const encText = await ctx.reader?.readFile?.(oldEnc);
    if (encText == null) throw new OperationError('not-found', `the encrypted body is missing: ${oldEnc}`);
    const { path: newEnc } = encAssetFor(type, id.username, slug);
    fm.encryptedBody = newEnc;
    files.push({ path: newEnc, content: encText }, { path: oldEnc, content: null });
  }
  files.push({ path: newPath, content: serializeContentFile(fm, body) }, { path: rel, content: null });
  // The from-the-author intro comment (project/prompt) moves + retargets in the same PR.
  files.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug, newSlug: slug }));

  // The network branch is always based on live main, so the old file it deletes is the one read above.
  const pr = await hostedPublishFiles(ctx, { branch: `gbti/rename-${type}-${oldSlug}`, files, title: `Rename: ${oldSlug} -> ${slug}` });
  return { ...pr, ok: true, type, oldSlug, slug, path: newPath };
}


// SOW-106 Phase B: a member's reversible self-unpublish/republish. Only their OWN post/product/prompt, only a
// status flip (visibility and every other field untouched), through the normal gated own-folder PR so the
// SOW-005 gate stays the authority. Idempotent: already in the requested state = a clean no-op, no PR.
export const OWN_STATUS_PATH_RE = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|projects|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;


export async function setOwnContentStatus(ctx, { path: rel, status } = {}) {
  const id = requireIdentity(ctx);
  if (status !== 'published' && status !== 'draft') {
    throw new OperationError('bad-request', 'status must be "published" or "draft"');
  }
  // SOW-145: a house/ status flip is superadmin-only (re-checked); the house branch is prefixed so it cannot
  // collide with a member item of the same slug. Otherwise the path must be the caller's own member folder.
  const houseTarget = isNetworkContentPath(rel);
  let type, slug, branch;
  if (houseTarget) {
    // Validate the content-path shape BEFORE the role gate: a non-content house path (house/roles.yml, a
    // traversal) is a plain bad-request for everyone, and only a well-formed house item reaches the superadmin
    // check, so a non-superadmin cannot probe which house paths exist via the error.
    const hm = NETWORK_CONTENT_PATH_RE.exec(String(rel || ''));
    if (!hm) throw new OperationError('bad-request', 'invalid house content path');
    await requireSuperadminForHouse(ctx);
    type = hm[1].slice(0, -1);
    slug = String(rel).split('/')[2];
    branch = `gbti/status-house-${type}-${slug}`;
  } else {
    const m = OWN_STATUS_PATH_RE.exec(String(rel || ''));
    if (!m) throw new OperationError('bad-request', 'path must be members/<you>/(posts|projects|products|prompts)/<slug>/index.md');
    if (m[1] !== String(id.username).toLowerCase()) {
      throw new OperationError('forbidden', 'you may only change the status of your own content');
    }
    type = m[2].slice(0, -1);
    slug = m[3];
    branch = `gbti/status-${type}-${slug}`;
  }
  // The publishing lifecycle is paid-only (SOW-011); the gate is the real authority (unknown fails open to it).
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Changing a published item requires a paid membership.', { membership });
  }
  const text = await ctx.reader?.readFile?.(rel); // fresh canonical read (async-safe; preserves concurrent fields)
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  const flip = flipContentStatus(text, status);
  if (!flip.changed) return { ok: true, noop: true, status };
  const verb = status === 'draft' ? 'Unpublish' : 'Republish';
  const pr = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: flip.content }], title: `${verb}: ${slug}` });
  return { ...pr, ok: true, status };
}


export async function publish(ctx, { type, input, body, title, authorNote, path, scope } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  // SOW-145: a house publish targets the non-member house/ folder (author stays 'gbti'). The scope is declared
  // by the caller (a NEW house item) or inferred from `path` (editing an existing house item). It is
  // superadmin-only, RE-CHECKED here server-side (never trust the client); the SOW-108 gate auto-merges a
  // superadmin house/** PR, and a forged non-superadmin one is Tier A -> rejected + closed by the gate.
  // sow-195: infer the network target from the members/gbtilabs/ prefix. Without this an edit loaded from
  // the network scope would publish into the ACTOR's own folder, silently misfiling the item instead of
  // failing visibly, so it has to move in the same change as the read side.
  const houseTarget = scope === 'house' || isNetworkContentPath(path);
  const targetScope = houseTarget ? 'house' : 'member';
  if (houseTarget) await requireSuperadminForHouse(ctx);
  // SOW-011: publishing to the canonical repo is paid-only. Block a KNOWN non-paid (trial / lapsed) member
  // BEFORE opening any PR, so nothing of theirs reaches the canonical repo (a draft stays in their private store).
  // 'unknown' (oracle unreachable) fails OPEN to the SOW-005 gate, which is the real authority and rejects a
  // genuinely non-paid PR anyway, so a paid member is never wrongly blocked when the oracle is down.
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError(
      'membership-required',
      'Publishing on gbti.network requires a paid membership. Save it as a draft to keep it privately, then upgrade at https://gbti.network and publish it.',
      { membership },
    );
  }
  // SOW-112 v2 (owner-directed): the rename happens AT THE PUBLISH EVENT. `path` names the canonical item this
  // edit was loaded from; a submitted slug that differs from it makes this publish a RENAME (one PR: the new
  // path, the old path deleted, the old URL in redirectFrom so the build 301s and readers alias). Even without
  // a slug change, the old file's redirectFrom entries are merged in (a plain re-publish used to drop them).
  // House rename is deferred (SOW-145 v1): a house target never enters the rename path (origin stays null), so a
  // house edit is always a plain re-publish of the same slug. Member content keeps the full SOW-112 rename flow.
  const origin = houseTarget ? null : renameOriginOf({ path, username: id.username, type });
  let oldFm = null;
  if (origin) {
    const oldText = await ctx.reader?.readFile?.(origin.oldPath);
    if (oldText != null) oldFm = parseContentFile(oldText).frontmatter ?? {};
  }
  const effInput = { ...(input ?? {}) };
  const renaming = Boolean(oldFm) && typeof effInput.slug === 'string' && effInput.slug !== origin.oldSlug;
  if (oldFm) {
    const keep = Array.isArray(oldFm.redirectFrom) ? oldFm.redirectFrom : [];
    const oldUrl = renaming ? `${RENAME_URL_BASE[type]}/${origin.oldSlug}/` : null;
    const merged = [...new Set([...keep, ...(Array.isArray(effInput.redirectFrom) ? effInput.redirectFrom : []), ...(oldUrl ? [oldUrl] : [])])];
    if (merged.length) effInput.redirectFrom = merged;
    // A rename must not re-stamp publishedAt (feeds stay stable; the item is not new). The editor stamps it on
    // every publish, so restore the original here for the rename case only.
    if (renaming && oldFm.publishedAt) effInput.publishedAt = oldFm.publishedAt;
  }
  // Date parity with the WorkBench editor (SOW-062 P6), which stamps publishedAt/updatedAt at publish. The
  // MCP/API path never did, so an add_* item landed DATELESS: bottom of every feed, no date chip (hit live
  // 2026-07-09 with the /ci prompt). Preserve an existing item's publishedAt ONLY when it was already
  // published (read the canonical file when the caller sent no `path`); stamp now for a genuinely new item or
  // the first publish of a draft; updatedAt bumps only on a genuine re-publish of an already-published item.
  // The outer guard is intentionally NOT `&& !effInput.publishedAt`: a faithful re-publish round-trips the
  // existing frontmatter, which INCLUDES publishedAt (the MCP/API shape), and the old guard then skipped this
  // whole block so updatedAt never bumped (SOW-258, hit live 2026-08-18 on the /qa prompt; DeployStatusNotice
  // and the "Recently updated" sort both read updatedAt and went stale). The two publishedAt WRITES stay guarded
  // by `!effInput.publishedAt`, so a supplied publishedAt is preserved; only the updatedAt stamp is newly reached.
  if (['post', 'project', 'prompt'].includes(type)) {
    const nowIso = new Date().toISOString();
    let priorFm = oldFm;
    if (!priorFm && typeof effInput.slug === 'string' && effInput.slug) {
      const canonical = contentPath(type, id.username, effInput.slug, targetScope); // SOW-145: house -> house/<sub>/…
      let text = null;
      try { text = (await ctx.reader?.readFile?.(canonical)) ?? null; } catch { text = null; }
      // The MCP host without a local repoPath has no working reader (hit live 2026-07-10: a re-publish
      // stamped publishedAt to now); the repo client reads the canonical upstream file instead.
      if (text == null) { try { text = (await repo.getFileContent(canonical)) ?? null; } catch { text = null; } }
      if (text != null) { try { priorFm = parseContentFile(text).frontmatter ?? {}; } catch { priorFm = null; } }
    }
    // A prior canonical file that is still a DRAFT carries a draft-time publishedAt, not a real publication
    // moment: its first publish must stamp now (hit live 2026-08-26 with the /grok prompt, whose draft landed
    // on the canonical repo as `status: draft` in #367 and then surfaced that draft date, hours before the
    // real publish in #372, at the top of the feed). Preserve the date only when the prior version was PUBLISHED.
    const priorPublished = Boolean(priorFm && priorFm.status === 'published' && priorFm.publishedAt);
    if (priorPublished) {
      if (!effInput.publishedAt) effInput.publishedAt = priorFm.publishedAt; // keep the real publication moment
      effInput.updatedAt = nowIso;                // a genuine re-publish of published content is an edit (SOW-258)
    } else if (!effInput.publishedAt) {
      effInput.publishedAt = nowIso;              // a new item, or the first publish of a draft
    }
  }
  let built;
  try {
    // SOW-106: publishing merges into the network repo, and merged content is PUBLIC. Force status: published (an
    // explicit caller status still wins), so a publish can never silently produce a hidden merged draft.
    built = buildContentFile({ type, username: id.username, input: { ...effInput, status: effInput.status || 'published' }, body, scope: targetScope });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  if (renaming) {
    // Collision pre-check (CI's unique-slug guard is the backstop) — the new path must not exist upstream.
    const collision = await repo.getFileContent(built.path).catch(() => null);
    if (collision != null) throw new OperationError('bad-request', `the permalink "${built.slug}" is already taken`);
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
  // SOW-014: a published project/prompt must carry a from-the-author intro comment IN THE SAME PR. When authorNote
  // is provided, seed intro-<slug>.md (public, authorNote:true) into this same publish, so validate-content's
  // diff-scoped intro check passes and a compliant prompt/product ships in ONE PR (deterministic id -> a re-publish
  // updates the same comment, never duplicating it).
  const introFile = buildIntroCommentFile({ username: id.username, built, authorNote, now: ctx.now?.() });
  // A descriptive PR title / commit message / body (used only when the caller gave none), so the pull request
  // reads clearly and the activity feed (which shows the PR title) is not a bare "Update".
  const desc = describeContentPublish(built, { hasIntro: Boolean(introFile) });
  // The network takes the title only and writes its own commit message and pull request body.
  const ttl = title ?? desc.title;
  // SOW-156/157: hand the file set to the network (no local commit), which commits to a canonical branch based
  // on live main and opens the auto-merging PR. A RENAME is just the old-path deletes plus the intro move in the
  // same files[]; every path is own-folder, verified against the canonical reader.
  // sow-203: the NETWORK's content publishes from a hosted host like any other member folder. The refusal
  // that used to sit here (SOW-157, 2026-07-25) predated sow-195 and was broader than the rule it guarded.
  // Nothing special is needed: the Worker authorises a superadmin to write any member folder
  // (allowAnyFolder, sow-183) and the SOW-108 gate auto-merges the PR. The hosted image rule does not apply
  // either, because it is checked only against BINARY entries and a website upload is staged flat under the
  // acting caller's own folder (src/lib/workbench-client.ts stageImage), which that rule already accepts.
  const renameFiles = [];
  if (renaming) {
    const onMain = (await ctx.reader?.readFile?.(origin.oldPath)) != null;
    if (!onMain) throw new OperationError('bad-request', 'the original item could not be found on the network — refresh and try the rename again');
    renameFiles.push({ path: origin.oldPath, content: null });
    if (typeof oldFm?.encryptedBody === 'string' && oldFm.encryptedBody) renameFiles.push({ path: oldFm.encryptedBody, content: null });
    if (!introFile) {
      renameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
    } else {
      const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
      if ((await ctx.reader?.readFile?.(oldIntro)) != null) renameFiles.push({ path: oldIntro, content: null });
    }
  }
  const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(renameFiles);
  const r = await hostedAuthor({
    token: ctx.store?.get?.('githubToken'), itemId: hostedItemId(built.type, renaming ? origin.oldSlug : built.slug),
    files, title: ttl, signupBase: SIGNUP_BASE, fetchImpl: ctx.fetch ?? globalThis.fetch,
  });
  // sow-326: drop the staged draft record, mirroring the website host (src/lib/workbench-client.ts). Without
  // this the extension and the npm CMS resurrect the very record the website just cleared, and the immortal
  // "not published yet" banner comes back on the next open. Best-effort and strictly after the author call,
  // so a failed publish leaves the draft intact and a cleanup miss cannot fail a successful publish; the
  // delete is idempotent, so the publishDraft path deleting it too is harmless. A rename sweeps both slugs.
  for (const staleSlug of [...new Set([built.slug, renaming ? origin.oldSlug : null].filter(Boolean))]) {
    try {
      await workerDeleteDraft({
        type, slug: staleSlug, token: ctx.store?.get?.('githubToken'),
        signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch,
      });
    } catch { /* see above */ }
  }
  return renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r;
}


/**
 * A descriptive PR title, commit message, and PR body for a content publish, built from the human title (not the
 * slug) plus the one-line description and category. Fixes the bare "Update" PR + the identical activity-feed entry
 * (gbti-activity-bell reads the PR title). Pure + exported for unit tests.
 */
export function describeContentPublish(built, { hasIntro } = {}) {
  const LABEL = { post: 'article', project: 'project', prompt: 'prompt', profile: 'profile' };
  const label = LABEL[built?.type] ?? built?.type ?? 'content';
  if (built?.type === 'profile') {
    const t = `Update the ${built.username} member profile`;
    return { title: t, message: t, body: `Update the ${built.username} member profile.` };
  }
  const name = built?.frontmatter?.title || built?.slug || label;
  const title = `Publish ${label}: ${name}`;
  const blurb = built?.frontmatter?.shortDescription || built?.frontmatter?.excerpt || '';
  const cats = Array.isArray(built?.frontmatter?.categories) ? built.frontmatter.categories.join(' > ') : '';
  const lines = [`## ${name}`, ''];
  if (blurb) lines.push(blurb, '');
  lines.push(`- Type: ${label}`);
  if (cats) lines.push(`- Category: ${cats}`);
  lines.push(`- Path: \`${built?.path ?? ''}\``);
  if (hasIntro) lines.push('- Includes the from-the-author intro comment.');
  lines.push('', '_Published through the GBTI Network client._');
  return { title, message: title, body: lines.join('\n') };
}


/**
 * SOW-014: build the from-the-author intro comment file, to commit in the SAME publish PR. Returns
 * { path, content } or null (no note, or a type that cannot carry one). Pure + exported for unit tests. The id
 * is deterministic (intro-<slug>) so a re-publish updates the same comment file, never duplicating it.
 * 2026-08-11: posts included. The note stays OPTIONAL for a post (validate-content requires one only for a
 * project/prompt); this returning null for a post is what silently discarded a note typed on an article.
 */
export function buildIntroCommentFile({ username, built, authorNote, now } = {}) {
  const note = String(authorNote ?? '').trim();
  if (!note || !built?.slug || !AUTHOR_NOTE_TYPES.has(built.type)) return null;
  const introBuilt = buildCommentFile({
    username,
    // SOW-145: a house project/prompt intro lands at house/comments/ with author 'gbti' (mirrors the item scope).
    scope: built.scope || 'member',
    input: {
      id: `intro-${built.slug}`,
      targetType: built.type,
      targetSlug: built.slug,
      createdAt: now ?? new Date().toISOString(),
      status: 'published',
      visibility: 'public',
      authorNote: true,
    },
    body: note,
  });
  return { path: introBuilt.path, content: introBuilt.markdown };
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
    // A members item MAY carry a public teaser: everything before the marker stays in index.md and only the
    // tail is encrypted, so a Mode B stub can say what it is instead of showing a bare title. Without a marker
    // this is unchanged from before — the ENTIRE body is gated (Mode A, or a Mode B stub with no teaser).
    // Back-compatible by measurement: no shipped members item contains the marker, and validate-content
    // rejects a committed body that does, so no existing item can change shape here.
    const split = splitMemberMarkdown(body);
    if (split.memberPart) {
      publicPart = split.publicPart; // the teaser: stays in index.md, public
      memberPart = split.memberPart; // the tail: encrypted to the .enc
    } else {
      // No marker, or a marker with an empty tail: the ENTIRE body is gated, exactly as before. Strip any
      // marker so the literal `<!-- members-only -->` never reaches index.md (validate-content rejects it).
      memberPart = String(body ?? '').replace(MEMBER_MARKER, '').trim();
      if (!memberPart) return null; // a members item with an empty body: nothing to encrypt (plain publish)
    }
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
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug, built.scope); // SOW-145: house -> house/_enc/
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



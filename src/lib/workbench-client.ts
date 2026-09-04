// sow-158 Phase 3a: the website WorkBench client adapter. A FRESH thin implementation of the GbtiClient contract
// (client-ui/src/client.mjs) that talks to the signup Worker over the httpOnly-cookie session (Phase 1b/2) instead
// of a bearer token. It is HOSTED-ONLY by construction: it never forks, never installs, and never holds a GitHub
// token. Every publish rides the SOW-156/157 hosted-authoring path (POST /membership/author), which commits to a
// hosted/<github_id>/<itemId> branch on the canonical repo with GBTI's App INSTALLATION token and opens the
// SOW-005-gated auto-merging PR. The token NEVER enters the page: writes carry only `credentials:'include'` plus
// the non-secret gbti_csrf echo (double-submit CSRF), reads carry `credentials:'include'` alone.
//
// Scope (the ~15 methods gbti-workspace + gbti-content-editor actually call): status, listContent, getContentItem,
// readItem, validateContent (pure), formFields (pure), preview (pure), publish, saveDraft, listDrafts, readDraft,
// discardDraft, publishDraft, setContentStatus, decrypt, listPRs, prStatus. Everything else the components call is
// OPTIONAL-CHAINED there (getActivity, getFollows, listContributions, listComments, admin, ...), so its absence
// degrades gracefully to an empty state — deferred to a later phase per the SOW.
//
// Now live on the web (earlier phases): members-only PUBLISH (via the cookie /membership/encrypt), IMAGE upload
// (binary base64 entries), and PERMALINK RENAME (rename-at-publish, SOW-112 v2 — a changed permalink field makes
// the publish a rename: the new path + the old-path deletes + redirectFrom in ONE hosted PR). SOW-182: house
// content LISTS and READS on the web (the public index already carried it; /membership/file already allowed
// house/ paths for any signed-in member, see reviewFileContent in workers/signup/github-app.mjs). SOW-183: house
// PUBLISH + superadmin content-authorship REASSIGNMENT (house<->member, member<->member) now write too — the
// Worker's hosted-authoring endpoint independently re-verifies the caller is superadmin (authorizeSuperadmin,
// membership-admin.mjs) before accepting a write outside the caller's own folder, so this adapter's own
// house/authorTarget handling below is UX convenience, not the security boundary; a non-superadmin's stray
// attempt still fails closed server-side.

import { buildContentFile, buildCommentFile, buildShareFile, shareId as makeShareId, flipContentStatus, parseContentFile, commentId } from '../../client/src/content-ops.mjs';
import { fieldsFor } from '../../client/src/form-fields.mjs';
import { renderMarkdown } from '../../client/src/markdown.mjs';
import { canPublish, canStageDrafts } from '../../client/src/membership.mjs';
import { memberContent } from '../../client-ui/src/member-view-core.mjs';
import { planMemberFiles, reassembleMemberBody, filterThreadComments, coerceCommentInput, favoritedFrom, COMMENT_TARGET_TYPES, AUTHOR_NOTE_TYPES, MEMBER_READ_TIER, sanitizeImageName, planPublishImageFiles, referencedImages, bodyImageCandidates, planImageRefs, normalizeImageFields, base64Bytes, renameOriginOf, mergedRedirectFrom, renameIntroMoveFiles, introFolderFor, networkContent } from './workbench-client-core.mjs';
import { mergeRepoDrafts } from '../../client/src/repo-drafts-core.mjs';

const MAX_IMAGE_BYTES = 1_048_576; // 1 MB, matching the Worker gate + check-media
const TYPE_INDEX: Record<string, string> = { post: 'blog-index.json', project: 'projects-index.json', prompt: 'prompts-index.json' };
const TYPE_LABEL: Record<string, string> = { post: 'article', project: 'project', prompt: 'prompt', profile: 'profile' };
// members/<user>/<posts|projects|products|prompts>/<slug>/index.md -> { type, slug }. Mirrors the folder->type mapping.
const FOLDER_TYPE: Record<string, string> = { posts: 'post', projects: 'project', products: 'project', prompts: 'prompt' };
const PATH_RE = /^members\/[^/]+\/(posts|projects|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;

/** A GbtiClientError-shaped error (code + message) so the editor's failHint reads it exactly like the other hosts. */
class WorkbenchClientError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.name = 'WorkbenchClientError';
    this.code = code;
  }
}
const err = (code: string, message?: string) => new WorkbenchClientError(code, message);

/** The hosted item id (the branch's last segment; the Worker prefixes it with the verified github_id). Mirrors
 *  hosted-publish.mjs hostedItemId so a re-publish of the same item reuses one branch + PR. */
function hostedItemId(type: string, slug: string | null): string {
  return type === 'profile' ? 'profile' : `${type}-${slug}`;
}

function parseContentPath(path: string): { type: string; slug: string } | null {
  const m = PATH_RE.exec(String(path || ''));
  if (!m) return null;
  return { type: FOLDER_TYPE[m[1]], slug: m[2] };
}

/** Read the non-HttpOnly gbti_csrf cookie for the double-submit header (mirrors member-signal.ts). */
function readCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === 'gbti_csrf') return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Seed the from-the-author intro comment in the SAME publish PR, so the gate's diff-scoped
 *  intro check passes. Deterministic id (intro-<slug>): a re-publish updates the same comment. Mirrors
 *  operations.buildIntroCommentFile. Returns a { path, content } file, or null.
 *  sow-183: `target` is the item's TARGET { scope, username } (house or member), not always the acting caller
 *  -- a superadmin's house item gets a house/comments/ intro, exactly like its content .md. `actingUser` is
 *  ALWAYS the verified caller's own login (buildCommentFile requires a non-empty username even for scope
 *  'house', where it is inert actor context only -- resolveTarget's house branch ignores it for the frontmatter
 *  author, which is always 'gbti'). */
function buildIntroFile(target: { scope: string; username: string | null }, actingUser: string, built: any, authorNote: string | undefined): { path: string; content: string } | null {
  const note = String(authorNote ?? '').trim();
  if (!note || !built?.slug || !AUTHOR_NOTE_TYPES.has(built.type)) return null;
  const intro = buildCommentFile({
    username: target.scope === 'house' ? actingUser : target.username,
    scope: target.scope,
    input: {
      id: `intro-${built.slug}`,
      targetType: built.type,
      targetSlug: built.slug,
      createdAt: new Date().toISOString(),
      status: 'published',
      visibility: 'public',
      authorNote: true,
    },
    body: note,
  });
  return { path: intro.path, content: intro.markdown };
}

/** Map one KV draft record ({ type, slug, path, frontmatter, body, updatedAt }) to the workspace's list-item
 *  shape (mergeTypeItems + classifyDraft + the draft row read these). pull:null -> classifyDraft 'Staged'. */
function mapDraftRecord(rec: any) {
  const fm = (rec && rec.frontmatter) || {};
  return {
    type: rec?.type,
    slug: rec?.slug,
    pendingSlug: rec?.pendingSlug ?? null,
    title: fm.title || rec?.slug || '',
    path: rec?.path || null,
    status: fm.status || 'draft',
    visibility: fm.visibility || 'public',
    frontmatter: fm,
    body: rec?.body || '',
    authorNote: typeof rec?.authorNote === 'string' ? rec.authorNote : null,
    // sow-183 follow-up: the PENDING author reassignment, so reopening a draft restores the superadmin's
    // choice instead of silently showing the owner they were moving the item away from.
    authorTarget: rec?.authorTarget && typeof rec.authorTarget === 'object' ? rec.authorTarget : null,
    pull: null,
    store: 'kv', // sow-194: the store discriminator, so a KV draft never collides with a repo draft on merge
    publishedAt: fm.publishedAt ? Number(fm.publishedAt) : null,
    updatedAt: rec?.updatedAt || null,
  };
}

/**
 * Build the website WorkBench client.
 * @param signupBase the signup Worker origin (stamped on <html data-signup-base> by BaseLayout).
 * @param login the signed-in member's GitHub login (the folder username; drives the own-content filter).
 * @param githubId the signed-in member's immutable id (fallback identity; the session cookie is authoritative).
 */
export function createWorkbenchClient({ signupBase, login, githubId = null, isSuperadmin = false }: { signupBase: string; login: string; githubId?: string | null; isSuperadmin?: boolean }) {
  const base = String(signupBase || '').replace(/\/$/, '');
  const user = String(login || '');
  // sow-158 image upload: staged image binaries (base64), keyed by their own-folder repo path. stageImage fills
  // this; publish() flushes the ones the content actually references into the SAME author PR, so the image + the
  // .md land atomically and the path resolves on merge.
  //
  // This Map used to be the ONLY copy, and it is per-tab, so saving a draft persisted the image PATH and the
  // BYTES nowhere. A reload left the editor and the preview resolving that path to a jsDelivr URL for a file
  // that had never been committed: the broken thumbnail no amount of re-saving could fix. The bytes now also go
  // to the Worker's staged-image store (`draftimg:<github_id>:<type>:<slug>:<name>`), which survives the reload
  // and the device. The Map stays as the same-session fast path so picking an image and publishing immediately
  // needs no round trip, but it is a cache now, not the record.
  //
  // Keyed by file NAME, deliberately, while the store is keyed by item as well. A tab edits one item at a time,
  // so a name is unambiguous here, and it keeps working across any number of permalink edits in the same
  // session (the store lookup would miss, because the item token moves with the slug).
  const pendingImages = new Map<string, string>();
  /**
   * Read a staged image back from the Worker store, scoped to the item it was staged for. Returns null when it
   * is not staged, which is the NORMAL state once the image has been published and merged: publish deletes the
   * key, and the caller then falls back to the CDN. A miss must therefore never read as a failure.
   */
  async function readStagedImage(name: string, item?: string | null) {
    if (!name) return null;
    try {
      const q = `name=${encodeURIComponent(name)}${item ? `&item=${encodeURIComponent(item)}` : ''}`;
      const r = await workerGet(`/membership/draft-image?${q}`);
      return r?.dataBase64 ? { dataBase64: r.dataBase64 as string, contentType: (r.contentType as string) || 'image/png' } : null;
    } catch {
      return null; // a 404 or an offline read is a fall-back-to-CDN, not a hard failure
    }
  }

  async function parseJson(res: Response) {
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) throw new WorkbenchClientError(json?.error || `http-${res.status}`, json?.message || json?.error || `request failed (${res.status})`);
    return json;
  }
  // Worker GET over the cookie session (credentials ride the httpOnly gbti_session; no token, no CSRF on GET).
  async function workerGet(path: string) {
    return parseJson(await fetch(base + path, { credentials: 'include' }));
  }
  // Worker POST over the cookie session: credentials + the double-submit X-GBTI-CSRF header (resolveIdentity gates).
  async function workerPost(path: string, body: unknown) {
    const csrf = readCsrf();
    return parseJson(await fetch(base + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
      body: JSON.stringify(body),
    }));
  }
  // sow-231 Phase 3: the same cookie-session + CSRF treatment as workerPost, for the invite PATCH route.
  // Written as its own helper rather than a `method` parameter on workerPost so an existing POST caller
  // cannot acquire a method by accident.
  async function workerPatch(path: string, body: unknown) {
    const csrf = readCsrf();
    return parseJson(await fetch(base + path, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
      body: JSON.stringify(body),
    }));
  }
  // sow-158 News: a status-aware GET for the news read routes. <gbti-news> drives its view from the ERROR CODE
  // (not-authenticated -> sign-in nudge, membership-required -> locked nudge, else the feed), so map the HTTP
  // status to those codes (mirrors operations.mapNewsErr). A signed-in member gets 200 -> the feed renders.
  async function newsGet(path: string) {
    const res = await fetch(base + path, { credentials: 'include' });
    if (res.status === 401) throw err('not-authenticated', 'Sign in to read the news.');
    if (res.status === 403) throw err('membership-required', 'News is a members-only perk.');
    return parseJson(res);
  }
  // A same-origin build-artifact index JSON (public, no credentials needed).
  async function sameOriginJson(path: string) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw err(`http-${res.status}`, `could not load ${path}`);
    return res.json();
  }

  async function readOwnFile(path: string): Promise<string | null> {
    const r = await workerGet(`/membership/file?path=${encodeURIComponent(path)}&ref=main`);
    return r?.text ?? null;
  }
  // sow-183: the same read, returning the RAW base64 GitHub sent rather than the decoded text. An image is
  // binary, so `text` is mojibake for it and the bytes cannot be recovered from that; this is the only way to
  // read a committed image back out of the repo, which a move has to do to carry it to the item's new folder.
  // Same route, same allow-list, same auth: nothing here is reachable that readOwnFile above cannot reach.
  async function readOwnFileBase64(path: string): Promise<string | null> {
    const r = await workerGet(`/membership/file?path=${encodeURIComponent(path)}&ref=main`);
    return r?.base64 ?? null;
  }

  // The core publish: build the file set from PURE builders and POST it to the hosted-authoring endpoint.
  // sow-158 permalink rename (SOW-112 v2, owner-directed rename-at-publish): `path` names the canonical item this
  // edit was loaded from; a submitted slug that differs makes this publish a RENAME (one hosted PR: the new path,
  // the old path + old .enc deleted, the old URL in redirectFrom so the build 301s, the intro moved). Even without
  // a slug change the old file's redirectFrom is merged in (a plain re-publish used to DROP it). Mirrors the
  // isHostedCtx branch of client/src/operations.mjs publish(); the website is hosted-only, so the fork dance does
  // not apply (the hosted branch is always fresh-based on live main).
  //
  // sow-183: `authorTarget` ({ scope: 'house'|'member', username? }), when given, reassigns an EXISTING item's
  // author -- the shared editor's Author field only ever sends this for a superadmin and only when it differs
  // from the loaded item's current home (gbti-content-editor.mjs). It generalizes the rename machinery above: a
  // MOVE is now "the resolved path changed", for a slug reason, an author reason, or both, in one hosted PR.
  async function publish({ type, input = {}, body = '', authorNote, path, scope, authorTarget }: any) {
    // Both triggers below (a house path, or an explicit authorTarget) are only reachable through UI already
    // gated to role==='superadmin' (gbti-workspace.mjs _canScope, the editor's Author field) -- the Worker
    // independently re-verifies the caller is superadmin (authorizeSuperadmin) before accepting the write, so
    // this is UX convenience, not the security boundary; a non-superadmin's stray attempt still fails closed.
    const allowAnyFolder = String(path || '').startsWith('house/') || authorTarget != null;
    // Resolve the origin (the item the editor loaded) and read its frontmatter for the redirectFrom merge, the
    // publishedAt preservation, the old .enc path, and (with authorTarget) the old owner to move away from.
    const origin = renameOriginOf({ path, username: user, type, allowAnyFolder });
    let oldFm: any = null;
    // sow-165: the previously committed BODY, kept from the read that already happens here rather than paid
    // for again. It is what makes the body-image scan below free in the common case: a reference that is
    // already in it is already committed, so it needs no lookup at all. Null when the item is not on main
    // yet, or when the parse fails, and both of those correctly mean "treat every reference as new".
    // A members item's index.md carries only the PUBLIC half (the gated half lives in the sibling .enc), so a
    // gated body image reads as new every publish. That costs one lookup that resolves to skip; it is not a
    // correctness gap, and reading the .enc would mean decrypting it just to save a round-trip.
    let oldBody: string | null = null;
    if (origin) {
      const oldText = await readOwnFile(origin.oldPath);
      if (oldText != null) {
        try {
          const parsed = parseContentFile(oldText);
          oldFm = parsed.frontmatter ?? {};
          oldBody = parsed.body ?? '';
        } catch { oldFm = null; oldBody = null; }
      }
    }
    // The TARGET folder for this publish. An explicit authorTarget (an existing item, superadmin) wins; else the
    // loaded origin's own folder (a plain edit, unchanged); else the workspace's create-time scope (a NEW item),
    // falling back to the caller's own folder (the pre-sow-183 default, unchanged). buildContentFile/buildCommentFile
    // each resolve { folder, author } from { scope, username } internally (content-ops.mjs resolveTarget), so this
    // only needs to settle the two raw inputs.
    const target: { scope: string; username: string | null } = authorTarget
      ? { scope: authorTarget.scope === 'house' ? 'house' : 'member', username: authorTarget.scope === 'house' ? null : String(authorTarget.username || '') }
      : origin ? { scope: origin.scope, username: origin.username }
      : { scope: scope === 'house' ? 'house' : 'member', username: user };
    const slugChanged = Boolean(origin) && typeof input?.slug === 'string' && input.slug !== origin!.oldSlug;
    const authorChanged = Boolean(origin) && (target.scope !== origin!.scope || target.username !== origin!.username);
    const moved = slugChanged || authorChanged;
    const effInput: any = { ...input };
    // The 301 redirect is only meaningful when the public URL actually changed (the slug) -- never for an
    // author-only reassignment (the public URL is type+slug only, unaffected by which folder the file lives in).
    const redirects = mergedRedirectFrom({ oldFm, inputRedirectFrom: input?.redirectFrom, renaming: slugChanged, type, oldSlug: origin?.oldSlug });
    if (redirects) effInput.redirectFrom = redirects;
    // A move (rename or reassignment) must not re-stamp publishedAt (feeds stay stable; the item is not new).
    // The editor stamps it on every publish, so restore the original for the move case only.
    if (moved && oldFm?.publishedAt) effInput.publishedAt = oldFm.publishedAt;
    // sow-165 on the website: every image()-typed value becomes the canonical `./images/<file>` BEFORE the
    // markdown is built. Astro resolves image() relative to the item's own index.md, so the repo-rooted path
    // the stager used to write could not resolve and reddened the site build on main. Normalizing here also
    // repairs a draft saved before the stager was fixed, which still holds the old flat value.
    Object.assign(effInput, normalizeImageFields(effInput, user));

    let built: any;
    try {
      built = buildContentFile({ type, username: target.username, input: { ...effInput, status: effInput.status || 'published' }, body, scope: target.scope });
    } catch (e: any) {
      throw new WorkbenchClientError('invalid-content', e?.message || 'the content is invalid');
    }
    if (moved) {
      // The new path must not already exist (the CI unique-slug guard is the backstop).
      const collision = await readOwnFile(built.path);
      if (collision != null) throw err('bad-request', `"${built.slug}" already exists at the target location`);
    }
    // SOW-016 / Phase 3c: a whole-item members body OR a `<!-- members-only -->` section is encrypted to a sibling
    // .enc (via the cookie /membership/encrypt), and index.md keeps only the public teaser + the encryptedBody
    // pointer. planMemberFiles overrides any stale encryptedBody with the deterministic path, so a re-publish
    // overwrites the same .enc (no orphan). On a move it writes the NEW-location .enc; the OLD one is deleted below.
    const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
    const files: Array<{ path: string; content?: string | null; contentBase64?: string }> = plan ? plan.files : [{ path: built.path, content: built.markdown }];
    const intro = buildIntroFile(target, user, built, authorNote);
    if (intro) files.push(intro);
    // sow-158 image upload: flush the images this item references into the SAME PR as the .md (binary base64
    // entries the Worker commits raw), so the path resolves the moment the PR merges. Newly staged uploads always
    // live under the ACTING caller's own folder (stageImage), regardless of the target folder. planPublishImage
    // holds the commit / skip / REFUSE rule and the order the three sources are tried in; it is unit-tested in
    // test/workbench-client-core.test.mjs, and the three lookups it needs are wired here.
    //
    // The commit folder is resolved HERE, from built.path, rather than at stage time: built.path is the real
    // destination, so this is correct through a rename or an author reassignment that happened after the image
    // was picked. The store is keyed by the draft's `<type>:<slug>`, which moves with a permalink edit, so a
    // renamed item also asks under its previous slug before giving up.
    const imagesDir = `${built.path.replace(/\/[^/]*$/, '')}/images`;
    // sow-183 THE MOVE CASE. Images are co-located: they live in the item's OWN folder, so a rename or an
    // author reassignment moves them too. Before this, every lookup was pointed at the destination folder,
    // where nothing is yet, and the publish refused with "the image is no longer staged" -- which made
    // reassigning any item that carries an image impossible, the owner's /grok prompt among them. The origin
    // folder derives from origin.oldPath by exactly the rule imagesDir uses on built.path, so one rule
    // resolves both ends of the move and they cannot drift apart.
    const oldImagesDir = moved && origin ? `${origin.oldPath.replace(/\/[^/]*$/, '')}/images` : null;
    const itemTokens = [`${type}:${built.slug}`];
    if (origin?.oldSlug && origin.oldSlug !== built.slug) itemTokens.push(`${type}:${origin.oldSlug}`);
    const stagedForCleanup: Array<{ name: string; item: string }> = [];
    // sow-165: the body is scanned too, and it is the half that was missing. referencedImages reads the
    // frontmatter only, so a body image was staged and then never committed, and the merged PR carried
    // markdown pointing at a file that is not in the repository. Astro does not render that as a broken
    // image: the site build fails with [ImageNotFound], so on an auto-merged publish it reds main and stops
    // the deploy. Confirmed by building one on purpose rather than inferred.
    //
    // The frontmatter refs keep the sow-183 MOVE treatment and the body refs deliberately do not. A move has
    // to carry the bytes (the hosted API has no rename primitive) and HOSTED_MAX_IMAGE_TOTAL_BYTES is 4 MB
    // per request, while one real article already holds 9717 KB of body images and two more sit within 3% of
    // the ceiling. Moving them would hard-fail the rename outright, which is worse than today's behaviour of
    // leaving them orphaned at the old folder. That half needs a chunked or Worker-side move, and sow-165
    // records the measurement.
    const imageRefs: Array<{ name: string; move: boolean }> = planImageRefs(
      referencedImages(built.frontmatter),
      bodyImageCandidates(body, oldBody, new Set(pendingImages.keys())),
    );
    for (const ref of imageRefs) {
      const commitPath = `${imagesDir}/${ref.name}`;
      const oldPath = ref.move && oldImagesDir ? `${oldImagesDir}/${ref.name}` : null;
      // ONE read answers both halves of the move: it is the fallback bytes for the copy into the new folder,
      // and it is the proof there is something at the old path worth deleting.
      const oldBase64 = oldPath && oldPath !== commitPath ? await readOwnFileBase64(oldPath) : null;
      const plan = await planPublishImageFiles({ name: ref.name, item: itemTokens[0], commitPath, oldPath, oldBase64 }, {
        fromSession: (r: any) => pendingImages.get(r.name),
        fromStore: async (r: any) => {
          for (const it of itemTokens) {
            const got = await readStagedImage(r.name, it);
            if (got?.dataBase64) return got.dataBase64;
          }
          return null;
        },
        onMain: async (r: any) => (await readOwnFile(r.commitPath)) != null,
      });
      if (plan.action === 'refuse') throw err('bad-request', plan.message);
      if (!plan.files.length) continue;
      files.push(...plan.files);
      if (plan.action !== 'commit') continue;
      pendingImages.delete(ref.name);
      for (const it of itemTokens) stagedForCleanup.push({ name: ref.name, item: it });
    }
    // Move cleanup: delete the old index.md + old .enc, and move the from-the-author intro (project/prompt), all
    // in the same PR. Fail closed if the original vanished from main (never a half-move).
    if (moved) {
      const onMain = (await readOwnFile(origin!.oldPath)) != null;
      if (!onMain) throw err('bad-request', 'the original item could not be found on the network; refresh and try again');
      files.push({ path: origin!.oldPath, content: null });
      if (typeof oldFm?.encryptedBody === 'string' && oldFm.encryptedBody) files.push({ path: oldFm.encryptedBody, content: null });
      const fromTarget = { scope: origin!.scope, username: origin!.username };
      if (!intro) {
        const oldIntroText = await readOwnFile(`${introFolderFor(fromTarget)}/comments/intro-${origin!.oldSlug}.md`);
        files.push(...renameIntroMoveFiles({ from: fromTarget, to: target, type, oldSlug: origin!.oldSlug, newSlug: built.slug, introText: oldIntroText }));
      } else {
        const oldIntro = `${introFolderFor(fromTarget)}/comments/intro-${origin!.oldSlug}.md`;
        if ((await readOwnFile(oldIntro)) != null) files.push({ path: oldIntro, content: null });
      }
    }
    const title = `Publish ${TYPE_LABEL[built.type] || built.type}: ${built.frontmatter?.title || built.slug || user}`;
    const itemId = hostedItemId(built.type, moved ? origin!.oldSlug : built.slug);
    const res = await workerPost('/membership/author', { itemId, files, title });
    // The bytes are in the PR now, so the staging copies have done their job. Dropped AFTER the author call
    // succeeds, never before: a failed publish must leave the image staged, or the author loses it by trying.
    // Best effort, because a stale key is harmless (it is re-put on the next stage, swept by the SOW-024
    // erasure step, and ignored once the real file resolves on main) while a throw here would report a
    // successful publish as a failure.
    for (const c of stagedForCleanup) {
      try { await workerPost('/membership/draft-image', { op: 'delete', item: c.item, name: c.name }); } catch { /* see above */ }
    }
    return {
      prNumber: res.number, prUrl: res.html_url, branch: res.branch, updated: !!res.already, hosted: true,
      encrypted: Boolean(plan?.encPath),
      // sow-183: the item's CURRENT canonical path after this publish (unchanged for a plain edit; the new
      // location for a move) -- lets the editor keep itemPath/itemScope live for a second publish in the SAME
      // session, with no reload, whether this one moved the item or not.
      path: built.path,
      ...(slugChanged ? { renamed: { from: origin!.oldSlug, to: built.slug } } : {}),
      ...(authorChanged ? { reassigned: { from: { scope: origin!.scope, username: origin!.username }, to: { scope: target.scope, username: target.username } } } : {}),
    };
  }

  async function discardDraft({ type, slug, store }: any) {
    // sow-194: a repo draft is committed to the public repo; discarding it is a delete request, not a KV delete.
    // Refuse with a recognizable code so the UI shows "unsupported" rather than a broken control.
    if (store === 'repo') throw err('unsupported', 'This draft is committed to the network and cannot be discarded here. Publish it, or open a removal request.');
    await workerPost('/membership/drafts', { op: 'delete', type, slug });
    return { ok: true };
  }

  // SOW-106 / sow-194: the gated status flip on an OWN canonical item, shared by setContentStatus (unpublish/
  // republish) and publishDraft(store:'repo') (a repo-draft publish is a draft->published flip). members/ only:
  // parseContentPath rejects a house/ path, so a house repo-draft publish is unsupported on the website for now
  // (house content is migrating to members/gbtilabs, sow-195); the Worker re-gates the write regardless.
  async function flipStatus(path: string, status: string) {
    const parsed = parseContentPath(path);
    if (!parsed) throw err('bad-request', 'unsupported content path');
    const text = await readOwnFile(path);
    if (text == null) throw err('not-found', 'could not read that item');
    const flip = flipContentStatus(text, status);
    if (!flip.changed) return { noop: true } as any;
    const title = `${status === 'draft' ? 'Unpublish' : 'Republish'} ${TYPE_LABEL[parsed.type] || parsed.type}: ${parsed.slug}`;
    const res = await workerPost('/membership/author', { itemId: hostedItemId(parsed.type, parsed.slug), files: [{ path, content: flip.content }], title });
    return { prNumber: res.number, prUrl: res.html_url };
  }

  // Read an own `.enc` asset and decrypt it via the Worker (the key stays in the Worker). Returns the plaintext.
  async function decryptEnc(encPath: string): Promise<string> {
    const text = await readOwnFile(encPath);
    if (text == null) throw err('not-found', 'could not read that asset');
    let envelope: any;
    try { envelope = JSON.parse(text); } catch { throw err('undecryptable', 'the asset envelope is invalid'); }
    const r = await workerPost('/membership/decrypt', envelope);
    return r.text;
  }

  // sow-158 Phase 3c: read an own content item and reassemble its FULL authoring body. index.md holds only the
  // public part (Mode C) or an empty body (Mode A/B) — the gated text is in the sibling .enc. When encryptedBody is
  // set, decrypt it and re-join via the pure reassembleMemberBody, so the editor shows everything and a re-publish
  // re-splits identically. FAIL CLOSED: if the decrypt fails on an item that HAS an .enc, throw rather than open the
  // editor on a partial body (a re-save from a partial body would drop the members section).
  async function readAndReassemble(path: string) {
    const text = await readOwnFile(path);
    if (text == null) throw err('not-found', 'could not load that item');
    const { frontmatter, body } = parseContentFile(text);
    const enc = (frontmatter as any)?.encryptedBody;
    if (!enc) return { path, frontmatter, body };
    let memberText: string;
    try { memberText = await decryptEnc(enc); }
    catch { throw err('locked', 'could not load the members-only section of this item; refresh and try again'); }
    return { path, frontmatter, body: reassembleMemberBody(frontmatter, body, memberText) };
  }

  // sow-158 Phase 3b: the cookie twin of member-content.mjs encryptViaWorker. POSTs plaintext to the now-cookie-
  // enabled /membership/encrypt (credentials + CSRF); the AES key never comes back. A 401/403 (not effective-paid)
  // surfaces as the membership-required nudge through workerPost's throw.
  async function encryptViaCookie(plaintext: string, assetId: string) {
    const r = await workerPost('/membership/encrypt', { plaintext, assetId });
    if (!r || r.ok !== true || !r.envelope) throw err('encrypt-failed', 'the comment could not be encrypted');
    return r.envelope;
  }

  // Build + publish one comment file set (post or edit). Mirrors operations.publishComment/editComment: a members
  // body is encrypted to a sibling .enc (planMemberFiles) and the stub .md carries only the pointer; a public
  // author-note intro is committed plaintext. Both files live under members/<login>/, which the hosted validator
  // permits, and ride the own-folder-gated /membership/author (idempotent per comment-<id> item).
  async function commitComment(input: any, body: string) {
    let built: any;
    try { built = buildCommentFile({ username: user, input, body }); }
    catch (e: any) { throw new WorkbenchClientError('invalid-content', e?.message || 'the comment is invalid'); }
    const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
    const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
    const res = await workerPost('/membership/author', { itemId: `comment-${built.id}`, files, title: `Comment on ${input.targetType}: ${input.targetSlug}` });
    return { id: built.id, path: built.path, prNumber: res.number, prUrl: res.html_url, visibility: built.frontmatter.visibility, encrypted: Boolean(plan?.encPath) };
  }

  // Read one of the member's OWN comments (frontmatter + decrypted body), for the edit-form prefill. A members
  // comment stores its body in the .enc, so decrypt it or an edit would start blank and overwrite the gated text.
  async function getCommentLocal(id: string) {
    const path = `members/${user}/comments/${id}.md`;
    const text = await readOwnFile(path);
    if (text == null) throw err('not-found', 'no such comment in your folder');
    const { frontmatter, body } = parseContentFile(text);
    const enc = (frontmatter as any)?.encryptedBody;
    return { path, frontmatter, body: enc ? await decryptEnc(enc) : body };
  }

  // The caller's effective tier (for the SOW-078 member-stub read gate), fail-closed to a non-member on any error.
  async function currentTier(): Promise<string> {
    try { const p = await workerGet('/membership/status'); return typeof p?.status === 'string' ? p.status : 'none'; }
    catch { return 'none'; }
  }

  // A discussion thread from the same-origin comments index (public bodies inline, member rows pointer-only),
  // filtered to the target (+ rename aliases), oldest-first. A non-member viewer sees only the public rows.
  async function listCommentsLocal({ targetType, targetSlug, limit, aliases }: any = {}) {
    if (!COMMENT_TARGET_TYPES.has(targetType) || !targetSlug) return { items: [] };
    let all: any[] = [];
    try { all = (await sameOriginJson('/comments-index.json'))?.items ?? []; } catch { return { items: [] }; }
    const canSeeMembers = MEMBER_READ_TIER.has(await currentTier()); // SOW-078: gate the member stubs by tier
    return { items: filterThreadComments(all, { targetType, targetSlug, aliases, limit, canSeeMembers }) };
  }

  // sow-161 B (owner-approved Option A, band seq 35): the SUPERADMIN channel-map surface, THE ROLE GATE.
  // These methods are attached ONLY when the viewer is a superadmin. That is deliberate and load-bearing: the
  // shared <gbti-categories-workspace> decides whether to draw its channel column with a CAPABILITY check
  // (`typeof this.client.contentChannelPool === 'function' && typeof this.client.discordChannels === 'function'`),
  // which cannot express a role. If these methods were present for an admin, the admin would see the channel
  // column and every write would 403 at the Worker (writes are superadmin via the category-batch max-rank gate).
  // Making the CAPABILITY itself superadmin-scoped is what lets the capability check reflect the role: an admin's
  // client simply does not have the methods, so the column stays off AND the admin cannot call them at all
  // (defense in depth over the server gate, which is still the real boundary: reads default to authorizeSuperadmin,
  // writes re-check rank). This object is EMPTY for every non-superadmin caller and for every other host page that
  // never passes isSuperadmin, so no other surface is affected.
  const channelMapMethods: Record<string, any> = isSuperadmin ? {
    // The category -> Discord channel picker source (SOW-100). authorizeAdmin server-side (shared with the
    // extension), but only a superadmin client exposes it, so the categories channel column is superadmin-only UX.
    discordChannels() { return workerGet('/membership/discord-channels'); }, // [{ id, name, type, parentId }]
    // The <gbti-channel-map-manager> surface (six reads + six writes). Reads mirror admin-ops' shapes; writes land
    // as auto-gated PRs against the superadmin-pinned moderation-flags.yml / syndication-config.yml. contentChannelPool
    // is read here (the matrix) but the channel -> Discord map is EDITED via the categories workspace (category-batch),
    // so no setContentChannel method is needed.
    contentChannelPool() { return workerGet('/membership/admin/content-channel-pool'); }, // { channels }
    moderationFlagPool() { return workerGet('/membership/admin/moderation-flag-pool'); }, // { lists }
    syndicationTemplatePool() { return workerGet('/membership/admin/syndication-template-pool'); }, // { templates, channelTemplates, ..., types, channels }
    newsEngagementSettings() { return workerGet('/membership/admin/news-engagement'); }, // { settings, tiers }
    syndicationSettings() { return workerGet('/membership/admin/syndication-settings'); }, // { settings, channelNames, autoTypes, ... }
    async addModerationFlagTerm(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'flag-term-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeModerationFlagTerm(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'flag-term-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setSyndicationTemplates(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'syndication-templates-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setNewsEngagement(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-engagement-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setSyndicationSettings(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'syndication-settings-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
  } : {};

  return {
    // ----- identity + read -----
    async status() {
      let payload: any = null;
      try { payload = await workerGet('/membership/status'); } catch { payload = null; }
      // sow-158 follow-up: prefer the oracle's effectiveStatus (ban>staff>grandfather>Stripe, folded server-side)
      // + role, which the static site cannot derive itself. So a staff/grandfathered member reads as paid and
      // staff surfaces the role for the admin gate. Falls back to the raw Stripe status for an older Worker.
      const membership = typeof payload?.effectiveStatus === 'string' ? payload.effectiveStatus
        : (typeof payload?.status === 'string' ? payload.status : 'unknown');
      const role = typeof payload?.role === 'string' && payload.role ? payload.role : 'member';
      const lg = payload?.login || user;
      const gid = payload?.github_id != null ? String(payload.github_id) : githubId;
      return {
        authenticated: payload?.ok === true,
        membership,
        role,
        canPublish: canPublish(membership),
        canStageDrafts: canStageDrafts(membership),
        couponUntil: payload?.couponUntil ?? null,
        // sow-185: the Worker's authoritative paid TIER (none|member|creator), fail-closed to 'none' for an
        // older Worker. Presentation-only; the WorkBench editor reads it for any creator-tier affordance.
        paidTier: typeof payload?.paidTier === 'string' ? payload.paidTier : 'none',
        // sow-271: `username` is REQUIRED here, not decorative. canEditInPlace (client-ui/src/inline.mjs:25)
        // reads `identity.username` and returns false without it, so omitting it makes the in-place edit
        // panel invisible to the folder OWNER as well as to everyone else, with no error anywhere. The
        // extension host supplies it; the website host did not, which is why the panel never worked here.
        identity: { login: lg, username: lg, githubId: gid },
        login: lg,
        username: lg,
        githubId: gid,
      };
    },

    // Own + house content is fetched from the same-origin public per-type index (published items only). "My
    // content" filters to the member's own folder; "House content" (superadmin-only in the UI, gbti-workspace.mjs
    // gates the toggle on role==='superadmin') filters to house/ instead, by path rather than by author string
    // (sow-182). Drafts + members-only-A items are surfaced separately (listDrafts / the locked card), matching
    // the website's tokenless read reach; house content has no draft concept (SOW-145: it publishes directly),
    // and the index is published-only, so an unpublished house item never appears here either way.
    async listContent({ type, scope }: any = {}) {
      const json = TYPE_INDEX[type];
      if (!json) return { items: [] }; // profile + unknown types have no public index
      let raw: any = null;
      try { raw = await sameOriginJson('/' + json); } catch { return { items: [] }; }
      const rawItems: any[] = Array.isArray(raw?.items) ? raw.items : [];
      const selected = scope === 'house' ? networkContent(rawItems, 9999) : memberContent(rawItems, user, 9999);
      const items = selected.map((it: any) => ({ ...it, status: 'published' }));
      return { items };
    },

    getContentItem({ path }: any) { return readAndReassemble(path); },
    // SOW-031 reader parity: read any own published item (same source as getContentItem for the WorkBench).
    readItem({ path }: any) { return readAndReassemble(path); },

    // ----- pure form/preview/validate (no network) -----
    formFields({ type }: any) { return { type, fields: fieldsFor(type) || [] }; },
    preview({ body }: any) { return { html: renderMarkdown(body ?? '') }; },
    validateContent({ type, input, body }: any) {
      try {
        const built = buildContentFile({ type, username: user, input, body });
        return { valid: true, path: built.path };
      } catch (e: any) {
        return { valid: false, error: e?.message, issues: e?.issues };
      }
    },

    // ----- authoring -----
    publish,
    // sow-183: the Author-reassignment picker source (gbti-content-editor.mjs). Superadmin-only server-side
    // (authorizeSuperadmin) -- a non-superadmin's call throws (parseJson on a 403), which the editor treats
    // exactly like an absent/unsupported client method: the Author field simply does not render for them.
    async authorTargets() {
      const r = await workerGet('/membership/author/targets');
      return { members: Array.isArray(r?.members) ? r.members : [] };
    },
    async saveDraft({ type, input = {}, body = '', path, authorNote, authorTarget }: any) {
      // A members-only draft is allowed: its plain body stays in the private, erasable KV draft store (SOW-157),
      // never git; publishDraft() encrypts it at publish time. So no members refusal here.
      const slug = String((input && input.slug) || '');
      await workerPost('/membership/drafts', {
        op: 'put',
        draft: {
          type, slug, path: path || null, frontmatter: input, body,
          // SOW-014: omitted rather than nulled, so a caller that does not know about the note cannot clear one.
          ...(typeof authorNote === 'string' ? { authorNote } : {}),
          // Same contract for the pending author reassignment, and it matters more here: preview.astro saves
          // drafts too and passes no authorTarget, so nulling on absence would let a Preview quietly throw
          // away a reassignment the superadmin had already chosen. `null` is passed explicitly to CLEAR, which
          // is what the editor does once a publish has consumed the move.
          ...(authorTarget !== undefined ? { authorTarget } : {}),
        },
      });
      return { state: 'staged' };
    },
    async listDrafts({ type }: any = {}) {
      const r = await workerGet('/membership/drafts');
      let drafts = (Array.isArray(r?.drafts) ? r.drafts : []).map(mapDraftRecord);
      // sow-194: fold in the caller's committed repo drafts (status:draft in the public repo), which both the
      // KV store and the published index omit. mergeRepoDrafts drops a repo row whose (type,slug) already has a
      // KV draft (that KV copy is the newer editable staging state). Fail-soft: a repo-drafts error must not
      // blank the Drafts list, so a KV-only member still sees their KV drafts if the route is unavailable.
      let repoItems: any[] = [];
      try { const rr = await workerGet('/membership/repo-drafts'); repoItems = Array.isArray(rr?.items) ? rr.items : []; } catch { repoItems = []; }
      drafts = mergeRepoDrafts(drafts, repoItems);
      if (type) drafts = drafts.filter((d: any) => d.type === type);
      return { drafts };
    },
    async readDraft({ type, slug, store, path }: any) {
      // sow-194: a repo draft is the canonical committed file (not a KV record); read + reassemble it (decrypting
      // a members-only body via readAndReassemble) so the editor opens the real content.
      if (store === 'repo') {
        if (!path) throw err('bad-request', 'a repo draft needs its path to open');
        return readAndReassemble(path);
      }
      const r = await workerGet('/membership/drafts');
      const rec = (Array.isArray(r?.drafts) ? r.drafts : []).find((d: any) => d.type === type && d.slug === slug);
      if (!rec) throw err('not-found', 'could not open that draft');
      return {
        frontmatter: rec.frontmatter || {}, body: rec.body || '', path: rec.path || '',
        authorNote: typeof rec.authorNote === 'string' ? rec.authorNote : null,
        authorTarget: rec.authorTarget && typeof rec.authorTarget === 'object' ? rec.authorTarget : null,
      };
    },
    discardDraft,
    async publishDraft({ type, slug, store, path }: any) {
      // sow-194: publishing a repo draft is the draft->published status flip on the canonical item (the same
      // gated hosted PR setContentStatus uses), NOT a KV publish.
      if (store === 'repo') {
        if (!path) throw err('bad-request', 'a repo draft needs its path to publish');
        return flipStatus(path, 'published');
      }
      const r = await workerGet('/membership/drafts');
      const rec = (Array.isArray(r?.drafts) ? r.drafts : []).find((d: any) => d.type === type && d.slug === slug);
      if (!rec) throw err('not-found', 'could not find that draft');
      const res = await publish({
        type, input: rec.frontmatter || {}, body: rec.body || '', path: rec.path || undefined,
        ...(typeof rec.authorNote === 'string' ? { authorNote: rec.authorNote } : {}),
        // WITHOUT THIS LINE THE WHOLE FEATURE IS A LIE. The editor would show the pending reassignment,
        // the store would hold it, and publishing the draft from the Drafts list would quietly publish it
        // back to the original owner and report success. That silent no-op is the behaviour this change
        // exists to remove, so it must be forwarded on EVERY publish path, not only the editor's.
        ...(rec.authorTarget && typeof rec.authorTarget === 'object' ? { authorTarget: rec.authorTarget } : {}),
      });
      await discardDraft({ type, slug }).catch(() => {}); // best-effort: the draft is now a submitted PR
      return { prNumber: res.prNumber, prUrl: res.prUrl };
    },
    // SOW-106: member self-unpublish/republish — flip status on the own canonical item via the gated hosted PR.
    setContentStatus({ path, status }: any) { return flipStatus(path, status); },

    // ----- pull requests (read via the Worker's installation-token proxy, scoped to the caller) -----
    async listPRs() {
      const r = await workerGet('/membership/my-pulls');
      return { prs: Array.isArray(r?.items) ? r.items : [] }; // the Worker returns { items }; the components read { prs }
    },
    prStatus({ number }: any) { return workerGet(`/membership/pr-status?number=${encodeURIComponent(number)}`); },

    // ----- SOW-018 Shares: post (members-default, encrypted) + read the tier-gated community stream -----
    // Post a Share through the SAME hosted-authoring PR path as content. A members share (the composer's default
    // visibility) encrypts its whole body to a sibling .enc via the cookie /membership/encrypt; the stub .md
    // carries only the pointer. Mirrors operations.publishShare. Returns the PR handle the composer's ack reads.
    async postShare({ input = {}, body = '' }: any) {
      const createdAt = new Date().toISOString();
      const id_ = (input && input.id) || makeShareId(createdAt, input?.title);
      let built: any;
      try { built = buildShareFile({ username: user, input: { ...input, id: id_, createdAt }, body }); }
      catch (e: any) { throw new WorkbenchClientError('invalid-content', e?.message || 'the share is invalid'); }
      const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
      const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
      const title = `New Share${built.frontmatter?.title ? `: ${built.frontmatter.title}` : ''}`;
      const res = await workerPost('/membership/author', { itemId: `share-${id_}`, files, title });
      return { id: id_, path: built.path, visibility: built.frontmatter?.visibility ?? 'members', encrypted: Boolean(plan?.encPath), prNumber: res.number, prUrl: res.html_url, updated: !!res.already };
    },
    // SOW-057: the share composer's "Fetch details" link preview. The website holds no GitHub token in the page,
    // so this rides the cookie session to the Worker's SSRF-guarded, now cookie-enabled /membership/og-preview
    // via workerPost (credentials + the double-submit CSRF header). Returns { image, title, description, tags,
    // suggestedCategory }; the composer prefills the fields (all optional) and never blocks a share on a miss.
    ogPreview({ url }: any) { return workerPost('/membership/og-preview', { url }); },
    // The community Shares stream, tier-gated server-side (paid/trial see members + public; else public only).
    // Members bodies arrive pointer-only (encryptedBody); <gbti-shares-feed> decrypts on expand via decrypt().
    async listShares({ limit, before }: any = {}) {
      const qs = new URLSearchParams();
      if (limit) qs.set('limit', String(limit));
      if (before) qs.set('before', String(before));
      const r = await workerGet('/membership/shares' + (qs.toString() ? `?${qs.toString()}` : ''));
      return { items: Array.isArray(r?.items) ? r.items : [], nextBefore: r?.nextBefore ?? null, canSeeMembers: r?.canSeeMembers ?? false };
    },

    // ----- sow-161 admin surface (read): the per-member Stripe status map for the dashboard roster. Admin-gated
    // server-side over the cookie session (authorizeAdmin + allowCookie); a non-admin session 403s. -----
    adminStatuses() { return workerGet('/membership/admin/statuses'); }, // { ok, statuses: { <github_id>: '<status>' } }
    // sow-161 admin mutation dispatch (increment 1: content moderation deplatform/republish/remove with { path }).
    // The Worker computes the change server-side + gates by role; a non-staff session 403s, an unsupported action
    // 400s (ban/role land in later increments). Cookie POST -> CSRF enforced by workerPost. Normalize the Worker's
    // { number, html_url } to the { prNumber, prUrl } shape <gbti-admin> renders (parity with the extension host).
    async admin(action: string, args: any = {}) {
      const r = await workerPost('/membership/admin/author', { action, ...args });
      return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null };
    },
    // sow-161 A: the categories workspace + tag explorer. taxonomy() reads house/taxonomy.yml { tree }; adminOp()
    // fires an allow-listed operation (category-migrate) over the cookie session (the Worker enforces CSRF on the
    // POST). category-batch + tag-edit go through admin() above (the Worker resolves their multi-file writes).
    taxonomy() { return workerGet('/membership/admin/taxonomy'); }, // { ok, tree }
    async adminOp(action: string, params: any = null) { return workerPost('/membership/admin/ops', params ? { action, params } : { action }); },
    // sow-161 increment 4: the quotes config manager. Read the full pool (admin-gated) + the three write actions,
    // each normalized to the { noop, prNumber } shape gbti-quote-manager renders.
    quotePool() { return workerGet('/membership/admin/quote-pool'); }, // { ok, quotes }
    async addQuote(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'quote-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeQuote(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'quote-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setQuoteEnabled(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'quote-toggle', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-271: the site-wide presentation toggles (superadmin). siteSettings reads house/site-settings.yml resolved;
    // setSiteToggle lands as an auto-gated house PR. `enabled` is coerced to a real boolean on the wire so a stray
    // "false" cannot switch a toggle ON (the Worker's siteToggleInput rejects a non-boolean regardless).
    siteSettings() { return workerGet('/membership/admin/site-settings'); }, // { ok, settings, toggles }
    async setSiteToggle(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'site-setting-set', ...args, enabled: args?.enabled === true }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-161 increment 4: the news-source config manager (full pool read + the three write actions).
    newsSourcePool() { return workerGet('/membership/admin/news-source-pool'); }, // { ok, sources }
    async addNewsSource(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeNewsSource(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setNewsSourceEnabled(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-toggle', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-161 increment 4: the coupons config manager. couponPool reads house/coupons.yml (config); couponUsage reads
    // the KV redemption counts; add/update land as auto-gated house PRs. A coupon is deactivated, never deleted.
    couponPool() { return workerGet('/membership/admin/coupon-pool'); }, // { ok, coupons }
    couponUsage() { return workerGet('/membership/admin/coupon-usage'); }, // { ok, usage }
    async addCoupon(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'coupon-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async updateCoupon(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'coupon-update', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },

    // sow-161 B: the SUPERADMIN channel-map surface (six manager reads/writes + discordChannels for the categories
    // channel column). Attached only when isSuperadmin (see channelMapMethods above): the role gate lives HERE, in
    // the presence of the methods, so the shared elements' capability checks reflect the role and no admin ever
    // meets a channel control that would 403. Empty spread for every non-superadmin caller.
    ...channelMapMethods,

    // sow-231 Phase 3: ISSUED INVITES. Unlike the coupon config above, these are NOT git-native and open no
    // PR: an invite is per-person state carrying an administration note, so it lives in KV per the storage
    // boundary. That is why these go straight to the Worker rather than through the author route.
    inviteList() { return workerGet('/membership/admin/invites'); }, // { ok, invites }
    inviteCreate(args: any = {}) { return workerPost('/membership/admin/invites', args); }, // { campaign, note?, expiresAt? }
    inviteUpdate(args: any = {}) { return workerPatch('/membership/admin/invites', args); }, // { code, action: 'revoke'|'note', note? }

    // sow-293: CREATOR APPLICATIONS. Same disposition as the invites above and for the same reason: an
    // application is prose a person wrote about themselves, keyed by github_id, so it is KV state per the
    // storage boundary and opens no PR. The Worker gates both at authorizeSuperadmin, because approving
    // grants a real tier.
    creatorApplications() { return workerGet('/membership/admin/creator-applications'); }, // { ok, applications }
    decideCreatorApplication(args: any = {}) { return workerPost('/membership/admin/creator-applications', args); }, // { githubId, decision, note? }

    // ----- SOW-043/046: interactive News over the cookie session (free-tier perk; authorizeSignedIn) -----
    getNews({ category, since, limit }: any = {}) {
      const qs = new URLSearchParams();
      if (category) qs.set('category', String(category));
      if (since) qs.set('since', String(since));
      if (limit) qs.set('limit', String(limit));
      return newsGet('/membership/news' + (qs.toString() ? `?${qs.toString()}` : ''));
    },
    getNewsSources() { return newsGet('/membership/news-sources'); },
    getNewsCategories() { return newsGet('/membership/news-categories'); },
    // Best-effort engagement beacons (the reader ignores their failures); cookie POST -> CSRF via workerPost.
    newsOpened({ guid, source }: any = {}) { return workerPost('/membership/news-opened', { guid, ...(source ? { source } : {}) }); },
    newsDiscussed({ guid, source }: any = {}) { return workerPost('/membership/news-discussed', { guid, ...(source ? { source } : {}) }); },
    // SOW-126 engagement beacon, positional (type, slug) to match the extension client. Best-effort: the reader
    // wraps it in a .catch, and the Worker 200-no-ops off-tier, so a signed-out/off-tier open never surfaces.
    // Curator "Add to Discord" stays extension-only for now (news-publish is bearer/curator-gated). status() keeps
    // canCurate false on the web, so <gbti-news> never renders the button; this typed refusal is a defensive stop.
    publishNews() { throw err('curator-extension-only', 'Publishing news to Discord is available in the browser extension for now.'); },

    // ----- members-only READ (a paid/trial member reading an existing own members-only body) -----
    async decrypt({ encPath }: any) { return { text: await decryptEnc(encPath) }; },

    // ----- SOW-024: favorites + collections (Saved), all over the cookie-ready KV /membership/activity -----
    async getActivity() { const r = await workerGet('/membership/activity'); return r?.activity ?? { favorites: [], collections: [] }; },
    async toggleFavorite({ targetType, targetSlug, on }: any) {
      const r = await workerPost('/membership/activity', { action: 'favorite', targetType, targetSlug, on });
      return { favorited: favoritedFrom(r?.activity, targetType, targetSlug) };
    },
    async createCollection({ name }: any) { const r = await workerPost('/membership/activity', { action: 'collection.create', name }); return { id: r.id, activity: r.activity }; },
    addToCollection({ id, targetType, targetSlug, on = true }: any) { return workerPost('/membership/activity', { action: 'collection.item', id, targetType, targetSlug, on }); },
    renameCollection({ id, name }: any) { return workerPost('/membership/activity', { action: 'collection.rename', id, name }); },
    deleteCollection({ id }: any) { return workerPost('/membership/activity', { action: 'collection.delete', id }); },

    // ----- SOW-023/046: the follow graph + prefs (Following), cookie-ready KV -----
    getFollows() { return workerGet('/membership/follows'); }, // { following }
    setFollow({ username, on = true, notify }: any) { return workerPost('/membership/follows', { username, on, notify }); }, // SOW-186 C3: optional per-follow notify matrix
    // UNWRAP the envelope. `/membership/prefs` answers `{ ok, prefs: { categories, followedChannels } }`,
    // but every consumer of client.getPrefs/setPrefs reads `.categories` off the TOP level: the comment on
    // these two lines has always said `{ categories, followedChannels }`, and client/src/news-client.mjs
    // (the extension + npm transport for the same two endpoints) does `return data?.prefs ?? ...`. This
    // adapter alone returned the raw envelope, so on the WEBSITE `p?.categories` was undefined everywhere.
    //
    // It was not cosmetic, it DESTROYED DATA. <gbti-topic-picker> assigns the response back over its local
    // selection (`this._selected = selectedTopics(p?.categories)`), so every chip click reset the selection
    // to []. The next click then POSTed a one-element array, because the picker sends the whole selection
    // rather than a delta. Each pick silently replaced every earlier pick, and the chip un-highlighted as it
    // happened. metacast's stored prefs after picking several topics were `{"categories":["gaming"]}`, the
    // last click alone. The same undefined also made _load() show an empty picker to a member who had
    // already chosen topics.
    //
    // Fixed HERE rather than in the picker, because the picker is shared with the extension where the
    // transport already unwraps; "fixing" the reader would have double-unwrapped that host.
    async getPrefs() { const r: any = await workerGet('/membership/prefs'); return r?.prefs ?? r; },
    async setPrefs(patch: any) { const r: any = await workerPost('/membership/prefs', patch); return r?.prefs ?? r; },

    // ----- sow-207: the welcome flow's Discord step, over the cookie session -----
    // The member is already authenticated by the httpOnly session cookie, so the connect URL points straight at the
    // Worker's /discord/link/start (it resolves identity from the cookie). Opening it in a new tab is a same-site
    // top-level navigation, so the session cookie rides along; no token, no round-trip to mint the URL.
    async discordLinkUrl() { return { url: `${base}/discord/link/start` }; },
    // The welcome poll: has this member's Discord been linked yet? Read-only; the Worker answers over the cookie
    // session (credentialed CORS + a cookie fallback) and fails closed to { linked: false }, so a poll never blocks.
    discordLinkStatus() { return workerGet('/discord/link/status'); },
    // sow-218: disconnect. The Worker strips the managed roles BEFORE clearing the link, so a member cannot end
    // up holding guild access that reconcile can no longer see to revoke. Never kicks.
    discordUnlink() { return workerPost('/discord/unlink', {}); },

    // ----- SOW-027/044: comments — read (public + own decrypt) + post/edit (members-encrypted) + own delete -----
    listComments(a: any = {}) { return listCommentsLocal(a); },
    listShareComments({ targetSlug, limit }: any = {}) { return listCommentsLocal({ targetType: 'share', targetSlug, limit }); },
    getComment({ id }: any) { return getCommentLocal(String(id || '')); },
    // Post a discussion reply (members-only, encrypted) or a from-the-author intro (public). Paid-only, gate-backed.
    postComment({ targetType, targetSlug, body, authorNote, parentId, visibility }: any) {
      if (!COMMENT_TARGET_TYPES.has(targetType)) throw err('bad-request', 'a valid targetType is required');
      if (!targetSlug) throw err('bad-request', 'a targetSlug is required');
      const createdAt = new Date().toISOString();
      const id = commentId(createdAt, Math.random().toString(36).slice(2, 8));
      const input = coerceCommentInput({ id, targetType, targetSlug, createdAt, authorNote, parentId, visibility });
      return commitComment(input, body ?? '');
    },
    async editComment({ id, body, authorNote }: any) {
      const cur = await getCommentLocal(String(id || ''));
      const fm: any = cur.frontmatter || {};
      const effAuthorNote = authorNote !== undefined ? Boolean(authorNote) : Boolean(fm.authorNote);
      const input = coerceCommentInput({
        id: fm.id, targetType: fm.targetType, targetSlug: fm.targetSlug,
        createdAt: fm.createdAt, updatedAt: new Date().toISOString(),
        authorNote: effAuthorNote, parentId: fm.parentId, visibility: fm.visibility,
      });
      const r = await commitComment(input, body ?? '');
      return { ...r, edited: true, targetType: fm.targetType, targetSlug: fm.targetSlug };
    },
    async deleteComment({ id }: any) {
      const cid = String(id || '').trim();
      if (!cid) throw err('bad-request', 'a comment id is required');
      const res = await workerPost('/membership/author', {
        itemId: `comment-${cid}`,
        files: [{ path: `members/${user}/comments/${cid}.md`, content: null }],
        title: `Delete comment: ${cid}`,
      });
      return { ok: true, id: cid, prNumber: res.number, prUrl: res.html_url };
    },

    // sow-158 image upload: stage an image binary for the next publish. The editor already shows a local data-URL
    // preview; this validates + records the base64 and returns the value the field stores. The image is committed
    // with the content in one PR (publish flushes referencedImages). png/jpg/webp/gif only (no svg on web),
    // <= 1 MB (the Worker + check-media re-enforce; this is the fast client refusal).
    //
    // The value returned is the canonical CO-LOCATED `./images/<name>`, which Astro's image() resolves relative
    // to the item's own index.md. This used to return the repo-rooted `members/<user>/images/<name>`, which
    // image() cannot resolve at all: publishing one reddened the site build, and every render surface
    // (resolveContentAsset, the preview's asset()) joined it onto the item folder and 404ed. The npm client was
    // fixed for this in sow-165; only the website was left behind.
    //
    // `item` is the draft's `<type>:<slug>`, which scopes the stored bytes. A missing one is refused rather than
    // defaulted: an image belongs to a draft, and the draft store itself will not accept a record without a slug.
    async stageImage({ filename, dataBase64, item }: any) {
      const name = sanitizeImageName(filename);
      if (!name) throw err('bad-request', 'Use a PNG, JPG, WEBP, or GIF image (SVG is not supported on the web).');
      const b64 = String(dataBase64 || '');
      if (!b64) throw err('bad-request', 'That image had no data. Try choosing it again.');
      if (base64Bytes(b64) > MAX_IMAGE_BYTES) throw err('bad-request', 'That image is over 1 MB. Please optimize it (or pick a smaller one) first.');
      if (!item) throw err('bad-request', 'Give this item a permalink before adding an image.');
      pendingImages.set(name, b64);
      // Persist alongside the draft so the image survives a reload. The Worker re-validates and re-derives the
      // key from the authenticated identity, so this is not the only place the rules are enforced.
      await workerPost('/membership/draft-image', { op: 'put', item, name, dataBase64: b64 });
      return { ok: true, path: `./images/${name}` };
    },

    // The editor and the preview call this to rehydrate a thumbnail after a reload, scoped to their item.
    getStagedImage: readStagedImage,
  };
}

export { WorkbenchClientError };

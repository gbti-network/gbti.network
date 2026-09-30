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
// OPTIONAL-CHAINED there (getActivity, getFollows, listComments, admin, ...), so its absence
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
// house/authorTarget handling in publish is UX convenience, not the security boundary; a non-superadmin's stray
// attempt still fails closed server-side.
//
// Split at the 900-line cap (owner ruling 2026-09-30). This file keeps the factory and most of its methods. The
// Worker fetches live in workbench-client-transport.ts, publish in workbench-client-publish.ts, and the admin,
// channel-map, invite and editorial methods in workbench-client-admin.ts. The object this factory returns, its
// method names and their order are unchanged by the split.

import { mergeCommentEchoes } from '../../membership/comment-echo.mjs'; // SOW-076 echoes, wired for the website 2026-09-11
import { skillFileBeside } from '../../client/src/skill-file.mjs'; // sow-109: a skill's SKILL.md is read back with it
import { buildContentFile, buildCommentFile, buildShareFile, shareId as makeShareId, flipContentStatus, parseContentFile, commentId } from '../../client/src/content-ops.mjs';
import { fieldsFor } from '../../client/src/form-fields.mjs';
import { renderMarkdown } from '../../client/src/markdown.mjs';
import { canPublish, canStageDrafts } from '../../client/src/membership.mjs';
import { memberContent } from '../../client-ui/src/member-view-core.mjs';
import { coverAfterAuthorMove, redirectAfterAuthorMove } from '../../client-ui/src/share-post-core.mjs';
import { planMemberFiles, reassembleMemberBody, filterThreadComments, coerceCommentInput, favoritedFrom, activityFavoritePayload, activityCollectionItemPayload, COMMENT_TARGET_TYPES, MEMBER_READ_TIER, sanitizeImageName, draftRecordForEditor, base64Bytes, networkContent, shareMoveDeletions } from './workbench-client-core.mjs';
import { mergeRepoDrafts } from '../../client/src/repo-drafts-core.mjs';
import { setContentRef } from '../../client-ui/src/assets.mjs'; // sow-315: pin images to the content commit
import { WorkbenchClientError, err, readCsrf, createWorkerTransport } from './workbench-client-transport'; // the Worker fetches
import { TYPE_LABEL, hostedItemId, createPublish } from './workbench-client-publish'; // publish, and the two names flipStatus shares with it
import { adminMethods } from './workbench-client-admin'; // the admin, channel-map, invite and editorial methods

const MAX_IMAGE_BYTES = 1_048_576; // 1 MB, matching the Worker gate + check-media
const TYPE_INDEX: Record<string, string> = { post: 'blog-index.json', project: 'projects-index.json', prompt: 'prompts-index.json' };
// members/<user>/<posts|projects|products|prompts>/<slug>/index.md -> { type, slug }. Mirrors the folder->type mapping.
const FOLDER_TYPE: Record<string, string> = { posts: 'post', projects: 'project', products: 'project', prompts: 'prompt' };
const PATH_RE = /^members\/[^/]+\/(posts|projects|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;

function parseContentPath(path: string): { type: string; slug: string } | null {
  const m = PATH_RE.exec(String(path || ''));
  if (!m) return null;
  return { type: FOLDER_TYPE[m[1]], slug: m[2] };
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
    skillFile: typeof rec?.skillFile === 'string' ? rec.skillFile : null, // sow-109
    pull: null,
    store: 'kv', // sow-194: the store discriminator, so a KV draft never collides with a repo draft on merge
    publishedAt: fm.publishedAt ? Number(fm.publishedAt) : null,
    updatedAt: rec?.updatedAt || null,
  };
}

/**
 * Build the website WorkBench client.
 * @param signupBase the signup Worker origin (stamped on <html data-signup-base> by BaseLayout).
 * @param login the signed-in member's GitHub login.
 * @param username the member's FOLDER, members/<username>/, their GBTI name (sow-428). It drives every path this
 *   client writes and the own-content filter. It can differ from the login, so it is never derived from it here;
 *   the login stands in only for a caller that has no folder to pass.
 * @param githubId the signed-in member's immutable id (fallback identity; the session cookie is authoritative).
 */
export function createWorkbenchClient({ signupBase, login, username = '', githubId = null, isSuperadmin = false }: { signupBase: string; login: string; username?: string; githubId?: string | null; isSuperadmin?: boolean }) {
  const base = String(signupBase || '').replace(/\/$/, '');
  const user = String(username || login || '').toLowerCase();
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

  // The Worker transport (workbench-client-transport.ts): the cookie-session GET/POST/PATCH, the news GET, the
  // same-origin index read, and the two own-file reads, all bound to this client's Worker origin.
  const { workerGet, workerPost, workerPatch, newsGet, sameOriginJson, readOwnFile, readOwnFileBase64 } = createWorkerTransport(base);

  // The core publish (workbench-client-publish.ts). Built over this closure's state so a publish still reads
  // and clears the same staged images, and still encrypts through the same cookie route, as it did inline.
  const publish = createPublish({ user, pendingImages, readOwnFile, readOwnFileBase64, readStagedImage, workerPost, encryptViaCookie });

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
    // sow-425: the Worker says `membership_required` to a reader who is not paid. Every decrypting component (the
    // locked box, the discussion, the shares feed, the reader) shows its members message for `membership-required`,
    // the code the extension host already uses, so translate it here once.
    let r: any;
    try { r = await workerPost('/membership/decrypt', envelope); } catch (e: any) {
      if (e?.code === 'membership_required') throw err('membership-required', e.message || 'This is for members.');
      throw e;
    }
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
    const skill = await skillFileBeside(path, frontmatter, readOwnFile, decryptEnc); // sow-109: the editor opens the file it publishes back (decrypted for a members-only skill)
    const enc = (frontmatter as any)?.encryptedBody;
    if (!enc) return { path, frontmatter, body, ...skill };
    let memberText: string;
    try { memberText = await decryptEnc(enc); }
    catch { throw err('locked', 'could not load the members-only section of this item; refresh and try again'); }
    return { path, frontmatter, body: reassembleMemberBody(frontmatter, body, memberText), ...skill };
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
  // `removeEnc`: the comment's previous ciphertext, deleted in the same PR when the comment flips to public
  // (a stale .enc beside a public stub is the half-flip the build guard now refuses). Own _enc/ only.
  async function commitComment(input: any, body: string, { removeEnc = null }: { removeEnc?: string | null } = {}) {
    let built: any;
    try { built = buildCommentFile({ username: user, input, body }); }
    catch (e: any) { throw new WorkbenchClientError('invalid-content', e?.message || 'the comment is invalid'); }
    const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
    const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
    if (!plan?.encPath && typeof removeEnc === 'string' && removeEnc.startsWith(`members/${user}/_enc/`)) files.push({ path: removeEnc, content: null });
    const res = await workerPost('/membership/author', { itemId: `comment-${built.id}`, files, title: `Comment on ${input.targetType}: ${input.targetSlug}` });
    return { id: built.id, path: built.path, prNumber: res.number, prUrl: res.html_url, visibility: built.frontmatter.visibility, encrypted: Boolean(plan?.encPath) };
  }

  // Read one of the member's OWN comments (frontmatter + decrypted body), for the edit-form prefill. A members
  // comment stores its body in the .enc, so decrypt it or an edit would start blank and overwrite the gated text.
  // sow-326: `author` is OPTIONAL and defaults to the caller, which is the right scope for the comment box
  // (it prefills an edit of the caller's OWN comment). An explicit author reads that member's folder instead,
  // which the content editor needs: a superadmin editing another member's article has to prefill the
  // from-the-author note from the ITEM's intro comment, and the caller-scoped read found nothing there and
  // silently left the box empty. Same route, same allow-list and same auth as readOwnFile, which admits any
  // clean members/ path for a signed-in member on a repo that is public by design, so this widens no access.
  async function getCommentLocal(id: string, author?: string) {
    const folder = /^[a-z0-9][a-z0-9-]*$/.test(String(author || '')) ? String(author) : user;
    const path = `members/${folder}/comments/${id}.md`;
    const text = await readOwnFile(path);
    if (text == null) throw err('not-found', 'no such comment in that folder');
    const { frontmatter, body } = parseContentFile(text);
    const enc = (frontmatter as any)?.encryptedBody;
    return { path, frontmatter, body: enc ? await decryptEnc(enc) : body, visibility: (frontmatter as any)?.visibility === 'public' ? 'public' : 'members' };
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
    const deployed = filterThreadComments(all, { targetType, targetSlug, aliases, limit, canSeeMembers });
    return { items: await withCommentEchoes(targetType, targetSlug, deployed) };
  }

  // SOW-076, wired for the WEBSITE on 2026-09-11 (the npm + extension hosts had it since the SOW; here a member's
  // fresh comment stayed invisible until the site rebuilt, which the owner read as "several minutes to land").
  // The caller's OWN pending echoes for the thread, merged behind the deployed rows: a row the deployed index
  // already carries reaps its echo (fire-and-forget). No web session, no echoes to ask for; any failure is the
  // deployed list unchanged.
  async function withCommentEchoes(targetType: string, targetSlug: string, deployed: any[]) {
    if (!readCsrf()) return deployed;
    let echoes: any[] = [];
    try {
      const r = await workerGet(`/membership/comment-echo?targetType=${encodeURIComponent(targetType)}&targetSlug=${encodeURIComponent(targetSlug)}`);
      echoes = Array.isArray(r?.echoes) ? r.echoes : [];
    } catch { return deployed; }
    if (!echoes.length) return deployed;
    const { comments, reap } = mergeCommentEchoes({ deployed, echoes });
    if (reap.length) workerPost('/membership/comment-echo', { action: 'reap', targetType, targetSlug, ids: reap }).catch(() => {});
    return comments;
  }

  // The echo write behind a fresh comment: awaited (bounded) so the page's reload after the post already finds
  // it, swallowed on failure because the PR is the durable record and the echo is only the instant view of it.
  async function writeCommentEcho(echo: any) {
    try {
      await Promise.race([
        workerPost('/membership/comment-echo', { action: 'add', echo }),
        new Promise((_, rej) => { setTimeout(() => rej(new Error('echo timed out')), 4000); }),
      ]);
    } catch { /* best-effort */ }
  }

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
      const lg = payload?.login || login || user;
      // sow-428: the folder (GBTI name) the Worker resolved, else the one this client was built with.
      const folder = typeof payload?.folder === 'string' && payload.folder ? String(payload.folder) : user;
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
        identity: { login: lg, username: folder, githubId: gid },
        login: lg,
        username: folder,
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
      // sow-317 (owner, 2026-09-10): the Network content scope is EVERY member's content, published items from the
      // same index plus what sits unpublished on main, each with its author, from the superadmin-only Worker route.
      // A refused or failed call (not a superadmin, Worker down) falls back to the network's own folder, which is
      // what the scope meant before, so the tab never goes blank.
      if (scope === 'house') {
        try {
          const r = await workerGet(`/membership/network-content?type=${encodeURIComponent(String(type))}`);
          if (Array.isArray(r?.items)) return { items: r.items };
        } catch { /* fall through to the network-folder view */ }
        return { items: networkContent(rawItems, 9999).map((it: any) => ({ ...it, status: 'published' })) };
      }
      const items = memberContent(rawItems, user, 9999).map((it: any) => ({ ...it, status: 'published' }));
      return { items };
    },
    // sow-317: every member's shares (drafts included) for the Network content scope; superadmin-only at the Worker.
    async networkShares() { return workerGet('/membership/network-shares'); },

    getContentItem({ path }: any) { return readAndReassemble(path); },
    // SOW-031 reader parity: read any own published item (same source as getContentItem for the WorkBench).
    readItem({ path }: any) { return readAndReassemble(path); },

    // ----- pure form/preview/validate (no network) -----
    formFields({ type }: any) { return { type, fields: fieldsFor(type) || [] }; },
    preview({ body, autoEmbed }: any) { return { html: renderMarkdown(body ?? '', { autoEmbed: !!autoEmbed }) }; }, // autoEmbed: comment bodies frame a bare video URL
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
    async saveDraft({ type, input = {}, body = '', path, authorNote, authorTarget, skillFile }: any) {
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
          // sow-109: a skill's own file, on the authorNote terms (absent keeps the stored one).
          ...(typeof skillFile === 'string' ? { skillFile } : {}),
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
      // sow-315: the same envelope carries the content commit. Pin the image URLs to it, because a `@main`
      // jsDelivr URL is cached seven days in the viewer's browser and a replaced image would keep showing
      // the old picture. A missing or partial sha resets to `main` inside setContentRef, never half-pins.
      try {
        const rr: any = await workerGet('/membership/repo-drafts');
        repoItems = Array.isArray(rr?.items) ? rr.items : [];
        setContentRef(rr?.sha);
      } catch { repoItems = []; }
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
      return draftRecordForEditor(rec, user); // sow-336: repairs a pre-move flat image path, so the media card loads
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
        ...(typeof rec.skillFile === 'string' ? { skillFile: rec.skillFile } : {}), // sow-109: the skill file publishes with it
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
    // sow-232: the editor's Live revisions tile; the Worker counts the commits on main that touched the item.
    async itemStats({ path }: any) {
      const r = await workerGet(`/membership/revisions?path=${encodeURIComponent(String(path || ''))}`);
      return r && r.ok ? { revisions: r.revisions, capped: !!r.capped, lastAt: r.lastAt ?? null } : null;
    },

    // ----- SOW-018 Shares: post (members-default, encrypted) + read the tier-gated community stream -----
    // Post a Share through the SAME hosted-authoring PR path as content. A members share (the composer's default
    // visibility) encrypts its whole body to a sibling .enc via the cookie /membership/encrypt; the stub .md
    // carries only the pointer. Mirrors operations.publishShare. Returns the PR handle the composer's ack reads.
    // sow-304: the same call EDITS a share when `input.id` names one the member already published. The stored
    // createdAt is kept (the id encodes it), updatedAt rides in the input, a stale encryptedBody pointer is never
    // carried (the planner re-derives it from the audience), and on a members-to-public flip `removeEnc` names
    // the old ciphertext under the member's own _enc/ so the Worker deletes it in the same pull request. The
    // Worker's share checks (audience needs Curator for public, own folder only) apply to the edit unchanged.
    // sow-183 for shares (2026-09-10): `authorTarget` (a member login) is the superadmin composer's Author pick. The
    // file is built under THAT member's folder, so the frontmatter author and the folder agree; on an edit that
    // moves the share, `removePaths` names the old stub and ciphertext in the caller's own folder and they are
    // deleted in the same pull request. The Worker only accepts the cross-folder write from a re-verified
    // superadmin (allowAnyFolder), so this is convenience, not the boundary.
    async postShare({ input = {}, body = '', removeEnc = null, authorTarget = null, removePaths = [] }: any) {
      const isEdit = !!(input && input.id);
      const createdAt = isEdit && input.createdAt ? new Date(input.createdAt).toISOString() : new Date().toISOString();
      const id_ = (input && input.id) || makeShareId(createdAt, input?.title);
      const { encryptedBody: _stale, ...clean } = input || {};
      const owner = typeof authorTarget === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(authorTarget) ? authorTarget.toLowerCase() : user;
      // A MOVE names the old files in removePaths (the composer computed them from the share's current folder); an
      // in-place edit of another member's share (sow-317) carries none, so nothing is deleted.
      const moving = isEdit && Array.isArray(removePaths) && removePaths.length > 0;
      const from = moving ? ((/^members\/([a-z0-9][a-z0-9-]*)\//i.exec(String(removePaths[0] || '')) || [])[1] || user).toLowerCase() : user;
      // sow-363: a hosted cover belongs to the folder it is stored under, so a move hands the share back its
      // ORIGINAL image and lets the covers workflow re-host it under the new owner. Carrying the old url
      // instead left the Estrada share pointing at a copy that was then reaped, and the og:image guard failed
      // every production deploy until the file was repaired by hand.
      // sow-365: and the url it is leaving behind is recorded, so the build 301s it to the new one. A share's
      // public url carries the author, so a move retires it exactly as a rename retires a slug.
      const shareInput = moving
        ? redirectAfterAuthorMove(coverAfterAuthorMove({ ...clean, id: id_, createdAt }, { fromUser: from, toUser: owner }), { fromUser: from, toUser: owner, id: id_ })
        : { ...clean, id: id_, createdAt };
      let built: any;
      try { built = buildShareFile({ username: owner, input: shareInput, body }); }
      catch (e: any) { throw new WorkbenchClientError('invalid-content', e?.message || 'the share is invalid'); }
      const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
      const files: any[] = plan ? plan.files : [{ path: built.path, content: built.markdown }];
      // The ciphertext to drop on a members-to-public flip sits under the share's OWN folder: the caller's for their own
      // share, the owner's for a superadmin editing another member's share in place (sow-317).
      if (isEdit && typeof removeEnc === 'string' && (removeEnc.startsWith(`members/${user}/_enc/`) || removeEnc.startsWith(`members/${owner}/_enc/`)) && !plan?.encPath) files.push({ path: removeEnc, content: null });
      if (moving) {
        const already = new Set(files.map((f: any) => f.path));
        for (const d of shareMoveDeletions({ user: from, removePaths })) if (!already.has(d.path)) files.push(d);
      }
      const title = `${isEdit ? (moving ? 'Move Share' : 'Update Share') : 'New Share'}${built.frontmatter?.title ? `: ${built.frontmatter.title}` : ''}`;
      const res = await workerPost('/membership/author', { itemId: `share-${id_}`, files, title });
      return { id: id_, path: built.path, visibility: built.frontmatter?.visibility ?? 'members', status: built.frontmatter?.status ?? 'published', encrypted: Boolean(plan?.encPath), prNumber: res.number, prUrl: res.html_url, updated: !!res.already || isEdit, edited: isEdit };
    },
    // sow-304: the member's OWN shares for the WorkBench Shares tab (drafts included; members bodies as pointers,
    // decrypted on edit through decrypt()). The Worker lists the verified session's folder only.
    async myShares() {
      const r = await workerGet('/membership/my-shares');
      return { items: Array.isArray(r?.items) ? r.items : [] };
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

    // The admin surface (workbench-client-admin.ts): staff reads and config writes, the superadmin-only
    // channel-map and syndication methods (attached only when isSuperadmin, the role gate lives there), the
    // issued invites and the editorial review queue. Spread HERE so every name keeps its place in this object.
    ...adminMethods({ workerGet, workerPost, workerPatch, isSuperadmin }),

    // ----- SOW-043/046: interactive News over the cookie session (free-tier perk; authorizeSignedIn) -----
    getNews({ category, since, limit }: any = {}) {
      const qs = new URLSearchParams();
      if (category) qs.set('category', String(category));
      if (since) qs.set('since', String(since));
      if (limit) qs.set('limit', String(limit));
      return newsGet('/membership/news' + (qs.toString() ? `?${qs.toString()}` : ''));
    },
    getNewsSources() { return newsGet('/membership/news-sources'); },
    getFollowedNews() { return newsGet('/membership/news-following'); }, // sow-386: members-only, { items } for the header bell
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
      const r = await workerPost('/membership/activity', activityFavoritePayload({ targetType, targetSlug, on })); // sow-316: the Worker reads type/slug
      return { favorited: favoritedFrom(r?.activity, targetType, targetSlug) };
    },
    async createCollection({ name }: any) { const r = await workerPost('/membership/activity', { action: 'collection.create', name }); return { id: r.id, activity: r.activity }; },
    addToCollection({ id, targetType, targetSlug, on = true }: any) { return workerPost('/membership/activity', activityCollectionItemPayload({ id, targetType, targetSlug, on })); }, // sow-316
    renameCollection({ id, name }: any) { return workerPost('/membership/activity', { action: 'collection.rename', id, name }); },
    deleteCollection({ id }: any) { return workerPost('/membership/activity', { action: 'collection.delete', id }); },

    // ----- SOW-023/046: the follow graph + prefs (Following), cookie-ready KV -----
    getFollows() { return workerGet('/membership/follows'); }, // { following }
    // Owner, 2026-09-29: what the member has read in the bells, on their account, so a read here clears the extension too.
    getBellSeen() { return workerGet('/membership/notifications').then((r: any) => ({ bellSeen: r?.bellSeen ?? { groups: {} } })); },
    markBellSeen(bellSeen: unknown) { return workerPost('/membership/notifications/seen', { bellSeen }).then((r: any) => ({ bellSeen: r?.bellSeen ?? { groups: {} } })); },
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
    // sow-314: the Saturday Shop Talk seat. GET answers { eligible, enrolled, address, optedOut, nextCall };
    // POST { action: 'leave' | 'rejoin' } records the choice and, when the calendar is reachable, applies it at once.
    async getShoptalk() { return workerGet('/membership/shoptalk'); },
    async setShoptalk(action: 'leave' | 'rejoin') { return workerPost('/membership/shoptalk', { action }); },
    // sow-202: the weekly digest switch on /account/notifications/. GET answers { on, address, reason? } about this
    // account's own record only; POST { on } turns the digest on (lifting an earlier unsubscribe) or off (digest only).
    async getDigest() { return workerGet('/membership/digest'); },
    async setDigest(on: boolean) { return workerPost('/membership/digest', { on: on === true }); },
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
    getComment({ id, author }: any) { return getCommentLocal(String(id || ''), author ? String(author) : undefined); },
    // Post a discussion reply (members-only, encrypted) or a from-the-author intro (public). Paid-only, gate-backed.
    async postComment({ targetType, targetSlug, body, authorNote, parentId, visibility }: any) {
      if (!COMMENT_TARGET_TYPES.has(targetType)) throw err('bad-request', 'a valid targetType is required');
      if (!targetSlug) throw err('bad-request', 'a targetSlug is required');
      const createdAt = new Date().toISOString();
      const id = commentId(createdAt, Math.random().toString(36).slice(2, 8));
      const input = coerceCommentInput({ id, targetType, targetSlug, createdAt, authorNote, parentId, visibility });
      const r = await commitComment(input, body ?? '');
      if (r?.prNumber) await writeCommentEcho({ id, targetType, targetSlug, body: body ?? '', prNumber: r.prNumber, createdAt });
      return { ...r, targetType, targetSlug };
    },
    async editComment({ id, body, authorNote, visibility }: any) {
      const cur = await getCommentLocal(String(id || ''));
      const fm: any = cur.frontmatter || {};
      const effAuthorNote = authorNote !== undefined ? Boolean(authorNote) : Boolean(fm.authorNote);
      // The audience is the author's (2026-09-11): a given visibility wins, else the comment keeps its own.
      const effVisibility = visibility === 'public' || visibility === 'members' ? visibility : (fm.visibility === 'public' ? 'public' : 'members');
      const input = coerceCommentInput({
        id: fm.id, targetType: fm.targetType, targetSlug: fm.targetSlug,
        createdAt: fm.createdAt, updatedAt: new Date().toISOString(),
        authorNote: effAuthorNote, parentId: fm.parentId, visibility: effVisibility,
      });
      const r = await commitComment(input, body ?? '', { removeEnc: typeof fm.encryptedBody === 'string' ? fm.encryptedBody : null });
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

export { WorkbenchClientError } from './workbench-client-transport';

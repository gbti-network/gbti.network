// The website WorkBench client's publish (split out of workbench-client.ts at the 900-line cap, owner ruling
// 2026-09-30). It builds the item's file set from the pure builders and posts it to the hosted-authoring endpoint,
// with the rename, author reassignment, members-only encryption, skill file and image handling that go with it.
// createPublish is handed the client's closure state (the caller's folder, the staged images, the transport
// reads and writes, and the cookie encrypt), so the moved code keeps the local names it always used.

import { kindForPublish } from '../../membership/prompt-kind.mjs'; // sow-109: an edit keeps a skill a skill
import { skillFilesForPublish } from '../../client/src/skill-file.mjs'; // sow-109: a skill's SKILL.md travels with it
import { buildContentFile, buildCommentFile, parseContentFile } from '../../client/src/content-ops.mjs';
import { partitionBodyImages, bodyImagesToResolve } from './workbench-client-core.mjs'; // sow-323
import { planMemberFiles, AUTHOR_NOTE_TYPES, planPublishImageFiles, resolvePublishedAt, referencedImages, planImageRefs, normalizeImageFields, renameOriginOf, mergedRedirectFrom, renameIntroMoveFiles, introFolderFor, isForeignMemberPath } from './workbench-client-core.mjs';
import { WorkbenchClientError, err } from './workbench-client-transport';

const TYPE_LABEL: Record<string, string> = { post: 'article', project: 'project', prompt: 'prompt', profile: 'profile' };

/** The hosted item id (the branch's last segment; the Worker prefixes it with the verified github_id). Mirrors
 *  hosted-publish.mjs hostedItemId so a re-publish of the same item reuses one branch + PR. */
function hostedItemId(type: string, slug: string | null): string {
  return type === 'profile' ? 'profile' : `${type}-${slug}`;
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

/** What publish reads from the client's closure. Every member is a value the client already holds. */
export type PublishContext = {
  user: string;
  pendingImages: Map<string, string>;
  readOwnFile: (path: string) => Promise<string | null>;
  readOwnFileBase64: (path: string) => Promise<string | null>;
  readStagedImage: (name: string, item?: string | null) => Promise<{ dataBase64: string; contentType: string } | null>;
  workerPost: (path: string, body: unknown) => Promise<any>;
  encryptViaCookie: (plaintext: string, assetId: string) => Promise<any>;
};

/** Build the client's `publish` over its closure state. The client exposes it unchanged as `publish`. */
export function createPublish({ user, pendingImages, readOwnFile, readOwnFileBase64, readStagedImage, workerPost, encryptViaCookie }: PublishContext) {
  // The core publish: build the file set from PURE builders and POST it to the hosted-authoring endpoint.
  // sow-158 permalink rename (SOW-112 v2, owner-directed rename-at-publish): `path` names the canonical item this
  // edit was loaded from; a submitted slug that differs makes this publish a RENAME (one hosted PR: the new path,
  // the old path + old .enc deleted, the old URL in redirectFrom so the build 301s, the intro moved). Even without
  // a slug change the old file's redirectFrom is merged in (a plain re-publish used to DROP it). Mirrors
  // client/src/operations-publish.mjs publish(), which since sow-274 is network-only on every host too (the
  // network branch is always fresh-based on live main).
  //
  // sow-183: `authorTarget` ({ scope: 'house'|'member', username? }), when given, reassigns an EXISTING item's
  // author -- the shared editor's Author field only ever sends this for a superadmin and only when it differs
  // from the loaded item's current home (gbti-content-editor.mjs). It generalizes the rename machinery above: a
  // MOVE is now "the resolved path changed", for a slug reason, an author reason, or both, in one hosted PR.
  async function publish({ type, input = {}, body = '', authorNote, path, scope, authorTarget, skillFile }: any) {
    // Both triggers below (a house path, or an explicit authorTarget) are only reachable through UI already
    // gated to role==='superadmin' (gbti-workspace.mjs _canScope, the editor's Author field) -- the Worker
    // independently re-verifies the caller is superadmin (authorizeSuperadmin) before accepting the write, so
    // this is UX convenience, not the security boundary; a non-superadmin's stray attempt still fails closed.
    // sow-317: a superadmin editing ANOTHER member's item from the Network content scope loads that member's path.
    // Without this arm the origin resolved to null and the target fell through to the caller's own folder, so a
    // plain "save" of somebody else's article would have published a duplicate under the superadmin's name.
    const allowAnyFolder = String(path || '').startsWith('house/') || authorTarget != null || isForeignMemberPath(path, user);
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
    // sow-109: until the editor offered the choice, a re-save of a skill sent no kind and wrote the default, turning
    // its page into a prompt page while its SKILL.md stayed behind. The item's own kind wins when none is sent.
    if (type === 'prompt') { const k = kindForPublish(input?.kind, oldFm?.kind); if (k) effInput.kind = k; }
    // The 301 redirect is only meaningful when the public URL actually changed (the slug) -- never for an
    // author-only reassignment (the public URL is type+slug only, unaffected by which folder the file lives in).
    const redirects = mergedRedirectFrom({ oldFm, inputRedirectFrom: input?.redirectFrom, renaming: slugChanged, type, oldSlug: origin?.oldSlug });
    if (redirects) effInput.redirectFrom = redirects;
    // A move (rename or reassignment) must not re-stamp publishedAt (feeds stay stable; the item is not new).
    // The editor stamps it on every publish, so restore the original for the move case only.
    if (moved && oldFm?.publishedAt) effInput.publishedAt = oldFm.publishedAt;
    // sow-325: the PUBLISH decides the date, not the editor. resolvePublishedAt carries the reasoning; the
    // short version is that the editor's own publishedAt is not evidence. A draft already carries one, so the
    // old "fill it in when absent" rule never fired for a first publish and the draft-creation date went live.
    // And for an item already live the editor may be round-tripping a STALE staged record, which overwrote a
    // corrected date in the repository six publishes running. The committed date wins for a live item; a draft
    // or a new item is stamped now.
    const stampedPublishedAt = resolvePublishedAt({ oldFm, moved, type, now: new Date().toISOString() });
    if (stampedPublishedAt) effInput.publishedAt = stampedPublishedAt;
    // sow-165 on the website: every image()-typed value becomes the canonical `./images/<file>` BEFORE the
    // markdown is built. Astro resolves image() relative to the item's own index.md, so the repo-rooted path
    // the stager used to write could not resolve and reddened the site build on main. Normalizing here also
    // repairs a draft saved before the stager was fixed, which still holds the old flat value.
    Object.assign(effInput, normalizeImageFields(effInput, user));

    // sow-109 Phase 7: the encrypted skill-file pointer is decided by the skill-file plan below, never by the caller.
    delete effInput.encryptedSkill;
    const build = (extra: any = {}) => {
      try {
        return buildContentFile({ type, username: target.username, input: { ...effInput, ...extra, status: effInput.status || 'published' }, body, scope: target.scope });
      } catch (e: any) {
        throw new WorkbenchClientError('invalid-content', e?.message || 'the content is invalid');
      }
    };
    let built: any = build();
    if (moved) {
      // The new path must not already exist (the CI unique-slug guard is the backstop).
      const collision = await readOwnFile(built.path);
      if (collision != null) throw err('bad-request', `"${built.slug}" already exists at the target location`);
    }
    // sow-109: a skill's SKILL.md is written, kept, moved or removed with it (the rule is shared with the agent publisher).
    const skillPlan = await skillFilesForPublish({ type, built, oldIndexPath: origin && oldFm ? origin.oldPath : null, priorKind: oldFm?.kind, priorEncryptedSkill: oldFm?.encryptedSkill, moved, skillFile, readFile: readOwnFile, encrypt: encryptViaCookie });
    if (skillPlan.refusal) throw new WorkbenchClientError('invalid-content', skillPlan.refusal);
    if (skillPlan.pointer) built = build({ encryptedSkill: skillPlan.pointer }); // a members-only skill's file, encrypted
    // SOW-016 / Phase 3c: a whole-item members body OR a `<!-- members-only -->` section is encrypted to a sibling
    // .enc (via the cookie /membership/encrypt), and index.md keeps only the public teaser + the encryptedBody
    // pointer. planMemberFiles overrides any stale encryptedBody with the deterministic path, so a re-publish
    // overwrites the same .enc (no orphan). On a move it writes the NEW-location .enc; the OLD one is deleted below.
    const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
    const files: Array<{ path: string; content?: string | null; contentBase64?: string }> = plan ? plan.files : [{ path: built.path, content: built.markdown }];
    const intro = buildIntroFile(target, user, built, authorNote);
    if (intro) files.push(intro);
    files.push(...skillPlan.files);
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
    // sow-323: which body images this publish has to resolve. The old rule inferred "already committed" from
    // the previously committed BODY and never checked, which let a publish commit markdown pointing at a file
    // that is not in the repository (two of them in a live article on 2026-09-12), red the site build, and get
    // the article auto-drafted, with every later publish filtering the same references out again so the author
    // could not heal it. Existence is now VERIFIED, and concurrently, so the whole body costs one round-trip of
    // wall time instead of the ~100 sequential reads the old comment was right to avoid.
    const bodyParts = partitionBodyImages(body, new Set(pendingImages.keys()));
    const presentOnMain = new Set<string>(
      (await Promise.all(bodyParts.toVerify.map(async (r: any) =>
        ((await readOwnFile(`${imagesDir}/${r.name}`)) != null ? r.name : null)))).filter(Boolean) as string[],
    );
    const imageRefs: Array<{ name: string; move: boolean }> = planImageRefs(
      referencedImages(built.frontmatter),
      bodyImagesToResolve(body, new Set(pendingImages.keys()), presentOnMain),
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
    // sow-326: THE PUBLISHED DRAFT RECORD DIES HERE, and until now nothing ever deleted it. publish() swept the
    // staged IMAGES and left the KV draft (`drafts:<github_id>`, keyed `<type>:<slug>`) exactly as it was, so a
    // record outlived its own publication and every later open of the item read it back instead of the file
    // that had just been committed. That one omission is the root of three separate owner-reported defects:
    // the "not published yet" banner that no publish could clear, a layout and an author note that reverted on
    // every refresh of the WorkBench deep link, and two superadmins editing one article overwriting each
    // other, because the record is per-ACCOUNT and carries no author.
    //
    // Same two rules as the image cleanup above, for the same reason stated there: strictly AFTER the author
    // POST resolves, and never able to throw, or a successful publish is reported to the author as a failure.
    // Idempotent by design (applyDraftDelete is pinned idempotent), which matters because publishDraft already
    // deletes on its own path. Every token is swept, so a RENAME clears the pre-rename slug too.
    for (const token of itemTokens) {
      const staleSlug = token.startsWith(`${type}:`) ? token.slice(String(type).length + 1) : '';
      if (!staleSlug) continue;
      try { await workerPost('/membership/drafts', { op: 'delete', type, slug: staleSlug }); } catch { /* see above */ }
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

  return publish;
}

export { TYPE_LABEL, hostedItemId, buildIntroFile };

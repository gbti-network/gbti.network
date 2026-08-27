// sow-158 Phase 3b: the PURE, node-testable core of the website WorkBench adapter (src/lib/workbench-client.ts).
// The .ts adapter is the browser transport (cookie fetch + CSRF); the logic that has no network — the members-only
// file-set planning, the discussion filter/sort/tier-gate, the comment-input coercion, the favorite derivation —
// lives here so `node --test` (which has no TS loader) can exercise it. Node-free: it imports only the shared pure
// builders. Mirrors the member-signal.ts / member-signal-core.mjs split.

import { serializeContentFile, parseContentFile, byCommentOldest, NETWORK_CONTENT_OWNER } from '../../client/src/content-ops.mjs';
import { splitMemberMarkdown, encAssetFor, MEMBER_MARKER } from '../../client/src/member-content.mjs';

// SOW-027: the valid comment targets (mirrors operations.listComments' COMMENT_TARGET_TYPES).
// sow-158 News track: 'news' enables the shared <gbti-discussion> news thread on the website (read is public;
// posting stays paid-gated via postComment's membership check). The comments-index already carries news rows.
export const COMMENT_TARGET_TYPES = new Set(['post', 'product', 'prompt', 'share', 'news']);

// SOW-014 + 2026-08-11: the content types that MAY carry a from-the-author note. Distinct from the types that
// REQUIRE one, which is product/prompt and lives in validate-content.mjs -- an article's note is optional and
// always has been permitted on the READ side (validate-content's public-comment rule, Comments.astro's pinned
// block), so widening this only closes the write path that never caught up. Declared here AND in
// operations.mjs AUTHOR_NOTE_TYPES: the two cores are separate bundle boundaries and already mirror
// COMMENT_TARGET_TYPES the same way. test/publish-intro-comment.test.mjs asserts every copy agrees, including
// the literal in the client-ui editor, which can import neither core.
export const AUTHOR_NOTE_TYPES = new Set(['post', 'product', 'prompt']);

// sow-158 image upload: the frontmatter keys that hold an uploaded image path (per the editor RAIL_SCHEMA:
// coverImage on a post; icon/iconLarge/featuredImage/banner on a product; image on a prompt). coverAlt is text,
// not a path. `gallery` is handled separately below because its entries are a list, not a scalar.
//
// iconLarge and gallery were MISSING here, so an image staged into either was never flushed into the publish
// PR: the .md committed a reference to a file the PR did not carry, and Astro's image() has to resolve, so the
// site build went red on main. Every image()-typed field in src/content.config.ts is now covered.
export const IMAGE_FIELD_KEYS = ['coverImage', 'image', 'banner', 'featuredImage', 'icon', 'iconLarge'];
/** The one image()-typed field whose value is a LIST (bare entries or `{ src, caption }`). */
export const IMAGE_LIST_FIELD = 'gallery';
const WEB_IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/;

// sow-182: a NETWORK-authored index item, matched by PATH rather than by author string, because the network's
// content is not an individual to filter by the way memberContent (client-ui/src/member-view-core.mjs) filters a
// real member's username.
//
// sow-195 retargeted it. This used to match `house/<sub>/...`, and those folders no longer exist, so it filtered
// to nothing and the website WorkBench showed "No articles yet" under the network scope. That was the half of the
// regression the first fix missed: client/src/operations.mjs is the client core the EXTENSION and npm hosts use,
// while the website has this parallel implementation, and only the former was repaired.
//
// The owner name comes from content-ops.mjs rather than a second literal here, because a duplicated constant is
// precisely how the two halves drifted apart.
const NETWORK_PATH_RE = new RegExp(`^members/${NETWORK_CONTENT_OWNER}/(posts|products|prompts)/[a-z0-9][a-z0-9-]*/index\\.md$`);

export function isNetworkPath(path) {
  return NETWORK_PATH_RE.test(String(path || ''));
}

/**
 * Filter a per-type public index item list to NETWORK-authored content, newest-first, capped. Pure. Mirrors
 * memberContent's sort/cap shape exactly (dateless items sink to the bottom rather than producing NaN
 * comparisons; the cap applies after the sort so the newest survive), so House content and My content page
 * identically in the WorkBench list; only the selection predicate differs.
 * @param {Array} items  raw index items ({ path, publishedAt, title, ... })
 * @param {number} [cap=24]
 */
export function networkContent(items, cap = 24) {
  if (!Array.isArray(items)) return [];
  const mine = items.filter((it) => it && isNetworkPath(it.path));
  mine.sort((a, b) => {
    const av = Number.isFinite(a?.publishedAt) ? a.publishedAt : -Infinity;
    const bv = Number.isFinite(b?.publishedAt) ? b.publishedAt : -Infinity;
    if (bv !== av) return bv - av; // newest first; dateless (-Infinity) sinks to the bottom
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });
  return mine.slice(0, Math.max(0, cap));
}

/**
 * Sanitize an uploaded image filename to a clean own-folder leaf: lowercase, only [a-z0-9._-], no path segments,
 * no leading dot/hyphen, and it MUST end in a web-image extension (png/jpg/jpeg/webp/gif — NO svg on web upload).
 * Returns the clean name or null (reject). Mirrors the Worker gate (validateHostedRequest IMAGE_PATH_TAIL_RE), so
 * the client and the security wall agree on what an image filename is.
 */
export function sanitizeImageName(filename) {
  const base = String(filename ?? '').trim().toLowerCase().split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').replace(/-+/g, '-');
  if (!/^[a-z0-9]/.test(cleaned) || !WEB_IMAGE_EXT_RE.test(cleaned)) return null;
  return cleaned;
}

// The canonical value shape for an image()-typed field: `./images/<file>`, resolved by Astro RELATIVE to the
// markdown file that declares it. It is the only shape that works, and the only shape any committed content
// uses (78 of 78 across members/** and house/**).
const CANONICAL_IMAGE_RE = /^\.\/images\/([a-z0-9][a-z0-9._-]*)$/;

/**
 * Rewrite one image()-field value to the canonical `./images/<name>`, or return it untouched.
 *
 * Untouched means: an absolute or protocol-relative URL, a build-optimized /_astro/ path, an empty value, or
 * anything whose file name is not a web image. A flat `members/<login>/images/<name>` IS rewritten, because
 * that is what the website stager used to write and Astro cannot resolve it: the value is repo-rooted while
 * image() resolves relative to the item's own index.md, so publishing one reddened the build on main.
 * Another member's folder is left alone; only the acting caller's own uploads are ours to normalize.
 */
export function normalizeImageValue(value, login) {
  const v = String(value ?? '').trim();
  if (!v || /^(?:https?:)?\/\//.test(v) || v.startsWith('/')) return value;
  if (CANONICAL_IMAGE_RE.test(v)) return v;
  const isOwnFlat = v.startsWith(`members/${login}/images/`);
  const isBareOrLocal = !v.includes('/') || /^\.?\/?images\//.test(v);
  if (!isOwnFlat && !isBareOrLocal) return value;
  const name = sanitizeImageName(v);
  return name ? `./images/${name}` : value;
}

/**
 * Normalize every image()-typed field on a frontmatter object, returning a NEW object (the input is not
 * mutated). Runs before the markdown is built, so what publishes is always the resolvable shape. This is also
 * what repairs a draft saved earlier that still holds a flat path.
 */
export function normalizeImageFields(frontmatter, login) {
  const fm = { ...(frontmatter || {}) };
  for (const k of IMAGE_FIELD_KEYS) {
    if (typeof fm[k] === 'string') fm[k] = normalizeImageValue(fm[k], login);
  }
  const list = fm[IMAGE_LIST_FIELD];
  if (Array.isArray(list)) {
    fm[IMAGE_LIST_FIELD] = list.map((row) => {
      if (typeof row === 'string') return normalizeImageValue(row, login);
      if (row && typeof row === 'object' && typeof row.src === 'string') return { ...row, src: normalizeImageValue(row.src, login) };
      return row;
    });
  }
  return fm;
}

/**
 * Every staged image a content item's frontmatter references, as `[{ field, name }]` deduped by name. Used to
 * flush ONLY the images the content actually uses into the publish PR (never an unreferenced upload).
 *
 * It returns NAMES rather than repo paths on purpose: the folder an image commits into is the item's own
 * folder, which is known only after the build resolves the destination path, and an item can be renamed or
 * reassigned between staging and publishing.
 */
export function referencedImages(frontmatter) {
  const out = [];
  const seen = new Set();
  const take = (field, v) => {
    const m = CANONICAL_IMAGE_RE.exec(String(v ?? '').trim());
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    out.push({ field, name: m[1] });
  };
  for (const k of IMAGE_FIELD_KEYS) take(k, frontmatter?.[k]);
  const list = frontmatter?.[IMAGE_LIST_FIELD];
  if (Array.isArray(list)) for (const row of list) take(IMAGE_LIST_FIELD, typeof row === 'string' ? row : row?.src);
  return out;
}

/**
 * Decide what publish should do with ONE image the content references. Pure over three injected lookups, so
 * the rule is testable without a Worker, a browser or a network.
 *
 * `ref` is the descriptor `{ name, item, commitPath }`: the file name, the draft it was staged for, and the
 * repo path it would commit to. Each lookup is handed the whole descriptor and reads the part it needs, which
 * is what lets the three sources be keyed differently (the session Map and the store by item + name, main by
 * the resolved commit path).
 *
 * The order is load-bearing:
 *   1. `fromSession`    -- the in-tab Map, for an image picked and published without a reload;
 *   2. `fromStore`      -- the Worker's staged store, for one picked in an EARLIER session. It wins over what
 *      is on main, because re-staging the same file name is a replacement of the committed image;
 *   3. `fromOldFolder`  -- sow-183: on a MOVE (a rename or an author reassignment), the committed copy is in
 *      the ORIGIN folder, and `onMain` looks at the destination, where nothing is yet. Without this source all
 *      three lookups missed and the publish REFUSED, so reassigning any item carrying an image was impossible
 *      without re-picking every image by hand. It ranks BELOW the store on purpose: re-staging a file name is
 *      still a replacement, and the old committed bytes must not win over the new ones;
 *   4. `onMain`         -- already committed at the destination, the steady state for every re-publish of an
 *      item whose image has not changed. Nothing to send, so this is a skip.
 *
 * Anything else REFUSES. The original code silently dropped an image it could not find and opened a PR whose
 * frontmatter pointed at a file that was not in it; Astro's image() has to resolve, so merging that would have
 * broken the site build on main. An error the author can act on beats a red build.
 *
 * @returns {Promise<{action:'commit',contentBase64:string}|{action:'skip'}|{action:'refuse',message:string}>}
 */
export async function planPublishImage(ref, { fromSession, fromStore, fromOldFolder, onMain } = {}) {
  const b64 = (fromSession ? fromSession(ref) : null)
    || (fromStore ? await fromStore(ref) : null)
    || (fromOldFolder ? await fromOldFolder(ref) : null);
  if (b64) return { action: 'commit', contentBase64: b64 };
  if (onMain && (await onMain(ref))) return { action: 'skip' };
  const name = ref?.name || 'that image';
  return { action: 'refuse', message: `the image ${name} is no longer staged; choose it again before publishing` };
}

/**
 * sow-183: every file entry ONE referenced image contributes to a publish PR, the MOVE included.
 *
 * `planPublishImage` above decides WHERE the bytes come from. This decides WHAT the PR carries, which on a
 * move is two entries and not one: the image has to be committed into the item's new folder AND deleted from
 * the old one. Splitting those apart is how a half-move ships. The old folder keeping an orphaned image after
 * its index.md is deleted is not a red build (nothing references it any more), which is exactly why it would
 * go unnoticed: the repo quietly accumulates the images of every item ever reassigned.
 *
 * `ref` extends the descriptor with the move: `oldPath` is where the committed copy lives now, and
 * `oldBase64` is its bytes, or null when it is not there. The caller reads it ONCE and passes the value,
 * rather than passing a lookup, because the same read answers both questions: it is the fallback source for
 * the copy, and it is the proof the delete has a target. A delete of a path that is not there would be a
 * fabricated file entry.
 *
 * @returns {Promise<{action:'commit'|'skip'|'refuse', files:Array<object>, message?:string}>}
 */
export async function planPublishImageFiles(ref, { fromSession, fromStore, onMain } = {}) {
  const oldPath = ref?.oldPath && ref.oldPath !== ref?.commitPath ? String(ref.oldPath) : null;
  const oldBase64 = ref?.oldBase64 || null;
  const plan = await planPublishImage(ref, {
    fromSession,
    fromStore,
    fromOldFolder: oldPath ? () => oldBase64 : null,
    onMain,
  });
  if (plan.action === 'refuse') return { action: 'refuse', files: [], message: plan.message };
  const files = [];
  if (plan.action === 'commit') files.push({ path: ref.commitPath, contentBase64: plan.contentBase64 });
  if (oldPath && oldBase64) files.push({ path: oldPath, content: null });
  return { action: plan.action, files };
}

/** The decoded byte length of a base64 payload (padding-aware), for the client-side 1 MB pre-check. */
export function base64Bytes(b64) {
  const s = String(b64 ?? '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length / 4) * 3 - pad);
}
// SOW-078: who may READ a members-visibility comment stub (an active trial OR a paid member). Mirrors the
// server's READ_TRIAL tier, applied here as the presentation-side gate; the Worker decrypt is authoritative.
export const MEMBER_READ_TIER = new Set(['paid', 'trialing', 'trial']);

/**
 * Plan the file set for a members-or-public comment/content write — a browser-safe reimplementation of
 * operations.planMemberFiles (importing operations.mjs would drag fork-mode + 15 REST clients into the page
 * bundle). A members item encrypts its whole body to a sibling .enc (via the injected async `encrypt`, which the
 * adapter wires to the Worker); a public item with no marker returns null (the caller commits built.markdown).
 * Pure over `encrypt`, so it unit-tests with a fake. Returns { files, encPath } | null.
 */
export async function planMemberFiles({ built, body, encrypt }) {
  if (!built?.slug) return null;
  const vis = built.frontmatter?.visibility ?? 'public';
  let publicPart = '';
  let memberPart = null;
  if (vis === 'members') {
    // Mirrors client/src/operations.mjs planMemberFiles: a members item MAY carry a public teaser before the
    // marker, so a Mode B stub can say what it is. No marker means the whole body is gated, as before.
    const split = splitMemberMarkdown(body);
    if (split.memberPart) {
      publicPart = split.publicPart;
      memberPart = split.memberPart;
    } else {
      memberPart = String(body ?? '').replace(MEMBER_MARKER, '').trim(); // whole item: the entire body is gated
      if (!memberPart) return null;
    }
  } else {
    const split = splitMemberMarkdown(body);
    if (split.memberPart == null) return null; // plain public content: no encryption
    publicPart = split.publicPart;
    memberPart = split.memberPart;
    if (!memberPart) return { files: [{ path: built.path, content: serializeContentFile(built.frontmatter, publicPart) }] };
  }
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug, built.scope);
  const envelope = await encrypt(memberPart, assetId);
  const markdown = serializeContentFile({ ...built.frontmatter, encryptedBody: encPath }, publicPart);
  return { files: [{ path: built.path, content: markdown }, { path: encPath, content: JSON.stringify(envelope) }], encPath };
}

/**
 * Filter a full comments-index item list to one discussion thread: matching targetType + targetSlug (or a rename
 * alias) + published, oldest-first, capped. A viewer who cannot see members rows (`canSeeMembers:false`) gets only
 * the public rows — the member stub carries no body, so this never leaks gated text. Pure.
 */
export function filterThreadComments(all, { targetType, targetSlug, aliases = [], limit = 100, canSeeMembers = true } = {}) {
  if (!COMMENT_TARGET_TYPES.has(targetType) || !targetSlug) return [];
  const slugs = new Set([targetSlug, ...(Array.isArray(aliases) ? aliases : [])]);
  let items = (Array.isArray(all) ? all : [])
    .filter((c) => c?.targetType === targetType && slugs.has(c?.targetSlug) && (c?.status ?? 'published') === 'published')
    .sort(byCommentOldest);
  if (!canSeeMembers) items = items.filter((c) => (c?.visibility ?? 'public') !== 'members');
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  return items.slice(0, n);
}

/**
 * Assemble the buildCommentFile input, coercing visibility the SAME way operations.publishComment/editComment do:
 * a comment is public ONLY as a from-the-author intro (authorNote) on a post/product/prompt; everything else
 * (a discussion reply, ANY comment on a share) is coerced to members, so its body is encrypted, never plaintext.
 * The id + timestamps are passed in (impure clock/random stays in the .ts adapter). Pure.
 */
export function coerceCommentInput({ id, targetType, targetSlug, createdAt, updatedAt, authorNote, parentId, visibility } = {}) {
  const isPublicIntro = authorNote === true && ['post', 'product', 'prompt'].includes(targetType);
  const input = { id, targetType, targetSlug, status: 'published', visibility: (visibility === 'public' && isPublicIntro) ? 'public' : 'members' };
  if (createdAt) input.createdAt = createdAt;
  if (updatedAt) input.updatedAt = updatedAt;
  if (authorNote) input.authorNote = true;
  if (parentId) input.parentId = parentId;
  return input;
}

/** Derive `favorited` for a target from the activity store's favorites list (matches the client contract). Pure. */
export function favoritedFrom(activity, targetType, targetSlug) {
  const favs = (activity && activity.favorites) || [];
  return favs.some((f) => f.type === targetType && f.slug === targetSlug);
}

/**
 * sow-158 Phase 3c: rebuild the FULL authoring body of a members-only item from its committed `index.md` body plus
 * the DECRYPTED members text, so the editor shows everything and a re-publish re-splits identically. The exact
 * inverse of planMemberFiles' split:
 *   - Mode A/B (visibility: members): the whole body was gated, so the decrypted memberText IS the body.
 *   - Mode C (visibility: public): the public part (the committed index.md body) + the `<!-- members-only -->`
 *     marker + the members part.
 * Pure. Used only when frontmatter.encryptedBody is set (the caller decrypts, then calls this).
 */
export function reassembleMemberBody(frontmatter, indexBody, memberText) {
  const gated = String(memberText ?? '');
  if ((frontmatter?.visibility ?? 'public') === 'members') return gated; // whole-item members: memberText is all
  const pub = String(indexBody ?? '').trim();
  return pub ? `${pub}\n\n${MEMBER_MARKER}\n\n${gated}` : `${MEMBER_MARKER}\n\n${gated}`;
}

// ---- sow-158 permalink rename (rename-at-publish). PURE mirrors of client/src/operations.mjs so the website
// hosted publish renames exactly like the extension. Client-side FILE PLANNING only — the real boundaries
// (isCleanPath / validateHostedRequest / the SOW-005 gate) are shared + unchanged. Converge operations.mjs onto
// these later; the extension path is deliberately left untouched here (zero regression risk). ----

// The public URL base per content type; a rename records the OLD url in redirectFrom so the build 301s it.
export const RENAME_URL_BASE = { post: '/articles', product: '/products', prompt: '/prompts' };
const OWN_ITEM_PATH_RE = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;
const HOUSE_ITEM_PATH_RE = /^house\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;
const FOLDER_TYPE = { posts: 'post', products: 'product', prompts: 'prompt' };

// Resolve the ORIGIN of an edit: the canonical item the editor loaded (`path`). Returns
// { scope, username, oldSlug, oldPath } when the path is an item of the SAME type, else null. The slug in the
// FORM is the (possibly new) value; the path names what it was.
//
// sow-183: `allowAnyFolder` additionally resolves a house/ path or ANOTHER member's folder (for a superadmin's
// content authorship reassignment) instead of only the caller's own `members/<username>/`. The CALLER
// (publish()) sets this ONLY when the request already shape-implies a superadmin surface (an authorTarget was
// given, or the loaded path is already under house/) -- both of those are themselves only reachable through UI
// gated to role==='superadmin' (gbti-workspace.mjs _canScope). This function does no authorization of its own;
// the real fail-closed gate is the Worker's independent authorizeSuperadmin re-check (membership-admin.mjs),
// exactly like every other client-side convenience in this file.
export function renameOriginOf({ path, username, type, allowAnyFolder = false } = {}) {
  const p = String(path || '');
  const h = HOUSE_ITEM_PATH_RE.exec(p);
  if (h) {
    if (!allowAnyFolder) return null;
    if (FOLDER_TYPE[h[1]] !== type) return null;
    return { scope: 'house', username: null, oldSlug: h[2], oldPath: p };
  }
  const m = OWN_ITEM_PATH_RE.exec(p);
  if (!m) return null;
  if (FOLDER_TYPE[m[2]] !== type) return null;
  const pathUsername = m[1];
  if (!allowAnyFolder && pathUsername !== String(username ?? '').toLowerCase()) return null;
  return { scope: 'member', username: pathUsername, oldSlug: m[3], oldPath: p };
}

// Merge the redirectFrom set for a publish: the old file's entries + any input entries + (when renaming) the old
// item's public URL, deduped. Returns the array or undefined (nothing to write). Mirrors operations.mjs:548-552 —
// which ALSO fixes a plain re-publish silently DROPPING the item's existing redirects. `oldFm` null (a fresh item
// or an unreadable original) leaves only the input entries.
export function mergedRedirectFrom({ oldFm, inputRedirectFrom, renaming, type, oldSlug } = {}) {
  const keep = Array.isArray(oldFm?.redirectFrom) ? oldFm.redirectFrom : [];
  const fromInput = Array.isArray(inputRedirectFrom) ? inputRedirectFrom : [];
  const oldUrl = renaming ? `${RENAME_URL_BASE[type]}/${oldSlug}/` : null;
  const merged = [...new Set([...keep, ...fromInput, ...(oldUrl ? [oldUrl] : [])])];
  return merged.length ? merged : undefined;
}

/** The comments folder for a { scope, username }: house's is fixed; a member's is their own folder. */
export function introFolderFor({ scope, username } = {}) {
  // sow-195: the 'house' scope key is retained (it is persisted in the WorkBench preference) but resolves to the
  // network's real member folder, so an intro comment lands beside its item instead of in a folder that is gone.
  return scope === 'house' ? `members/${NETWORK_CONTENT_OWNER}` : `members/${username}`;
}

// The from-the-author intro-comment MOVE files for a rename or reassignment: read intro-<old>.md, rewrite its
// id + targetSlug to the new slug, emit the new file + the old-path delete. `[]` for a type that cannot carry
// a note, or when the item has no intro (introText null). Pure given the already-read introText. Mirrors
// operations.mjs introMoveFiles. 2026-08-11: posts are included, so renaming an article carries its note
// instead of orphaning it at the old slug.
//
// sow-183: `from`/`to` are each { scope, username } -- a plain rename (unchanged folder) passes the SAME
// value for both; an authorship reassignment passes a DIFFERENT `to`, so the intro moves house<->member or
// member<->member right alongside the content item, never left behind at the old owner's folder.
export function renameIntroMoveFiles({ from, to, type, oldSlug, newSlug, introText } = {}) {
  if (!AUTHOR_NOTE_TYPES.has(type)) return [];
  if (introText == null) return [];
  const oldIntro = `${introFolderFor(from)}/comments/intro-${oldSlug}.md`;
  const intro = parseContentFile(introText);
  const introFm = { ...(intro.frontmatter ?? {}), id: `intro-${newSlug}`, targetSlug: newSlug };
  return [
    { path: `${introFolderFor(to || from)}/comments/intro-${newSlug}.md`, content: serializeContentFile(introFm, intro.body) },
    { path: oldIntro, content: null },
  ];
}

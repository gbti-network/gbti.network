// SOW-156 (spike): the pure core of hosted authoring. A paid member with NO fork and NO App install hands
// authored files to the signup Worker, which commits them to a per-member branch on the CANONICAL repo and
// opens the auto-merging PR (the SOW-005 gate stays the only merger). This module is the fail-closed wall
// between a member request and GBTI's canonical-repo installation token, so every check here is
// security-critical (see the SOW-078-grade review notes in the SOW).
//
// Node-free on purpose: it runs inside the Cloudflare Worker and in the unit suite, and it reuses the
// classify-pr path hygiene so the endpoint and the merge gate cannot disagree about what a clean
// own-folder path is.

import { isCleanPath } from './classify-pr.mjs';
import { ITEM_ID_MAX, ITEM_ID_PATTERN, SLUG_PATTERN } from './item-id.mjs';
import { shareFilesCategoryProblem } from './share-category.mjs';

export const HOSTED_MAX_FILES = 20;
export const HOSTED_MAX_FILE_BYTES = 100_000;
export const HOSTED_MAX_TOTAL_BYTES = 300_000;
export const HOSTED_BRANCH_PREFIX = 'hosted/';
// sow-158 image upload: a BINARY image entry ({ path, contentBase64 }) has its OWN budget, separate from the
// text caps above, so a 1 MB cover image never counts against the 100 KB text limit. 1 MB matches the
// check-media.mjs MAX_BYTES cap, so an uploaded image never fails media-check on the auto-merged PR.
export const HOSTED_MAX_IMAGE_BYTES = 1_048_576; // 1 MB per image (== check-media MAX_BYTES)
export const HOSTED_MAX_IMAGE_TOTAL_BYTES = 4_194_304; // 4 MB of images per request (a hard abuse bound)
// A binary image must be a WEB-IMAGE file under the matched folder's images/ directory, either the flat
// per-member `images/<name>` or, since sow-203, an item's own `<type>/<slug>/images/<name>`. NO svg (an
// uploaded svg is a navigation-XSS vector when opened directly); the web upload is raster-only, the
// extension host keeps svg.
//
// The optional item segment exists because content items CO-LOCATE their images beside index.md, which is
// the layout the Astro build resolves natively (the flat per-user path could not be resolved by image() and
// broke the site build, which is why the client moved to co-location on 2026-08-04). Only this validator was
// left on the flat-only rule, so a rename that had to carry co-located images was rejected outright and the
// attempt was reverted (sow-165, 2026-08-06).
//
// Every other property is deliberately unchanged, because this pattern is one of the few things standing
// between a hosted write and an arbitrary repo path: anchored at BOTH ends, matched against the tail AFTER
// the caller's folder prefix is stripped so it stays folder-scoped, the type restricted to the three content
// subdirectories, and the slug restricted to the same charset ANY_MEMBER_FOLDER_RE uses. Neither the slug
// nor the filename class admits `/`, and the slug admits no `.` either, so no traversal is expressible.
// NO `i` FLAG, AND ITS ABSENCE IS THE POINT (sow-157, 2026-08-22). Every class here is lowercase, so the
// flag silently widened all of them and `POSTS/My-Slug/images/A.PNG` was accepted. The SECURITY properties
// held either way (no traversal, no nested depth, no double extension, no escape from the member's tree),
// which is why this survived review: the cost is correctness, and it is a silent one.
//
// On a case-sensitive filesystem an accepted `POSTS/` or `My-Slug/` writes a SECOND directory that the Astro
// build never reads. The upload returns success, the member sees a confirmation, and the image simply never
// appears. That is the worst failure shape available for a member-facing action, because nothing anywhere
// reports a fault.
//
// The extension is held to lowercase TOO, which is the part worth explaining because it looks unkind to a
// phone that produces `IMG_4021.JPG`. The web client's `sanitizeImageName` (src/lib/workbench-client-core.mjs)
// already lowercases the entire leaf before upload, and its own contract says it exists so that the client
// and this wall AGREE ON WHAT AN IMAGE FILENAME IS. If this accepted `photo.JPG` while the client would only
// ever produce `photo.jpg`, they would not agree, and the one path that reaches here uppercase is a
// non-web client, which gets a precise error telling it exactly what to change. An explicit rejection turns
// an invisible failure into a visible one; silently lowercasing here would fix the render and leave the
// member wondering why their file has a different name.
const IMAGE_PATH_TAIL_RE = /^(?:(?:posts|projects|products|prompts)\/[a-z0-9][a-z0-9-]{0,63}\/)?images\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|gif)$/;
// The same pattern with `i` restored, used ONLY to tell "wrong case" apart from "wrong shape" so the error
// can say which. It is never a gate: a tail must satisfy the strict pattern above to be accepted.
const IMAGE_PATH_TAIL_ANYCASE_RE = new RegExp(IMAGE_PATH_TAIL_RE.source, 'i');

/**
 * Why `tail` is not an acceptable image path, or null when it is fine. Exported for tests and for the
 * caller's error message: naming the offending segment is the whole value of the fix, since the member
 * otherwise has a success response and a broken page and no way to connect the two.
 */
export function imagePathProblem(tail) {
  const t = String(tail ?? '');
  if (IMAGE_PATH_TAIL_RE.test(t)) return null;
  if (IMAGE_PATH_TAIL_ANYCASE_RE.test(t)) {
    const upper = t.split('/').filter((seg) => seg !== seg.toLowerCase());
    return `image paths must be lowercase, but ${upper.map((s) => JSON.stringify(s)).join(', ')} `
      + 'is not. An uppercase path writes a directory the site build never reads, so the upload would '
      + 'succeed and the image would never appear. Rename it in lowercase and upload again.';
  }
  return 'an uploaded image must be a png, jpg, webp, or gif under your images/ folder';
}

// sow-483: a member's uploaded recording, in the audio/ folder beside the item it plays in. Lowercase throughout for
// the reason IMAGE_PATH_TAIL_RE gives, and only the co-located shape. A recording never travels as base64 in the
// request: an entry names the caller's own STAGED copy (`stagedAudio: { item, name }`, read from the Worker's store) or
// a recording already on main to copy when the item moves (`copyFrom`), and the Worker reads the bytes itself.
const AUDIO_PATH_TAIL_RE = /^(?:posts|projects|products|prompts)\/[a-z0-9][a-z0-9-]{0,63}\/audio\/[a-z0-9][a-z0-9_-]{0,79}\.(?:mp3|ogg)$/;
const AUDIO_ITEM_RE = new RegExp(`^(post|project|product|prompt):${SLUG_PATTERN}$`); // membership/draft-audio.mjs itemTokenOf
/** Recordings one publish may carry, each up to 20 MB. */
export const HOSTED_MAX_AUDIO_FILES = 2;

/** Why `tail` is not an acceptable recording path, or null. */
export function audioPathProblem(tail) {
  if (AUDIO_PATH_TAIL_RE.test(String(tail ?? ''))) return null;
  return 'a recording must be an .mp3 or .ogg file in the audio/ folder beside its item, named in lowercase';
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** The exact decoded byte length of a base64 string, or -1 if it is not well-formed base64. Node-free (no atob):
 *  length math + a charset/padding check, so the Worker validates size WITHOUT decoding a megabyte into memory. */
export function base64DecodedBytes(b64) {
  if (typeof b64 !== 'string' || b64.length === 0) return -1;
  if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) return -1;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

// The item id becomes a branch segment AFTER the server-inserted github_id, so it must never be able to
// shift the id parse or produce an illegal git ref: lowercase alphanumeric + hyphen only, bounded length.
// SOW-157: bounded at 80 (was 64) so a share itemId fits: share-<14-digit stamp>-<slug up to 48> = 69.
// sow-354: bounded at ITEM_ID_MAX (item-id.mjs), so every slug the schemas accept has an item id that fits.
const ITEM_ID_RE = new RegExp(`^${ITEM_ID_PATTERN}$`);
const GITHUB_ID_RE = /^\d{1,20}$/;
// Folder names are the members-index usernames (lowercase folder/username per house/members-index.yml).
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Parse house/members-index.yml (the flat, reconcile-maintained `"github_id": username` map) WITHOUT a
 * YAML library (the Worker carries none by design; the file is admin-owned and trivially line-shaped).
 * Returns a Map<github_id string, username string>. Unrecognized lines (comments, the `members:` header)
 * are skipped; a malformed value line is skipped rather than guessed at (fail closed: an absent entry
 * denies, it never mis-scopes).
 */
export function parseMembersIndex(text) {
  const map = new Map();
  if (typeof text !== 'string') return map;
  for (const line of text.split('\n')) {
    const m = /^\s*"?(\d{1,20})"?\s*:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** The per-member canonical branch. The github_id segment is ALWAYS server-inserted from the verified
 * identity (never from the request body); callers must validate itemId via validateHostedRequest first. */
export function hostedBranchFor(githubId, itemId) {
  if (!GITHUB_ID_RE.test(String(githubId ?? ''))) return null;
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return null;
  return `${HOSTED_BRANCH_PREFIX}${githubId}/${itemId}`;
}

const HOSTED_REF_RE = new RegExp(`^hosted\\/(\\d{1,20})\\/${ITEM_ID_PATTERN}$`);

/**
 * The gate-side inverse: resolve the member github_id from a hosted branch ref, or null. Used by
 * scripts/pr-gate.mjs for a bot-opened PR whose head lives on the CANONICAL repo (no fork owner to read).
 * Sharing the regex with hostedBranchFor keeps the write path and the merge gate on one contract.
 * Fail closed: anything that does not match exactly returns null (the gate hard-fails a null author).
 */
export function parseHostedRef(ref) {
  const m = HOSTED_REF_RE.exec(String(ref ?? ''));
  return m ? m[1] : null;
}

// sow-161 server-side admin authoring: a DISTINCT branch prefix for a Worker-opened ADMIN mutation PR
// (moderation, ban/grandfather, role assignment, config), so it is not confused with own-folder member
// content (`hosted/...`). Like the member case, the github_id is ALWAYS server-inserted from the verified
// session identity, never the request body, and the action slug names what the PR does. The gate resolves
// this id -> the git-native role and runs the SAME decide() anti-escalation: the id must independently hold
// the role for every touched path tier (moderator to touch others' content, admin for Tier A house/**,
// superadmin for Tier S roles.yml), so a wrong/forged id cannot escalate. Members cannot mint this branch:
// only the Worker (installation token) pushes canonical branches and opens the bot PR.
export const ADMIN_HOSTED_BRANCH_PREFIX = 'hosted-admin/';
// The action slug is a bounded lowercase token (e.g. `deplatform-my-post`, `ban-12345`, `role-12345`); it is
// cosmetic for the gate (the touched PATHS + the id's role decide the merge), but it is validated so it can
// never shift the id parse or produce an illegal git ref.
const ADMIN_ACTION_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** The per-admin canonical mutation branch. The github_id segment is ALWAYS server-inserted from the verified
 *  identity (never the request body). Returns null if the id or the action slug is not well-formed. */
export function adminHostedBranchFor(githubId, actionSlug) {
  if (!GITHUB_ID_RE.test(String(githubId ?? ''))) return null;
  if (!ADMIN_ACTION_SLUG_RE.test(String(actionSlug ?? ''))) return null;
  return `${ADMIN_HOSTED_BRANCH_PREFIX}${githubId}/${actionSlug}`;
}

/** The gate-side inverse of adminHostedBranchFor: resolve the requesting admin github_id from a
 *  `hosted-admin/<github_id>/<action-slug>` ref, or null. Fail closed (a non-match hard-fails the author). */
export function parseAdminHostedRef(ref) {
  const m = /^hosted-admin\/(\d{1,20})\/[a-z0-9][a-z0-9-]{0,79}$/.exec(String(ref ?? ''));
  return m ? m[1] : null;
}

function utf8Bytes(s) {
  return new TextEncoder().encode(s).length;
}

// sow-183: a content path lives under SOME member's folder or house/. Shape-only (isCleanPath already ruled
// out traversal/unclean segments by the time this runs) -- it does not confirm the folder is a REAL
// registered member, matching the fact that a superadmin can already reach any path through the gate
// (classify-pr.mjs's decide() auto-merges a superadmin on any path); this is not a NEW ceiling, just
// the hosted-authoring endpoint's own shape check, same rigor as its existing own-folder-only pattern.
const ANY_MEMBER_FOLDER_RE = /^members\/[a-z0-9][a-z0-9-]{0,63}\//;
// EXPLICIT house CONTENT subdirectories only -- never a bare 'house/' prefix. house/ also holds Tier-S/A
// sow-195 REMOVED the house content allowlist that used to sit here. house/posts, house/projects and
// house/prompts no longer exist: the network's content moved into members/gbtilabs/, which the
// ANY_MEMBER_FOLDER_RE arm below already covers for a superadmin. This TIGHTENS the surface rather
// than loosening it. All of house/** is now uniformly governance (roles.yml, bans.yml, taxonomy.yml
// and the rest), so no hosted CONTENT write can target house/ at all, and one of the two allowlists
// that had to be kept in sync with the gate is gone. The admin config surface writes house YAML
// through membership-admin-author.mjs, a different module on a different route, and is unaffected.

/**
 * Validate a hosted author request against the caller's OWNED folder (resolved by the caller from the
 * members-index by github_id, exactly as the gate does; never from the current GitHub login). Returns
 * { ok: true, paths } or { ok: false, error, status } with a member-safe error string. Fail closed:
 * any doubt rejects the whole request.
 *
 * sow-183: `allowAnyFolder` additionally permits ANY OTHER member's folder, for a content authorship
 * reassignment and (since sow-195) for the network's own content in members/gbtilabs/. It never
 * permits house/ at all any more, governance or otherwise. The CALLER (membershipAuthor) sets this ONLY after an independent superadmin
 * check (authorizeSuperadmin, resolved from the SIGNUP_KV roles mirror) -- never from anything in the
 * request body itself, so a non-superadmin cannot self-grant it by simply asking. Every other check
 * (clean paths, size caps, file count, duplicates) is unchanged and applies identically either way.
 */
export function validateHostedRequest({ files, itemId, folder, allowAnyFolder = false, topicKeys = null } = {}) {
  const bad = (error, status = 400) => ({ ok: false, error, status });
  if (!FOLDER_RE.test(String(folder ?? ''))) return bad('no member folder resolved for this account', 409);
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return bad(`itemId must be lowercase letters, digits, and hyphens (max ${ITEM_ID_MAX})`);
  if (!Array.isArray(files) || files.length === 0) return bad('files must be a non-empty array');
  if (files.length > HOSTED_MAX_FILES) return bad(`too many files (max ${HOSTED_MAX_FILES})`);
  const ownPrefix = `members/${folder}/`;
  const paths = [];
  let totalBytes = 0;
  let imageBytes = 0;
  let audioCount = 0;
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.path !== 'string') return bad('every file needs a path');
    if (!isCleanPath(f.path)) return bad('a file path is not a clean repo-relative path');
    const inOwnFolder = f.path.startsWith(ownPrefix) && f.path.length > ownPrefix.length;
    // sow-183: which folder prefix actually matched -- own, house/, or (allowAnyFolder only) another
    // member's -- so the image-tail check below (own-folder "images/x.png") is computed against the RIGHT
    // folder for a cross-folder write, not always the caller's own.
    let matchedPrefix = null;
    if (inOwnFolder) matchedPrefix = ownPrefix;
    else if (allowAnyFolder) {
      const m = ANY_MEMBER_FOLDER_RE.exec(f.path);
      if (m) matchedPrefix = m[0];
    }
    if (!matchedPrefix) {
      return bad(allowAnyFolder ? 'every file must live under a member folder' : 'every file must live inside your own member folder');
    }
    if (seen.has(f.path)) return bad('duplicate file path');
    seen.add(f.path);
    if (f.stagedAudio !== undefined || f.copyFrom !== undefined) {
      // sow-483: a recording, by reference. Its path is the item's own audio/ folder; its bytes come from the
      // caller's own staged copy or from a recording already on main, read by the Worker, never from the request.
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      if (f.content !== undefined || f.contentBase64 !== undefined) return bad(`the recording ${name} carries a reference, not content`);
      const problem = audioPathProblem(f.path.slice(matchedPrefix.length));
      if (problem) return bad(problem);
      audioCount += 1;
      if (audioCount > HOSTED_MAX_AUDIO_FILES) return bad(`one publish carries at most ${HOSTED_MAX_AUDIO_FILES} recordings`);
      if (f.stagedAudio !== undefined) {
        if (f.copyFrom !== undefined) return bad(`the recording ${name} is either staged or copied, not both`);
        const s = f.stagedAudio;
        if (!s || typeof s !== 'object' || s.name !== name || !AUDIO_ITEM_RE.test(String(s.item ?? ''))) {
          return bad(`the recording ${name} does not name its staged copy`);
        }
      } else {
        // The source must be a recording in a folder this caller may write: their own, or any member's for a
        // superadmin, the same rule as the destination. Same name, different place.
        const from = typeof f.copyFrom === 'string' ? f.copyFrom : '';
        let fromPrefix = null;
        if (isCleanPath(from) && from.startsWith(ownPrefix)) fromPrefix = ownPrefix;
        else if (isCleanPath(from) && allowAnyFolder) fromPrefix = (ANY_MEMBER_FOLDER_RE.exec(from) || [])[0] || null;
        if (!fromPrefix || audioPathProblem(from.slice(fromPrefix.length)) || from.slice(from.lastIndexOf('/') + 1) !== name || from === f.path) {
          return bad(`the recording ${name} can only be copied from another item's audio/ folder you can write to`);
        }
      }
      paths.push(f.path);
      continue;
    }
    const isBinary = f.contentBase64 !== undefined && f.contentBase64 !== null;
    if (isBinary) {
      // sow-158 image upload: a binary entry is a base64-encoded raster image, own-folder images/ only, capped.
      if (typeof f.content === 'string') return bad('a file cannot carry both content and contentBase64');
      const tail = f.path.slice(matchedPrefix.length);
      const imageProblem = imagePathProblem(tail);
      if (imageProblem) return bad(imageProblem);
      // NAME THE IMAGE. These three used to say "an uploaded image", which tells a caller holding several
      // images only that one of them is wrong, not which. The sibling check in prepared-claim-files.mjs
      // ("The image <name> is missing") already names it, and the difference is not academic: a malformed
      // upload read as a fault in the tool rather than in the payload, and cost an afternoon of bisecting
      // by removing images one at a time. The basename is what the caller supplied, so it is what they can
      // act on; the full path is server-side detail.
      const imageName = f.path.slice(f.path.lastIndexOf('/') + 1);
      const bytes = base64DecodedBytes(f.contentBase64);
      if (bytes < 0) return bad(`the image ${imageName} is not valid base64`);
      if (bytes === 0) return bad(`the image ${imageName} is empty`);
      if (bytes > HOSTED_MAX_IMAGE_BYTES) return bad(`the image ${imageName} exceeds ${HOSTED_MAX_IMAGE_BYTES} bytes (1 MB)`);
      imageBytes += bytes;
      if (imageBytes > HOSTED_MAX_IMAGE_TOTAL_BYTES) return bad(`the request exceeds ${HOSTED_MAX_IMAGE_TOTAL_BYTES} image bytes total`);
    } else if (f.content !== null) {
      if (typeof f.content !== 'string') return bad('file content must be a string (or null to delete)');
      const bytes = utf8Bytes(f.content);
      if (bytes > HOSTED_MAX_FILE_BYTES) return bad(`a file exceeds ${HOSTED_MAX_FILE_BYTES} bytes`);
      totalBytes += bytes;
      if (totalBytes > HOSTED_MAX_TOTAL_BYTES) return bad(`the request exceeds ${HOSTED_MAX_TOTAL_BYTES} bytes total`);
    }
    paths.push(f.path);
  }
  // A published share must carry a category, and a real one when the caller holds the topic list. Here so a
  // direct call to the author route cannot skip the client's own check (membership/share-category.mjs).
  const categoryProblem = shareFilesCategoryProblem(files, { topicKeys });
  if (categoryProblem) return bad(categoryProblem);
  return { ok: true, paths };
}

// ---- sow-458: the content items a publish writes ----------------------------------------------------------
//
// Until 2026-10-16 this section decided which items needed a superadmin's approval before they could be public
// (sow-323). The owner retired that rule: "It is published when the person publishes it." What the Worker still
// needs from a publish is which content ITEMS it writes, so it can tell a NEW item (the owner is emailed about it)
// from an edit. It stays here, node-free and pure, so `node --test` exercises it; the Worker does the one thing a
// pure function cannot, which is ask main whether an item's paths already exist.
//
// Comments and profiles are not content items here: they do not live under these directories.

/** The member-folder directories that hold content items, and the content type each one carries. products/ is the
 *  retired name of projects/ and still builds as a project (src/content.config.ts). */
export const CONTENT_ITEM_DIRS = Object.freeze({ posts: 'post', projects: 'project', products: 'project', prompts: 'prompt', shares: 'share' });

/** The URL base a rename records in `redirectFrom`, per type, so an old slug can be recovered from it. */
const RENAME_URL_DIR = Object.freeze({ post: 'articles', project: 'projects', prompt: 'prompts', share: 'shares' });

/**
 * The `visibility` a content file's own frontmatter states: 'members', 'public', or null when the file carries
 * no readable frontmatter at all. An ABSENT field returns 'public', because that is the schema default and
 * therefore what the build would do with it.
 */
export function statedVisibility(content) {
  if (typeof content !== 'string') return null; // unreadable: the caller treats this as needing approval
  // ONLY the frontmatter block is read, and a file with no frontmatter block is not a content file this can
  // vouch for. Both halves are anti-spoofing, and both were found by moving the sow-293 adversarial cases onto
  // this function: without the block bound, a BODY line reading `visibility: members` would gate the item, and
  // a file with no frontmatter at all would be judged on its prose. Neither is a content file's audience.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!fm) return 'public';
  const m = /^visibility:\s*["']?([a-z]+)["']?\s*$/m.exec(fm[1]);
  if (!m) return 'public'; // silence is public (src/content.config.ts defaults post/project/prompt to public)
  return m[1] === 'members' ? 'members' : 'public';
}

/** Every `redirectFrom` URL a content file's frontmatter lists, as raw strings. */
function redirectFromUrls(content) {
  if (typeof content !== 'string') return [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const head = fm ? fm[1] : content;
  const inline = /^redirectFrom:\s*\[([^\]]*)\]/m.exec(head);
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const block = /^redirectFrom:\s*\r?\n((?:\s*-\s*.*\r?\n?)+)/m.exec(head);
  if (!block) return [];
  return block[1].split(/\r?\n/).map((l) => {
    const m = /^\s*-\s*["']?(.+?)["']?\s*$/.exec(l);
    return m ? m[1] : null;
  }).filter(Boolean);
}

/** One frontmatter scalar, unquoted, bounded, control characters stripped. '' when absent. Titles are member text. */
function frontmatterText(content, key, max = 200) {
  const fm = typeof content === 'string' ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(content) : null;
  if (!fm) return '';
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm[1]);
  if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][-+]?$/.test(v)) { // a folded or literal block: the indented lines that follow
    const after = fm[1].slice(m.index + m[0].length).split(/\r?\n/);
    const lines = [];
    for (const line of after.slice(1)) { if (/^\s+\S/.test(line)) lines.push(line.trim()); else if (line.trim()) break; }
    v = lines.join(' ');
  }
  v = v.replace(/^(["'])(.*)\1$/, '$2').replace(/''/g, "'");
  return v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max);
}

/**
 * Every content item this request WRITES in `folder`, whatever its audience: `{ path, type, slug, visibility, title,
 * priorPaths }`. `priorPaths` are the repository paths the item had before a rename (from `redirectFrom`), so the
 * Worker can tell a renamed item from a new one. A delete writes nothing and is not listed. A skill's SKILL.md is
 * listed as its item (the sibling index.md), once.
 */
export function contentItemsIn(files, folder) {
  if (!Array.isArray(files) || files.length === 0) return [];
  if (typeof folder !== 'string' || !folder) return [];
  const itemRe = new RegExp(`^members/${folder}/(posts|projects|products|prompts|shares)/(.+)$`);
  const skillRe = new RegExp(`^(members/${folder}/prompts/[a-z0-9][a-z0-9-]*/)SKILL\\.md$`);
  const isDelete = (f) => typeof f === 'object' && f !== null && f.content === null && f.contentBase64 == null;
  const out = [];
  const skillItems = [];
  // An item is `<dir>/<slug>/index.md` or a flat `<dir>/<slug>.md` (the site's globs build both); a share is `shares/<id>.md`.
  const itemTail = /^([a-z0-9][a-z0-9-]*)(?:\/index)?\.mdx?$/;
  const slugOf = (dir, tail) => (itemTail.exec(tail) || [])[1] || tail.split('/')[0];
  for (const f of files) {
    const path = typeof f === 'string' ? f : f?.path;
    if (typeof path !== 'string' || path.includes('..')) continue;
    const m = itemRe.exec(path);
    if (!m) continue;                                   // comments, profile.md, images, _enc: not content items
    if (!/\.(md|mdx)$/.test(path)) continue;
    if (isDelete(f)) continue;
    const sk = skillRe.exec(path);
    if (sk) { skillItems.push(`${sk[1]}index.md`); continue; }
    if (!itemTail.exec(m[2])) continue; // an item's own file only (not a nested page or a note beside it)
    const type = CONTENT_ITEM_DIRS[m[1]];
    const content = typeof f === 'string' ? null : f?.content;
    out.push({
      path, type, slug: slugOf(m[1], m[2]),
      // A share's schema default is members (an article's is public), so an unstated share is members-only.
      visibility: ['members', 'public'].includes(frontmatterText(content, 'visibility')) ? frontmatterText(content, 'visibility') : (type === 'share' ? 'members' : 'public'),
      publicStub: frontmatterText(content, 'publicStub') === 'true',
      title: frontmatterText(content, 'title') || frontmatterText(content, 'shortDescription') || frontmatterText(content, 'url'),
      priorPaths: priorPathsOf(content, type, m[1], m[2], folder),
    });
  }
  for (const indexPath of new Set(skillItems)) {
    if (out.some((o) => o.path === indexPath)) continue;
    const m = itemRe.exec(indexPath);
    out.push({ path: indexPath, type: 'prompt', slug: slugOf(m[1], m[2]), visibility: 'public', publicStub: false, title: '', priorPaths: [] });
  }
  return out;
}

/**
 * The repository paths an item had before a rename, recovered from the `redirectFrom` URLs its frontmatter lists. A
 * rename of an item that was already public carries the old URL there, and only a public item ever had a public URL,
 * so the Worker can check the old path instead: without this an author renaming their own approved article is
 * refused, which looks like a bug to them.
 */
function priorPathsOf(content, type, dir, tail, folder) {
  return redirectFromUrls(content).map((url) => {
    const seg = String(url).split('/').filter(Boolean);
    if (seg.length < 2 || seg[0] !== RENAME_URL_DIR[type]) return null;
    const oldSlug = seg[seg.length - 1];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(oldSlug)) return null;
    return type === 'share'
      ? `members/${folder}/shares/${oldSlug}.md`
      : `members/${folder}/${dir}/${oldSlug}/${tail.replace(/^[^/]+\//, '')}`;
  }).filter(Boolean);
}

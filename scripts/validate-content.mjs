#!/usr/bin/env node
// Content validation for the public-repo PR model (SOW-003 CI / SOW-005 scoping). Enforces the
// rules the Astro build does NOT: per-author scoping (a member may only author content inside their
// own members/<username>/ folder), globally-unique slugs per type, and valid status/visibility.
// The Astro build separately validates frontmatter against the Zod schemas. Runs locally + in CI.
//   node scripts/validate-content.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { isSanctionedAvatar } from '../client-ui/src/profile-fields.mjs'; // SOW-129: the avatar host allowlist (shared)
import { stripTrackingParamsInText } from '../client/src/url-normalize.mjs'; // sow-364: the body tracking-parameter rule
import { topicVocabKeys } from '../membership/topics-vocab.mjs'; // SOW-080: the flat house/topics.yml topic vocabulary
import { shareCategoryProblem } from '../membership/share-category.mjs'; // a published share needs a category
import { targetProblems } from '../membership/ai-tools.mjs'; // sow-368: the controlled AI-tool list
import { promptKindProblems } from '../membership/prompt-kind.mjs'; // sow-109: every prompt item says prompt or skill
import { skillNameFrom } from '../membership/skill-install.mjs'; // sow-109: the name a skill file declares
import { licenseProblems } from '../membership/licenses.mjs'; // sow-305: the controlled license list
import { validateHouseConfig } from './lib/validate-house-config.mjs'; // the house/*.yml settings checks

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const errors = [];
const slugs = { post: new Map(), project: new Map(), prompt: new Map(), applet: new Map() };

// Canonical taxonomy (house/taxonomy.yml). Every content `categories` path must resolve in this tree
// (SOW-012) — the single source of truth shared with src/lib/taxonomy.ts. A path may stop at any node.
const TAXONOMY = (() => {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'house/taxonomy.yml'), 'utf8'));
    return (doc && doc.tree) || {};
  } catch {
    return {};
  }
})();

// SOW-087: the flat topic vocabulary (house/topics.yml). A share's optional `category` must be one of these
// keys so the category -> Discord-channel map can resolve it.
const TOPIC_KEYS = (() => {
  try {
    return new Set(topicVocabKeys(yaml.load(fs.readFileSync(path.join(ROOT, 'house/topics.yml'), 'utf8'))));
  } catch {
    return new Set();
  }
})();

// sow-368: the controlled list of AI tools a prompt may say it runs on (house/ai-tools.yml). Unlike the topic
// vocabulary above, the LABEL is the canonical form: a target is written into the content, rendered as the
// chip and carried in the filter link, so the displayed string is the stored value.
//
// An unreadable or empty file leaves this null and the check below reports THAT, rather than silently passing
// every prompt. A guard that cannot read its own vocabulary has proved nothing (sow-245).
const AI_TOOLS_DOC = (() => {
  try { return yaml.load(fs.readFileSync(path.join(ROOT, 'house/ai-tools.yml'), 'utf8')); }
  catch { return null; }
})();

// sow-305: the licence list. Same shape and same reasoning as the AI-tool vocabulary above: unreadable leaves
// this null and validateLicenseVocabulary reports THAT, rather than every project silently passing.
const LICENSES_DOC = (() => {
  try { return yaml.load(fs.readFileSync(path.join(ROOT, 'house/licenses.yml'), 'utf8')); }
  catch { return null; }
})();

function validCategoryPath(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return true; // uncategorized is allowed
  let level = TAXONOMY;
  for (const seg of arr) {
    if (!level || !level[seg]) return false;
    level = level[seg].children;
  }
  return true;
}

/**
 * sow-256: a title that is present but blank.
 *
 * The schemas refuse it now, but this check exists so the failure arrives with a sentence a member can act
 * on, at the earliest gate, rather than as a raw zod issue from the site build. It reads the PARSED
 * frontmatter rather than `field()`, which cannot see the difference: `field`'s pattern needs at least one
 * non-quote character, so `title: ""` and a missing title both come back null.
 *
 * Types only. A share's title is optional (omitting it is correct), so only a PRESENT blank is an error.
 */
function checkTitle(fm, rel, type) {
  if (!fm || !('title' in fm)) return;
  const t = fm.title;
  if (typeof t === 'string' && t.trim() !== '') return;
  if (t === undefined || t === null) return; // absent: the schema's own required rule owns that case
  errors.push(`${rel}: title must not be blank (got ${JSON.stringify(t)}). A blank title renders as " | GBTI Network" in the page title and the share preview. See sow-256.`);
}

/** sow-140: a project's newsFeed (the member-owned RSS the admin registry may approve into the news pool)
 *  must be an https URL. RSS VALIDITY is verified by the moderator at approval time (CI stays offline). */
function checkNewsFeed(fm, rel) {
  const v = fm?.newsFeed;
  if (v === undefined || v === null) return;
  if (typeof v !== 'string' || !/^https:\/\/[^\s]+$/i.test(v)) {
    errors.push(`${rel}: newsFeed must be an https URL to the project's RSS feed (got ${JSON.stringify(v)}). See sow-140.`);
  }
}

/** SOW-015: an encrypted link must be member-only (encryption attaches only to visibility: members). */
function checkEncryptedLinks(fm, rel) {
  const links = fm?.links;
  if (!Array.isArray(links)) return;
  for (const [i, l] of links.entries()) {
    if (l && l.encrypted === true && l.visibility !== 'members') {
      errors.push(`${rel}: links[${i}] is encrypted but not visibility: members (encryption attaches only to member-only links). See SOW-015.`);
    }
  }
}

/**
 * SOW-016 member-only gating: publicStub is only meaningful for a members item, and an encryptedBody must
 * reference a real v1 .enc envelope (never a missing file or a committed plaintext). Modes A (members, no
 * stub), B (members, stub), and C (public, with a member-only section) all encrypt the gated body to a .enc.
 */
const MEMBER_MARKER = '<!-- members-only -->';

function checkMemberGating(fm, rel, body = '') {
  if (fm == null) return;
  if (fm.publicStub === true && fm.visibility !== 'members') {
    errors.push(`${rel}: publicStub:true requires visibility: members (a public item has no body to gate). See SOW-016.`);
  }
  // SOW-016: the `<!-- members-only -->` marker is a publish-time split directive. The client encrypts the
  // gated tail and strips the marker, so a committed body must NEVER contain it (otherwise the gated plaintext
  // would render inline). Enforce at PR time, not just in the dist build guard.
  if (typeof body === 'string' && body.includes(MEMBER_MARKER)) {
    errors.push(`${rel}: the body still contains the ${MEMBER_MARKER} marker (the gated section was not split). Publish via the client so the tail is encrypted and the marker removed. See SOW-016.`);
  }
  const enc = fm.encryptedBody;
  if (enc == null) return;
  if (typeof enc !== 'string') {
    errors.push(`${rel}: encryptedBody must be a repo-relative path string to a .enc envelope`);
    return;
  }
  const abs = path.join(ROOT, enc);
  if (!fs.existsSync(abs)) {
    errors.push(`${rel}: encryptedBody points at a missing file: ${enc} (publish via the client so the .enc ships in the same PR). See SOW-016.`);
    return;
  }
  try {
    const env = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (env?.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.aad !== 'string') {
      errors.push(`${rel}: encryptedBody ${enc} is not a valid v1 encrypted envelope (it may be plaintext; encrypt it via the client)`);
    }
  } catch {
    errors.push(`${rel}: encryptedBody ${enc} is not valid JSON (a .enc must be an encrypted v1 envelope, not raw plaintext)`);
  }
}

// sow-165: a body image reference whose file is not in the repository does NOT render as a broken image.
// Astro resolves relative markdown images at build time and throws:
//
//   [ImageNotFound] Could not find requested image `./images/x.webp`. Does it exist?
//
// so the site build exits 1. That matters here rather than somewhere else because of what is downstream: a
// hosted publish AUTO-MERGES, no workflow builds the site on a pull request (content-check, tests and
// extension-check all build zero site pages; only deploy.yml builds, on push to main), and the Astro schemas
// validate frontmatter rather than body assets. So a single missing body image reds main and stops every
// deploy, for everybody, until someone notices. `fdf91096` fixed the one path that produced it, the website
// publish flushing frontmatter images only, but any other route to the same shape lands the same way: a
// hand-authored pull request, a migration, a rename that leaves a body reference behind.
//
// BOTH markdown forms are checked, `![alt](./images/x)` and the link form `[text](./images/x)`, because both
// name a file the item expects to be there. Only the image form breaks the build; a link-form reference to a
// file that is not committed is the 404-on-click defect sow-165 already had to fix four times by hand.
// Catching them with one rule costs nothing and the message says which form was found.
const BODY_IMAGE_REF_RE = /(!?)\[[^\]]*\]\((\.\/images\/[^)\s]+)(?:\s+"[^"]*")?\)/g; // an optional title (the caption) after the path

// Counts what the rule actually examined. A guard that reports "passed" after inspecting zero subjects is
// this repo's most-recorded failure, and nothing downstream disagrees with it, so the number is printed.
const bodyImageStats = { refs: 0, files: 0 };

function checkBodyImages(file, rel, body) {
  if (typeof body !== 'string' || !body) return;
  const dir = path.dirname(file);
  const seen = new Set();
  const before = bodyImageStats.refs;
  for (const m of body.matchAll(BODY_IMAGE_REF_RE)) {
    const ref = m[2];
    if (seen.has(ref)) continue;
    seen.add(ref);
    bodyImageStats.refs++;
    const abs = path.join(dir, ref.replace(/^\.\//, ''));
    if (fs.existsSync(abs)) continue;
    const form = m[1] === '!' ? 'image' : 'link';
    const consequence = m[1] === '!'
      ? 'the site build FAILS with [ImageNotFound], so this would red main and stop the deploy'
      : 'the link 404s for every reader, because Astro only emits assets for the ![] image form';
    errors.push(`${rel}: the body references ${ref} (markdown ${form} form) but that file is not committed; ${consequence}. Publish via the client so the image ships in the same PR. See sow-165.`);
  }
  if (bodyImageStats.refs > before) bodyImageStats.files++;
}

/** Each content item's `categories` must be a valid ordered path in the canonical taxonomy. */
function checkCategories(fm, rel) {
  const cats = fm?.categories;
  if (cats == null) return;
  if (!Array.isArray(cats)) {
    errors.push(`${rel}: categories must be an array path into house/taxonomy.yml`);
    return;
  }
  if (!validCategoryPath(cats)) {
    errors.push(`${rel}: categories ${JSON.stringify(cats)} is not a valid path in house/taxonomy.yml (canonical taxonomy)`);
  }
}

const field = (txt, key) => {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm').exec(txt);
  return m ? m[1].trim() : null;
};


/** Parse the leading YAML frontmatter block, or null. Never throws (malformed YAML => null, build catches it). */
function frontmatter(txt) {
  const m = /^---\n([\s\S]*?)\n---/.exec(txt);
  if (!m) return null;
  try {
    const doc = yaml.load(m[1]);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

// sow-109: a skill keeps its skill file as a SKILL.md beside its index.md; the skill page's install box, Copy and
// Download all read it, and its name: line fills in the folder and the command. So:
//   - a PUBLIC skill must have one, with a usable name (a skill page without it has nothing to install);
//   - a MEMBERS-ONLY item must NOT have a plaintext one: it would publish the file its page locks (its skill file
//     travels encrypted instead, sow-424 Phase 7);
//   - a prompt must not have one, since nothing would ever show it.
function checkSkillFile(fm, file, rel) {
  if (!fm || typeof fm !== 'object') return;
  const skillPath = path.join(path.dirname(file), 'SKILL.md');
  const hasFile = has(skillPath);
  const skillRel = path.relative(ROOT, skillPath);
  if (fm.visibility === 'members') {
    if (hasFile) errors.push(`${skillRel}: a members-only item cannot carry a plaintext SKILL.md; it would publish the file its page locks`);
    return;
  }
  if (fm.kind === 'skill') {
    if (!hasFile) { errors.push(`${rel}: a skill needs its skill file saved as SKILL.md beside this index.md`); return; }
    if (!skillNameFrom(fs.readFileSync(skillPath, 'utf8'))) {
      errors.push(`${skillRel}: needs frontmatter with a name: line (lowercase letters, digits and dashes), which the install steps use for the folder and the command`);
    }
  } else if (hasFile) {
    errors.push(`${skillRel}: only a skill carries a SKILL.md; set kind: skill in ${rel}, or remove the file`);
  }
}

function checkContent(file, owner, type) {
  const txt = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const author = field(txt, 'author');
  if (owner && author && author !== owner) {
    errors.push(`${rel}: author "${author}" must equal the folder owner "${owner}" (members may only author their own content)`);
  }
  const status = field(txt, 'status');
  if (status && !['draft', 'published'].includes(status)) errors.push(`${rel}: invalid status "${status}"`);
  const vis = field(txt, 'visibility');
  if (vis && !['public', 'members'].includes(vis)) errors.push(`${rel}: invalid visibility "${vis}"`);
  // sow-166: A PUBLISHED item MUST carry publishedAt, and this is a correctness rule, not tidiness.
  //
  // The schema has always had it `.optional()`, so an item could publish without one and nothing complained
  // anywhere. The date is not merely cosmetic: `buildActivityIndex` sorts on `publishedAt ?? 0` and caps at 40
  // PER TYPE, and the weekly digest drops anything below a time floor. So a missing date does not read as
  // "undated", it reads as THE FIRST OF JANUARY 1970, and that produces two different silent failures depending
  // on how much content of that type exists:
  //
  //   - over the cap (posts, 50 of them): the item sorts dead last and is CUT from the index entirely. It has a
  //     live public page the whole time, so nothing looks broken. Three published articles were missing from
  //     the index, the extension feed and the digest this way, found 2026-08-23.
  //   - under the cap (projects, 11): the item survives into the index but keeps date 0, which is below every
  //     possible digest floor, so it can never be mailed in any issue, ever. That was Ryker.
  //
  // Both were invisible: the page renders, the build passes, the guards pass, and the item is simply absent
  // downstream. Rejecting at authoring time is the only layer that fails LOUDLY, which is why it is here and
  // not a fallback in the index. A fallback would keep the item working while hiding the omission.
  if (status === 'published' && ['post', 'project', 'prompt'].includes(type) && !field(txt, 'publishedAt')) {
    errors.push(`${rel}: a published ${type} must set publishedAt (e.g. publishedAt: 2026-08-22). Without it the item sorts as epoch 0, so it is cut from activity-index.json by the 40-per-type cap and can never appear in the weekly digest. See sow-166.`);
  }
  const slug = field(txt, 'slug');
  if (slug && slugs[type]) {
    if (slugs[type].has(slug)) errors.push(`${rel}: duplicate ${type} slug "${slug}" (already used by ${slugs[type].get(slug)})`);
    else slugs[type].set(slug, rel);
  }
  const bodyOf = (t) => t.replace(/^---\n[\s\S]*?\n---/, '');
  if (type === 'post' || type === 'project' || type === 'prompt' || type === 'applet') {
    const fm = frontmatter(txt);
    checkTitle(fm, rel, type); // sow-256
    // sow-368: a prompt's `targets` names the AI tools it runs on, from the controlled list in
    // house/ai-tools.yml. Free text here is how one tool becomes two filter buttons on the prompts
    // directory, each showing half the prompts, with nothing anywhere reporting it.
    if (type === 'prompt' && fm && fm.targets !== undefined) {
      for (const problem of targetProblems(fm.targets, AI_TOOLS_DOC)) errors.push(`${rel}: ${problem}`);
    }
    // sow-109: a prompt item says whether it is a prompt or a skill (required, owner 2026-09-29), and a skill names
    // the tools it is made for. Same branch as the targets rule above, which is the one a prompt reaches.
    if (type === 'prompt') for (const problem of promptKindProblems(fm)) errors.push(`${rel}: ${problem}`);
    if (type === 'prompt') checkSkillFile(fm, file, rel); // sow-109: a skill's own SKILL.md, beside its index.md
    checkCategories(fm, rel);
    checkEncryptedLinks(fm, rel);
    if (type === 'project') checkNewsFeed(fm, rel); // sow-140
    // sow-305: the licence, in the SAME branch as the news feed above, which is the branch a project frontmatter
    // reaches. The equivalent AI-tool check was first written beside the share rules, where a prompt never
    // arrives, and every control passed green while nothing was checked.
    if (type === 'project' && fm && (fm.license !== undefined || fm.licenseUrl !== undefined)) {
      for (const problem of licenseProblems({ license: fm.license, licenseUrl: fm.licenseUrl }, LICENSES_DOC)) {
        errors.push(`${rel}: ${problem}`);
      }
    }
    checkMemberGating(fm, rel, bodyOf(txt)); // SOW-016
    checkBodyImages(file, rel, bodyOf(txt)); // sow-165
  } else if (type === 'comment' || type === 'share') {
    // SOW-016: encryptedBody resolves to a real v1 envelope + no members-only marker leaks into the body.
    // SOW-018: a Share is gated the same way (a members Share encrypts its body); author scoping above
    // already enforces author === folder owner.
    const fmc = frontmatter(txt) || {};
    checkTitle(fmc, rel, type); // sow-256: a share headline may be omitted, but not left blank
    checkMemberGating(fmc, rel, bodyOf(txt));
    // SOW-087: a share's optional `category` is ONE flat topic key (house/topics.yml), not a taxonomy path; it
    // routes the share's category Discord post, so an unknown key would silently never route.
    if (type === 'share' && fmc.category != null && !TOPIC_KEYS.has(String(fmc.category))) {
      errors.push(`${rel}: share category "${fmc.category}" is not a topic key in house/topics.yml (SOW-087)`);
    }
    // A PUBLISHED share must carry one (owner, 2026-09-21). The builder and the Worker refuse it first
    // (membership/share-category.mjs); this is the backstop for a share committed by hand.
    if (type === 'share' && shareCategoryProblem(fmc)) {
      errors.push(`${rel}: a published share needs a category, one topic key from house/topics.yml`);
    }
    // SOW-032: a share comment is identified by the composite "<author>/<shareId>" targetSlug (a Share id is a
    // member-scoped timestamp-slug, not globally unique), so it stays unambiguous across members. The shareId stamp
    // is VARIABLE length: shareId() slices the createdAt digits to 14, so a date-only createdAt yields an 8-digit
    // stamp (e.g. 20260610-...) while a full timestamp yields 14 (20260615120000-...). Accept 1-14 leading digits.
    // The from-the-author intro requirement (SOW-014) only targets projects/prompts, so a share never demands one.
    if (type === 'comment' && fmc.targetType === 'share' && !/^[a-z0-9][a-z0-9-]*\/[0-9]{1,14}-[a-z0-9-]+$/.test(String(fmc.targetSlug || ''))) {
      errors.push(`${rel}: a share comment targetSlug must be "<author>/<shareId>" (e.g. alice/20260615120000-x or alice/20260610-x). See SOW-032.`);
    }
    // SOW-046 D: a news comment targets a deterministic slug-safe id derived from the (URL-shaped) news guid:
    // "news-<hash>" (newsTargetSlug in client-ui/src/news.mjs). A raw guid (a URL) is never used as a targetSlug.
    if (type === 'comment' && fmc.targetType === 'news' && !/^news-[a-z0-9]+$/.test(String(fmc.targetSlug || ''))) {
      errors.push(`${rel}: a news comment targetSlug must be "news-<hash>" (the hashed news guid; see newsTargetSlug). See SOW-046 D.`);
    }
    // A comment's audience is its author's choice (owner, 2026-09-11; SOW-044's "public only as an intro" rule
    // ended). What still holds is the leak rule and its mirror: a members comment carries its body in an
    // encrypted envelope, never as committed plaintext, and a public comment carries no encryptedBody pointer
    // (a stale .enc beside a public stub is a half-flip: the body would render from the plaintext while the old
    // ciphertext lingers in the tree).
    if (type === 'comment') {
      const cvis = fmc.visibility ?? 'members';
      if (cvis === 'public' && fmc.encryptedBody) {
        errors.push(`${rel}: a public comment must not carry an encryptedBody pointer (a members->public flip must delete the old .enc in the same change).`);
      }
      if (cvis === 'members' && bodyOf(txt).trim() && !fmc.encryptedBody) {
        errors.push(`${rel}: a members-only comment must encrypt its body to an encryptedBody .enc, never commit plaintext. Publish via the client. See SOW-044.`);
      }
    }
  }
}

const has = (p) => fs.existsSync(p);
// sow-158: recursive file list (for the member .mdx ban). Small trees only (one member folder at a time).
function* walkFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else yield p;
  }
}
function eachSlug(base, owner) {
  for (const sub of ['posts', 'projects', 'products', 'prompts']) {
    const dir = path.join(base, sub);
    if (!has(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const idx = path.join(dir, slug, 'index.md');
      if (has(idx)) checkContent(idx, owner, sub.slice(0, -1));
    }
  }
}

// house = org content (no per-author scoping)
eachSlug(path.join(ROOT, 'house'), null);
// SOW-022: applets are a SUPERADMIN-only content type, GBTI-only (house/applets/<slug>/index.md). Validate
// like a project (author scoping null, categories, slug). Members cannot author them (checked below).
const houseApplets = path.join(ROOT, 'house/applets');
if (has(houseApplets)) for (const slug of fs.readdirSync(houseApplets)) {
  const idx = path.join(houseApplets, slug, 'index.md');
  if (has(idx)) checkContent(idx, null, 'applet');
}
for (const page of has(path.join(ROOT, 'house/pages')) ? fs.readdirSync(path.join(ROOT, 'house/pages')) : []) {
  if (page.endsWith('.md')) checkContent(path.join(ROOT, 'house/pages', page), null, 'page');
}
// house/comments: GBTI's own comments (e.g. the from-the-author intro on house projects/prompts). Author must be `gbti`.
// house/comments: GBTI-hosted comments (e.g. the from-the-author intro on house projects/prompts). The
// author is the content owner (which may be a member handle like atwellpub now, not only `gbti`), so no
// fixed-author scoping here; house is admin-owned (CODEOWNERS) and ungated.
const houseComments = path.join(ROOT, 'house/comments');
if (has(houseComments)) for (const c of fs.readdirSync(houseComments)) if (c.endsWith('.md')) checkContent(path.join(houseComments, c), null, 'comment');

// members = scoped to <username>
const membersDir = path.join(ROOT, 'members');
if (has(membersDir)) {
  for (const user of fs.readdirSync(membersDir)) {
    const base = path.join(membersDir, user);
    if (!fs.statSync(base).isDirectory()) continue;
    eachSlug(base, user);
    // SOW-022: applets are superadmin-only. A member must never publish one; they link out from a project instead.
    if (has(path.join(base, 'applets'))) errors.push(`members/${user}/applets/: applets are a superadmin-only content type (SOW-022); members link out from a project instead`);
    // sow-158: member content is .md ONLY. MDX runs through a different pipeline than the sanitized
    // markdown config, so a member .mdx would be an unsanitized-HTML bypass; the collections no longer
    // load it, and this error gives the PR a clear message instead of a silently unrendered file.
    for (const f of walkFiles(base)) {
      if (f.endsWith('.mdx')) errors.push(`${path.relative(ROOT, f)}: .mdx is not allowed in member folders (sow-158); use .md`);
    }
    const profile = path.join(base, 'profile.md');
    if (has(profile)) {
      const ptxt = fs.readFileSync(profile, 'utf8');
      const u = field(ptxt, 'username');
      if (u && u !== user) errors.push(`members/${user}/profile.md: username "${u}" must equal the folder name "${user}"`);
      const av = field(ptxt, 'avatar');
      if (!isSanctionedAvatar(av)) errors.push(`members/${user}/profile.md: avatar "${av}" must be an https GitHub or Gravatar image URL; external image links are not allowed (SOW-129).`);
    }
    const comments = path.join(base, 'comments');
    if (has(comments)) for (const c of fs.readdirSync(comments)) if (c.endsWith('.md')) checkContent(path.join(comments, c), user, 'comment');
    // SOW-018: member Shares (status updates) live one-file-per in members/<user>/shares/. Author-scoped to
    // the folder owner, gated like comments (a members Share encrypts its body to .enc, no marker leak).
    const shares = path.join(base, 'shares');
    if (has(shares)) for (const s of fs.readdirSync(shares)) if (s.endsWith('.md')) checkContent(path.join(shares, s), user, 'share');
  }
}

// SOW-024: favorites.yml is RETIRED. Favorites moved off the immutable public repo onto the deletable edge
// store (Cloudflare KV), keyed by github_id, so a member's right-to-erasure is a hard delete. The public site
// only ever sees the member-identity-free aggregate in house/favorite-counts.yml (synced from KV by reconcile).
// A members/*/favorites.yml committed to git is therefore an error: it would put who-favorited-what back into
// immutable history. This guard prevents the git path (SOW-013) from being reintroduced.
if (has(membersDir)) {
  for (const user of fs.readdirSync(membersDir)) {
    const fav = path.join(membersDir, user, 'favorites.yml');
    if (has(fav)) {
      errors.push(`${path.relative(ROOT, fav)}: favorites.yml is retired (SOW-024). Favorites live in the edge store (KV), not git; remove this file.`);
    }
  }
}

// SOW-014: a published project/prompt requires a from-the-author introduction comment (a published
// comment by the content author targeting it). Enforced ONLY over the files changed in the PR
// (CHANGED_FILES, set by .github/workflows/content-check.yml), so already-published content is
// grandfathered and local full-repo runs skip it. The metadata-only merge gate is unchanged.
function buildCommentIndex() {
  const files = [];
  const hc = path.join(ROOT, 'house/comments');
  if (has(hc)) for (const f of fs.readdirSync(hc)) if (f.endsWith('.md')) files.push(path.join(hc, f));
  if (has(membersDir)) for (const u of fs.readdirSync(membersDir)) {
    const cd = path.join(membersDir, u, 'comments');
    if (fs.existsSync(cd) && fs.statSync(path.join(membersDir, u)).isDirectory()) {
      for (const f of fs.readdirSync(cd)) if (f.endsWith('.md')) files.push(path.join(cd, f));
    }
  }
  // `${targetType}:${targetSlug}` -> Map(author -> count of published, non-empty, authorNote-flagged comments).
  // SOW-014: only a comment the author DELIBERATELY flagged `authorNote: true` is the from-the-author note;
  // an ordinary conversational comment by the same author no longer satisfies the requirement.
  const idx = new Map();
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(txt) || {};
    const body = txt.replace(/^---\n[\s\S]*?\n---/, '').trim();
    if (!fm.targetType || !fm.targetSlug || !fm.author || !body) continue;
    if ((fm.status ?? 'published') !== 'published') continue;
    if (fm.authorNote !== true) continue;
    const key = `${fm.targetType}:${fm.targetSlug}`;
    if (!idx.has(key)) idx.set(key, new Map());
    const byAuthor = idx.get(key);
    byAuthor.set(fm.author, (byAuthor.get(fm.author) ?? 0) + 1);
  }
  return idx;
}

function validateAuthorIntro() {
  const raw = (process.env.CHANGED_FILES || '').trim();
  if (!raw) return; // no PR diff => grandfather existing content (local + push runs skip this rule)
  const changed = raw.split(/\s+/).filter(Boolean);
  const idx = buildCommentIndex();
  for (const rel of changed) {
    const m = /^(?:house|members\/[^/]+)\/(projects|prompts)\/[^/]+\/index\.md$/.exec(rel.replace(/^\.?\//, ''));
    if (!m) continue;
    const type = m[1].slice(0, -1); // 'project' | 'prompt'
    const abs = path.join(ROOT, rel);
    if (!has(abs)) continue; // deleted in the PR
    const txt = fs.readFileSync(abs, 'utf8');
    if (field(txt, 'status') !== 'published') continue; // only published content needs an intro
    const author = field(txt, 'author');
    const slug = field(txt, 'slug');
    const count = idx.get(`${type}:${slug}`)?.get(author) ?? 0;
    if (!author || count < 1) {
      errors.push(`${rel}: a published ${type} requires a from-the-author note by "${author}" in the same pull request (a published comment with authorNote: true, targetType:${type}, targetSlug:${slug}). See SOW-014.`);
    }
  }
  // Exactly one author note per target+author: a changed comment flagged `authorNote` must not collide with another.
  const reported = new Set();
  for (const rel of changed) {
    const cm = /^(?:house|members\/[^/]+)\/comments\/[^/]+\.mdx?$/.exec(rel.replace(/^\.?\//, ''));
    if (!cm) continue;
    const abs = path.join(ROOT, rel);
    if (!has(abs)) continue;
    const fm = frontmatter(fs.readFileSync(abs, 'utf8')) || {};
    if (fm.authorNote !== true) continue;
    const key = `${fm.targetType}:${fm.targetSlug}`;
    const dupKey = `${key}:${fm.author}`;
    if ((idx.get(key)?.get(fm.author) ?? 0) > 1 && !reported.has(dupKey)) {
      reported.add(dupKey);
      errors.push(`${rel}: more than one from-the-author note (authorNote: true) by "${fm.author}" targets ${fm.targetType}:${fm.targetSlug}. Exactly one is allowed; edit the existing note instead. See SOW-014.`);
    }
  }
}
validateAuthorIntro();

// SOW-100 tag policy (2026-07-08): tags are DASH-CONNECTED going forward. Diff-scoped like the intro check,
// so existing content is grandfathered; the client normalizes member input at build time, making this the
// backstop for hand-authored PRs.
function validateTagShape() {
  const raw = (process.env.CHANGED_FILES || '').trim();
  if (!raw) return;
  const TAG_RE = /^[a-z0-9][a-z0-9.-]*$/;
  const errors = [];
  for (const rel of raw.split(/[\s,]+/).filter(Boolean)) {
    // sow-303: SHARES join the check. They were exempt because their path has a different shape (one flat
    // file, not a folder with an index.md), not because a share's tags were meant to be unpoliced. They are
    // now generated programmatically from an AI suggestion, so the backstop matters more than it did when
    // every share tag was hand-typed by the one person who knew the rule.
    const isContentItem = /^(members\/[^/]+|house)\/(posts|projects|products|prompts)\/[^/]+\/index\.md$/.test(rel);
    const isShare = /^members\/[^/]+\/shares\/[^/]+\.md$/.test(rel);
    if (!isContentItem && !isShare) continue;
    let fm;
    try { fm = yaml.load((/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(ROOT, rel), 'utf8')) || [])[1] || '') || {}; } catch { continue; }
    for (const t of Array.isArray(fm.tags) ? fm.tags : []) {
      if (!TAG_RE.test(String(t))) errors.push(`${rel}: tag "${t}" must be dash-connected (lowercase letters, digits, dots, hyphens)`);
    }
  }
  if (errors.length) {
    console.error(`\n✗ tag shape check failed (${errors.length}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exitCode = 1;
  }
}
validateTagShape();

// sow-364 (2026-09-18): a share note and an author note reach the site with no tracking parameters on their
// links. The client strips them at the publish chokepoints, so this is the backstop for a body that arrives
// another way: a hand-written pull request, or an agent writing files straight into the repository, which is
// how the three that shipped got in. Diff-scoped like the rules above, so existing content is grandfathered.
//
// THE RULE IS THE FUNCTION, not a pattern of its own. Anything stripTrackingParamsInText deliberately leaves
// alone (a url inside a code fence, a url whose parentheses cut the run short) is something this cannot then
// reject, so a body the client cannot clean can never be refused here either.
function validateBodyTracking() {
  const raw = (process.env.CHANGED_FILES || '').trim();
  if (!raw) return;
  const found = [];
  for (const rel of raw.split(/[\s,]+/).filter(Boolean)) {
    const isShare = /^members\/[^/]+\/shares\/[^/]+\.md$/.test(rel);
    const isComment = /^(?:house|members\/[^/]+)\/comments\/[^/]+\.mdx?$/.test(rel);
    if (!isShare && !isComment) continue;
    const abs = path.join(ROOT, rel);
    if (!has(abs)) continue; // deleted in the PR
    const txt = fs.readFileSync(abs, 'utf8');
    const body = txt.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const cleaned = stripTrackingParamsInText(body);
    if (cleaned === body) continue;
    const urls = (t) => new Set((t.match(/https?:\/\/[^\s<>"'`)\]]+/g) || []).map((u) => u.replace(/[.,;:!?*_~]+$/, '')));
    const before = urls(body);
    const after = urls(cleaned);
    const changed = [...before].filter((u) => !after.has(u));
    found.push(`${rel}: a link carries a tracking parameter: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` (+${changed.length - 3} more)` : ''}`);
  }
  if (found.length) {
    errors.push(...found.map((f) => f + '. Publish through the client, or strip the parameter by hand. See sow-364.'));
  }
}
validateBodyTracking();

// The house/*.yml settings files (role and ban grants, channel maps, the tool and licence lists, tiers, CTAs
// and the rest) are checked by scripts/lib/validate-house-config.mjs, moved out of this file when it passed 900
// lines. Same checks, run at the same point, reporting into the same list.
validateHouseConfig({ root: ROOT, errors, aiToolsDoc: AI_TOOLS_DOC, licensesDoc: LICENSES_DOC });

// sow-207 QA (2026-08-11): a taxonomy PRIMARY with no matching follow topic.
//
// SOW-080 split the flat follow vocabulary (house/topics.yml) away from the content taxonomy
// (house/taxonomy.yml) so the follow list could grow without re-tagging content. That split is correct and
// stays. What it lacked was any check in the OTHER direction, and the cost was concrete: `entertainment` was a
// taxonomy primary and gaming's PARENT from the very first commit, house/topics.yml was hand-authored two weeks
// later without it, and for two months members were offered the child topic but never the parent. Nothing
// noticed, because the only existing rule runs topic-map -> topics.yml.
//
// A WARNING, not an error, deliberately. The legitimate answer is sometimes "this category is structural and
// nobody should follow it" (see STRUCTURAL below), and categories are added through the admin Categories screen
// as a house PR, so a hard failure would block the owner's own UI flow on a curation question. This surfaces the
// gap on every run and leaves the judgement where it belongs.
const STRUCTURAL_PRIMARIES = new Set(['gbti', 'blog']); // filing buckets, not interests: no follow topic wanted
const topicGaps = Object.keys(TAXONOMY)
  .filter((k) => !STRUCTURAL_PRIMARIES.has(k) && !TOPIC_KEYS.has(k));

// SOW-076 Phase 3: `--json` emits the errors as machine-readable JSON (for the post-publish remediation), while the
// exit code is unchanged. The default human output is untouched.
const JSON_OUT = process.argv.includes('--json');
if (topicGaps.length && !JSON_OUT) {
  console.warn(`! ${topicGaps.length} taxonomy primar${topicGaps.length === 1 ? 'y has' : 'ies have'} no follow topic in house/topics.yml:`);
  for (const k of topicGaps) console.warn(`  - ${k}: members can file content here but cannot follow it. Add it to house/topics.yml, or to STRUCTURAL_PRIMARIES if it is a filing bucket.`);
}
if (errors.length) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, errors }));
  else {
    console.error(`✗ content validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error('  - ' + e);
  }
  process.exit(1);
}
if (JSON_OUT) console.log(JSON.stringify({ ok: true, errors: [] }));
else {
  // sow-165: say what the body-image rule actually looked at. A rule that inspected nothing reports "passed"
  // exactly like one that inspected everything, and a zero here would mean the scan is pointed at the wrong
  // thing (an empty bodyOf, a changed call site) rather than that the content is clean.
  console.log(`· body-image references checked: ${bodyImageStats.refs} across ${bodyImageStats.files} items.`);
  console.log('✓ content validation passed (author scoping, unique slugs, valid status/visibility, canonical categories)');
}

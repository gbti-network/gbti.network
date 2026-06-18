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
import { isImageGenTarget } from '../client/src/image-models.mjs';
import { membersIndexFromParsed, overrideConsistencyErrors } from '../membership/overrides-core.mjs';
import { validateNewsChannels } from '../membership/news-channels.mjs'; // SOW-043: the news-category -> Discord channel map

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const errors = [];
const slugs = { post: new Map(), product: new Map(), prompt: new Map(), applet: new Map() };

// SOW-007/008 delegation caps (mirror membership/distribution.mjs + content.config.ts). Defense-in-depth:
// the Zod schema already bounds these at build time, but delegation is a money field so CI rejects an
// out-of-range value explicitly (a member cannot delegate more of their commission than the caps allow).
const DELEGATION_CAPS = { contributions: 0.07, comments: 0.03 };

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

function validCategoryPath(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return true; // uncategorized is allowed
  let level = TAXONOMY;
  for (const seg of arr) {
    if (!level || !level[seg]) return false;
    level = level[seg].children;
  }
  return true;
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

/** Validate the optional delegation object against the 7%/3% caps. Adds an error per out-of-range share. */
function checkDelegation(fm, rel) {
  const d = fm?.delegation;
  if (d == null) return; // absent => owner keeps 100% (the default)
  if (typeof d !== 'object' || Array.isArray(d)) {
    errors.push(`${rel}: delegation must be an object { contributions, comments }`);
    return;
  }
  for (const [key, cap] of Object.entries(DELEGATION_CAPS)) {
    if (d[key] == null) continue;
    const v = Number(d[key]);
    if (!Number.isFinite(v) || v < 0 || v > cap) {
      errors.push(`${rel}: delegation.${key} must be a number in [0, ${cap}] (got ${JSON.stringify(d[key])})`);
    }
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
  const slug = field(txt, 'slug');
  if (slug && slugs[type]) {
    if (slugs[type].has(slug)) errors.push(`${rel}: duplicate ${type} slug "${slug}" (already used by ${slugs[type].get(slug)})`);
    else slugs[type].set(slug, rel);
  }
  const bodyOf = (t) => t.replace(/^---\n[\s\S]*?\n---/, '');
  if (type === 'post' || type === 'product' || type === 'prompt' || type === 'applet') {
    const fm = frontmatter(txt);
    checkDelegation(fm, rel);
    checkCategories(fm, rel);
    checkEncryptedLinks(fm, rel);
    checkMemberGating(fm, rel, bodyOf(txt)); // SOW-016
    // A prompt result image is reserved for image-gen models: reject an `image` unless a target is one.
    if (type === 'prompt' && fm.image && !isImageGenTarget(fm.targets)) {
      errors.push(`${rel}: a prompt "image" is only allowed when one of its targets is an image-gen model (e.g. Nano Banana, MidJourney). See client/src/image-models.mjs.`);
    }
  } else if (type === 'comment' || type === 'share') {
    // SOW-016: encryptedBody resolves to a real v1 envelope + no members-only marker leaks into the body.
    // SOW-018: a Share is gated the same way (a members Share encrypts its body); author scoping above
    // already enforces author === folder owner.
    const fmc = frontmatter(txt) || {};
    checkMemberGating(fmc, rel, bodyOf(txt));
    // SOW-032: a share comment is identified by the composite "<author>/<shareId>" targetSlug (a Share id is a
    // member-scoped timestamp-slug, not globally unique), so it stays unambiguous across members. The
    // from-the-author intro requirement (SOW-014) only targets products/prompts, so a share never demands one.
    if (type === 'comment' && fmc.targetType === 'share' && !/^[a-z0-9][a-z0-9-]*\/[0-9]{14}-[a-z0-9-]+$/.test(String(fmc.targetSlug || ''))) {
      errors.push(`${rel}: a share comment targetSlug must be "<author>/<shareId>" (e.g. alice/20260615120000-x). See SOW-032.`);
    }
    // SOW-044: comments are members-only + encrypted. A `public` comment is allowed ONLY as a from-the-author
    // intro (authorNote:true) on a post/product/prompt; a discussion reply, and ANY comment on a Share, must be
    // members. A members comment must carry its body in an encrypted envelope, never as committed plaintext.
    if (type === 'comment') {
      const cvis = fmc.visibility ?? 'members';
      const isPublicIntro = fmc.authorNote === true && ['post', 'product', 'prompt'].includes(fmc.targetType);
      if (cvis === 'public' && !isPublicIntro) {
        errors.push(`${rel}: a public comment is only allowed as a from-the-author intro (authorNote:true on a post/product/prompt). A discussion comment, and any comment on a share, must be visibility:members. See SOW-044.`);
      }
      if (cvis === 'members' && bodyOf(txt).trim() && !fmc.encryptedBody) {
        errors.push(`${rel}: a members-only comment must encrypt its body to an encryptedBody .enc, never commit plaintext. Publish via the client. See SOW-044.`);
      }
    }
  }
}

const has = (p) => fs.existsSync(p);
function eachSlug(base, owner) {
  for (const sub of ['posts', 'products', 'prompts']) {
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
// like a product (author scoping null, categories, slug). Members cannot author them (checked below).
const houseApplets = path.join(ROOT, 'house/applets');
if (has(houseApplets)) for (const slug of fs.readdirSync(houseApplets)) {
  const idx = path.join(houseApplets, slug, 'index.md');
  if (has(idx)) checkContent(idx, null, 'applet');
}
for (const page of has(path.join(ROOT, 'house/pages')) ? fs.readdirSync(path.join(ROOT, 'house/pages')) : []) {
  if (page.endsWith('.md')) checkContent(path.join(ROOT, 'house/pages', page), null, 'page');
}
// house/comments: GBTI's own comments (e.g. the from-the-author intro on house products/prompts). Author must be `gbti`.
// house/comments: GBTI-hosted comments (e.g. the from-the-author intro on house products/prompts). The
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
    // SOW-022: applets are superadmin-only. A member must never publish one; they link out from a product instead.
    if (has(path.join(base, 'applets'))) errors.push(`members/${user}/applets/: applets are a superadmin-only content type (SOW-022); members link out from a product instead`);
    const profile = path.join(base, 'profile.md');
    if (has(profile)) {
      const u = field(fs.readFileSync(profile, 'utf8'), 'username');
      if (u && u !== user) errors.push(`members/${user}/profile.md: username "${u}" must equal the folder name "${user}"`);
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

// SOW-014: a published product/prompt requires a from-the-author introduction comment (a published
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
    const m = /^(?:house|members\/[^/]+)\/(products|prompts)\/[^/]+\/index\.md$/.exec(rel.replace(/^\.?\//, ''));
    if (!m) continue;
    const type = m[1].slice(0, -1); // 'product' | 'prompt'
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

// Override grants (bans / grandfathered / roles) must reference github_ids consistent with members-index.yml.
// A typo'd or swapped github_id<->login otherwise FAILS CLOSED silently (the wrong id never matches the member,
// so a comp/ban grant just does nothing). Skips ids/logins not in the index (folderless grants + the bot).
function validateOverrideConsistency() {
  const load = (rel) => {
    try { return yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) ?? {}; } catch { return {}; }
  };
  const idx = membersIndexFromParsed(load('house/members-index.yml'));
  if (!idx.size) return; // no members-index yet (pre-M0) -> nothing to check against
  const gf = load('house/grandfathered.yml');
  const bn = load('house/bans.yml');
  const rl = load('house/roles.yml');
  const tag = (list, src) => (Array.isArray(list) ? list : []).map((e) => ({ ...e, _src: src }));
  const entries = [
    ...tag(gf.grandfathered, 'grandfathered.yml'),
    ...tag(bn.bans, 'bans.yml'),
    ...tag(rl.superadmins, 'roles.yml superadmins'),
    ...tag(rl.admins, 'roles.yml admins'),
    ...tag(rl.moderators, 'roles.yml moderators'),
  ];
  for (const err of overrideConsistencyErrors(idx, entries)) errors.push(err);
}
validateOverrideConsistency();

// SOW-043: the news-category -> Discord channel map (house/news-channels.yml). Absent is fine; when present, it
// must be a list of { category, numeric channelId } with no duplicate category (a bad map would silently misroute
// or drop a heart-publish). Pure validation lives in membership/news-channels.mjs.
function validateNewsChannelsConfig() {
  const rel = 'house/news-channels.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateNewsChannels(parsed)) errors.push(err);
}
validateNewsChannelsConfig();

if (errors.length) {
  console.error(`✗ content validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('✓ content validation passed (author scoping, unique slugs, valid status/visibility, canonical categories)');

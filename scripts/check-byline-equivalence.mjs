#!/usr/bin/env node
// sow-215 Check A: does the rendered byline EQUAL the profile it claims to show?
//
// Every other dist guard we have asks whether the output is HAZARDOUS: nothing leaked, the CSP is present,
// nothing overflows, every redirect resolves, a slot is not empty. None of them asks whether the output is
// RIGHT. Defect 1 of sow-215 was exactly that gap: after sow-195 the raw username rendered as the byline on
// 29 published pages, and CI, the full unit suite and a 163-page build all passed, because the HTML was
// well-formed, leaked nothing, overflowed nothing, and was simply wrong.
//
// WHAT THIS PROVES, AND NOTHING BROADER: for the pages that exist in dist/ at the moment it runs, every
// rendered byline matches what the author's profile says their name is. It proves nothing about pages that
// were not built, about drafts, or about any other rendered value. That boundary is the honest scope, not a
// disclaimer.
//
// WHY THERE IS NO COVERAGE ADVISORY, DELIBERATELY. The sibling guard check-article-closing-slot.mjs prints a
// zero-coverage note on every run, and everyone read past it for weeks, which is how the Editorial and Card
// layouts shipped with no live coverage at all. A guard that reports a gap nobody acts on fails more quietly
// than one that goes red. So here, finding NOTHING TO CHECK is a FAILURE, not a note: a run that scanned no
// bylines has proved nothing, and it says so by exiting non-zero.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors src/lib/authors.ts. The two network pseudo-authors render as the brand rather than as a username.
const NETWORK_AUTHORS = new Set(['gbti', 'gbtilabs']);

// Mirrors ContentMeta.astro: `prof?.displayName ?? authorDisplay(author)`.
const expectedName = (username, displayName) =>
  displayName != null && displayName !== ''
    ? displayName
    : (NETWORK_AUTHORS.has(username) ? 'GBTI Network' : username);

const decode = (s) => String(s)
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .trim();

const frontmatterField = (txt, key) => {
  const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(txt);
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '').trim();
};

function walkHtml(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(p, out);
    else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

// Attribute ORDER is not guaranteed across Astro versions, so match the anchor and read its attributes
// rather than pinning `href="..." class="cm-name"` as one literal string.
const ANCHOR = /<a\s([^>]*?)>([\s\S]*?)<\/a>/g;
const HREF = /href="([^"]*)"/;
const MEMBER_HREF = /^\/members\/([^/]+)\/$/;

// sow-215 Check A phase 2: the content-directory -> built-section routes.
//
// THIS MAP IS HAND-MAINTAINED. An earlier version of this comment claimed the guard "demands coverage of a
// fourth content type as soon as content exists", which is FALSE and was caught in review: nothing here
// discovers a new type, and a comment claiming self-extension is worse than no comment because the next
// person trusts it. What the map DOES do is scale coverage to the content that exists: a type listed here
// is only required to prove itself once a member actually has items of it.
//
// `shares` IS ALREADY A FOURTH MEMBER-AUTHORED TYPE ON DISK (three owners have `members/<u>/shares/`) and is
// EXCLUDED DELIBERATELY. Share pages emit member links but no ContentMeta byline at all: measured across the
// built site, ~180 member-href anchors in `shares/` and zero carrying `cm-name`. Requiring it would red on
// every build for a byline that was never there.
//
// SO: if `shares` (or any new type) ever gains a ContentMeta byline, ADD IT HERE. Until someone does, the
// guard will keep silently not checking it, which is this SOW's own partial-rename hole one level up.
const CONTENT_SECTIONS = Object.freeze({ posts: 'articles', projects: 'projects', products: 'projects', prompts: 'prompts' });

/**
 * The built sections that MUST yield at least one checked byline, derived from content on disk.
 *
 * WHY THIS EXISTS. The guard used to fail only when the WHOLE run checked zero bylines, and articles alone
 * keep that non-zero. So a PARTIAL rename passed green: @UnifiedWorker reproduced it by giving a project
 * page a byline class sharing no `cm-name` token, and the guard stayed green because the 50 article bylines
 * carried the run. A per-section floor is what turns that from invisible into red.
 *
 * Derived from the CONTENT rather than from `dist`, deliberately. Most built sections legitimately carry no
 * `ContentMeta` byline at all (measured: feeds, shares, members, account and the standalone pages all emit
 * member links with no `cm-name`), so "every section in dist must yield a byline" would red on ten innocent
 * folders. Only a section whose content type actually exists is required to prove itself. The set of types
 * considered is the hand-maintained CONTENT_SECTIONS above, NOT auto-discovered; see its comment.
 */
function sectionsRequiringBylines(root) {
  const need = new Set();
  const membersDir = path.join(root, 'members');
  const owners = fs.existsSync(membersDir) ? fs.readdirSync(membersDir) : [];
  for (const [dir, section] of Object.entries(CONTENT_SECTIONS)) {
    const anyOwnerHasItems = owners.some((o) => {
      const d = path.join(membersDir, o, dir);
      try { return fs.statSync(d).isDirectory() && fs.readdirSync(d).length > 0; } catch { return false; }
    });
    if (anyOwnerHasItems) need.add(section);
  }
  return need;
}

export function checkBylineEquivalence({ root }) {
  const errors = [];

  // username -> displayName (only for profiles that define one)
  const profiles = new Map();
  const membersDir = path.join(root, 'members');
  for (const owner of (fs.existsSync(membersDir) ? fs.readdirSync(membersDir) : [])) {
    const f = path.join(membersDir, owner, 'profile.md');
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    const username = frontmatterField(txt, 'username') ?? owner;
    profiles.set(username, frontmatterField(txt, 'displayName'));
  }

  const distDir = path.join(root, 'dist');
  const files = walkHtml(distDir);
  let checked = 0;
  const pages = new Set();
  const perSection = new Map(); // built section -> how many bylines it yielded

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(distDir, file);
    ANCHOR.lastIndex = 0;
    let m;
    while ((m = ANCHOR.exec(html)) !== null) {
      const [, attrs, inner] = m;
      // `\b` treats a hyphen as a word boundary, so this matches `cm-name` AND `cm-name-v2` (deliberately
      // tolerant of a suffixed rename) but NOT `byline-name` or `cmname`. Worth knowing before writing a
      // negative fixture: @UnifiedWorker's first attempt to prove the partial-rename hole used `cm-name-v2`
      // and failed because the guard still matched it.
      if (!/class="[^"]*\bcm-name\b[^"]*"/.test(attrs)) continue;
      const href = HREF.exec(attrs)?.[1];
      if (!href) continue;
      const um = MEMBER_HREF.exec(href);
      if (!um) continue; // the retired `gbti` pseudo-author links to `/`, and has no profile to compare against
      const username = um[1];
      if (!profiles.has(username)) continue; // no profile on disk: nothing to be equivalent TO

      checked += 1;
      pages.add(rel);
      const section = rel.split(path.sep)[0];
      perSection.set(section, (perSection.get(section) || 0) + 1);
      const shown = decode(inner.replace(/<[^>]*>/g, ''));
      const expected = expectedName(username, profiles.get(username));
      if (shown !== expected) {
        errors.push(
          `${rel}: byline for author "${username}" renders "${shown}" but the profile says "${expected}"`
        );
      }
    }
  }

  // Zero coverage is a FAILURE, not a note. See the header: a run that checked nothing proved nothing, and
  // an advisory line is exactly how the sibling guard's gap went unnoticed for weeks.
  if (files.length === 0) {
    errors.push('no built HTML found in dist/ -- run the build before this guard, since it can prove nothing without it');
  } else if (checked === 0) {
    errors.push(
      `scanned ${files.length} built page(s) and found ZERO bylines to check, so this guard proved nothing. ` +
      'Either the byline markup changed (the guard keys on class="cm-name" in ContentMeta.astro) or no ' +
      'content detail page was built. Fix the guard or the build; do not ignore this line.'
    );
  }

  // sow-215 Check A phase 2: a per-section floor. The global `checked === 0` above cannot see a PARTIAL
  // rename, because one healthy content type keeps the total non-zero while another silently stops being
  // checked at all. Each content type that has items on disk must prove itself independently.
  for (const section of sectionsRequiringBylines(root)) {
    if ((perSection.get(section) || 0) === 0) {
      errors.push(
        `section "${section}/" has content on disk but yielded ZERO checked bylines, so nothing in it was ` +
        'verified while other sections kept the total non-zero. Either its byline markup changed (the guard ' +
        'keys on class="cm-name" in ContentMeta.astro) or its pages did not build. This is the partial-rename ' +
        'hole; do not silence it by lowering the floor.'
      );
    }
  }

  return { errors, checked, pages: pages.size, files: files.length, perSection };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, checked, pages } = checkBylineEquivalence({ root: ROOT });
  if (errors.length) {
    console.error(`✗ byline equivalence guard FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ byline equivalence guard passed (${checked} byline${checked === 1 ? '' : 's'} across ${pages} page${pages === 1 ? '' : 's'})`);
}

#!/usr/bin/env node
// sow-362 build guard: every /members/<username>/ link in the built site must resolve to a page we actually
// built, so a member's own name never sends a reader to a 404.
//
// WHY THIS EXISTS AS A GUARD AND NOT A NOTE. A member folder is created the moment someone comments, shares or
// publishes; a profile.md is written later, or never. In between, every card naming them linked to a page that
// did not exist. Measured live on 2026-09-18: one comment author on a published prompt page (name and avatar,
// both 404) and one share author (the same, until the share was moved). Nothing failed, nothing warned, and
// the two call sites that DID guard it had each solved it locally without anyone generalising the rule.
//
// src/lib/profile-pages.ts is the fix; this is the backstop that fails the build when a NEW surface renders an
// author link without asking it, which is exactly how the first two got in.
//   node scripts/check-member-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A query or a fragment on the link still resolves to the same page, so they must not hide one: a
// `/members/x/#projects` that the regex skipped would be a 404 this guard reported as fine.
const HREF_RE = /href="\/members\/([^"/?#]+)\/?(?:[?#][^"]*)?"/g;

/** Every built member page, by username: the directories under dist/members that carry an index.html. */
export function builtMemberPages(distDir) {
  const dir = path.join(distDir, 'members');
  if (!fs.existsSync(dir)) return new Set();
  const out = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (fs.existsSync(path.join(dir, name, 'index.html'))) out.add(name);
  }
  return out;
}

/** Walk dist for .html files. */
function htmlFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

/**
 * Check every member link in dist against the pages dist actually holds. Pure over distDir, so it is
 * unit-testable. Returns { errors, notes, checked, pages }.
 */
export function checkMemberLinks({ distDir } = {}) {
  const errors = [];
  const notes = [];
  if (!fs.existsSync(distDir)) {
    errors.push('dist not found, so this guard had no subjects and proved nothing. Run astro build first. Do not ignore this line: a green tick here would have been a pass on nothing (sow-245).');
    return { errors, notes, checked: 0, pages: new Set() };
  }
  const pages = builtMemberPages(distDir);
  if (!pages.size) {
    errors.push('dist/members holds no member pages, so every member link would fail and this guard would be checking a build that never finished (sow-245).');
    return { errors, notes, checked: 0, pages };
  }

  const broken = new Map(); // username -> Set of pages linking it
  let checked = 0;
  for (const file of htmlFiles(distDir)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(HREF_RE)) {
      const username = m[1];
      // "/members/" itself is the directory index, not a member.
      if (!username || username === 'index.html') continue;
      checked += 1;
      if (pages.has(username)) continue;
      const rel = path.relative(distDir, file);
      if (!broken.has(username)) broken.set(username, new Set());
      broken.get(username).add(rel);
    }
  }
  if (!checked) {
    errors.push('no /members/<username>/ link was found anywhere in dist, which cannot be right on a site whose every content card carries a byline. The guard proved nothing (sow-245).');
  }
  for (const [username, files] of [...broken].sort()) {
    const list = [...files].sort();
    const shown = list.slice(0, 6).join(', ');
    errors.push(
      `/members/${username}/ is linked from ${list.length} page(s) and was never built, so every one of those links is a 404: ${shown}${list.length > 6 ? `, and ${list.length - 6} more` : ''}.\n` +
      `      ${username} has content but no published, public profile.md. Link them with profileHref() from src/lib/profile-pages.ts, which returns undefined when there is no page, instead of authorHref().`,
    );
  }
  notes.push(`${checked} member links across ${pages.size} built member pages.`);
  return { errors, notes, checked, pages };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { errors, notes } = checkMemberLinks({ distDir: path.join(root, 'dist') });
  for (const n of notes) console.log(`· ${n}`);
  if (errors.length) {
    console.error('\n✗ member-link guard failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('✓ member-link guard passed (every member link resolves to a built page)');
}

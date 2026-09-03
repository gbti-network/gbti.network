#!/usr/bin/env node
// sow-196: rewrite content items for a CONTENT-TYPE RENAME (product -> project).
//
// Modelled on scripts/migrate-category.mjs (SOW-055/SOW-100): a full-clone scan that sees drafts, a dry run
// by default, and one atomic set of edits. It does NOT open a PR: a type rename lands with the code change
// that serves it, so it travels as one ordinary commit rather than as a content-only auto-merge.
//
// Two edits per item, both deliberately TEXTUAL rather than a YAML round trip, so the file is byte-identical
// apart from the two lines. Re-serializing would reflow the curated inline `links:` entries and turn a
// reviewable two-line diff into a whole-file rewrite.
//
//   1. `type: <old>`  ->  `type: <new>`
//   2. append `<oldUrlBase>/<slug>/` to `redirectFrom`, which does DOUBLE duty:
//        - scripts/compose-redirects.mjs turns it into the 301 at build time, and
//        - scripts/enqueue-syndication.mjs reads it as its rename marker (RENAME_MARK_RE) and therefore
//          SKIPS the item. Without it the folder move reads as 11 brand-new publishes and re-announces every
//          one of them to Discord, X, LinkedIn and dev.to.
//
//   node scripts/migrate-type-rename.mjs           # dry run, prints the plan
//   node scripts/migrate-type-rename.mjs --apply   # write the files
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');

// The rename this script performs. `dir` is the on-disk folder name, which the caller moves separately.
const RENAME = { fromType: 'product', toType: 'project', fromDir: 'products', toDir: 'projects', oldUrlBase: '/products' };

/** Every index.md under house/ and each member folder, for the given content subdirectory, published or draft. */
export function scanItems(root, dir) {
  const bases = [path.join(root, 'house', dir)];
  const membersDir = path.join(root, 'members');
  if (fs.existsSync(membersDir)) {
    for (const user of fs.readdirSync(membersDir)) {
      if (user.startsWith('.')) continue;
      bases.push(path.join(membersDir, user, dir));
    }
  }
  const out = [];
  for (const base of bases) {
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
    for (const slug of fs.readdirSync(base)) {
      const file = path.join(base, slug, 'index.md');
      if (fs.existsSync(file)) out.push({ file, slug, rel: path.relative(root, file).split(path.sep).join('/') });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Pure: rewrite one item's text. Returns { text, changedType, addedRedirect }. Idempotent, so a second run
 * over an already-migrated file reports no changes rather than appending a duplicate redirect entry.
 */
export function rewriteItem(text, { slug, fromType, toType, oldUrlBase }) {
  const lines = String(text).split('\n');
  if (lines[0] !== '---') throw new Error('no frontmatter');
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---') { end = i; break; }
  if (end === -1) throw new Error('unterminated frontmatter');

  let changedType = false;
  for (let i = 1; i < end; i++) {
    if (lines[i] === `type: ${fromType}`) { lines[i] = `type: ${toType}`; changedType = true; break; }
  }

  const oldUrl = `${oldUrlBase}/${slug}/`;
  const fm = lines.slice(1, end).join('\n');
  let addedRedirect = false;
  if (!fm.includes(oldUrl)) {
    const at = lines.findIndex((l, i) => i > 0 && i < end && /^redirectFrom:/.test(l));
    if (at === -1) {
      // No redirectFrom yet: add the block at the end of the frontmatter.
      lines.splice(end, 0, 'redirectFrom:', `  - "${oldUrl}"`);
    } else if (/^redirectFrom:\s*\[\s*\]\s*$/.test(lines[at])) {
      lines[at] = 'redirectFrom:';
      lines.splice(at + 1, 0, `  - "${oldUrl}"`);
    } else {
      lines.splice(at + 1, 0, `  - "${oldUrl}"`);
    }
    addedRedirect = true;
  }
  return { text: lines.join('\n'), changedType, addedRedirect };
}

export function main({ root = ROOT, apply = APPLY, rename = RENAME } = {}) {
  // Scan the NEW dir first (the folder move runs before this); fall back to the old one for a pre-move run.
  let items = scanItems(root, rename.toDir);
  const scannedDir = items.length ? rename.toDir : rename.fromDir;
  if (!items.length) items = scanItems(root, rename.fromDir);

  console.log(`migrate-type-rename: ${rename.fromType} -> ${rename.toType}, scanning ${scannedDir}/ (${items.length} item(s))${apply ? '' : ' [DRY RUN]'}`);
  let changed = 0;
  for (const it of items) {
    const before = fs.readFileSync(it.file, 'utf8');
    const { text, changedType, addedRedirect } = rewriteItem(before, { slug: it.slug, ...rename });
    if (!changedType && !addedRedirect) { console.log(`  ok (already migrated): ${it.rel}`); continue; }
    changed++;
    const what = [changedType ? 'type' : null, addedRedirect ? `redirectFrom += ${rename.oldUrlBase}/${it.slug}/` : null].filter(Boolean).join(', ');
    console.log(`  ${apply ? 'write' : 'would write'}: ${it.rel}  (${what})`);
    if (apply) fs.writeFileSync(it.file, text);
  }
  console.log(`${changed} item(s) ${apply ? 'rewritten' : 'would change'}.`);
  return { scanned: items.length, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) main();

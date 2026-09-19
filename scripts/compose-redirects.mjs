#!/usr/bin/env node
// SOW-112: compose the SERVED redirect file. `public/_redirects` stays the committed legacy base (its
// generator needs the gitignored migration CSV, unavailable in CI); this script APPENDS the
// frontmatter-driven lines — every published item's `redirectFrom` entries 301 to the item's current URL —
// and writes the composed result to `dist/_redirects` AFTER the Astro build (which copied the committed base
// there). Visibility-aware like gen-redirects: a non-public destination retargets to /membership/ so a rename
// of a Mode A item never 301s to a 404. Dedupe by SOURCE, committed lines win (a legacy CSV row for the same
// old path keeps its curated destination). Runs in build:pages between `astro build` and verify:dist.
//   node scripts/compose-redirects.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SEG = { posts: 'articles', projects: 'projects', products: 'projects', prompts: 'prompts' };
const MEMBERSHIP = '/membership/';

/** Parse the leading YAML frontmatter block, or null. Never throws. */
function frontmatter(txt) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(txt || ''));
  if (!m) return null;
  try {
    const doc = yaml.load(m[1]);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

/** Walk the house and per-member content trees and collect every item's redirect facts. */
export function scanContent(root = ROOT) {
  const items = [];
  const scanBase = (baseDir) => {
    for (const [sub, seg] of Object.entries(SEG)) {
      const dir = path.join(baseDir, sub);
      if (!fs.existsSync(dir)) continue;
      for (const slugDir of fs.readdirSync(dir)) {
        const idx = path.join(dir, slugDir, 'index.md');
        if (!fs.existsSync(idx)) continue;
        const fm = frontmatter(fs.readFileSync(idx, 'utf8'));
        if (!fm) continue;
        items.push({
          seg,
          slug: String(fm.slug ?? slugDir),
          status: String(fm.status ?? 'draft'),
          visibility: String(fm.visibility ?? 'public'),
          publicStub: fm.publicStub === true,
          redirectFrom: Array.isArray(fm.redirectFrom) ? fm.redirectFrom.filter((x) => typeof x === 'string') : [],
        });
      }
    }
  };
  // sow-365: a SHARE's public url carries its author (/shares/<author>/<id>/), so moving a share to another
  // member retires the old url exactly as a rename retires a slug. Shares are flat files rather than a folder
  // with an index.md, and their destination is two segments, so they carry their own `dest` rather than a
  // seg/slug pair.
  const scanShares = (user, baseDir) => {
    const dir = path.join(baseDir, 'shares');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!fm) continue;
      const redirectFrom = Array.isArray(fm.redirectFrom) ? fm.redirectFrom.filter((x) => typeof x === 'string') : [];
      if (!redirectFrom.length) continue;
      const id = String(fm.id ?? f.replace(/\.md$/, ''));
      items.push({
        seg: 'shares',
        slug: id,
        dest: `/shares/${String(fm.author ?? user)}/${id}/`,
        status: String(fm.status ?? 'draft'),
        visibility: String(fm.visibility ?? 'members'),
        publicStub: fm.publicStub === true,
        redirectFrom,
      });
    }
  };
  scanBase(path.join(root, 'house'));
  const membersDir = path.join(root, 'members');
  if (fs.existsSync(membersDir)) {
    for (const u of fs.readdirSync(membersDir)) {
      const b = path.join(membersDir, u);
      try { if (!fs.statSync(b).isDirectory()) continue; } catch { continue; }
      scanBase(b);
      scanShares(u, b);
    }
  }
  return items;
}

/**
 * Compose the served _redirects text: the committed base verbatim, then one line per frontmatter redirect
 * entry. Committed sources win; duplicate frontmatter sources keep the first; a self-redirect is dropped.
 * Pure over (committedText, items) so it unit-tests without a repo.
 */
export function composeRedirects(committedText, items) {
  const lines = String(committedText || '').replace(/\s+$/, '').split('\n');
  const taken = new Set(
    lines
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => l.trim().split(/\s+/)[0]),
  );
  const added = [];
  for (const it of items) {
    if (it.status !== 'published' || !it.redirectFrom.length) continue;
    const isPublic = it.visibility === 'public' || it.publicStub;
    // An item may name its own destination (a share, whose url carries the author as well as the id). A
    // non-public destination still retargets to /membership/ rather than 301-ing to a page that is not built.
    const dest = isPublic ? (it.dest || `/${it.seg}/${it.slug}/`) : MEMBERSHIP;
    for (const src of it.redirectFrom) {
      const from = String(src).trim();
      if (!from.startsWith('/') || from === dest || taken.has(from)) continue;
      taken.add(from);
      added.push(`${from} ${dest} 301`);
    }
  }
  const out = [...lines];
  if (added.length) {
    out.push('# SOW-112: frontmatter redirectFrom entries (composed by scripts/compose-redirects.mjs at build).');
    out.push(...added.sort());
  }
  return { text: out.join('\n') + '\n', added: added.length };
}

export function main({ root = ROOT } = {}) {
  const committedFile = path.join(root, 'public/_redirects');
  const committed = fs.existsSync(committedFile) ? fs.readFileSync(committedFile, 'utf8') : '';
  const { text, added } = composeRedirects(committed, scanContent(root));
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('compose-redirects: dist/ is missing; run `astro build` first.');
    process.exitCode = 1;
    return { added: 0 };
  }
  fs.writeFileSync(path.join(distDir, '_redirects'), text);
  console.log(`compose-redirects: wrote dist/_redirects (${added} frontmatter redirect(s) appended to the committed base).`);
  return { added };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

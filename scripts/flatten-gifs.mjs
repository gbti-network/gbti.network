#!/usr/bin/env node
// INTERIM media fix (SOW-001): replace heavy animated GIFs in migrated content with a static
// first-frame .webp so nothing in the repo is multi-megabyte while we iterate. Updates the
// referencing index.md (coverImage + body). Full handling (YouTube/Vimeo embed or optimized
// loop + CI size cap) is the Phase-5 media pass per content-schemas.md.
//   node scripts/flatten-gifs.mjs          # dry run
//   node scripts/flatten-gifs.mjs --write  # convert + rewrite refs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const ROOTS = ['house/posts', 'members'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.gif')) out.push(p);
  }
  return out;
}

const gifs = ROOTS.flatMap((r) => walk(path.join(ROOT, r)));
let reclaimed = 0;
const rows = [];
for (const gif of gifs) {
  const before = fs.statSync(gif).size;
  const webp = gif.replace(/\.gif$/i, '.webp');
  if (WRITE) {
    await sharp(gif, { limitInputPixels: false, animated: false }) // first frame only
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(webp);
    fs.rmSync(gif);
    // rewrite references in the post's index.md (coverImage + body)
    const postDir = path.dirname(path.dirname(gif)); // <slug>/images/foo.gif → <slug>
    const md = path.join(postDir, 'index.md');
    if (fs.existsSync(md)) {
      const txt = fs.readFileSync(md, 'utf8').split(path.basename(gif)).join(path.basename(webp));
      fs.writeFileSync(md, txt);
    }
  }
  const after = WRITE ? fs.statSync(webp).size : 0;
  reclaimed += before - after;
  rows.push({ file: path.basename(gif), before: `${(before / 1e6).toFixed(2)}MB`, after: WRITE ? `${Math.round(after / 1e3)}KB` : '—' });
}
console.log(`${WRITE ? 'FLATTENED' : 'DRY RUN'} ${gifs.length} GIF(s); ${WRITE ? `reclaimed ~${(reclaimed / 1e6).toFixed(1)}MB` : 'run with --write to convert'}`);
console.table(rows);

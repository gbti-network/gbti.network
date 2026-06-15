#!/usr/bin/env node
// Optimize committed content images to keep the public repo lean (content-schemas.md media policy:
// web formats, size-capped). Converts raster images (png/jpg/jpeg) to webp, resized to a max width,
// and rewrites the references in each item's index.md (coverImage, body, icon, banner, gallery).
// Per-item so reference rewrites stay local. Idempotent (already-webp images are skipped).
//   node scripts/optimize-images.mjs          # dry run (size estimate)
//   node scripts/optimize-images.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const MAX_W = 1600;
const QUALITY = 80;

// Find every content item folder that has an index.md + images/.
function itemDirs() {
  const out = [];
  const scan = (base) => {
    if (!fs.existsSync(base)) return;
    for (const slug of fs.readdirSync(base)) {
      const dir = path.join(base, slug);
      if (fs.existsSync(path.join(dir, 'index.md')) && fs.existsSync(path.join(dir, 'images'))) out.push(dir);
    }
  };
  scan(path.join(ROOT, 'house/posts'));
  scan(path.join(ROOT, 'house/products'));
  const members = path.join(ROOT, 'members');
  if (fs.existsSync(members)) for (const u of fs.readdirSync(members)) scan(path.join(members, u, 'posts'));
  return out;
}

let before = 0;
let after = 0;
let converted = 0;
for (const dir of itemDirs()) {
  const imagesDir = path.join(dir, 'images');
  const md = path.join(dir, 'index.md');
  let txt = fs.readFileSync(md, 'utf8');
  let changed = false;
  for (const file of fs.readdirSync(imagesDir)) {
    const src = path.join(imagesDir, file);
    if (!/\.(png|jpe?g)$/i.test(file)) { before += fs.existsSync(src) ? fs.statSync(src).size : 0; after += before && 0; continue; }
    const sz = fs.statSync(src).size;
    before += sz;
    const outName = file.replace(/\.(png|jpe?g)$/i, '.webp');
    try {
      const buf = await sharp(src, { limitInputPixels: false }).rotate().resize({ width: MAX_W, withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
      after += buf.length;
      converted++;
      if (WRITE) {
        fs.writeFileSync(path.join(imagesDir, outName), buf);
        fs.rmSync(src);
        txt = txt.split(file).join(outName); // rewrite refs (coverImage, body, icon, banner, gallery)
        changed = true;
      }
    } catch {
      after += sz; // leave as-is on failure
    }
  }
  if (WRITE && changed) fs.writeFileSync(md, txt);
}

console.log(`${WRITE ? 'OPTIMIZED' : 'DRY RUN'}: ${converted} raster image(s) -> webp; ${(before / 1e6).toFixed(0)}MB -> ${(after / 1e6).toFixed(0)}MB`);

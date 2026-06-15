#!/usr/bin/env node
// Localize gbti.network CDN images that were missing from the offline archive (so they do not 404
// after WordPress is cancelled). Fetches each remaining absolute gbti.network image from the live
// site into the referencing post's images/ folder and rewrites the body reference to a relative
// path. GIFs are converted to a static first-frame webp. Run AFTER migration.
//   node scripts/fetch-missing-images.mjs          # dry run
//   node scripts/fetch-missing-images.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (compatible; GBTI-migration/1.0)';
const RE = /https?:\/\/[^)"\s]*gbti\.network\/wp-content\/[^)"\s]*\.(?:jpg|jpeg|png|webp|gif|svg)/gi;

function findIndexFiles() {
  const out = [];
  const roots = [path.join(ROOT, 'house/posts')];
  const membersDir = path.join(ROOT, 'members');
  if (fs.existsSync(membersDir)) for (const u of fs.readdirSync(membersDir)) roots.push(path.join(membersDir, u, 'posts'));
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.md') out.push(p);
    }
  };
  roots.forEach(walk);
  return out;
}

const rows = [];
let fetched = 0;
let failed = 0;
for (const file of findIndexFiles()) {
  let content = fs.readFileSync(file, 'utf8');
  const urls = [...new Set(content.match(RE) || [])];
  if (!urls.length) continue;
  const imagesDir = path.join(path.dirname(file), 'images');

  for (const url of urls) {
    const base = decodeURIComponent(url.split('?')[0].split('/').pop());
    const isGif = /\.gif$/i.test(base);
    const outName = isGif ? base.replace(/\.gif$/i, '.webp') : base;
    rows.push({ post: path.basename(path.dirname(file)), img: base, to: outName });
    if (!WRITE) continue;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.mkdirSync(imagesDir, { recursive: true });
      if (isGif) {
        await sharp(buf, { limitInputPixels: false, animated: false }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(imagesDir, outName));
      } else {
        fs.writeFileSync(path.join(imagesDir, outName), buf);
      }
      content = content.split(url).join(`./images/${outName}`);
      fetched++;
    } catch (err) {
      console.error(`  ! failed ${url}: ${err.message}`);
      failed++;
    }
  }
  if (WRITE) fs.writeFileSync(file, content);
}

console.log(`${WRITE ? 'FETCHED' : 'DRY RUN'} ${WRITE ? fetched : rows.length} image(s)${failed ? `, ${failed} failed` : ''}.`);
console.table(rows);

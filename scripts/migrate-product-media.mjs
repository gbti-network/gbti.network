#!/usr/bin/env node
// Migrate product screenshots + a featured-spotlight cover + the demo video into the products, driven by
// per-product manifests produced upstream (.data/legacy/_manifests/<slug>.json). Idempotent.
//   node scripts/migrate-product-media.mjs            # dry run (reports the plan)
//   node scripts/migrate-product-media.mjs --write    # generate images + write frontmatter
//
// For each product the manifest carries: { featuredSource, gallery:[{file,caption}], video }. Sources are
// filenames inside .data/legacy/products/products_<slug>/images/. We:
//   - gallery: optimize each screenshot to webp, <= 1600px long edge, under 1 MB -> images/<slug>-shot-N.webp
//   - featured: letterbox the best source onto a 1280x800 brand-ink canvas -> images/<slug>-featured.webp
//     (option B: the whole source stays visible, the spotlight has no empty bars)
//   - frontmatter: set gallery[], featuredImage, and video (replacing any prior generated values)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const MANIFEST_DIR = path.join(ROOT, '.data/legacy/_manifests');
const legacyImages = (slug) => path.join(ROOT, '.data/legacy/products/products_' + slug, 'images');
const productDir = (slug) => path.join(ROOT, 'house/products', slug);

const FEATURED_W = 1280;
const FEATURED_H = 800;
const INNER_W = 1120; // source occupies an inner box, leaving a uniform brand-ink margin
const INNER_H = 660;
const INK = { r: 0x25, g: 0x23, b: 0x2b, alpha: 1 }; // brand ink #25232b
const MAX_LONG_EDGE = 1600;
const MAX_BYTES = 1024 * 1024;

/** Encode a sharp pipeline to webp under MAX_BYTES, dropping quality if needed. Returns a Buffer. */
async function toWebpUnderCap(pipeline) {
  for (const quality of [82, 74, 66, 58, 50]) {
    const buf = await pipeline.clone().webp({ quality }).toBuffer();
    if (buf.length <= MAX_BYTES) return buf;
  }
  return pipeline.clone().webp({ quality: 44 }).toBuffer();
}

/** Optimize one screenshot to a capped webp. */
async function makeScreenshot(src, dest) {
  const pipe = sharp(src).rotate().resize({
    width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true,
  });
  const buf = await toWebpUnderCap(pipe);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/** Letterbox a source onto a fixed 1280x800 brand-ink canvas (option B featured cover). */
async function makeFeatured(src, dest) {
  const inner = await sharp(src).rotate()
    .resize({ width: INNER_W, height: INNER_H, fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  const pipe = sharp({ create: { width: FEATURED_W, height: FEATURED_H, channels: 4, background: INK } })
    .composite([{ input: inner, gravity: 'center' }]);
  const buf = await toWebpUnderCap(pipe);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/** Drop a single-line `key:` from frontmatter lines. */
function removeKey(lines, key) {
  return lines.filter((l) => !new RegExp('^' + key + ':').test(l));
}
/** Drop a block `key:` line plus its following indented (list/continuation) lines. */
function removeBlockKey(lines, key) {
  const out = [];
  let skipping = false;
  for (const l of lines) {
    if (skipping) {
      if (/^\s/.test(l)) continue; // still inside the block
      skipping = false;
    }
    if (new RegExp('^' + key + ':').test(l)) { skipping = true; continue; }
    out.push(l);
  }
  return out;
}

const rows = [];
const slugs = fs.existsSync(MANIFEST_DIR)
  ? fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  : [];

if (!slugs.length) {
  console.error('No manifests found in ' + path.relative(ROOT, MANIFEST_DIR) + ' — run the manifest workflow first.');
  process.exit(1);
}

for (const slug of slugs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, slug + '.json'), 'utf8'));
  const srcDir = legacyImages(slug);
  const dir = productDir(slug);
  const md = path.join(dir, 'index.md');
  if (!fs.existsSync(md)) { rows.push({ slug, status: 'no index.md, skipped' }); continue; }
  const imagesDir = path.join(dir, 'images');

  const resolveSrc = (name) => {
    const p = path.join(srcDir, name);
    return fs.existsSync(p) ? p : null;
  };

  // Plan
  const gallery = (manifest.gallery || []).map((g, i) => ({
    src: resolveSrc(g.file), out: slug + '-shot-' + (i + 1) + '.webp', file: g.file,
  })).filter((g) => g.src);
  const featSrc = manifest.featuredSource ? resolveSrc(manifest.featuredSource) : null;
  const featOut = slug + '-featured.webp';
  const video = manifest.video || null;

  const galleryRels = gallery.map((g) => './images/' + g.out);
  const featuredRel = featSrc ? './images/' + featOut : null;
  rows.push({ slug, shots: gallery.length, featured: featSrc ? manifest.featuredKind || 'yes' : 'MISSING', video: video ? 'yes' : '' });

  if (!WRITE) continue;

  fs.mkdirSync(imagesDir, { recursive: true });
  // Clean prior generated outputs (idempotency) — never touch icon/banner.
  for (const f of fs.readdirSync(imagesDir)) {
    if (new RegExp('^' + slug + '-shot-\\d+\\.webp$').test(f) || f === featOut) fs.unlinkSync(path.join(imagesDir, f));
  }
  for (const g of gallery) await makeScreenshot(g.src, path.join(imagesDir, g.out));
  if (featSrc) await makeFeatured(featSrc, path.join(imagesDir, featOut));

  // Frontmatter
  const txt = fs.readFileSync(md, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(txt);
  if (!m) { rows[rows.length - 1].status = 'bad frontmatter'; continue; }
  let fm = m[1].split('\n');
  fm = removeBlockKey(fm, 'gallery');
  fm = removeKey(fm, 'featuredImage');
  fm = removeKey(fm, 'video');
  const add = [];
  if (featuredRel) add.push('featuredImage: ' + JSON.stringify(featuredRel));
  if (galleryRels.length) { add.push('gallery:'); for (const g of galleryRels) add.push('  - ' + JSON.stringify(g)); }
  if (video) add.push('video: ' + JSON.stringify(video));
  // Insert after the banner: line if present, else after icon:, else append.
  let at = fm.findIndex((l) => /^banner:/.test(l));
  if (at < 0) at = fm.findIndex((l) => /^icon:/.test(l));
  if (at < 0) fm = [...fm, ...add];
  else fm = [...fm.slice(0, at + 1), ...add, ...fm.slice(at + 1)];
  fs.writeFileSync(md, '---\n' + fm.join('\n') + '\n---\n' + m[2]);
}

console.log((WRITE ? 'WROTE' : 'DRY RUN') + ' product media for ' + rows.length + ' product(s).');
console.table(rows);

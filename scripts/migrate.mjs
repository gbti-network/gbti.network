#!/usr/bin/env node
/**
 * Legacy → Markdown migration (SOW-001, Phase 3).
 *
 * Source: .data/legacy/<type>/<item>/{meta.json, content.html, images/}
 * Target: house/posts/<slug>/index.md  (+ ./images/) for org content
 *         members/<user>/posts/<slug>/index.md for member-authored content
 *
 * Conventions (folder-per-item so each item owns a collision-free images/ dir,
 * referenced relatively so Astro's markdown pipeline optimizes them):
 *   - slug = canonical flat slug from redirect-map.csv (authoritative), else last URL segment
 *   - title strips the " | GBTI Network" / " - GBTI Network" SEO suffix
 *   - categories derived from the legacy URL path segments (minus the final slug)
 *   - <img> srcs mapped from the WP CDN to the archived local original (size-suffix stripped)
 *   - redirectFrom carries the old deep path (also emitted to _redirects separately)
 *
 * Usage:
 *   node scripts/migrate.mjs posts            # DRY RUN over all posts (default)
 *   node scripts/migrate.mjs posts --sample   # dry run, only the SAMPLE slugs
 *   node scripts/migrate.mjs posts --write     # actually write files
 *   node scripts/migrate.mjs posts --sample --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const LEGACY = path.join(ROOT, '.data/legacy');

// --- args ---
const argv = process.argv.slice(2);
const TYPE = argv[0] || 'posts';
const WRITE = argv.includes('--write');
const SAMPLE = argv.includes('--sample');

// Posts to migrate as members rather than house. meta.json has no author field,
// so attribution is an explicit override map (owner-supplied for the full batch).
// Anything not listed defaults to house (author: gbti).
const MEMBER_ATTRIBUTION = {
  'black-myth-wukong-dikas-review': 'dikafei',
  'image-editing-with-midjourney-and-nano-banana': 'hudson',
};

// Representative items for the sample review.
const SAMPLE_SLUGS = new Set([
  'solana-introduces-blinks-a-new-web3-transactional-system', // → house
  'black-myth-wukong-dikas-review', // → members/dikafei
]);

// --- redirect map: old URL path -> new flat slug ---
function loadRedirectMap() {
  const csv = fs.readFileSync(path.join(LEGACY, 'redirect-map.csv'), 'utf8').trim().split('\n').slice(1);
  const byOldPath = new Map();
  for (const line of csv) {
    const [oldPath, newPath] = line.split(',');
    const slug = newPath.replace(/\/$/, '').split('/').pop();
    byOldPath.set(oldPath, { newPath, slug });
  }
  return byOldPath;
}

// --- turndown ---
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' });
td.use(gfm);
td.remove(['script', 'style', 'noscript']);

function urlPath(url) {
  try { return new URL(url).pathname; } catch { return url; }
}
function cleanTitle(t) {
  return t.replace(/\s*[|\-–]\s*GBTI Network\s*$/i, '').trim();
}
function stripSizeSuffix(name) {
  return name.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, '');
}
function clampExcerpt(s) {
  if (!s) return undefined;
  s = s.trim();
  return s.length <= 200 ? s : s.slice(0, 197).trimEnd() + '…';
}

/** Map a post directory to its migrated record (no writes). */
function buildPost(dir, redirects) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const pth = urlPath(meta.url);
  const r = redirects.get(pth);
  const slug = r?.slug || pth.replace(/\/$/, '').split('/').pop();
  const owner = MEMBER_ATTRIBUTION[slug] || 'gbti';
  const isHouse = owner === 'gbti';

  // categories from the legacy path segments minus the final slug
  const segs = pth.split('/').filter(Boolean);
  const categories = segs.slice(0, -1);

  // clean + rewrite images
  const html = fs.readFileSync(path.join(dir, 'content.html'), 'utf8');
  const $ = cheerio.load(html, null, false);
  $('.wp-block-gbti-toc-block, .sharedaddy, .addtoany_share_save_container, [class^="spbsm-"], .wp-block-buttons').remove();

  // Legacy WordPress members-only paywall: the real content lives (display:none) inside
  // .gbti-gated-content-body. Presence of the widget ⇒ this was members-only content.
  // Strip the join/reveal UI, unwrap the real body, and mark visibility: members.
  const gated = $('.gbti-gated-content').length > 0;
  $('.gbti-gated-content-cta, .gbti-gated-content-reveal, .gbti-join-network-btn, .gbti-reveal-content-btn').remove();
  $('.gbti-gated-content-body').each((_, el) => $(el).replaceWith($(el).contents()));
  $('.gbti-gated-content').each((_, el) => $(el).replaceWith($(el).contents()));
  const visibility = gated ? 'members' : 'public';
  $('p').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.find('img,iframe,video').length === 0) $el.remove();
  });

  const localImages = new Set(fs.existsSync(path.join(dir, 'images')) ? fs.readdirSync(path.join(dir, 'images')) : []);
  const usedImages = new Set();
  const missing = [];
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || '';
    const base = stripSizeSuffix(decodeURIComponent(src.split('?')[0].split('/').pop() || ''));
    $el.removeAttr('srcset'); $el.removeAttr('sizes'); $el.removeAttr('decoding'); $el.removeAttr('loading');
    if (localImages.has(base)) {
      usedImages.add(base);
      $el.attr('src', `./images/${base}`);
    } else {
      missing.push(base);
    }
  });

  // cover image: og_image local equiv, else first body image — ONLY if confirmed local
  // (so coverImage always resolves through Astro's image() pipeline; no broken refs).
  let cover;
  const ogBase = meta.og_image ? stripSizeSuffix(meta.og_image.split('?')[0].split('/').pop()) : null;
  if (ogBase && localImages.has(ogBase)) { cover = ogBase; usedImages.add(ogBase); }
  else if (usedImages.size) cover = [...usedImages][0];

  const body = td
    .turndown($.html())
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(#{1,6}) \*\*(.+?)\*\*$/gm, '$1 $2') // drop redundant bold inside headings
    .trim();

  const fm = {
    type: 'post',
    title: cleanTitle(meta.title),
    slug,
    author: owner,
    status: 'published',
    visibility,
    publishedAt: meta.published ? meta.published.slice(0, 10) : undefined,
    updatedAt: meta.modified ? meta.modified.slice(0, 10) : undefined,
    excerpt: clampExcerpt(meta.description),
    categories,
    coverImage: cover ? `./images/${cover}` : undefined,
    redirectFrom: r ? [pth] : [],
  };

  const destBase = isHouse ? path.join(ROOT, 'house/posts', slug) : path.join(ROOT, 'members', owner, 'posts', slug);
  return { meta, slug, owner, isHouse, fm, body, destBase, srcImagesDir: path.join(dir, 'images'), usedImages, missing };
}

function emitFrontmatter(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    } else if (k === 'title' || k === 'excerpt' || k === 'coverImage') {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function writeRecord(rec) {
  fs.mkdirSync(rec.destBase, { recursive: true });
  if (rec.usedImages.size) {
    const imgDest = path.join(rec.destBase, 'images');
    fs.mkdirSync(imgDest, { recursive: true });
    for (const img of rec.usedImages) {
      const from = path.join(rec.srcImagesDir, img);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(imgDest, img));
    }
  }
  const md = `${emitFrontmatter(rec.fm)}\n\n${rec.body}\n`;
  fs.writeFileSync(path.join(rec.destBase, 'index.md'), md);
}

// --- run ---
if (TYPE !== 'posts') {
  console.error(`Only 'posts' implemented so far (got '${TYPE}'). Products/pages/profiles next.`);
  process.exit(1);
}

const redirects = loadRedirectMap();

// Idempotent full write: clear prior post outputs so re-runs (e.g. after author
// re-attribution) stay clean and never leave duplicate-slug orphans.
if (WRITE && !SAMPLE) {
  fs.rmSync(path.join(ROOT, 'house/posts'), { recursive: true, force: true });
  const membersDir = path.join(ROOT, 'members');
  if (fs.existsSync(membersDir)) {
    for (const u of fs.readdirSync(membersDir)) {
      fs.rmSync(path.join(membersDir, u, 'posts'), { recursive: true, force: true });
    }
  }
}

const postDirs = fs.readdirSync(path.join(LEGACY, 'posts')).map((d) => path.join(LEGACY, 'posts', d)).filter((d) => fs.statSync(d).isDirectory());

let n = 0;
const summary = [];
for (const dir of postDirs) {
  const rec = buildPost(dir, redirects);
  if (SAMPLE && !SAMPLE_SLUGS.has(rec.slug)) continue;
  n++;
  summary.push({ slug: rec.slug, owner: rec.owner, vis: rec.fm.visibility, imgs: rec.usedImages.size, missing: rec.missing.length, cats: rec.fm.categories.join('/') });
  if (WRITE) writeRecord(rec);
  if (SAMPLE) {
    console.log('\n' + '='.repeat(80));
    console.log(`SLUG: ${rec.slug}  →  ${path.relative(ROOT, rec.destBase)}/index.md`);
    console.log('-'.repeat(80));
    console.log(emitFrontmatter(rec.fm));
    console.log('\n' + rec.body.slice(0, 1100) + (rec.body.length > 1100 ? '\n…[truncated]' : ''));
    if (rec.missing.length) console.log('\n⚠ images not found locally:', rec.missing);
  }
}

console.log('\n' + '='.repeat(80));
console.log(`${WRITE ? 'WROTE' : 'DRY RUN'} ${n} post(s)${SAMPLE ? ' (sample)' : ''}.`);
console.table(summary);
const totalMissing = summary.reduce((a, s) => a + s.missing, 0);
if (totalMissing) console.log(`⚠ total images not matched locally across run: ${totalMissing}`);

#!/usr/bin/env node
// Migrate the 11 legacy products → house/products/<slug>/index.md (SOW-001 Phase 3).
// Product content.html is a FULL page; the description lives in `.product-description`.
//   node scripts/migrate-products.mjs          # dry run
//   node scripts/migrate-products.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const LEGACY = path.join(ROOT, '.data/legacy/products');
const WRITE = process.argv.includes('--write');

// Controlled vocab (content-schemas.md): ide-plugins | minecraft-mods | utilities | wordpress
const CATEGORY = {
  radle: 'wordpress',
  'better-taxonomy-manager': 'wordpress',
  'clean-image-meta': 'wordpress',
  'wordpress-perplexity-plugin': 'wordpress',
  'email-signature-generator': 'utilities',
  'js-animate-hue': 'utilities',
  'phpstorm-snapshots-for-ai': 'ide-plugins',
  'vscode-snapshots-for-ai': 'ide-plugins',
  'travelers-chest': 'minecraft-mods',
  'travelers-journal': 'minecraft-mods',
  'travelers-lectern': 'minecraft-mods',
};

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.use(gfm);
td.remove(['script', 'style', 'noscript']);

const cleanTitle = (t) => t.replace(/\s*[|\-–]\s*GBTI Network\s*$/i, '').trim();
const stripSize = (n) => n.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, '');
const slugOf = (url) => url.replace(/\/$/, '').split('/').pop();

if (WRITE) fs.rmSync(path.join(ROOT, 'house/products'), { recursive: true, force: true });

const dirs = fs
  .readdirSync(LEGACY)
  .filter((d) => d.startsWith('products_') && d !== 'products') // skip the bare directory index
  .map((d) => path.join(LEGACY, d))
  .filter((d) => fs.statSync(d).isDirectory());

const rows = [];
for (const dir of dirs) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const slug = slugOf(meta.url);
  const category = CATEGORY[slug] || 'utilities';
  const localImages = new Set(fs.existsSync(path.join(dir, 'images')) ? fs.readdirSync(path.join(dir, 'images')) : []);

  // icon: each product page archives EVERY product's icon, so match the one whose filename
  // contains this product's full slug; fall back to the first slug word, then og_image/first.
  const iconMatch = [...localImages].find((f) => /icon/i.test(f) && f.includes(slug))
    || [...localImages].find((f) => /icon/i.test(f) && f.includes(slug.split('-')[0]));
  const ogBase = meta.og_image ? stripSize(meta.og_image.split('?')[0].split('/').pop()) : null;
  const icon = iconMatch || (ogBase && localImages.has(ogBase) ? ogBase : [...localImages][0]);

  // body: the .product-description region of the full page
  const html = fs.readFileSync(path.join(dir, 'content.html'), 'utf8');
  const $ = cheerio.load(html);
  const $desc = $('.product-description').first().length ? $('.product-description').first() : $('.product-content').first();
  const used = new Set();
  if (icon) used.add(icon);
  $desc.find('img').each((_, el) => {
    const $el = $(el);
    const base = stripSize(decodeURIComponent(($el.attr('src') || '').split('?')[0].split('/').pop() || ''));
    $el.removeAttr('srcset').removeAttr('sizes').removeAttr('decoding').removeAttr('loading');
    if (localImages.has(base)) { used.add(base); $el.attr('src', `./images/${base}`); }
  });
  const body = $desc.length
    ? td.turndown($desc.html() || '').replace(/\n{3,}/g, '\n\n').replace(/^(#{1,6}) \*\*(.+?)\*\*$/gm, '$1 $2').trim()
    : '';

  const fm = {
    type: 'product',
    title: cleanTitle(meta.title),
    slug,
    author: 'gbti',
    status: 'published',
    visibility: 'public',
    shortDescription: (meta.description || '').slice(0, 200),
    category,
    icon: icon ? `./images/${icon}` : './images/placeholder',
    publishedAt: meta.modified ? meta.modified.slice(0, 10) : undefined,
  };
  rows.push({ slug, category, icon: icon || '∅', imgs: used.size, bodyKB: Math.round(body.length / 1024) });

  if (WRITE) {
    const destBase = path.join(ROOT, 'house/products', slug);
    fs.mkdirSync(path.join(destBase, 'images'), { recursive: true });
    for (const img of used) {
      const from = path.join(dir, 'images', img);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(destBase, 'images', img));
    }
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
      if (v === undefined) continue;
      lines.push(['title', 'shortDescription', 'icon'].includes(k) ? `${k}: ${JSON.stringify(v)}` : `${k}: ${v}`);
    }
    lines.push('---');
    fs.writeFileSync(path.join(destBase, 'index.md'), `${lines.join('\n')}\n\n${body || meta.description || ''}\n`);
  }
}
console.log(`${WRITE ? 'WROTE' : 'DRY RUN'} ${rows.length} product(s).`);
console.table(rows);

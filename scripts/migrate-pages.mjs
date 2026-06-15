#!/usr/bin/env node
// Migrate the static info/legal pages -> house/pages/<slug>.md (SOW-001 Phase 3).
// Legacy pages are full HTML documents; extract the main content region and strip site chrome.
// Contact is handled as a stub elsewhere (its legacy Phoenix form does not migrate cleanly).
//   node scripts/migrate-pages.mjs          # dry run
//   node scripts/migrate-pages.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const LEGACY = path.join(ROOT, '.data/legacy/page');
const WRITE = process.argv.includes('--write');

// legacy folder -> { slug, nav }
const PAGES = [
  { dir: 'about', slug: 'about', nav: 'About' },
  { dir: 'terms', slug: 'terms', nav: null },
  { dir: 'privacy', slug: 'privacy', nav: null },
  { dir: 'refund-policy', slug: 'refund-policy', nav: null },
];

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.use(gfm);
td.remove(['script', 'style', 'noscript']);
const cleanTitle = (t) => t.replace(/\s*[|\-–]\s*GBTI Network\s*$/i, '').trim();

const SELECTORS = ['.entry-content', '.about-page-content', '.page-content', '.legal-content', 'main', 'article'];

const rows = [];
for (const p of PAGES) {
  const dir = path.join(LEGACY, p.dir);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const html = fs.readFileSync(path.join(dir, 'content.html'), 'utf8');
  const $ = cheerio.load(html);
  // strip chrome
  $('script, style, noscript, nav, header, footer, form, .site-header, .site-footer, .main-navigation, .products-overlay, .products-dropdown, .slide-out-menu, .hamburger-menu').remove();
  // pick the content region with the most text
  let best = null;
  let bestLen = 0;
  for (const sel of SELECTORS) {
    $(sel).each((_, el) => {
      const len = $(el).text().trim().length;
      if (len > bestLen) { bestLen = len; best = $(el); }
    });
  }
  const region = best ?? $('body');
  const body = td.turndown(region.html() || '').replace(/\n{3,}/g, '\n\n').replace(/^(#{1,6}) \*\*(.+?)\*\*$/gm, '$1 $2').trim();
  rows.push({ slug: p.slug, bodyKB: Math.round(body.length / 1024), via: best ? 'selector' : 'body' });

  if (WRITE) {
    const fm = ['---', 'type: page', `title: ${JSON.stringify(cleanTitle(meta.title))}`, `slug: ${p.slug}`, 'status: published', 'visibility: public'];
    if (meta.description) fm.push(`description: ${JSON.stringify(meta.description)}`);
    if (p.nav) fm.push(`nav: ${p.nav}`);
    if (meta.modified) fm.push(`updatedAt: ${meta.modified.slice(0, 10)}`);
    fm.push(`redirectFrom: ["${new URL(meta.url).pathname}"]`);
    fm.push('---');
    fs.mkdirSync(path.join(ROOT, 'house/pages'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'house/pages', `${p.slug}.md`), `${fm.join('\n')}\n\n${body}\n`);
  }
}
console.log(`${WRITE ? 'WROTE' : 'DRY RUN'} ${rows.length} page(s).`);
console.table(rows);

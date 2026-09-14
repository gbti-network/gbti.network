#!/usr/bin/env node
// sow-287 build guard: a category link goes to the category it names.
//
// WHY. The article rail showed the deepest category ("React") and linked the top one (`?cat=devops`), so a reader
// was shown one category and given another. Nothing was broken, which is why it survived: the link filtered, it
// just filtered something other than what it said. The prompt cards carried the same pairing. Both now link the
// key they display, and this guard holds every built page to that.
//
// THE RULE. Every `<a>` whose href carries `cat=<key>` and whose visible text is ONE label must read that key's
// label from house/taxonomy.yml. A text containing "›" is a path (the related-article eyebrow "DevOps › React"),
// which names more than one category, so it is not held to a single key.
//
// It reads the built HTML, not the components, because the claim is about what a reader clicks. It fails when it
// checked no link on an article page or no link anywhere else, so a build where the rail or the cards stopped
// rendering category links cannot pass by having nothing to check.
//   node scripts/check-category-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { decodeHtmlEntities } from '../membership/html-entities.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const PATH_SEPARATOR = '›';

/** The flat key -> label map, walked the same way src/lib/taxonomy.ts builds it. */
export function loadCategoryLabels(root = ROOT) {
  const tree = yaml.load(fs.readFileSync(path.join(root, 'house/taxonomy.yml'), 'utf8'))?.tree ?? {};
  const labels = {};
  (function walk(nodes) {
    for (const [key, node] of Object.entries(nodes || {})) {
      labels[key] = node?.label ?? key;
      if (node?.children) walk(node.children);
    }
  })(tree);
  return labels;
}

/** Every category link in one page: { key, text }. */
export function categoryLinksIn(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(m[1]);
    if (!/[?&]cat=/.test(href)) continue;
    let key;
    try { key = new URL(href, 'https://gbti.network').searchParams.get('cat') || ''; } catch { continue; }
    const text = decodeHtmlEntities(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    out.push({ key, text });
  }
  return out;
}

function htmlFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(abs, base));
    else if (entry.name.endsWith('.html')) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

/** Check a built dist. Returns { errors, checked: { articlePages, elsewhere } }. */
export function checkCategoryLinks({ distDir, labels }) {
  const errors = [];
  const checked = { articlePages: 0, elsewhere: 0 };
  for (const rel of htmlFiles(distDir)) {
    const isArticlePage = /^articles\/[^/]+\/index\.html$/.test(rel);
    for (const { key, text } of categoryLinksIn(fs.readFileSync(path.join(distDir, rel), 'utf8'))) {
      if (!text || text.includes(PATH_SEPARATOR)) continue;
      checked[isArticlePage ? 'articlePages' : 'elsewhere']++;
      const want = labels[key] ?? key;
      if (text !== want) errors.push(`${rel}: a link reading "${text}" filters to ?cat=${key} ("${want}")`);
    }
  }
  if (checked.articlePages === 0) errors.push('no category link was checked on any article page (did the rail stop rendering one?)');
  if (checked.elsewhere === 0) errors.push('no category link was checked outside the article pages (did the prompt cards stop rendering one?)');
  return { errors, checked };
}

function run() {
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('check-category-links: dist/index.html is missing, build the site first');
    process.exit(1);
  }
  const { errors, checked } = checkCategoryLinks({ distDir, labels: loadCategoryLabels() });
  if (errors.length) {
    console.error(`check-category-links: ${errors.length} problem(s):`);
    for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
    if (errors.length > 40) console.error(`  ... and ${errors.length - 40} more`);
    process.exit(1);
  }
  console.log(`✓ category links name their destination (${checked.articlePages} on article pages, ${checked.elsewhere} elsewhere)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

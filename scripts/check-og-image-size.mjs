#!/usr/bin/env node
// sow-294 build guard: every article, project, prompt and share page whose link-preview image is served from
// gbti.network declares that image's width and height, and the numbers are the real ones.
//
// WHY. Strict link-preview scrapers (daily.dev among them) apply a minimum-width floor and will not fetch an
// image to measure it, so an og:image with no declared size is dropped: the tag is present, correct and ignored.
// Share pages were fixed first (604ba7c8, then sow-283 for hosted covers); articles, projects and prompts declared
// nothing. The size now comes from the image field Astro already resolved, or from the known-size table for the
// branded default banners.
//
// A WRONG NUMBER IS WORSE THAN A MISSING ONE, so this guard reads each declared image out of dist and compares.
// An image served from another host (a members-only share that keeps its outside cover) is exempt: its size is
// unknowable at build and the page correctly declares none.
//
// It fails on zero subjects per section, so a build where the pages vanished, or the og:image tag moved, cannot pass.
//   node scripts/check-og-image-size.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { listBuiltDetailPages } from './lib/dist-pages.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SITE_HOST = 'gbti.network';

const metaContent = (html, property) => {
  const m = new RegExp(`<meta\\s+property="${property.replace(/:/g, '\\:')}"\\s+content="([^"]*)"`, 'i').exec(html);
  return m ? m[1] : null;
};

/** The og:image facts one page declares. */
export function readOgTags(html) {
  return {
    image: metaContent(html, 'og:image'),
    width: metaContent(html, 'og:image:width'),
    height: metaContent(html, 'og:image:height'),
  };
}

/** Built share pages: dist/shares/<author>/<id>/index.html, relative to dist. */
function sharePages(distDir) {
  const root = path.join(distDir, 'shares');
  const out = [];
  let authors = [];
  try { authors = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const a of authors) {
    for (const id of fs.readdirSync(path.join(root, a.name), { withFileTypes: true })) {
      if (id.isDirectory() && fs.existsSync(path.join(root, a.name, id.name, 'index.html'))) out.push(`shares/${a.name}/${id.name}/index.html`);
    }
  }
  return out;
}

/**
 * Check a built dist. `measure(absPath)` returns { width, height } (injectable so the unit test needs no images).
 * Returns { errors, checked: { section: count } }.
 */
export async function checkOgImageSizes({ distDir, measure = async (p) => sharp(p).metadata() }) {
  const errors = [];
  const pages = {
    articles: listBuiltDetailPages(distDir, 'articles').map((s) => `articles/${s}/index.html`),
    projects: listBuiltDetailPages(distDir, 'projects').map((s) => `projects/${s}/index.html`),
    prompts: listBuiltDetailPages(distDir, 'prompts').map((s) => `prompts/${s}/index.html`),
    shares: sharePages(distDir),
  };
  const checked = {};
  for (const [section, list] of Object.entries(pages)) {
    checked[section] = 0;
    for (const rel of list) {
      const html = fs.readFileSync(path.join(distDir, rel), 'utf8');
      const { image, width, height } = readOgTags(html);
      if (!image) { errors.push(`${rel}: no og:image at all`); continue; }
      let url;
      try { url = new URL(image); } catch { errors.push(`${rel}: og:image is not an absolute URL (${image})`); continue; }
      if (url.hostname !== SITE_HOST) continue; // an outside image: its size is not ours to declare
      checked[section]++;
      if (!width || !height) { errors.push(`${rel}: og:image ${url.pathname} is served from ${SITE_HOST} but declares no width/height`); continue; }
      const file = path.join(distDir, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file)) { errors.push(`${rel}: og:image ${url.pathname} is not in dist`); continue; }
      let meta;
      try { meta = await measure(file); } catch (e) { errors.push(`${rel}: could not read ${url.pathname} (${e.message})`); continue; }
      if (String(meta.width) !== width || String(meta.height) !== height) {
        errors.push(`${rel}: declares ${width}x${height} but ${url.pathname} is ${meta.width}x${meta.height}`);
      }
    }
    if (list.length && checked[section] === 0) errors.push(`${section}: ${list.length} page(s) built but none had a gbti.network og:image to check`);
    if (!list.length) errors.push(`${section}: no built pages found, so nothing was checked`);
  }
  return { errors, checked };
}

async function run() {
  const distDir = path.join(ROOT, 'dist');
  const { errors, checked } = await checkOgImageSizes({ distDir });
  if (errors.length) {
    console.error(`✗ og:image size guard failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
    process.exit(1);
  }
  const summary = Object.entries(checked).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`✓ og:image size guard passed (${summary}: every declared size matches its file)`);
}

if (import.meta.url === `file://${process.argv[1]}`) run();

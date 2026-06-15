#!/usr/bin/env node
// Enrich migrated products with real data from the production DB: GitHub repo link, banner image,
// and download URL. Banner images are copied from the local media library. Idempotent.
//   node scripts/extract-product-media.mjs          # dry run
//   node scripts/extract-product-media.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const SQL = fs.readFileSync(path.join(ROOT, '.data/legacy/db/dnbwthyuzc-20260602-0543.sql'), 'utf8');
const LIB = path.join(ROOT, '.data/legacy/wp-content');

function valuesBlobs(table) {
  const blobs = [];
  const re = new RegExp('INSERT INTO `' + table + '` VALUES ', 'g');
  let m;
  while ((m = re.exec(SQL))) {
    let i = m.index + m[0].length, inStr = false;
    const start = i;
    while (i < SQL.length) { const c = SQL[i]; if (inStr) { if (c === '\\') { i += 2; continue; } if (c === "'") inStr = false; i++; continue; } if (c === "'") inStr = true; else if (c === ';') break; i++; }
    blobs.push(SQL.slice(start, i));
  }
  return blobs;
}
function parseTuples(blob) {
  const rows = []; let i = 0; const n = blob.length;
  while (i < n) {
    while (i < n && blob[i] !== '(') i++; if (i >= n) break; i++;
    const f = []; let cur = '', inStr = false, q = false, done = false;
    while (i < n && !done) { const c = blob[i];
      if (inStr) { if (c === '\\') { cur += blob[i + 1]; i += 2; continue; } if (c === "'") { inStr = false; i++; continue; } cur += c; i++; }
      else if (c === "'") { inStr = true; q = true; i++; }
      else if (c === ',') { f.push(q ? cur : cur.trim()); cur = ''; q = false; i++; }
      else if (c === ')') { f.push(q ? cur : cur.trim()); done = true; i++; }
      else { cur += c; i++; } }
    rows.push(f);
  }
  return rows;
}

// wp_posts: products (type github_product) -> slug
const slugById = new Map();
for (const blob of valuesBlobs('wp_posts')) for (const r of parseTuples(blob)) {
  if (r[20] === 'github_product') slugById.set(r[0], r[11]);
}

// Library filename index (basename -> path). Robust banner resolution: the huge wp_posts content
// makes column parsing fragile, so resolve banners by their attachment filename via a targeted
// regex, then look the file up here.
const libIdx = new Map();
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (!libIdx.has(e.name)) libIdx.set(e.name, p);
  }
})(LIB);
function attachmentFilename(id) {
  const m = new RegExp(`\\(${id},\\d+,'[^']*','[^']*','','([^']*\\.(?:png|jpe?g|webp|gif))'`, 'i').exec(SQL);
  return m ? m[1] : null;
}
// wp_postmeta: collect media keys per product id
const KEYS = new Set(['_github_repo', '_github_repo_banner', '_github_download_button_url']);
const pm = new Map();
for (const blob of valuesBlobs('wp_postmeta')) for (const r of parseTuples(blob)) {
  const [, pid, key, val] = r;
  if (!KEYS.has(key) || !slugById.has(pid)) continue;
  if (!pm.has(pid)) pm.set(pid, {});
  pm.get(pid)[key] = val;
}

// guid -> local library path (.../uploads/Y/M/file -> .data/legacy/wp-content/Y/M/file)
function libPath(guid) {
  const m = /\/uploads\/(.+)$/.exec(guid || '');
  if (!m) return null;
  const p = path.join(LIB, m[1].split('?')[0]);
  return fs.existsSync(p) ? p : null;
}

const rows = [];
for (const [pid, slug] of slugById) {
  const meta = pm.get(pid);
  if (!meta) continue;
  const dir = path.join(ROOT, 'house/products', slug);
  if (!fs.existsSync(path.join(dir, 'index.md'))) continue; // only our migrated products

  const repo = meta._github_repo ? `https://github.com/${meta._github_repo}` : null;
  const download = meta._github_download_button_url || null;
  let bannerRel = null;
  const bannerName = meta._github_repo_banner ? attachmentFilename(meta._github_repo_banner) : null;
  const bannerSrc = bannerName ? libIdx.get(bannerName) : null;
  if (bannerSrc) {
    const base = path.basename(bannerSrc);
    bannerRel = `./images/${base}`;
    if (WRITE) { fs.mkdirSync(path.join(dir, 'images'), { recursive: true }); fs.copyFileSync(bannerSrc, path.join(dir, 'images', base)); }
  }
  rows.push({ slug, repo: repo ? '✓' : '', banner: bannerRel ? '✓' : '', download: download ? '✓' : '' });

  if (WRITE) {
    const md = path.join(dir, 'index.md');
    const txt = fs.readFileSync(md, 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(txt);
    if (!m) continue;
    // drop any prior banner/links lines for idempotency
    const fm = m[1].split('\n').filter((l) => !/^(banner:|links:|\s{2}(repository|download):)/.test(l));
    if (bannerRel) fm.push(`banner: ${JSON.stringify(bannerRel)}`);
    if (repo || download) {
      fm.push('links:');
      if (repo) fm.push(`  repository: ${JSON.stringify(repo)}`);
      if (download) fm.push(`  download: ${JSON.stringify(download)}`);
    }
    fs.writeFileSync(md, `---\n${fm.join('\n')}\n---\n${m[2]}`);
  }
}

console.log(`${WRITE ? 'WROTE' : 'DRY RUN'} media for ${rows.length} product(s).`);
console.table(rows);

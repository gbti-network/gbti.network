#!/usr/bin/env node
// Media policy check for committed content (content-schemas.md media handling). Fails if any
// content image exceeds the size cap, uses a non-web format, or if any video file is committed
// (video is embed-only). Runs locally and in CI (.github/workflows/media-check.yml) on content PRs.
//   node scripts/check-media.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const ROOTS = ['house', 'members'];
const MAX_BYTES = 1024 * 1024; // 1 MB per image
const VIDEO = /\.(mp4|webm|mov|m4v|avi|mkv|mpg|mpeg)$/i;
const RASTER = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i;
const WEB_OK = /\.(webp|avif|jpe?g|png|svg|gif)$/i;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const errors = [];
for (const root of ROOTS) {
  for (const f of walk(path.join(ROOT, root))) {
    const rel = path.relative(ROOT, f);
    if (VIDEO.test(f)) {
      errors.push(`video committed: ${rel} — host on YouTube/Vimeo and embed via the \`video\` field`);
      continue;
    }
    if (RASTER.test(f)) {
      if (!WEB_OK.test(f)) errors.push(`non-web image format: ${rel} — use webp/avif/jpg/png/svg`);
      const sz = fs.statSync(f).size;
      if (sz > MAX_BYTES) errors.push(`image over 1 MB (${(sz / 1024 / 1024).toFixed(1)} MB): ${rel} — optimize it`);
    }
  }
}

if (errors.length) {
  console.error(`✗ media check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('✓ media check passed (no committed video, no oversized or non-web images)');

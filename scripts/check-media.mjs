#!/usr/bin/env node
// Media policy check for committed content (content-schemas.md media handling). Fails if any
// content image exceeds the size cap, falls under the size floor, uses a non-web format, or if any
// video file is committed (video is embed-only). Audio (the ```audio block) lives only in
// public/media/podcasts/ as Opus or M4A under a size cap, and every file a block names must exist.
// Runs locally and in CI (.github/workflows/media-check.yml) on content PRs.
//   node scripts/check-media.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import sharp from 'sharp';
import { sizedImageRefs, undersizeProblem, AUDIO_FILE, podcastFileProblem, audioBlockSources } from './lib/media-rules.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const ROOTS = ['house', 'members'];
const MAX_BYTES = 1024 * 1024; // 1 MB per image
const VIDEO = /\.(mp4|webm|mov|m4v|avi|mkv|mpg|mpeg)$/i;
const RASTER = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i;
const WEB_OK = /\.(webp|avif|jpe?g|png|svg|gif)$/i;
const MARKDOWN = /\.mdx?$/i;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** The leading YAML frontmatter block, or null. Never throws: malformed YAML is the content check's job. */
function frontmatter(txt) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
  if (!m) return null;
  try {
    const doc = yaml.load(m[1]);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
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
    if (AUDIO_FILE.test(f)) {
      errors.push(podcastFileProblem({ rel: rel.split(path.sep).join('/'), bytes: fs.statSync(f).size }));
      continue;
    }
    if (RASTER.test(f)) {
      if (!WEB_OK.test(f)) errors.push(`non-web image format: ${rel} — use webp/avif/jpg/png/svg`);
      const sz = fs.statSync(f).size;
      if (sz > MAX_BYTES) errors.push(`image over 1 MB (${(sz / 1024 / 1024).toFixed(1)} MB): ${rel} — optimize it`);
    }
  }
}

// Audio: every recording under public/media/ is a podcast file within the rules, and every file an ```audio block
// names is on disk (a missing one is a player that never plays).
let audioFiles = 0;
for (const f of walk(path.join(ROOT, 'public', 'media'))) {
  if (!AUDIO_FILE.test(f)) continue;
  audioFiles += 1;
  const problem = podcastFileProblem({ rel: path.relative(ROOT, f).split(path.sep).join('/'), bytes: fs.statSync(f).size });
  if (problem) errors.push(problem);
}
let audioRefs = 0;
for (const root of ROOTS) {
  for (const f of walk(path.join(ROOT, root))) {
    if (!MARKDOWN.test(f)) continue;
    for (const src of audioBlockSources(fs.readFileSync(f, 'utf8'))) {
      audioRefs += 1;
      if (!fs.existsSync(path.join(ROOT, 'public', src))) errors.push(`audio block in ${path.relative(ROOT, f)} names ${src}, which is not in public/`);
    }
  }
}

// The size floor (scripts/lib/media-rules.mjs). It needs each image's ROLE, which only the frontmatter knows, so
// this pass walks the markdown rather than the image files.
let measured = 0;
const skipped = [];
for (const root of ROOTS) {
  for (const f of walk(path.join(ROOT, root))) {
    if (!MARKDOWN.test(f)) continue;
    const fm = frontmatter(fs.readFileSync(f, 'utf8'));
    if (!fm) continue;
    for (const ref of sizedImageRefs(fm)) {
      const abs = ref.src.startsWith('.')
        ? path.resolve(path.dirname(f), ref.src)
        : path.join(ROOT, ref.src.replace(/^\//, ''));
      const rel = path.relative(ROOT, abs);
      if (!fs.existsSync(abs)) {
        // A frontmatter image with no file is validate-content's error, not this one. Counted so a run that
        // measured nothing cannot look like a pass.
        skipped.push(rel);
        continue;
      }
      let dims = {};
      try {
        dims = await sharp(abs).metadata();
      } catch {
        dims = {};
      }
      measured += 1;
      const problem = undersizeProblem({ role: ref.role, rel, width: dims.width, height: dims.height });
      if (problem) errors.push(problem);
    }
  }
}

if (errors.length) {
  console.error(`✗ media check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
if (!measured) {
  console.error('✗ media check failed: no featured or gallery image was measured, so the size floor proved nothing.');
  process.exit(1);
}
console.log(`✓ media check passed (no committed video, no oversized or non-web images; ${measured} featured/gallery `
  + `image${measured === 1 ? '' : 's'} measured against the size floor`
  + `${skipped.length ? `, ${skipped.length} skipped with no file on disk` : ''}`
  + `${audioFiles || audioRefs ? `; ${audioFiles} audio file${audioFiles === 1 ? '' : 's'}, ${audioRefs} audio block source${audioRefs === 1 ? '' : 's'} found` : ''})`);

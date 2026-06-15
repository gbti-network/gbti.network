#!/usr/bin/env node
// Recover the primary YouTube embed for single-video posts (the migration dropped the iframes).
// Maps video-references.json embed -> referenced post -> our slug (via inventory.json) and sets the
// `video` frontmatter field, which the post template renders through VideoEmbed. Idempotent.
//   node scripts/recover-video.mjs          # dry run
//   node scripts/recover-video.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const refs = JSON.parse(fs.readFileSync(path.join(ROOT, '.data/legacy/video-references.json'), 'utf8'));
const inv = JSON.parse(fs.readFileSync(path.join(ROOT, '.data/legacy/inventory.json'), 'utf8'));

// legacy archive path -> flattened slug (last URL segment), only for posts
const slugByPath = new Map();
for (const it of inv) {
  if (it.type !== 'post' || !it.path || !it.url) continue;
  slugByPath.set(it.path, it.url.replace(/\/$/, '').split('/').pop());
}

// slug -> set of embed urls (posts only)
const bySlug = new Map();
for (const e of refs.external_embeds || []) {
  for (const rp of e.referenced_by || []) {
    if (!rp.startsWith('posts/')) continue;
    const slug = slugByPath.get(rp);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, new Set());
    bySlug.get(slug).add(e.url);
  }
}

function findPostDir(slug) {
  const h = path.join(ROOT, 'house/posts', slug);
  if (fs.existsSync(path.join(h, 'index.md'))) return h;
  const members = path.join(ROOT, 'members');
  if (fs.existsSync(members)) for (const u of fs.readdirSync(members)) {
    const m = path.join(members, u, 'posts', slug);
    if (fs.existsSync(path.join(m, 'index.md'))) return m;
  }
  return null;
}

const rows = [];
for (const [slug, urls] of bySlug) {
  if (urls.size !== 1) continue; // only single-video posts
  const dir = findPostDir(slug);
  if (!dir) continue;
  const url = [...urls][0];
  const md = path.join(dir, 'index.md');
  let txt = fs.readFileSync(md, 'utf8');
  if (/^video:/m.test(txt)) { rows.push({ slug, status: 'already set' }); continue; }
  rows.push({ slug, video: url });
  if (WRITE) {
    txt = txt.replace(/^(visibility:.*)$/m, `$1\nvideo: ${JSON.stringify(url)}`);
    fs.writeFileSync(md, txt);
  }
}

console.log(`${WRITE ? 'SET' : 'DRY RUN'} video on ${rows.filter((r) => r.video).length} post(s).`);
console.table(rows);

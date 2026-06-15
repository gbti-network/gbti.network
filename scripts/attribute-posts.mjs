#!/usr/bin/env node
// Attribute migrated posts to their real authors using the production DB (wp_posts.post_author).
// Posts by an author who has a member profile move to members/<nicename>/posts/<slug>/ (with their
// images); everyone else stays in house/posts/ as gbti. Updates the `author` frontmatter. Idempotent.
//   node scripts/attribute-posts.mjs          # dry run (distribution only)
//   node scripts/attribute-posts.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const SQL = fs.readFileSync(path.join(ROOT, '.data/legacy/db/dnbwthyuzc-20260602-0543.sql'), 'utf8');

function valuesBlobs(table) {
  const blobs = [];
  const re = new RegExp('INSERT INTO `' + table + '` VALUES ', 'g');
  let m;
  while ((m = re.exec(SQL))) {
    let i = m.index + m[0].length;
    let inStr = false;
    const start = i;
    while (i < SQL.length) {
      const c = SQL[i];
      if (inStr) { if (c === '\\') { i += 2; continue; } if (c === "'") inStr = false; i++; continue; }
      if (c === "'") inStr = true; else if (c === ';') break;
      i++;
    }
    blobs.push(SQL.slice(start, i));
  }
  return blobs;
}
function parseTuples(blob) {
  const rows = [];
  let i = 0;
  const n = blob.length;
  while (i < n) {
    while (i < n && blob[i] !== '(') i++;
    if (i >= n) break;
    i++;
    const fields = [];
    let field = '', inStr = false, quoted = false, done = false;
    while (i < n && !done) {
      const c = blob[i];
      if (inStr) {
        if (c === '\\') { field += blob[i + 1]; i += 2; continue; }
        if (c === "'") { inStr = false; i++; continue; }
        field += c; i++;
      } else if (c === "'") { inStr = true; quoted = true; i++; }
      else if (c === ',') { fields.push(quoted ? field : field.trim()); field = ''; quoted = false; i++; }
      else if (c === ')') { fields.push(quoted ? field : field.trim()); done = true; i++; }
      else { field += c; i++; }
    }
    rows.push(fields);
  }
  return rows;
}

// users: ID -> nicename
const nameById = new Map();
for (const blob of valuesBlobs('wp_users')) for (const r of parseTuples(blob)) nameById.set(r[0], (r[3] || '').toLowerCase());

// posts: post_name(11) -> post_author(1), for post_type(20)='post' & post_status(7)='publish'
const slugToAuthor = new Map();
for (const blob of valuesBlobs('wp_posts')) {
  for (const r of parseTuples(blob)) {
    if (r[20] !== 'post' || r[7] !== 'publish') continue;
    const slug = r[11];
    if (slug) slugToAuthor.set(slug, nameById.get(r[1]) || 'gbti');
  }
}

const hasProfile = (nicename) => fs.existsSync(path.join(ROOT, 'members', nicename, 'profile.md'));

// existing migrated posts -> current dir
function existingPosts() {
  const out = [];
  const scan = (base, owner) => {
    if (!fs.existsSync(base)) return;
    for (const slug of fs.readdirSync(base)) {
      const dir = path.join(base, slug);
      if (fs.existsSync(path.join(dir, 'index.md'))) out.push({ slug, dir, owner });
    }
  };
  scan(path.join(ROOT, 'house/posts'), 'gbti');
  const membersDir = path.join(ROOT, 'members');
  if (fs.existsSync(membersDir)) for (const u of fs.readdirSync(membersDir)) scan(path.join(membersDir, u, 'posts'), u);
  return out;
}

const dist = {};
const moves = [];
for (const p of existingPosts()) {
  const dbAuthor = slugToAuthor.get(p.slug);
  // target owner: the DB author if they have a profile; else house/gbti.
  // If the post is not in the DB at all, keep its current owner (do not revert).
  const target = !dbAuthor ? p.owner : dbAuthor !== 'gbti' && hasProfile(dbAuthor) ? dbAuthor : 'gbti';
  dist[target] = (dist[target] || 0) + 1;
  if (target !== p.owner) moves.push({ slug: p.slug, from: p.owner, to: target, dbAuthor: dbAuthor || '(not in DB)' });

  if (WRITE) {
    const md = path.join(p.dir, 'index.md');
    let txt = fs.readFileSync(md, 'utf8').replace(/^author:.*$/m, `author: ${target}`);
    fs.writeFileSync(md, txt);
    if (target !== p.owner) {
      const destBase = target === 'gbti' ? path.join(ROOT, 'house/posts') : path.join(ROOT, 'members', target, 'posts');
      fs.mkdirSync(destBase, { recursive: true });
      fs.renameSync(p.dir, path.join(destBase, p.slug));
    }
  }
}

console.log(`${WRITE ? 'APPLIED' : 'DRY RUN'} — author distribution across ${existingPosts().length} posts:`);
console.table(dist);
console.log(`${moves.length} post(s) ${WRITE ? 'moved' : 'would move'} to a new owner folder:`);
console.table(moves);

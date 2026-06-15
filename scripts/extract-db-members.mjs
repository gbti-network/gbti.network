#!/usr/bin/env node
// Extract the real member roster from the production WordPress DB dump and generate member profiles
// for every directory member (include_directory = 1), with their socials, bio, role, and Gravatar.
// Source: .data/legacy/db/*.sql (production). Avatars use the public Gravatar hash of the email;
// emails themselves are never written to disk.
//   node scripts/extract-db-members.mjs          # dry run
//   node scripts/extract-db-members.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');
const SQL = fs.readFileSync(path.join(ROOT, '.data/legacy/db/dnbwthyuzc-20260602-0543.sql'), 'utf8');

// Return the VALUES blobs for every `INSERT INTO \`table\` VALUES ...;`, respecting quoted ';'.
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
      if (c === "'") inStr = true;
      else if (c === ';') break;
      i++;
    }
    blobs.push(SQL.slice(start, i));
  }
  return blobs;
}

// Parse a "(..),(..)" tuple list into arrays of string fields (NULL -> null).
function parseTuples(blob) {
  const rows = [];
  let i = 0;
  const n = blob.length;
  while (i < n) {
    while (i < n && blob[i] !== '(') i++;
    if (i >= n) break;
    i++;
    const fields = [];
    let field = '';
    let inStr = false;
    let quoted = false;
    let done = false;
    while (i < n && !done) {
      const c = blob[i];
      if (inStr) {
        if (c === '\\') { field += blob[i + 1]; i += 2; continue; }
        if (c === "'") { inStr = false; i++; continue; }
        field += c; i++;
      } else {
        if (c === "'") { inStr = true; quoted = true; i++; }
        else if (c === ',') { fields.push(quoted ? field : (field.trim() === 'NULL' ? null : field.trim())); field = ''; quoted = false; i++; }
        else if (c === ')') { fields.push(quoted ? field : (field.trim() === 'NULL' ? null : field.trim())); done = true; i++; }
        else { field += c; i++; }
      }
    }
    rows.push(fields);
  }
  return rows;
}

// --- users: ID, login, pass, nicename, email, url, registered, activation, status, display_name ---
const users = new Map();
for (const blob of valuesBlobs('wp_users')) {
  for (const r of parseTuples(blob)) {
    users.set(r[0], { id: r[0], login: r[1], nicename: r[3], email: r[4], url: r[5], displayName: r[9] });
  }
}

// --- usermeta: umeta_id, user_id, meta_key, meta_value (whitelist) ---
const KEYS = new Set(['include_directory', 'description', 'description_longer', 'company_name', 'wp_capabilities',
  'social_github', 'social_x', 'social_youtube', 'social_bluesky', 'social_devto', 'social_mastodon',
  'social_reddit', 'social_linkedin', 'social_discord', 'social_blog']);
const meta = new Map();
for (const blob of valuesBlobs('wp_usermeta')) {
  for (const r of parseTuples(blob)) {
    const [, uid, key, val] = r;
    if (!KEYS.has(key)) continue;
    if (!meta.has(uid)) meta.set(uid, {});
    meta.get(uid)[key] = val;
  }
}

const gravatar = (email) => `https://secure.gravatar.com/avatar/${crypto.createHash('md5').update((email || '').trim().toLowerCase()).digest('hex')}?s=512&d=mm`;
const roleOf = (caps) => { const m = /"([a-z_]+)";b:1/.exec(caps || ''); return m ? m[1] : 'member'; };
const SOCIAL_MAP = { social_github: 'github', social_x: 'x', social_youtube: 'youtube', social_bluesky: 'bluesky', social_devto: 'devto', social_mastodon: 'mastodon', social_reddit: 'reddit', social_linkedin: 'linkedin', social_discord: 'discord', social_blog: 'website' };

const directory = [...users.values()].filter((u) => meta.get(u.id)?.include_directory === '1');

const rows = [];
for (const u of directory) {
  const md = meta.get(u.id) || {};
  const links = {};
  for (const [k, v] of Object.entries(SOCIAL_MAP)) if (md[k]) links[v] = md[k];
  const bio = (md.description_longer || md.description || '').trim();
  const username = (u.nicename || u.login || '').toLowerCase();
  rows.push({ username, displayName: u.displayName, role: roleOf(md.wp_capabilities), socials: Object.keys(links).length, bio: bio ? 'yes' : 'no' });

  if (WRITE && username) {
    const dir = path.join(ROOT, 'members', username);
    fs.mkdirSync(dir, { recursive: true });
    const fm = ['---', 'type: profile', `username: ${username}`, `displayName: ${JSON.stringify(u.displayName)}`, 'tier: paid', 'directory: true', 'status: published', 'visibility: public'];
    if (md.company_name) fm.push(`headline: ${JSON.stringify(md.company_name)}`);
    fm.push(`avatar: ${JSON.stringify(gravatar(u.email))}`);
    if (Object.keys(links).length) {
      fm.push('links:');
      for (const [k, v] of Object.entries(links)) fm.push(`  ${k}: ${JSON.stringify(v)}`);
    }
    fm.push('---');
    fs.writeFileSync(path.join(dir, 'profile.md'), `${fm.join('\n')}\n\n${bio || `${u.displayName} is a member of the GBTI Network.`}\n`);
  }
}

console.log(`${WRITE ? 'WROTE' : 'DRY RUN'} ${rows.length} directory member profile(s) (of ${users.size} total users).`);
console.table(rows);

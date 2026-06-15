#!/usr/bin/env node
// Migrate the 3 archived member profiles → members/<username>/profile.md (SOW-001 Phase 3).
// Legacy profiles are thin: title + Gravatar og_image, no real bio in the archive (the old
// content.html was the author's post-grid). Bios can be fleshed out later by the members.
//   node scripts/migrate-profiles.mjs          # dry run
//   node scripts/migrate-profiles.mjs --write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const LEGACY = path.join(ROOT, '.data/legacy/members');
const WRITE = process.argv.includes('--write');

// Known GitHub handles for the founding accounts (others can be added as members confirm them).
const GITHUB = { gbti: 'https://github.com/gbti-network' };

const dirs = fs.readdirSync(LEGACY).filter((d) => fs.statSync(path.join(LEGACY, d)).isDirectory());
const rows = [];
for (const d of dirs) {
  const meta = JSON.parse(fs.readFileSync(path.join(LEGACY, d, 'meta.json'), 'utf8'));
  const username = d.replace(/^author_/, '');
  const displayName = meta.title.split(/\s+[-–|]\s+/)[0].trim();
  const avatar = meta.og_image || undefined; // Gravatar URL (remote; survives WP cutover)
  rows.push({ username, displayName, avatar: avatar ? 'yes' : 'no' });

  if (WRITE) {
    const dir = path.join(ROOT, 'members', username);
    fs.mkdirSync(dir, { recursive: true });
    const fm = ['---', 'type: profile', `username: ${username}`, `displayName: ${JSON.stringify(displayName)}`, 'tier: paid', 'status: published', 'visibility: public'];
    if (avatar) fm.push(`avatar: ${JSON.stringify(avatar)}`);
    if (GITHUB[username]) fm.push('links:', `  github: ${GITHUB[username]}`);
    fm.push('---');
    const body = username === 'gbti'
      ? 'The GBTI Network — a developer co-op community. God Bless The Internet.'
      : `${displayName} is a member of the GBTI Network.`;
    fs.writeFileSync(path.join(dir, 'profile.md'), `${fm.join('\n')}\n\n${body}\n`);
  }
}
console.log(`${WRITE ? 'WROTE' : 'DRY RUN'} ${rows.length} profile(s).`);
console.table(rows);

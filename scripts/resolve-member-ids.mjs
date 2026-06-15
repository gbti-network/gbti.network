#!/usr/bin/env node
// Resolve each member folder's GitHub login (from members/<username>/profile.md links.github) to its
// immutable numeric github_id via the public GitHub API, and write house/members-index.yml. The
// members-index is the authoritative github_id -> username map the PR-gate and reconcile use, so a
// member's own-folder PRs auto-merge and contribution owner-resolution works regardless of renames.
//
//   node scripts/resolve-member-ids.mjs            # dry run: print the resolved table
//   node scripts/resolve-member-ids.mjs --write     # write house/members-index.yml
//
// Unauthenticated calls are rate-limited (about 60/hour), which is plenty for the member count. Set
// GITHUB_TOKEN to raise the limit. A folder with no links.github is reported as unresolved (it needs a
// login added to its profile before it can be mapped).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WRITE = process.argv.includes('--write');

/** Extract a github login from a links.github value (URL or bare handle). */
function githubLogin(value) {
  if (!value) return null;
  const m = value.match(/github\.com\/([^/?#\s"]+)/i);
  if (m) return m[1];
  const handle = value.trim().replace(/^@/, '').replace(/^"|"$/g, '');
  return /^[a-z0-9-]+$/i.test(handle) ? handle : null;
}

/** Read the links.github value from a profile.md (simple line scan under links:). */
function profileGithub(text) {
  const m = text.match(/^\s*github:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^"|"$/g, '') : null;
}

async function resolveId(login, token) {
  const headers = { 'User-Agent': 'gbti-member-id-resolver', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers });
  if (!res.ok) return { error: `${res.status}` };
  const body = await res.json();
  return { id: String(body.id), login: body.login, type: body.type };
}

const membersDir = path.join(ROOT, 'members');
const folders = fs.readdirSync(membersDir).filter((f) => fs.statSync(path.join(membersDir, f)).isDirectory());

const resolved = []; // { username, login, id, type }
const unresolved = []; // { username, reason }
const token = process.env.GITHUB_TOKEN || null;

for (const username of folders.sort()) {
  const profilePath = path.join(membersDir, username, 'profile.md');
  if (!fs.existsSync(profilePath)) {
    unresolved.push({ username, reason: 'no profile.md' });
    continue;
  }
  const login = githubLogin(profileGithub(fs.readFileSync(profilePath, 'utf8')));
  if (!login) {
    unresolved.push({ username, reason: 'no links.github in profile' });
    continue;
  }
  const r = await resolveId(login, token);
  if (r.error || !r.id) {
    unresolved.push({ username, reason: `lookup failed for ${login} (${r.error ?? 'no id'})` });
    continue;
  }
  resolved.push({ username, login: r.login, id: r.id, type: r.type });
}

console.table(resolved);
if (unresolved.length) {
  console.log('\nUnresolved (need a github login in the profile, or a manual entry):');
  for (const u of unresolved) console.log(`  - ${u.username}: ${u.reason}`);
}

const HEADER = `# Authoritative github_id -> username map (ADMIN-owned; reconcile-maintained).
# The PR-gate and the scoping CI resolve a PR author's immutable github_id to the folder they own
# through this map, NOT through "folder name == current login" (which breaks on a GitHub rename).
# On a rename the reconcile migrates the folder, adds a redirect, and updates this entry, so a member
# is never locked out of their own folder. Each members/<username>/profile.md also carries its
# links.github; this file is the fast index resolved from those (see scripts/resolve-member-ids.mjs).
#
# Keys are immutable github_id values (strings). Values are the lowercase folder/username.`;

const body = resolved
  .slice()
  .sort((a, b) => a.username.localeCompare(b.username))
  .map((r) => `  "${r.id}": ${r.username}${r.type === 'Organization' ? '   # organization account' : ''}`)
  .join('\n');

const yaml = `${HEADER}\nmembers:\n${body || '  {}'}\n`;

if (WRITE) {
  fs.writeFileSync(path.join(ROOT, 'house/members-index.yml'), yaml);
  console.log(`\nWrote house/members-index.yml with ${resolved.length} member(s).`);
} else {
  console.log('\nDRY RUN. Re-run with --write to update house/members-index.yml.\n');
  console.log(yaml);
}

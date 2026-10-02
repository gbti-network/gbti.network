// sow-439 (owner, 2026-10-02: "Give everyone a starter page"): every paying member gets a public profile page as soon
// as they are enrolled, which they fill in later.
//
// Why it is needed: a member's page is built ONLY from members/<folder>/profile.md (src/pages/members/[username].astro),
// and a new member has none until they write one. The first member through the Codeable invite clicked "Profile" a
// minute after joining and got "We could not find that page"; 18 of the 32 enrolled members had no profile that day.
//
// Why it is a real profile FILE and not a page made up at build time: every existing path then applies to it. The
// WorkBench profile editor opens it as the member's own profile; a ban drafts it like any other published file
// (reconcile-plan.mjs); an erasure deletes it with the folder; a lapse leaves it, as with any profile (sow-197).
//
// What it says: the member's GitHub display name (else their login), their GitHub picture (by account number, so a
// renamed login keeps it), a GitHub link, and ONE line in the third person,
// "<Name> is a member of the GBTI Network.", the wording the auto-written profiles already use. Nothing is written in
// the member's own voice. It starts out of the member directory (directory: false), which stays the member's choice.
//
// Who gets one: an effective-paid member (the gather hosted enrollment uses, so a banned or lapsed account never does)
// whose folder in the members index has NO profile.md in any state. A draft or hidden profile is the member's own
// choice and is left alone. Nothing is ever overwritten: main is re-checked for each file right before it is written.
// The writes go out as ONE bot PR merged in the same run, the enrollment pattern (scripts/lib/enroll-members.mjs).
//
// Nothing is announced: syndication and notifications read a profile only for the author's name.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { parseMembersIndex } from '../../membership/hosted-author.mjs';
import { MEMBERS_INDEX_PATH, resolveGithubUser } from './enroll-members.mjs';
import { idAvatarUrl } from '../../membership/member-avatar.mjs'; // sow-428: the picture by GitHub account number

const FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Folders that never get a starter page: the test account the live checks sign in as, and the house. */
export const STARTER_SKIP = Object.freeze(new Set(['gbti-test-member', 'gbti', 'house']));

export const profilePath = (folder) => `members/${folder}/profile.md`;

/**
 * A display name safe to put on a public page: letters, numbers, spaces and plain punctuation only, whitespace
 * collapsed, at most 80 characters. Anything that could be markup or YAML structure is dropped. Pure.
 */
export function cleanDisplayName(name) {
  const s = String(name ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} .,'&()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return /\p{L}|\p{N}/u.test(s) ? s : '';
}

/**
 * The starter profile file. Pure. `displayName` is cleaned and falls back to the login, then the folder; the result
 * is proven to parse back to the same fields before it is returned, so a malformed file can never reach a PR.
 */
export function starterProfileText({ folder, displayName, githubLogin, githubId = null, joinedAt = new Date() } = {}) {
  if (!FOLDER_RE.test(String(folder ?? ''))) throw new Error(`starter profile: ${folder} is not a valid folder`);
  const login = LOGIN_RE.test(String(githubLogin ?? '')) ? String(githubLogin) : null;
  const name = cleanDisplayName(displayName) || login || folder;
  const date = (joinedAt instanceof Date ? joinedAt : new Date(joinedAt)).toISOString().slice(0, 10);
  const avatar = /^\d{1,20}$/.test(String(githubId ?? '')) ? idAvatarUrl(String(githubId), 460) : ''; // 460: the profile header draws it 300px wide
  const lines = [
    '---',
    'type: profile',
    `username: ${folder}`,
    `displayName: ${JSON.stringify(name)}`,
    'tier: paid',
    'directory: false',
    'status: published',
    'visibility: public',
    ...(avatar ? [`avatar: ${JSON.stringify(avatar)}`] : []),
    ...(login ? ['links:', `  github: ${JSON.stringify(`https://github.com/${login}`)}`] : []),
    `joinedAt: ${date}`,
    '---',
    '',
    `${name} is a member of the GBTI Network.`,
    '',
  ];
  const text = lines.join('\n');
  const fm = yaml.load(text.split('---')[1]);
  if (fm?.username !== folder || fm?.displayName !== name || fm?.status !== 'published' || fm?.directory !== false) {
    throw new Error(`starter profile: the file for ${folder} did not parse back`);
  }
  return text;
}

/**
 * Who gets a starter page. Pure. `members` is the reconcile gather ({ githubId, githubLogin, effective: { status } });
 * `membersIndex` is the github_id -> folder Map from main; `hasProfile(folder)` says whether a profile.md exists in ANY
 * state. Returns [{ githubId, folder, hintLogin }].
 */
export function starterCandidates({ members, membersIndex, hasProfile } = {}) {
  const out = [];
  const seen = new Set();
  for (const m of members ?? []) {
    const id = String(m?.githubId ?? '');
    if (!id || m?.effective?.status !== 'paid') continue;
    const folder = membersIndex?.get?.(id);
    if (!folder || !FOLDER_RE.test(folder) || STARTER_SKIP.has(folder) || seen.has(folder)) continue;
    if (hasProfile?.(folder) !== false) continue; // a profile, or an unknown answer: leave it alone
    seen.add(folder);
    out.push({ githubId: id, folder, hintLogin: m.githubLogin ?? null });
  }
  return out;
}

/** Whether main holds the file: true, false (a 404), or null when the answer is unknown (fail closed: no write). */
async function existsOnMain(github, p) {
  try { await github.getContent(p, 'main'); return true; } catch (e) { return e?.status === 404 ? false : null; }
}

/**
 * The reconcile step. Plans from the members index as it is on main (the checkout's copy when main cannot be read), then
 * (unless dryRun) checks main for every file and writes the missing ones as ONE PR merged in the same run. Returns a summary the reconcile
 * logs. Fail soft overall (a miss heals on the next run); fail closed per member.
 */
export async function syncStarterProfiles({
  members, root, env = process.env, github = null, now = new Date(), dryRun = true,
  fetchImpl = globalThis.fetch, resolveUser = resolveGithubUser,
} = {}) {
  const localIndex = () => {
    try { return parseMembersIndex(fs.readFileSync(path.join(root, MEMBERS_INDEX_PATH), 'utf8')); } catch { return new Map(); }
  };
  let membersIndex = localIndex();
  if (github) {
    // The index as it is on main NOW (a read, so a dry run does it too): an enrollment merged earlier in this same run
    // is on main, not in the checkout, and a dry run should list exactly what an apply would write.
    try {
      const cur = await github.getContent(MEMBERS_INDEX_PATH, 'main');
      const text = Buffer.from(String(cur?.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8');
      if (text) membersIndex = parseMembersIndex(text);
    } catch { /* keep the checkout's copy */ }
  }
  const localHas = (folder) => {
    try { return fs.existsSync(path.join(root, profilePath(folder))); } catch { return null; }
  };
  const planned = starterCandidates({ members, membersIndex, hasProfile: localHas });
  if (!planned.length) return { synced: false, reason: 'every paying member has a profile', additions: [], skipped: [] };

  const additions = [];
  const skipped = [];
  for (const c of planned) {
    const user = await resolveUser(c.githubId, { token: env.GITHUB_BOT_TOKEN, fetchImpl });
    const login = user?.login || c.hintLogin || null;
    additions.push({ githubId: c.githubId, folder: c.folder, login, displayName: cleanDisplayName(user?.name) || login || c.folder });
  }
  if (dryRun) return { synced: false, reason: 'dry run', additions, skipped };
  if (!github) return { synced: false, reason: 'no github client to write the starter profiles', additions, skipped };

  const writes = [];
  for (const a of additions) {
    const there = await existsOnMain(github, profilePath(a.folder));
    if (there === false) writes.push(a);
    else skipped.push({ folder: a.folder, reason: there ? 'a profile appeared on main meanwhile' : 'could not check main' });
  }
  if (!writes.length) return { synced: false, reason: 'nothing left to write after checking main', additions: [], skipped };

  const branch = `gbti/starter-profiles-${now.getTime()}`;
  const baseSha = (await github.getRef('heads/main'))?.object?.sha;
  if (!baseSha) throw new Error('starter profiles: cannot resolve the main head sha');
  await github.createRef(branch, baseSha);
  const written = [];
  for (const a of writes) {
    try {
      const text = starterProfileText({ folder: a.folder, displayName: a.displayName, githubLogin: a.login, githubId: a.githubId, joinedAt: now });
      await github.putContent(profilePath(a.folder), {
        message: `reconcile: a starter profile for ${a.folder} (sow-439)`,
        content: Buffer.from(text, 'utf8').toString('base64'),
        branch,
      });
      written.push(a);
    } catch (e) {
      skipped.push({ folder: a.folder, reason: `write failed: ${e?.message ?? e}` });
    }
  }
  if (!written.length) return { synced: false, reason: 'every write failed', additions: [], skipped };
  const pull = await github.createPull({
    title: 'reconcile: starter profiles for paying members (sow-439)',
    head: branch,
    base: 'main',
    body: `Adds a starter profile page for ${written.length} paying member(s) who had none, so their profile link leads somewhere. Each member can rewrite theirs in the WorkBench.`,
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, additions: written, skipped };
}

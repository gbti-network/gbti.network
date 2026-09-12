// sow-329: the owner email when a member's profile changes on main. Covers the push selection (new, updated,
// removed, renamed, fail-closed), the social-link diff, the rendered notice, the CLI's send/dry-run/fail-soft
// paths, and the workflow wiring. No network, no git: git is a fake, frontmatter goes through the REAL
// parseContentFile so the YAML path is exercised end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  selectProfileChanges,
  diffLinks,
  socialLabel,
  profileUpdateNotice,
  profileUsername,
} from '../scripts/lib/profile-update-notice.mjs';
import { parseArgs, run } from '../scripts/notify-profile-updates.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEFORE = 'a'.repeat(40);
const AFTER = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

// A fake git: `diff --name-status` answers a fixed table; `show <sha>:<path>` answers from a file map and throws
// (as git does) for a path absent at that ref.
function fakeGit({ nameStatus = '', files = {} } = {}) {
  return (args) => {
    if (args[0] === 'diff') return nameStatus;
    if (args[0] === 'show') {
      if (!(args[1] in files)) { const e = new Error('does not exist in the given tree'); e.status = 128; throw e; }
      return files[args[1]];
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

const ANA_V1 = `---
type: profile
username: ana
displayName: Ana Lopez
headline: Builds home servers
links:
  github: https://github.com/ana
  x: https://x.com/ana_old
---

I run a **Proxmox** box at home.
`;

const ANA_V2 = `---
type: profile
username: ana
displayName: Ana Lopez
headline: Builds home servers and writes about them
links:
  github: https://github.com/ana
  x: https://x.com/ana
  bluesky: https://bsky.app/profile/ana.bsky.social
---

I run a **Proxmox** box at home, and I write about it.
`;

const BO_NEW = `---
type: profile
username: bo
displayName: Bo Chen
links:
  linkedin: https://www.linkedin.com/in/bochen
  mastodon: https://fosstodon.org/@bo
---

Hello.
`;

const CY_MEMBERS = `---
type: profile
username: cy
displayName: Cy
visibility: members
---
`;

const select = (nameStatus, files, extra = {}) =>
  selectProfileChanges({ before: BEFORE, after: AFTER, runGit: fakeGit({ nameStatus, files }), parseFile: parseContentFile, ...extra });

// --- selection ------------------------------------------------------------------------------------------

test('profileUsername recognises only members/<username>/profile.md', () => {
  assert.equal(profileUsername('members/ana/profile.md'), 'ana');
  assert.equal(profileUsername('members/ana/posts/x/index.md'), null);
  assert.equal(profileUsername('house/profile.md'), null);
  assert.equal(profileUsername('members/ana/profile.md.bak'), null);
});

test('selectProfileChanges: an added profile is new, a modified one is updated, content files are ignored', () => {
  const changes = select(
    'A\tmembers/bo/profile.md\nM\tmembers/ana/profile.md\nA\tmembers/ana/posts/hello/index.md\n',
    {
      [`${AFTER}:members/bo/profile.md`]: BO_NEW,
      [`${BEFORE}:members/ana/profile.md`]: ANA_V1,
      [`${AFTER}:members/ana/profile.md`]: ANA_V2,
      [`${AFTER}:members/ana/posts/hello/index.md`]: '---\ntitle: x\n---\n',
    },
  );
  assert.deepEqual(changes.map((c) => [c.username, c.change]), [['bo', 'new'], ['ana', 'updated']]);
  assert.equal(changes[0].before, null);
  assert.equal(changes[1].before.frontmatter.headline, 'Builds home servers');
  assert.equal(changes[1].after.frontmatter.links.bluesky, 'https://bsky.app/profile/ana.bsky.social');
  assert.match(changes[1].after.body, /Proxmox/);
});

test('selectProfileChanges: a deleted profile is removed, read from the before side', () => {
  const [c] = select('D\tmembers/ana/profile.md\n', { [`${BEFORE}:members/ana/profile.md`]: ANA_V1 });
  assert.equal(c.change, 'removed');
  assert.equal(c.after, null);
  assert.equal(c.before.frontmatter.displayName, 'Ana Lopez');
});

test('selectProfileChanges: a renamed profile folder reports as an update of the new path', () => {
  const [c] = select('R095\tmembers/ana-old/profile.md\tmembers/ana/profile.md\n', {
    [`${BEFORE}:members/ana-old/profile.md`]: ANA_V1,
    [`${AFTER}:members/ana/profile.md`]: ANA_V2,
  });
  assert.equal(c.path, 'members/ana/profile.md');
  assert.equal(c.change, 'updated');
});

test('selectProfileChanges: a modified profile with no readable before side is reported as new', () => {
  const [c] = select('M\tmembers/ana/profile.md\n', { [`${AFTER}:members/ana/profile.md`]: ANA_V2 });
  assert.equal(c.change, 'new');
});

test('selectProfileChanges fails closed: zero or missing refs, no parser, or a git error select nothing', () => {
  const files = { [`${AFTER}:members/bo/profile.md`]: BO_NEW };
  const ns = 'A\tmembers/bo/profile.md\n';
  assert.deepEqual(select(ns, files, { before: ZERO }), []);
  assert.deepEqual(select(ns, files, { before: '' }), []);
  assert.deepEqual(select(ns, files, { after: undefined }), []);
  assert.deepEqual(select(ns, files, { parseFile: undefined }), []);
  const broken = () => { throw new Error('fatal: bad revision'); };
  assert.deepEqual(selectProfileChanges({ before: BEFORE, after: AFTER, runGit: broken, parseFile: parseContentFile }), []);
});

// --- social links ---------------------------------------------------------------------------------------

test('diffLinks marks new, changed, removed and unchanged, in editor order', () => {
  const rows = diffLinks(
    { github: 'https://github.com/ana', x: 'https://x.com/ana_old', youtube: 'https://youtube.com/@ana' },
    { github: 'https://github.com/ana', x: 'https://x.com/ana', bluesky: 'https://bsky.app/profile/ana' },
  );
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [
    ['github', 'unchanged'], ['x', 'changed'], ['bluesky', 'new'], ['youtube', 'removed'],
  ]);
  assert.equal(rows.find((r) => r.key === 'x').previous, 'https://x.com/ana_old');
  assert.equal(rows.find((r) => r.key === 'youtube').url, 'https://youtube.com/@ana', 'a removed row keeps the old URL');
});

test('diffLinks lists every key present, including ones the editor no longer offers, with a fallback label', () => {
  const rows = diffLinks(null, { mastodon: 'https://fosstodon.org/@bo', linkedin: 'https://linkedin.com/in/bo' });
  assert.deepEqual(rows.map((r) => [r.label, r.status]), [['LinkedIn', 'new'], ['Mastodon', 'new']]);
  assert.equal(socialLabel('x'), 'X');
  assert.deepEqual(diffLinks({ github: '' }, { github: '  ' }), [], 'blank values are not accounts');
});

// --- the notice ----------------------------------------------------------------------------------------

const opts = { repo: 'gbti-network/gbti.network', before: BEFORE, after: AFTER };

test('an update names the member, links the live profile and the diff, and marks the new and changed accounts', () => {
  const changes = select('M\tmembers/ana/profile.md\n', {
    [`${BEFORE}:members/ana/profile.md`]: ANA_V1,
    [`${AFTER}:members/ana/profile.md`]: ANA_V2,
  });
  const { subject, text, html } = profileUpdateNotice(changes, opts);
  assert.equal(subject, 'Profile updated: Ana Lopez (@ana)');
  assert.match(text, /Visibility: public page/);
  assert.match(text, /Live profile: https:\/\/gbti\.network\/members\/ana\//);
  assert.match(text, new RegExp(`File on GitHub: https://github.com/gbti-network/gbti.network/blob/${AFTER}/members/ana/profile.md`));
  assert.match(text, /Bluesky: https:\/\/bsky\.app\/profile\/ana\.bsky\.social \(new\)/);
  assert.match(text, /X: https:\/\/x\.com\/ana \(changed, was https:\/\/x\.com\/ana_old\)/);
  assert.match(text, /GitHub: https:\/\/github\.com\/ana\n/, 'an unchanged account carries no mark');
  assert.match(text, new RegExp(`compare/${BEFORE}\\.\\.\\.${AFTER}`));
  assert.match(text, /Bio: I run a Proxmox box at home, and I write about it\./, 'the bio excerpt is plain text');

  assert.match(html, /^<!doctype html>/i);
  for (const fact of ['Ana Lopez', 'Builds home servers and writes about them', 'https://bsky.app/profile/ana.bsky.social', 'https://gbti.network/members/ana/']) {
    assert.ok(html.includes(fact), `html carries: ${fact}`);
  }
});

test('a new profile, a removed profile and several at once each get their own subject', () => {
  const bo = select('A\tmembers/bo/profile.md\n', { [`${AFTER}:members/bo/profile.md`]: BO_NEW });
  assert.equal(profileUpdateNotice(bo, opts).subject, 'New profile: Bo Chen (@bo)');
  assert.match(profileUpdateNotice(bo, opts).text, /Mastodon: https:\/\/fosstodon\.org\/@bo \(new\)/);

  const gone = select('D\tmembers/ana/profile.md\n', { [`${BEFORE}:members/ana/profile.md`]: ANA_V1 });
  const removed = profileUpdateNotice(gone, opts);
  assert.equal(removed.subject, 'Profile removed: @ana');
  assert.match(removed.text, /Visibility: removed from the repository/);
  assert.doesNotMatch(removed.text, /Live profile:/);
  assert.match(removed.text, new RegExp(`blob/${BEFORE}/members/ana/profile.md`), 'a removed profile links the last version');

  const both = [...bo, ...gone];
  assert.equal(profileUpdateNotice(both, opts).subject, '2 member profiles changed');
});

test('visibility: no live link for a members-only or draft profile; missing fields default to public like the site', () => {
  const cy = select('A\tmembers/cy/profile.md\n', { [`${AFTER}:members/cy/profile.md`]: CY_MEMBERS });
  const members = profileUpdateNotice(cy, opts).text;
  assert.match(members, /Visibility: members-only, no public page/);
  assert.doesNotMatch(members, /Live profile:/);
  assert.match(members, /Headline: \(none\)/);
  assert.match(members, /Bio: \(no bio\)/);
  assert.match(members, /\(none listed\)/);

  const draft = select('A\tmembers/cy/profile.md\n', { [`${AFTER}:members/cy/profile.md`]: CY_MEMBERS.replace('visibility: members', 'status: draft') });
  assert.match(profileUpdateNotice(draft, opts).text, /Visibility: draft, no public page/);

  // BO_NEW has neither status nor visibility; the site treats that as published + public, and so must the email.
  const bo = select('A\tmembers/bo/profile.md\n', { [`${AFTER}:members/bo/profile.md`]: BO_NEW });
  assert.match(profileUpdateNotice(bo, opts).text, /Live profile: https:\/\/gbti\.network\/members\/bo\//);
});

test('nothing to report renders nothing, and the copy carries no em or en dashes', () => {
  assert.equal(profileUpdateNotice([], opts), null);
  const changes = select('M\tmembers/ana/profile.md\nA\tmembers/bo/profile.md\n', {
    [`${BEFORE}:members/ana/profile.md`]: ANA_V1,
    [`${AFTER}:members/ana/profile.md`]: ANA_V2,
    [`${AFTER}:members/bo/profile.md`]: BO_NEW,
  });
  const { subject, text } = profileUpdateNotice(changes, opts);
  assert.ok(!/[–—]/.test(subject + text), 'shipped copy follows the no-dash writing rule');
});

// --- the CLI --------------------------------------------------------------------------------------------

const gitFor = () => fakeGit({
  nameStatus: 'M\tmembers/ana/profile.md\n',
  files: { [`${BEFORE}:members/ana/profile.md`]: ANA_V1, [`${AFTER}:members/ana/profile.md`]: ANA_V2 },
});
const quiet = { log: () => {}, warn: () => {} };
const baseEnv = { PROFILE_BEFORE: BEFORE, PROFILE_AFTER: AFTER, ALERT_EMAIL: 'owner@example.com', RESEND_API_KEY: 're_test' };

test('parseArgs reads --apply, --before and --after in both forms', () => {
  assert.deepEqual(parseArgs(['--apply', '--before', 'x', '--after=y']), { apply: true, before: 'x', after: 'y' });
  assert.deepEqual(parseArgs([]), { apply: false, before: null, after: null });
});

test('the CLI is a dry run by default and sends nothing', async () => {
  let calls = 0;
  const r = await run({ argv: [], env: baseEnv, runGit: gitFor(), sendEmail: async () => { calls++; }, ...quiet });
  assert.equal(r.reason, 'dry-run');
  assert.equal(calls, 0);
  assert.equal(r.notice.subject, 'Profile updated: Ana Lopez (@ana)');
});

test('--apply sends exactly one email to ALERT_EMAIL from RESEND_FROM', async () => {
  const sent = [];
  const r = await run({ argv: ['--apply'], env: { ...baseEnv, RESEND_FROM: 'GBTI <noreply@gbti.network>' }, runGit: gitFor(), sendEmail: async (m) => { sent.push(m); }, ...quiet });
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.equal(sent[0].from, 'GBTI <noreply@gbti.network>');
  assert.equal(sent[0].subject, 'Profile updated: Ana Lopez (@ana)');
  assert.ok(sent[0].html && sent[0].text);
});

test('the CLI fails soft: no recipient, a send error, or no changes never throws and never sends twice', async () => {
  let calls = 0;
  const noTo = await run({ argv: ['--apply'], env: { ...baseEnv, ALERT_EMAIL: '' }, runGit: gitFor(), sendEmail: async () => { calls++; }, ...quiet });
  assert.equal(noTo.reason, 'unconfigured');
  assert.equal(calls, 0);

  const boom = await run({ argv: ['--apply'], env: baseEnv, runGit: gitFor(), sendEmail: async () => { throw new Error('422 invalid from'); }, ...quiet });
  assert.equal(boom.reason, 'send-failed');

  const none = await run({ argv: ['--apply'], env: baseEnv, runGit: fakeGit({ nameStatus: '' }), sendEmail: async () => { calls++; }, ...quiet });
  assert.equal(none.reason, 'no-changes');
  assert.equal(calls, 0);
});

// --- the workflow wiring ---------------------------------------------------------------------------------

test('the workflow runs on profile changes only, diffs the whole push, sends with --apply, and cannot go red on mail', () => {
  const y = readFileSync(path.join(ROOT, '.github/workflows/profile-update-alert.yml'), 'utf8');
  assert.match(y, /paths:\s*\n\s*- 'members\/\*\/profile\.md'/);
  assert.match(y, /fetch-depth: 0/);
  assert.match(y, /PROFILE_BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.match(y, /PROFILE_AFTER: \$\{\{ github\.sha \}\}/);
  assert.match(y, /node scripts\/notify-profile-updates\.mjs --apply/);
  assert.match(y, /continue-on-error: true/);
  assert.match(y, /ALERT_EMAIL: \$\{\{ vars\.ALERT_EMAIL \}\}/);
});

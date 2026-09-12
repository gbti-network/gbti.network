// sow-329: the owner email when a member's profile changes on main.
//
// WHY THIS EXISTS. A paid member's edit to their own members/<username>/profile.md goes public with no human
// review: the PR gate classifies it as an own-folder change, clears it at the paid publishing tier and
// squash-merges it (scripts/pr-gate.mjs). Nothing else observes a profile change, so this notice is the owner's
// first look at what went public, for two jobs: checking it against the community guidelines, and following any
// social accounts the member added.
//
// A POST-MERGE OBSERVER, NOT A GATE. It reads what already landed on main (the push's before..after range), so it
// sees every route a profile takes to main: the fork PR, the hosted PR, and a direct superadmin commit. It never
// blocks anything; a profile is already public by the time this runs.
//
// Mirrors scripts/lib/publish-transitions.mjs (the before/after diff, the zero-SHA guard, the injectable git
// runner). It cannot call that module, because its content-path test deliberately rejects profile.md.
//
// FAIL-CLOSED on selection: an unreadable or zero before ref selects NOTHING, so a force-push or a first push can
// never email the owner about every profile in the repository at once.

import { execFileSync } from 'node:child_process';
import { opsEmail } from '../../membership/mail-ops.mjs';
import { SOCIAL_KEYS, SOCIAL_LABELS } from '../../client-ui/src/social-icons.mjs';
import { bioExcerpt } from '../../src/lib/members-directory.mjs';
import { isPublic } from '../../src/lib/content-gating.mjs';

const ZERO_SHA = '0000000000000000000000000000000000000000';
const PROFILE_RE = /^members\/([^/]+)\/profile\.md$/;
export const SITE_BASE = 'https://gbti.network';

const str = (v) => (v == null ? '' : String(v));
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** The username a profile path belongs to, or null when the path is not a member profile. */
export function profileUsername(p) {
  const m = PROFILE_RE.exec(str(p));
  return m ? m[1] : null;
}

const defaultRunGit = (args, root) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function readFile(runGit, sha, p, parseFile) {
  let txt;
  try { txt = runGit(['show', `${sha}:${p}`]); } catch { return null; } // absent at that ref
  if (txt == null) return null;
  try {
    const parsed = parseFile(txt);
    return { frontmatter: isObj(parsed?.frontmatter) ? parsed.frontmatter : {}, body: str(parsed?.body) };
  } catch { return null; }
}

/**
 * The member profiles that changed between `before` and `after`, one entry per profile:
 * `{ path, username, change: 'new' | 'updated' | 'removed', before, after }`, where `before` / `after` are
 * `{ frontmatter, body }` or null when that side does not exist.
 *
 * `runGit(args)` runs git in the repo (injectable for tests); `parseFile(text)` returns `{ frontmatter, body }`
 * (inject client/src/content-ops.mjs parseContentFile). Fail-closed: a missing parser, a missing or zero ref, or
 * a git error selects [].
 */
export function selectProfileChanges({ before, after, root = '.', runGit, parseFile } = {}) {
  const git = runGit ?? ((args) => defaultRunGit(args, root));
  if (typeof parseFile !== 'function') return [];
  if (!before || !after || before === ZERO_SHA || after === ZERO_SHA) return [];
  let raw;
  try { raw = git(['diff', '--name-status', '-M', before, after, '--', 'members']); }
  catch { return []; }

  const out = [];
  for (const line of str(raw).split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const code = cols[0] || '';
    let oldPath = null;
    let newPath = null;
    if (code.startsWith('R') || code.startsWith('C')) { oldPath = cols[1]; newPath = cols[2]; }
    else if (code.startsWith('A')) { newPath = cols[1]; }
    else if (code.startsWith('M') || code.startsWith('T')) { oldPath = cols[1]; newPath = cols[1]; }
    else if (code.startsWith('D')) { oldPath = cols[1]; }
    else continue;

    const newUser = profileUsername(newPath);
    const oldUser = profileUsername(oldPath);

    if (newUser) {
      const afterFile = readFile(git, after, newPath, parseFile);
      if (!afterFile) continue; // unreadable after side: nothing trustworthy to report
      const beforeFile = oldPath ? readFile(git, before, oldPath, parseFile) : null;
      out.push({
        path: newPath,
        username: str(afterFile.frontmatter.username).trim() || newUser,
        change: beforeFile ? 'updated' : 'new',
        before: beforeFile,
        after: afterFile,
      });
    } else if (oldUser) {
      // Deleted, or moved away from a profile path: the profile is gone from where the site reads it.
      const beforeFile = readFile(git, before, oldPath, parseFile);
      out.push({
        path: oldPath,
        username: str(beforeFile?.frontmatter?.username).trim() || oldUser,
        change: 'removed',
        before: beforeFile,
        after: null,
      });
    }
  }
  return out;
}

/** A human label for a social key. A key the label map does not carry (the retired `mastodon` is still valid in
 *  the schema) gets a capitalized fallback, so no account is ever dropped from the list for want of a label. */
export function socialLabel(key) {
  const k = str(key);
  return SOCIAL_LABELS[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : k);
}

/**
 * Compare two `links` objects. One row per key that has a value on either side:
 * `{ key, label, url, previous, status: 'new' | 'changed' | 'removed' | 'unchanged' }`. Ordered by SOCIAL_KEYS
 * (the order members see in the editor), then any other keys alphabetically.
 */
export function diffLinks(beforeLinks, afterLinks) {
  const b = isObj(beforeLinks) ? beforeLinks : {};
  const a = isObj(afterLinks) ? afterLinks : {};
  const present = new Set([...Object.keys(b), ...Object.keys(a)].filter((k) => str(b[k]).trim() || str(a[k]).trim()));
  const known = SOCIAL_KEYS.filter((k) => present.has(k));
  const extra = [...present].filter((k) => !SOCIAL_KEYS.includes(k)).sort();

  return [...known, ...extra].map((key) => {
    const bv = str(b[key]).trim();
    const av = str(a[key]).trim();
    let status = 'unchanged';
    if (!bv && av) status = 'new';
    else if (bv && !av) status = 'removed';
    else if (bv !== av) status = 'changed';
    return { key, label: socialLabel(key), url: av || bv, previous: status === 'changed' ? bv : null, status };
  });
}

function statusMark(row) {
  if (row.status === 'new') return 'new';
  if (row.status === 'removed') return 'removed';
  if (row.status === 'changed') return `changed, was ${row.previous}`;
  return '';
}

const CHANGE_LABEL = { new: 'New profile', updated: 'Profile updated', removed: 'Profile removed' };

// A profile read straight from git has no schema defaults applied, but the site's collection does (a profile with
// no status is published, with no visibility is public). Apply the same two defaults before asking isPublic, or a
// perfectly public profile would be reported as having no page.
function visibilityOf(change) {
  if (change.change === 'removed') return { text: 'removed from the repository', isLive: false };
  const fm = change.after?.frontmatter ?? {};
  const data = { ...fm, status: fm.status ?? 'published', visibility: fm.visibility ?? 'public' };
  if (isPublic({ data })) return { text: 'public page', isLive: true };
  if (data.status !== 'published') return { text: 'draft, no public page', isLive: false };
  return { text: 'members-only, no public page', isLive: false };
}

function describe(change, { repo, before, after, siteBase }) {
  const side = change.after ?? change.before ?? { frontmatter: {}, body: '' };
  const fm = side.frontmatter ?? {};
  const username = change.username;
  const name = str(fm.displayName).trim() || username;
  const headline = str(fm.headline).trim() || '(none)';
  const vis = visibilityOf(change);
  const liveUrl = vis.isLive ? `${siteBase}/members/${encodeURIComponent(username)}/` : null;
  const ref = change.change === 'removed' ? before : after;
  const fileUrl = repo && ref ? `https://github.com/${repo}/blob/${ref}/${change.path}` : null;
  const bio = bioExcerpt(side.body) || '(no bio)';
  const links = diffLinks(change.before?.frontmatter?.links, change.after?.frontmatter?.links);
  return { username, name, headline, vis, liveUrl, fileUrl, bio, links, changeLabel: CHANGE_LABEL[change.change] };
}

/**
 * Render the owner email for one push's profile changes. Returns `{ subject, text, html }`, or null when there is
 * nothing to report (the caller sends nothing). Never throws on a sparse profile: a missing field renders as an
 * explicit placeholder.
 */
export function profileUpdateNotice(changes, { repo = '', before = '', after = '', siteBase = SITE_BASE } = {}) {
  const list = Array.isArray(changes) ? changes : [];
  if (!list.length) return null;
  const items = list.map((c) => ({ change: c, d: describe(c, { repo, before, after, siteBase }) }));

  let subject;
  if (items.length === 1) {
    const { change, d } = items[0];
    subject = change.change === 'removed'
      ? `Profile removed: @${d.username}`
      : `${change.change === 'new' ? 'New profile' : 'Profile updated'}: ${d.name} (@${d.username})`;
  } else {
    subject = `${items.length} member profiles changed`;
  }

  const lead = items.length === 1
    ? 'A member changed their profile. Profile changes publish with no review, so this is the first look anyone gets.'
    : `${items.length} member profiles changed in one push to main. Profile changes publish with no review, so this is the first look anyone gets.`;
  const compareUrl = repo && before && after ? `https://github.com/${repo}/compare/${before}...${after}` : null;
  const closing = 'Check each profile against the community guidelines, and follow any new social accounts.';

  const lines = [lead, ''];
  const sections = [];
  for (const { d } of items) {
    lines.push(`${d.name} (@${d.username})`);
    lines.push(`Change: ${d.changeLabel}`);
    lines.push(`Headline: ${d.headline}`);
    lines.push(`Visibility: ${d.vis.text}`);
    if (d.liveUrl) lines.push(`Live profile: ${d.liveUrl}`);
    if (d.fileUrl) lines.push(`File on GitHub: ${d.fileUrl}`);
    lines.push(`Bio: ${d.bio}`);
    lines.push('Social accounts:');
    if (d.links.length) {
      for (const row of d.links) {
        const mark = statusMark(row);
        lines.push(`  ${row.label}: ${row.url}${mark ? ` (${mark})` : ''}`);
      }
    } else {
      lines.push('  (none listed)');
    }
    lines.push('');

    sections.push({ kind: 'fields', rows: [
      ['Member', `${d.name} (@${d.username})`],
      ['Change', d.changeLabel],
      ['Headline', d.headline],
      ['Visibility', d.vis.text],
      ...(d.liveUrl ? [['Live profile', d.liveUrl]] : []),
      ...(d.fileUrl ? [['File on GitHub', d.fileUrl]] : []),
    ] });
    sections.push({ kind: 'paragraph', text: 'Bio excerpt' });
    sections.push({ kind: 'pre', text: d.bio });
    if (d.links.length) {
      sections.push({
        kind: 'table',
        columns: ['Account', 'Link', 'Change'],
        rows: d.links.map((row) => [row.label, row.url, statusMark(row)]),
      });
    } else {
      sections.push({ kind: 'paragraph', text: 'No social accounts listed.' });
    }
  }
  if (compareUrl) lines.push(`Everything in this push: ${compareUrl}`);
  lines.push(closing);

  const { html } = opsEmail({
    title: items.length === 1 ? items[0].d.changeLabel : 'Member profiles changed',
    lead,
    sections: [
      ...sections,
      ...(compareUrl ? [{ kind: 'fields', rows: [['Everything in this push', compareUrl]] }] : []),
      { kind: 'note', text: closing },
    ],
    footer: 'Sent by the profile update alert workflow on pushes to main.',
  });

  return { subject, text: lines.join('\n'), html };
}

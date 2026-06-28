// SOW-059 C-gather: at PAYOUT, populate a frozen snapshot's collaboration `points` (the 5% pool) from git. For each
// of the snapshot's two frozen touch items, it reads the contributors[] credited on the item (SOW-059 `at` = the
// merge date) and the native comments targeting it (their createdAt), resolves each actor's username -> github_id,
// and feeds qualifyingCollaboration (which excludes the item owner, the author-intro comment, and anything at/after
// the conversion instant). The snapshot was frozen with `points: []`; this reconstructs them deterministically (the
// items + the conversion window are pinned), so gathering later is equivalent to freezing them then.
//
// Node-only (reads the local repo checkout in the offline payout job). The pure transform buildCollaborationEvents
// is injectable-IO so it unit-tests with no filesystem.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { qualifyingCollaboration } from '../../membership/revenue-model.mjs';

const TYPE_DIR = { post: 'posts', product: 'products', prompt: 'prompts' };
export const itemKey = (it) => `${it.owner}::${it.type}::${it.slug}`;
export const typeSlugKey = (type, slug) => `${type}::${slug}`;

/** Epoch ms from a yaml date (js-yaml returns a Date for `2025-09-27`) or an ISO string; NaN when unparseable. */
function toMs(d) {
  if (d instanceof Date) return d.getTime();
  const n = Date.parse(d);
  return Number.isFinite(n) ? n : NaN;
}

function parseFrontmatter(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try { return yaml.load(m[1]) || null; } catch { return null; }
}

/** Read a member-owned item's contributors[] (with the SOW-059 `at` merge date). [{ login, at }]; empty on any miss. */
export function readContributorsForItem(root, item, membersIndex, { readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const username = membersIndex.get(String(item.owner));
  const dir = TYPE_DIR[item.type];
  if (!username || !dir) return [];
  let text;
  try { text = readFile(path.join(root, 'members', username, dir, item.slug, 'index.md')); } catch { return []; }
  const fm = parseFrontmatter(text);
  const list = Array.isArray(fm?.contributors) ? fm.contributors : [];
  return list.filter((c) => c && c.login).map((c) => ({ login: String(c.login), at: c.at }));
}

function defaultCommentFiles(root) {
  const files = [];
  const addDir = (dir) => { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md') || f.endsWith('.mdx')) files.push(path.join(dir, f)); } catch { /* missing dir */ } };
  addDir(path.join(root, 'house', 'comments'));
  try { for (const u of fs.readdirSync(path.join(root, 'members'))) addDir(path.join(root, 'members', u, 'comments')); } catch { /* no members */ }
  return files;
}

/** Glob all native comments ONCE -> Map typeSlugKey -> [{ author, at, authorIntro }]. authorIntro = the `authorNote`
 *  from-the-author comment (excluded from the pool). Injectable file list + reader for tests. */
export function readCommentsIndex(root, { files = null, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const list = files || defaultCommentFiles(root);
  const index = new Map();
  for (const file of list) {
    let fm; try { fm = parseFrontmatter(readFile(file)); } catch { continue; }
    if (!fm || fm.type !== 'comment' || !fm.targetType || !fm.targetSlug || !fm.author) continue;
    const key = typeSlugKey(fm.targetType, fm.targetSlug);
    let arr = index.get(key); if (!arr) { arr = []; index.set(key, arr); }
    arr.push({ author: String(fm.author), at: fm.createdAt ?? fm.publishedAt, authorIntro: fm.authorNote === true });
  }
  return index;
}

/**
 * PURE: build raw collaboration events for qualifyingCollaboration from the gathered contributors + comments. Each
 * actor's login/author is resolved username -> github_id via reverseIndex (lowercased); an unresolved actor (a
 * non-member) is dropped. Dates are coerced to epoch ms (a non-finite date is left as-is so the window check drops
 * it). qualifyingCollaboration applies the owner/author-intro/before-conversion filters downstream.
 */
export function buildCollaborationEvents({ items = [], contributorsByItem = new Map(), commentsIndex = new Map(), reverseIndex }) {
  const events = [];
  const resolve = (name) => reverseIndex.get(String(name).toLowerCase()) || null;
  for (const item of items) {
    if (!item) continue;
    for (const c of contributorsByItem.get(itemKey(item)) || []) {
      const member = resolve(c.login);
      if (member) events.push({ member, item, kind: 'contribution', at: toMs(c.at) });
    }
    for (const cm of commentsIndex.get(typeSlugKey(item.type, item.slug)) || []) {
      const member = resolve(cm.author);
      if (member) events.push({ member, item, kind: 'comment', at: toMs(cm.at), authorIntro: cm.authorIntro });
    }
  }
  return events;
}

/** High-level: reconstruct a snapshot's collaboration points (the 5% pool input) at payout. Returns [{member,points}]. */
export function gatherSnapshotPoints({ root, snapshot, membersIndex, reverseIndex, commentsIndex, readFile } = {}) {
  const items = [snapshot?.firstItem, snapshot?.lastItem].filter(Boolean);
  if (!items.length) return [];
  const contributorsByItem = new Map();
  for (const item of items) contributorsByItem.set(itemKey(item), readContributorsForItem(root, item, membersIndex, { readFile }));
  const events = buildCollaborationEvents({ items, contributorsByItem, commentsIndex, reverseIndex });
  return qualifyingCollaboration({ firstTouch: snapshot.firstItem, lastTouch: snapshot.lastItem, events, conversionAt: snapshot.conversionAt });
}

/** Reverse a github_id -> username members index into username(lowercase) -> github_id, for actor resolution. */
export function reverseMembersIndex(membersIndex) {
  const rev = new Map();
  for (const [id, username] of membersIndex || []) rev.set(String(username).toLowerCase(), String(id));
  return rev;
}

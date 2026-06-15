// SOW-007/008: gather the per-content distribution inputs the payout planner needs from the git-native
// content + comments + points ledger. The ASSEMBLY (assembleDistributionInputs) is PURE and unit-tested;
// the file readers below are the thin I/O the shell uses to feed it. Everything keys money on the
// immutable github_id and fails closed (unknown content, unresolved author, no delegation => no split).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { contributorsForContent, commentsForContent } from '../../membership/distribution-inputs.mjs';
import { reverseMembersIndex } from '../../membership/overrides.mjs';

const VIA_RE = /^(post|product|prompt):(.+)$/;

/**
 * PURE: assemble the planner's per-content maps for the vias present in the commission ledger.
 * Only content that (a) exists, (b) resolves its author to a github_id, and (c) actually delegates is
 * included; the planner additionally checks the via-content's author equals the commission's referrer.
 *
 * @param {object} a
 * @param {object[]} a.entries                         commission entries (each may carry `via`).
 * @param {Map<string,{author:string, delegation:object}>} a.contentIndex  `${type}:${slug}` -> frontmatter.
 * @param {object[]} a.awards                          house/points-ledger.yml awards.
 * @param {object[]} a.comments                        all comment records.
 * @param {Map<string,string>} a.membersIndex          github_id -> username.
 * @param {Set<string>} [a.bannedGithubIds]
 * @param {number} a.nowMs
 * @returns {{contentOwnerByVia, delegationByContent, contributorsByContent, commentsByContent, delegateIds:Set<string>}}
 */
export function assembleDistributionInputs({ entries, contentIndex, awards, comments, membersIndex, bannedGithubIds, nowMs }) {
  const reverse = reverseMembersIndex(membersIndex);
  const contentOwnerByVia = new Map();
  const delegationByContent = new Map();
  const contributorsByContent = new Map();
  const commentsByContent = new Map();
  const delegateIds = new Set();

  const vias = new Set();
  for (const e of entries ?? []) if (e?.via) vias.add(e.via);

  for (const via of vias) {
    const m = VIA_RE.exec(via);
    if (!m) continue;
    const [, type, slug] = m;
    const content = contentIndex?.get?.(via);
    if (!content) continue; // unknown content -> no split (owner keeps 100%)
    // SOW-016: a Mode A item (members-only, no public stub) has NO public footprint, so it earns no referral
    // share and its comments + contributions earn no delegation. Skip it (defensive: a Mode A item cannot set
    // a `via` because it has no public page/CTA, so this should never fire, but it must fail closed if it does).
    if (content.visibility === 'members' && content.publicStub !== true) continue;
    const delegation = content.delegation || {};
    if (!(Number(delegation.contributions) > 0) && !(Number(delegation.comments) > 0)) continue; // nothing delegated
    const ownerId = content.author ? reverse.get(String(content.author).toLowerCase()) : null;
    if (!ownerId) continue; // unresolved author -> cannot trust the split

    contentOwnerByVia.set(via, String(ownerId));
    delegationByContent.set(via, delegation);
    const contribs = contributorsForContent(awards, type, slug, bannedGithubIds);
    const cmts = commentsForContent(comments, type, slug, reverse, nowMs, { bannedGithubIds, ownerGithubId: ownerId });
    contributorsByContent.set(via, contribs);
    commentsByContent.set(via, cmts);
    for (const c of contribs) delegateIds.add(String(c.id));
    for (const c of cmts) delegateIds.add(String(c.id));
  }
  return { contentOwnerByVia, delegationByContent, contributorsByContent, commentsByContent, delegateIds };
}

// ---- thin file readers (I/O for the shell) --------------------------------

function parseFrontmatter(txt) {
  const m = /^---\n([\s\S]*?)\n---/.exec(txt);
  if (!m) return null;
  try {
    const d = yaml.load(m[1]);
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

const safeIsDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

/** Scan members/<user>/{posts,products,prompts}/<slug>/index.md into `${type}:${slug}` -> {author, delegation}.
 * Slugs are globally unique per type (CI enforces it), but this self-defends: if two folders collide on a
 * `type:slug` key, the key is DROPPED (fail closed -> no delegation, owner keeps 100%), so a CI bypass can
 * never misroute one author's commission split to a different author's content. */
export function readContentIndex(root) {
  const index = new Map();
  const collided = new Set();
  const membersDir = path.join(root, 'members');
  if (!fs.existsSync(membersDir)) return index;
  for (const user of fs.readdirSync(membersDir)) {
    const base = path.join(membersDir, user);
    if (!safeIsDir(base)) continue;
    for (const [sub, type] of [['posts', 'post'], ['products', 'product'], ['prompts', 'prompt']]) {
      const dir = path.join(base, sub);
      if (!fs.existsSync(dir)) continue;
      for (const slugDir of fs.readdirSync(dir)) {
        const idx = path.join(dir, slugDir, 'index.md');
        if (!fs.existsSync(idx)) continue;
        const fm = parseFrontmatter(fs.readFileSync(idx, 'utf8'));
        if (!fm) continue;
        const key = `${type}:${fm.slug ?? slugDir}`;
        if (collided.has(key)) continue;
        if (index.has(key)) { index.delete(key); collided.add(key); continue; } // ambiguous slug -> drop
        index.set(key, { author: fm.author ?? user, delegation: fm.delegation ?? null, visibility: fm.visibility ?? 'public', publicStub: fm.publicStub === true }); // SOW-016: visibility/publicStub gate Mode A out of delegation
      }
    }
  }
  return index;
}

/** Scan members/<user>/comments/*.md into a flat list of comment frontmatter records. */
export function readComments(root) {
  const out = [];
  const membersDir = path.join(root, 'members');
  if (!fs.existsSync(membersDir)) return out;
  for (const user of fs.readdirSync(membersDir)) {
    const dir = path.join(membersDir, user, 'comments');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (fm) out.push(fm);
    }
  }
  return out;
}

/** Load the awards array from house/points-ledger.yml (empty when absent/unparseable). */
export function readAwards(root) {
  const file = path.join(root, 'house', 'points-ledger.yml');
  if (!fs.existsSync(file)) return [];
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    return Array.isArray(doc?.awards) ? doc.awards : [];
  } catch {
    return [];
  }
}

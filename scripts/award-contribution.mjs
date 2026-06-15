#!/usr/bin/env node
// SOW-008 contribution award runner. When the folder owner accepts a contribution (the PR merges),
// this credits the contributor: it adds them to the target content file's `contributors` frontmatter
// (which renders the stacked avatars + the Contributions footnote) and, for a point-bearing class,
// writes an award to house/points-ledger.yml.
//
// The pure helpers (insertContributor, the membership/points.mjs builders) are unit-tested. The thin
// main() reads a JSON payload describing the merged contribution and applies the changes; the GitHub
// Action that derives that payload from the merged PR event and commits the result is wired by the
// owner (see .data/sow/human-todo.md). Runs with --dry-run to print intended changes.
//   node scripts/award-contribution.mjs --payload <file.json> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { buildAward, upsertLedger } from '../membership/points.mjs';

const CONTRIB_INDENT = '  ';

/** Render one contributors[] YAML list item (2-space list indent, 4-space property indent). */
export function contributorItemYaml(c) {
  const lines = [`${CONTRIB_INDENT}- login: ${c.login}`];
  if (c.commit) lines.push(`${CONTRIB_INDENT}  commit: "${c.commit}"`);
  if (c.url) lines.push(`${CONTRIB_INDENT}  url: "${c.url}"`);
  if (c.class) lines.push(`${CONTRIB_INDENT}  class: ${c.class}`);
  return lines.join('\n');
}

/**
 * Add a contributor to a content file's frontmatter `contributors` block, surgically (the rest of the
 * frontmatter is preserved). Idempotent: if the commit is already credited, the file is unchanged.
 * Creates the block after `author:` when none exists, or expands an inline empty `contributors: []`.
 */
export function insertContributor(fileText, c) {
  const fmMatch = fileText.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return fileText; // no frontmatter: do not place anything
  const fm = fmMatch[1];
  if (c.commit && fm.includes(c.commit)) return fileText; // already credited this commit (idempotent)
  const item = contributorItemYaml(c);

  let newFm;
  if (/^contributors:[ \t]*\[[ \t]*\][ \t]*$/m.test(fm)) {
    newFm = fm.replace(/^contributors:[ \t]*\[[ \t]*\][ \t]*$/m, `contributors:\n${item}`);
  } else if (/^contributors:[ \t]*$/m.test(fm)) {
    newFm = fm.replace(/^(contributors:[ \t]*)$/m, `$1\n${item}`);
  } else if (/^author:.*$/m.test(fm)) {
    newFm = fm.replace(/^(author:.*)$/m, `$1\ncontributors:\n${item}`);
  } else {
    newFm = `${fm}\ncontributors:\n${item}`;
  }
  return fileText.replace(fm, newFm);
}

// ---- thin I/O shell (the deriving Action is human-todo) --------------------

function parseArgs(argv) {
  const out = { dryRun: argv.includes('--dry-run'), payload: null };
  const i = argv.indexOf('--payload');
  if (i >= 0) out.payload = argv[i + 1];
  return out;
}

function applyAward(payload, { root, dryRun }) {
  const { targetFile, contributor, contributorGithubId, ownerGithubId, banned = false, now = null, additionBonus = 0 } = payload;
  const changes = [];

  // 1. Credit the contributor in the target file's frontmatter (every accepted class, grammar included).
  const abs = path.join(root, targetFile);
  const before = fs.readFileSync(abs, 'utf8');
  const after = insertContributor(before, contributor);
  if (after !== before) {
    changes.push(`contributors += ${contributor.login} in ${targetFile}`);
    if (!dryRun) fs.writeFileSync(abs, after);
  }

  // 2. Write a points award for a point-bearing class (grammar is courtesy: buildAward returns null).
  const award = buildAward({
    contributorGithubId,
    contributorLogin: contributor.login,
    ownerGithubId,
    target: payload.target,
    commit: contributor.commit,
    url: contributor.url,
    klass: contributor.class,
    now,
    banned,
    additionBonus,
  });
  if (award) {
    const ledgerPath = path.join(root, 'house/points-ledger.yml');
    const doc = yaml.load(fs.readFileSync(ledgerPath, 'utf8')) ?? {};
    const awards = upsertLedger(doc.awards ?? [], award);
    changes.push(`award ${award.points}pt (${award.class}) -> ${award.contributor_login}`);
    if (!dryRun) fs.writeFileSync(ledgerPath, yaml.dump({ ...doc, awards }));
  }
  return changes;
}

function main() {
  const { dryRun, payload } = parseArgs(process.argv.slice(2));
  if (!payload) throw new Error('award-contribution: --payload <file.json> is required');
  const root = process.cwd();
  const data = JSON.parse(fs.readFileSync(payload, 'utf8'));
  const changes = applyAward(data, { root, dryRun });
  console.log(`award-contribution: ${dryRun ? 'DRY RUN, ' : ''}${changes.length} change(s)`);
  for (const c of changes) console.log('  ' + c);
}

export { applyAward };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

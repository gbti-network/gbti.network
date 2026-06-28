#!/usr/bin/env node
// SOW-008/SOW-059 contribution credit runner (credit-only, no points). When the folder owner accepts a
// contribution (the PR merges), this credits the contributor by adding them to the target content file's
// `contributors` frontmatter, which renders the stacked avatars + the Contributions footnote. The old
// points ledger (house/points-ledger.yml) was retired in SOW-059; this script no longer writes points.
//
// The pure helper (insertContributor) is unit-tested. The thin main() reads a JSON payload describing the
// merged contribution and applies the change; the GitHub Action that derives that payload from the merged
// PR event and commits the result is wired by the owner. Runs with --dry-run to print intended changes.
//   node scripts/credit-contribution.mjs --payload <file.json> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const { targetFile, contributor } = payload;
  const changes = [];

  // Credit the contributor in the target file's frontmatter (every accepted class, grammar included).
  const abs = path.join(root, targetFile);
  const before = fs.readFileSync(abs, 'utf8');
  const after = insertContributor(before, contributor);
  if (after !== before) {
    changes.push(`contributors += ${contributor.login} in ${targetFile}`);
    if (!dryRun) fs.writeFileSync(abs, after);
  }

  return changes;
}

function main() {
  const { dryRun, payload } = parseArgs(process.argv.slice(2));
  if (!payload) throw new Error('credit-contribution: --payload <file.json> is required');
  const root = process.cwd();
  const data = JSON.parse(fs.readFileSync(payload, 'utf8'));
  const changes = applyAward(data, { root, dryRun });
  console.log(`credit-contribution: ${dryRun ? 'DRY RUN, ' : ''}${changes.length} change(s)`);
  for (const c of changes) console.log('  ' + c);
}

export { applyAward };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

// The pure half of the contributor credit: rendering one `contributors[]` entry and inserting it into a content
// file's frontmatter. Extracted from scripts/credit-contribution.mjs in sow-475, unchanged in behaviour.
//
// WHY IT MOVED. The claim path needs it (a prepared item can credit whoever prepared it), and that path runs in
// the Worker. scripts/credit-contribution.mjs imports node:fs, node:path and node:url at the top for its CLI
// shell, so importing it from the Worker would pull node:fs into that bundle. The script now imports these two
// functions from here, so there is still exactly ONE implementation of the frontmatter edit.
//
// WHY A TEXT EDIT AND NOT A FIELD. `contributors` is SYSTEM_MANAGED for post, project and prompt
// (client/src/schemas.mjs), so buildContentFile strips it from any input it is given. The field cannot be set by
// building the file; it has to be written into the finished frontmatter. A sow-475 attempt to pass it through
// buildContentFile looked cleaner and silently produced no credit at all, which is what the tests caught.

const CONTRIB_INDENT = '  ';

/** Render one contributors[] YAML list item (2-space list indent, 4-space property indent). */
export function contributorItemYaml(c) {
  const lines = [`${CONTRIB_INDENT}- login: ${c.login}`];
  if (c.commit) lines.push(`${CONTRIB_INDENT}  commit: "${c.commit}"`);
  if (c.url) lines.push(`${CONTRIB_INDENT}  url: "${c.url}"`);
  if (c.class) lines.push(`${CONTRIB_INDENT}  class: ${c.class}`);
  // SOW-059: the merge date (ISO). The payout job's collaboration gather reads it so a contribution only counts
  // toward the 5% pool when it landed BEFORE the conversion it is attributed to. An entry without `at` earns no
  // collaboration point (the window check drops a non-finite date) -- safe + backward-tolerant for legacy entries.
  if (c.at) lines.push(`${CONTRIB_INDENT}  at: "${c.at}"`);
  return lines.join('\n');
}

/**
 * Add a contributor to a content file's frontmatter `contributors` block, surgically (the rest of the
 * frontmatter is preserved). Idempotent: if the commit is already credited, the file is unchanged.
 * Creates the block after `author:` when none exists, or expands an inline empty `contributors: []`.
 *
 * Returns the text UNCHANGED when there is no frontmatter to edit. A caller that must not silently skip the
 * credit has to compare the result, which is what the claim path does (membership/prepared-claim-files.mjs).
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

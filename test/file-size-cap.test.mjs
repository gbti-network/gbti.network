// Owner, 2026-09-30: no hand-written source file may exceed 900 lines (the machine-wide working agreement), and
// the limit lives in the build rather than in a document, because a rule that lives only in prose is discovered
// at 5,000 lines. This suite runs on every pull request and push, so a file that crosses the line fails CI in the
// change that makes it cross.
//
// Generated output is exempt: the built bundles, minified vendor files and lockfiles. Everything else a person
// writes counts, including tests, stylesheets, page templates, build scripts and the hosted tools under public/.
// When a file crosses the line, split it along the seams already there (see the split commits of 2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CAP = 900;

// Source a person writes, by extension.
const SOURCE = /\.(mjs|cjs|js|ts|astro|css|html|py|sh)$/;
// Output a build writes, or a minified vendor file.
const GENERATED = [/^client-ui\/dist\//, /^extension\/dist\//, /^extension\/mcp\//, /\.min\.(js|css)$/];

/** The line count `wc -l` reports for a file that ends in a newline, and one more when the last line has none. */
export function linesIn(src) {
  if (src === '') return 0;
  const n = src.split('\n').length;
  return src.endsWith('\n') ? n - 1 : n;
}

/** Whether a repository path is hand-written source the cap applies to. */
export function isCapped(file) {
  return SOURCE.test(file) && !GENERATED.some((re) => re.test(file));
}

/** Every capped file over the limit, as "path (N lines)". */
export function overCap(files, read) {
  const out = [];
  for (const f of files) {
    if (!isCapped(f)) continue;
    const n = linesIn(read(f));
    if (n > CAP) out.push(`${f} (${n} lines)`);
  }
  return out;
}

// NUL-separated: plain `git ls-files` C-quotes a path holding a non-ASCII byte, a quote or a backslash
// ("src/caf\303\251.mjs" with the quotes), which no extension test matches, so that file would skip the cap.
function trackedFiles() {
  return execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

test(`no hand-written source file is over ${CAP} lines`, () => {
  const files = trackedFiles().filter(isCapped).filter((f) => fs.existsSync(path.join(ROOT, f)));
  assert.ok(files.length > 500, `the scan found only ${files.length} files, so it proved nothing`);
  const over = overCap(files, (f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  assert.deepEqual(over, [], `Split these along the seams already in them (the working agreement caps a file at ${CAP} lines):\n  ${over.join('\n  ')}`);
});

test('the cap counts lines the way wc does, and knows generated output from source', () => {
  assert.equal(linesIn(''), 0);
  assert.equal(linesIn('a\n'), 1);
  assert.equal(linesIn('a\nb'), 2, 'a last line with no newline still counts');
  assert.equal(linesIn('x\n'.repeat(CAP)), CAP);
  const files = { 'src/ok.mjs': 'x\n'.repeat(CAP), 'test/big.test.mjs': 'x\n'.repeat(CAP + 1), 'public/tools/t/app.css': 'x\n'.repeat(CAP + 1),
    'client-ui/dist/gbti-ui.js': 'x\n'.repeat(5000), 'public/tools/t/lib.min.js': 'x\n'.repeat(5000), 'house/notes.md': 'x\n'.repeat(5000) };
  assert.deepEqual(overCap(Object.keys(files), (f) => files[f]),
    [`test/big.test.mjs (${CAP + 1} lines)`, `public/tools/t/app.css (${CAP + 1} lines)`],
    'a test suite and a hosted tool count; a bundle, a minified file and content do not');
});

// sow-286: the check that answers "is this number free" completely.
//
// EVERY TEST HERE RUNS ON INJECTED INPUTS, and that is a requirement rather than a style choice. The guard's
// real subject is `.data/sow`, which is gitignored and therefore ABSENT in CI, where these tests run. A test
// that read the real planning tree would pass locally and assert nothing on the machine that gates the push.
//
// THE CASE BUG IS THE REASON THIS EXISTS. The hand run that cleared the backlog on 2026-09-08 searched for
// lowercase `sow-` only. 100 of the 316 numbers cited in code are only ever written in capitals, so it found
// six missing documents and missed three the earlier audit had already named: 048, 093 and 133. The first
// test below is that one, and it is the one to keep if the others ever get in the way.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeToken, collectCited, collectDocuments, checkSowNumbers,
} from '../scripts/check-sow-numbers.mjs';

/** A fake `git grep` returning the lines it is given, and recording how it was called. */
function gitReturning(lines) {
  const calls = [];
  const run = (args) => { calls.push(args); return lines.join('\n') + '\n'; };
  run.calls = calls;
  return run;
}

test('a citation written in CAPITALS is found, which is the bug this whole check turned on', () => {
  const { cited, junk } = collectCited({ run: gitReturning(['SOW-133', 'sow-270', 'Sow-048']) });
  assert.deepEqual([...cited].sort(), ['sow-048', 'sow-133', 'sow-270']);
  assert.deepEqual(junk, []);
  // And the comparison must agree, or finding them would change nothing.
  const r = checkSowNumbers({ cited, documents: collectDocuments({ files: ['sow-270-a.md'] }) });
  assert.deepEqual(r.docless, ['sow-048', 'sow-133']);
});

test('the scan itself asks git for a CASE-INSENSITIVE match, and skips binaries', () => {
  // Asserted on the ARGUMENTS, not on the output. The tests around this one inject their own lines, so they
  // would keep passing with the real flag regressed to a lowercase-only search, which is precisely the bug
  // that let three numbers sit undocumented for a fortnight. A mutation run found this gap.
  const run = gitReturning(['sow-001']);
  collectCited({ run });
  assert.equal(run.calls.length, 1);
  const args = run.calls[0];
  const flags = args.find((a) => /^-[a-zA-Z]+$/.test(a) && a.includes('h')) || args.join(' ');
  assert.match(flags, /i/, 'the grep must be case-insensitive, or a citation written in capitals is invisible');
  assert.ok(args.includes('-I'), 'and it must skip binaries, or git writes its own prose into this output');
  assert.ok(args.includes(':!.data'), 'and exclude the planning tree, which is not code');
});

test('a document is keyed by the LEADING number in its name, not by a number anywhere in it', () => {
  // This exact file exists. Matching a number anywhere in the name reads it as a document for 223, which
  // briefly looked like a live collision while this was being written. It is a document for 240.
  const documents = collectDocuments({ files: [
    'sow-240-correction-to-sow-223-the-note-was-wrong.md',
    // A name that does NOT open with a number documents nothing. Without this case the test could not fail:
    // in the name above the first match IS the leading token, so dropping the anchor changed nothing and a
    // mutation run passed. Found by mutating, not by reading.
    'notes-about-sow-999-and-others.md',
  ] });
  assert.deepEqual([...documents.keys()], ['sow-240']);
  assert.ok(!documents.has('sow-223'), 'sow-223 must NOT be satisfied by a mention inside another name');
  assert.ok(!documents.has('sow-999'), 'a file that does not open with a number is not a document for one');
});

test('a binary-file line is refused rather than filtered away quietly', () => {
  // git grep without -I prints `binary file <ref>:<path> matches` into this stream, and the path can contain
  // a token. Dropping such a line silently is how a wrong count nearly reached the owner.
  const { cited, junk } = collectCited({ run: gitReturning(['sow-270', 'binary file origin/main:x/sow-999.bin matches']) });
  assert.deepEqual([...cited], ['sow-270']);
  assert.equal(junk.length, 1, 'the odd line must be REPORTED, so the caller can refuse the whole answer');
});

test('it refuses to run when there is nothing to compare against, rather than passing', () => {
  const cited = new Set(['sow-001']);
  const missing = checkSowNumbers({ cited, documents: new Map(), sowDirExists: false });
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0], /proved nothing/);
  assert.deepEqual(missing.docless, [], 'and it must not report every cited number as a finding');

  const empty = checkSowNumbers({ cited, documents: new Map(), sowDirExists: true });
  assert.equal(empty.errors.length, 1);
  assert.match(empty.errors[0], /a result about nothing/);
  assert.deepEqual(empty.docless, []);
});

test('a number cited in code with no document is an error; a document nobody cites is not', () => {
  const cited = new Set(['sow-001', 'sow-002']);
  const documents = collectDocuments({ files: ['sow-001-a.md', 'sow-050-planning-only.md'] });
  const r = checkSowNumbers({ cited, documents });
  assert.deepEqual(r.docless, ['sow-002']);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.unreferenced, ['sow-050']);
  assert.equal(r.notes.length, 1, 'an uncited document is a note: plenty of work is planning only');
});

test('a mention in ops is named in the error but does NOT satisfy the number', () => {
  // All three real cases are mentioned in ops or specs. Counting those would take this check to zero and
  // hide exactly the cases it exists to find.
  const cited = new Set(['sow-133']);
  const r = checkSowNumbers({ cited, documents: collectDocuments({ files: ['sow-001-a.md'] }), opsMentions: new Set(['sow-133']) });
  assert.deepEqual(r.docless, ['sow-133'], 'an ops mention must not clear it');
  assert.match(r.errors[0], /NOT a document/);
});

test('one number naming two documents is an error, which is the first collision that happened', () => {
  const documents = collectDocuments({ files: ['sow-145-one-thing.md', 'sow-145-a-different-thing.md'] });
  const r = checkSowNumbers({ cited: new Set(['sow-145']), documents });
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].token, 'sow-145');
  assert.ok(r.errors.some((e) => /names 2 documents/.test(e)));
});

test('the next free number is above the highest in use, not the lowest gap', () => {
  const r = checkSowNumbers({
    cited: new Set(['sow-005']),
    documents: collectDocuments({ files: ['sow-001-a.md', 'sow-005-b.md'] }),
  });
  // 002, 003 and 004 are free, and handing one out is how a collision starts: a gap may be a number claimed
  // somewhere this check cannot see.
  assert.equal(r.nextFree, 'sow-006');
  assert.deepEqual(r.gaps, ['sow-002', 'sow-003', 'sow-004']);
});

test('normalizeToken accepts only the real shape', () => {
  assert.equal(normalizeToken('SOW-007'), 'sow-007');
  assert.equal(normalizeToken(' sow-007 '), 'sow-007');
  for (const bad of ['sow-7', 'sow-0007', 'sows-007', '', null, undefined, 'binary file x matches']) {
    assert.equal(normalizeToken(bad), null, `${JSON.stringify(bad)} must not read as a number`);
  }
});

test('git grep exiting 1 for no matches is an answer, not a crash', () => {
  const run = () => { const e = new Error('no matches'); e.status = 1; e.stdout = ''; throw e; };
  const { cited, junk } = collectCited({ run });
  assert.equal(cited.size, 0);
  assert.deepEqual(junk, []);
  // A real failure still throws, or a broken scan would read as "nothing is cited", which passes everything.
  assert.throws(() => collectCited({ run: () => { const e = new Error('bad revision'); e.status = 128; throw e; } }));
});

test('it is wired as a local command and kept OUT of the build, which a comment could not enforce', () => {
  // package.json is JSON and cannot carry the reason as a comment, so the reason is asserted here instead.
  // A future author tidying this into verify:dist gets this message rather than a silent regression.
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.equal(pkg.scripts['check:sow-numbers'], 'node scripts/check-sow-numbers.mjs',
    'the local command must exist, or nobody runs this');
  assert.ok(!/check-sow-numbers/.test(pkg.scripts['verify:dist'] || ''),
    'DO NOT add this to verify:dist. .data/ is gitignored, so the planning documents do not exist in a fresh '
    + 'checkout: in the build it would find every cited number undocumented and fail every push, and each way '
    + 'of softening that is worse (a permanent warning nobody reads, or a check that passes on nothing).');
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (name === 'check:sow-numbers') continue;
    assert.ok(!/check-sow-numbers/.test(cmd), `${name} must not call it either, for the same reason`);
  }
});

test('no workflow runs it, for the same reason', () => {
  const dir = fileURLToPath(new URL('../.github/workflows', import.meta.url));
  for (const f of fs.readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/check-sow-numbers/.test(text),
      `.github/workflows/${f} runs the sow-number check, which cannot work in CI: .data/ is absent there by design`);
  }
});

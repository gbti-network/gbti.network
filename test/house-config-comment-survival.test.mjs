// sow-266 Phase 2: a note written beside a setting is deleted by the first superadmin save.
//
// THE FAILURE THIS EXISTS TO CATCH, which has now happened twice. When a superadmin edits a house config file
// from the admin area, the Worker keeps the comment block ABOVE the first line of data and rebuilds everything
// under it from the parsed values (leadingComment + yaml.dump, membership-admin-author.mjs). A comment sitting
// next to a field is not part of the parsed values, so it survives every review, every test and every build,
// right up until the first edit, and then it is gone. No warning fires. Nothing reds. The author who wrote the
// note is not the person who saves.
//
// house/digest-config.yml carried 22 of its 34 comment lines inside the document and would have lost all 22 on
// the first save from the manager. house/site-settings.yml carried 4 and was in the same position. Both were
// rewritten with every note in the leading block, naming the field it describes.
//
// THE RULE, then: write the guidance above the document, never beside the field. This test is what makes that
// a rule rather than a paragraph somebody has to remember, and it derives the file list from the Worker's own
// action table, so a NEW config action is covered the day it is added rather than the day somebody notices.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/** The Worker's own preserve rule, copied exactly. If it changes there, this copy must change with it. */
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line);
    else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}

/** What a superadmin save writes back, given the file as it stands today and no change to its values. */
const afterSave = (raw) => leadingComment(raw) + yaml.dump(yaml.load(raw), { lineWidth: 100, noRefs: true });

const commentLines = (text) => String(text).split('\n').filter((l) => l.trim().startsWith('#'));

/** Every single-file config path the Worker can write, read out of the table rather than listed by hand. */
function configPaths() {
  const src = fs.readFileSync(at('../workers/signup/membership-admin-author.mjs'), 'utf8');
  const start = src.indexOf('const CONFIG_OP = {');
  assert.ok(start > -1, 'could not find the CONFIG_OP table in the Worker (did it move or rename?)');
  const block = src.slice(start, src.indexOf('\n};', start));
  const paths = [...new Set([...block.matchAll(/path:\s*'(house\/[^']+)'/g)].map((m) => m[1]))];
  assert.ok(paths.length >= 8, `expected several config paths, parsed ${paths.length} (the regex may have gone stale)`);
  return paths;
}

test('every manager-written config file keeps all of its comments through a save', () => {
  let checked = 0;
  for (const rel of configPaths()) {
    const file = at(`../${rel}`);
    // A file the manager CREATES on first write does not exist yet, and has no comments to lose.
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const before = commentLines(raw);
    const after = commentLines(afterSave(raw));
    const lost = before.filter((l) => !after.includes(l));
    assert.deepEqual(lost, [], [
      `${rel} loses ${lost.length} comment line(s) the first time a superadmin saves it from the admin area.`,
      'Move them ABOVE the first line of data, naming the field each one describes.',
      ...lost.map((l) => `  lost: ${l.trim()}`),
    ].join('\n'));
    checked += 1;
  }
  // Without this the test passes loudly on an empty set, which is the shape of a guard that guards nothing.
  assert.ok(checked >= 5, `only ${checked} config files were actually checked; the path list or the repo layout has drifted`);
});

test('the guard fails on a comment placed inside the document', () => {
  // The positive control. A note beside a field is exactly what the rule forbids, and if this shape does not
  // trip the comparison above then the comparison is measuring something else.
  const bad = '# above the document\nsettings:\n  # beside the field\n  a: true\n';
  const lost = commentLines(bad).filter((l) => !commentLines(afterSave(bad)).includes(l));
  assert.deepEqual(lost.map((l) => l.trim()), ['# beside the field']);
});

test('the two files this was written for keep every line', () => {
  // Named rather than left to the sweep, because these are the two that were actually broken, and a sweep that
  // silently stopped covering them would still pass.
  for (const rel of ['house/digest-config.yml', 'house/site-settings.yml']) {
    const raw = fs.readFileSync(at(`../${rel}`), 'utf8');
    assert.equal(commentLines(afterSave(raw)).length, commentLines(raw).length, `${rel} loses comments on save`);
    assert.ok(commentLines(raw).length >= 10, `${rel} has lost its guidance entirely, which also passes the comparison above`);
  }
});

test('a save changes no value in either file', () => {
  // The rewrite moved comments only. If it moved a value too, every test above still passes.
  for (const rel of ['house/digest-config.yml', 'house/site-settings.yml']) {
    const raw = fs.readFileSync(at(`../${rel}`), 'utf8');
    assert.deepEqual(yaml.load(afterSave(raw)), yaml.load(raw), `${rel} does not survive a save unchanged`);
  }
});

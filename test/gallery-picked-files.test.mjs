// The gallery upload was dead for every member, and in the quietest possible way.
//
// The change handler read `input.files` into a variable, reset `input.value` so the same file could be picked
// twice, and then called the uploader. `input.files` is LIVE: the reset emptied the list the variable pointed
// at. doGalleryImages received nothing, returned at `if (!files.length) return;` BEFORE it had a status
// element to write to, and the member saw no upload, no row and no error. Reported from the field on
// 2026-10-21 as "no errors, but nothing happens", after it had silently wiped an existing gallery on save.
//
// The fake input below reproduces that browser semantic exactly: assigning to `value` clears `files`. Without
// it a test would pass against the broken code, because a plain object's array survives anything.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { takePickedFiles } from '../client-ui/src/gallery.mjs';

/**
 * A file input that behaves like a real one.
 *
 * The reset EMPTIES THE LIST IN PLACE rather than swapping in a fresh array, because that is what a live
 * FileList does and it is the only reason the bug existed: a variable holding the list goes empty under you.
 * An earlier version of this fake assigned `this._files = []`, which leaves a held reference intact, and a
 * mutation that restored the original defect passed against it. A fake that does not reproduce the semantic
 * tests nothing.
 */
function fakeInput(names) {
  return {
    _files: names.map((name) => ({ name, size: 1024 })),
    get files() { return this._files; },
    get value() { return this._files.length ? 'C:\\fakepath\\' + this._files[0].name : ''; },
    set value(v) { if (!v) this._files.length = 0; },
  };
}

test('the picked files survive the reset that lets the same file be picked again', () => {
  const input = fakeInput(['one.png', 'two.png', 'three.png']);
  const files = takePickedFiles(input);
  assert.equal(files.length, 3, 'the uploader must receive every file the member picked');
  assert.deepEqual(files.map((f) => f.name), ['one.png', 'two.png', 'three.png']);
  assert.equal(input.files.length, 0, 'and the input is still reset, so the same file can be picked twice');
});

test('a single file, which is how the bug was actually hit', () => {
  const input = fakeInput(['gallery-1-state-of-com.png']);
  assert.deepEqual(takePickedFiles(input).map((f) => f.name), ['gallery-1-state-of-com.png']);
});

test('an empty or missing input yields an empty list rather than throwing', () => {
  assert.deepEqual(takePickedFiles(fakeInput([])), []);
  assert.deepEqual(takePickedFiles(null), []);
  assert.deepEqual(takePickedFiles(undefined), []);
  assert.deepEqual(takePickedFiles({}), []);
});

test('a browser that refuses the reset still hands over the files', () => {
  // Some engines throw on assigning to value. Losing the upload because the reset failed would trade one
  // silent failure for another.
  const input = { files: [{ name: 'a.png' }], set value(_v) { throw new Error('refused'); }, get value() { return ''; } };
  assert.deepEqual(takePickedFiles(input).map((f) => f.name), ['a.png']);
});

test('the gallery change handler goes through the helper, not a raw read', () => {
  // The helper is only worth having if the listener uses it; a direct e.target.files read would reintroduce
  // the defect with every unit test still green.
  const src = readFileSync(new URL('../client-ui/src/elements/editor-rows.mjs', import.meta.url), 'utf8');
  assert.match(src, /galFile\?\.addEventListener\('change',[^\n]*takePickedFiles\(galFile\)/,
    'the gallery file input must hand its files over through takePickedFiles');
  assert.doesNotMatch(src, /e\.target\.value = ''; this\.doGalleryImages/,
    'reset-then-use is the defect: it must not come back');
});

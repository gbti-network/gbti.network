// The in-place title edit on the WorkBench Preview page. Reported 2026-08-28: the title could not be edited from
// the Preview at all. It is frontmatter rather than body source, so it does not go through the block commit path
// and these rules live nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTitleEdit } from '../src/lib/preview-title.mjs';

test('a real change is stored and reported as a change', () => {
  const p = planTitleEdit('A better title', 'Old title', 'the-slug');
  assert.deepEqual(p, { changed: true, title: 'A better title', display: 'A better title' });
});

test('an unchanged title writes nothing, so the draft is not marked dirty by a click-through', () => {
  const p = planTitleEdit('Same title', 'Same title', 'the-slug');
  assert.equal(p.changed, false);
  assert.equal(p.title, null);
  assert.equal(p.display, 'Same title');
});

test('an EMPTY title is refused and the previous one is put back on screen', () => {
  // Selecting all and typing is the normal way to retitle, so the intermediate state is an empty h1. Saving that
  // would publish a page with no heading, and the author would have no signal that it happened.
  for (const raw of ['', '   ', '\n', '\t \n ']) {
    const p = planTitleEdit(raw, 'Kept title', 'the-slug');
    assert.equal(p.changed, false, `"${raw}" was treated as a change`);
    assert.equal(p.title, null);
    assert.equal(p.display, 'Kept title', 'the element must snap back, not sit there showing an unsaved value');
  }
});

test('with no existing title, a refused edit falls back to the slug rather than to nothing', () => {
  assert.equal(planTitleEdit('  ', '', 'the-slug').display, 'the-slug');
  assert.equal(planTitleEdit('  ', null, 'the-slug').display, 'the-slug');
  assert.equal(planTitleEdit('  ', '', '').display, '', 'no title and no slug is empty, not the string "null"');
});

test('whitespace is collapsed, because the value becomes an h1 and a document title', () => {
  // contenteditable and paste both introduce newlines and runs of spaces that a heading cannot render.
  assert.equal(planTitleEdit('  Spaced   out \n title  ', 'x').title, 'Spaced out title');
  assert.equal(planTitleEdit('Line one\nLine two', 'x').title, 'Line one Line two');
  // A title that differs from the current one ONLY by whitespace is not a change.
  assert.equal(planTitleEdit('  Same  title ', 'Same title').changed, false);
});

test('null and undefined inputs do not become the strings "null" or "undefined"', () => {
  assert.equal(planTitleEdit(undefined, 'Kept').display, 'Kept');
  assert.equal(planTitleEdit(null, 'Kept').display, 'Kept');
  assert.equal(planTitleEdit('New', undefined, '').title, 'New');
});

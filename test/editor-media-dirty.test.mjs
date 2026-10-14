// Publish did not appear after a banner color pick, a cover Remove or a Reuse (owner, 2026-10-14). The Media section
// moved out of the rail into its own .media-slot in sow-164 (2026-09-08), and the click listener that reveals Publish
// for controls firing no input/change event stayed on .rail alone. A color pick only writes a hidden input, so the
// editor never learned anything had changed. These run the shipped methods; the listener check reads the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GbtiContentEditor } from '../client-ui/src/elements/gbti-content-editor.mjs';
import { contentEditorSource } from './lib/content-editor-source.mjs';

// A minimal stand-in for one [data-cover] control: every querySelector the two methods make answers with a stub.
function control() {
  const node = () => ({ value: 'x', innerHTML: '', textContent: '', setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const parts = new Map();
  return { querySelector: (sel) => { if (!parts.has(sel)) parts.set(sel, node()); return parts.get(sel); } };
}

function editor() {
  const el = Object.create(GbtiContentEditor.prototype);
  let marked = 0;
  el._markDirty = () => { marked += 1; };
  el._coverFrameInner = () => '';
  el.resolveCover = (p) => p;
  return { el, marked: () => marked };
}

test('Remove on a cover image marks the item changed', () => {
  const { el, marked } = editor();
  el.clearCover(control());
  assert.equal(marked(), 1);
});

test('a reused image placed into a cover field marks the item changed', () => {
  const { el, marked } = editor();
  el._setCoverField(control(), 'images/a.webp', 'https://example.test/a.webp');
  assert.equal(marked(), 1);
});

test('the click listener that reveals Publish covers the Media slot as well as the rail', () => {
  const src = contentEditorSource();
  assert.match(src, /this\.\$\$\('\.rail, \.media-slot'\)\.forEach\(\(box\) => box\.addEventListener\('click'/);
  assert.doesNotMatch(src, /this\.\$\('\.rail'\)\?\.addEventListener\('click'/, 'the rail-only listener is gone');
  // The Media section must still render into .media-slot, or the listener above watches nothing.
  assert.match(src, /<section class="media-slot" aria-label="Media">/);
});

test('picking a banner color marks the item changed itself', () => {
  const src = contentEditorSource();
  const i = src.indexOf("row.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click'");
  assert.ok(i > 0, 'the swatch handler is where the test expects it');
  const handler = src.slice(i, src.indexOf('}));', i));
  assert.match(handler, /this\._markDirty\(\);/);
});

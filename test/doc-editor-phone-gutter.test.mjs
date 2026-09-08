// sow-169 phone check (2026-09-08): the doc editor's 142px hover-toolbar gutter, plus the paragraph's 40px right
// padding, left every block 99px wide at phone width (a 241px document), so paragraphs wrapped one word per line.
// Source pins for the container rule that removes the gutter on a phone and flows the toolbar under the focused
// block (it precedes the content in the block's markup, so static flow puts it at the top), and for the document's
// trimmed side padding. A refactor that folds the gutter back in reds here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const doc = strip(readFileSync(ROOT + 'client-ui/src/elements/gbti-doc-editor.mjs', 'utf8'));
const editor = strip(readFileSync(ROOT + 'client-ui/src/elements/gbti-content-editor.mjs', 'utf8'));

test('the doc editor is a size container and keeps its measured 142px gutter for wide layouts', () => {
  assert.match(doc, /:host \{[^}]*--blk-gutter:142px;[^}]*container-type:inline-size/, 'the gutter stays for hover layouts; the container makes the phone rule possible');
});

test('below 560px there is no gutter and no paragraph right-padding, so a block gets the whole column', () => {
  const m = doc.match(/@container \(max-width: 560px\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, 'the phone block exists');
  assert.match(m[1], /\.doc-blocks \{ padding-right:0; \}/);
  assert.match(m[1], /\.ce-p \{ padding-right:0; \}/);
});

test('on a phone the block toolbar flows in at the top of the focused block instead of floating beside it', () => {
  const m = doc.match(/@container \(max-width: 560px\) \{([\s\S]*?)\n  \}/);
  assert.match(m[1], /\.blk-tools \{ position:static; display:none;[^}]*margin:0 0 6px auto/, 'static, hidden until focus, hugging the right, a gap before the text');
  assert.match(m[1], /\.blk:focus-within > \.blk-tools \{ display:flex; \}/, 'a tap focuses the block and reveals its tools');
});

test('the document sheds its 46px side padding on a phone', () => {
  assert.match(editor, /@container \(max-width:560px\) \{ \.doc \{ padding:24px 16px 34px; \}/);
  assert.match(editor, /\.doc \{ min-width:0;[^}]*padding:40px 46px 52px/, 'the wide padding is unchanged');
});

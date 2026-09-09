// sow-199: the WorkBench Markdown view edits the body instead of projecting it read-only. Source pins for the
// wiring (the panel layer, which the helper tests do not reach); the round trip is driven in the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'client-ui/src/elements/gbti-content-editor.mjs', 'utf8');
const method = (name) => { const i = src.indexOf(`\n  ${name}(`); const j = src.indexOf('\n  }\n', i); return src.slice(i, j); };

test('the textarea is editable and the bar says what it holds', () => {
  assert.match(src, /<textarea class="docmd" id="docmd" spellcheck="false" aria-label="Body as markdown"><\/textarea>/);
  assert.doesNotMatch(src, /id="docmd"[^>]*readonly/, 'no readonly attribute');
  assert.doesNotMatch(src, /Read-only source view/, 'the old label is gone');
  assert.doesNotMatch(src, /Full document as markdown/, 'it never held the whole document; the label no longer claims it');
  assert.match(src, /<span>Body as markdown<\/span>/);
});

test('typing writes back through the block editor value setter, debounced, and marks dirty', () => {
  assert.match(src, /this\.on\('#docmd', 'input', \(\) => \{\s*clearTimeout\(this\._mdTimer\);\s*this\._mdTimer = setTimeout\(\(\) => this\._applyMarkdownEdit\(\), 250\);/, 'a 250ms debounce');
  const apply = method('_applyMarkdownEdit');
  assert.match(apply, /if \(ta\.value === body\.value\) return;/, 'idempotent for unchanged text');
  assert.match(apply, /body\.value = ta\.value;\s*this\._markDirty\(\);/, 'the setter re-parses; the document is dirty');
});

test('the view projects the body in only when it OPENS, and flushes a pending edit on the way back to Visual', () => {
  const view = method('setDocView');
  assert.match(view, /if \(!on\) \{ clearTimeout\(this\._mdTimer\); this\._applyMarkdownEdit\(\); \}/, 'no debounced edit is lost');
  assert.match(view, /if \(on\) \{ const ta = this\.\$\('#docmd'\); if \(ta\) ta\.value = this\.\$\('#body'\)\?\.value \?\? ''; \}/, 'projection on open only; nothing pushes into the textarea while typing');
});

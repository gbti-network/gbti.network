// sow-489: the preview page lost an author's edit without a word (2026-11-02). "Save draft" appeared only on the blur
// commit, "Done editing" did not save, and leaving the page did not warn. The behaviour is driven in a browser; these
// pins keep the three wires from being dropped by a later refactor of src/lib/preview-edit.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(fileURLToPath(new URL('../src/lib/preview-edit.ts', import.meta.url)), 'utf8');

test('sow-489: typing in a block or the title shows Save before any commit', () => {
  assert.equal((src.match(/addEventListener\('input', markPending\)/g) || []).length, 2, 'one for the blocks, one for the title');
  assert.match(src, /const markPending = \(\) => \{[^}]*saveBtn\.hidden = false/);
});

test('sow-489: leaving with anything unsaved asks first', () => {
  assert.match(src, /addEventListener\('beforeunload', \(ev: BeforeUnloadEvent\) => \{ if \(!unsaved\(\)\) return; ev\.preventDefault\(\)/);
});

test('sow-489: Save commits the element being edited and waits for the commit before reading the body', () => {
  const save = src.slice(src.indexOf("saveBtn?.addEventListener('click'"));
  const wait = save.indexOf('await inflight');
  const read = save.indexOf('client.saveDraft(');
  assert.ok(wait > 0 && read > wait, 'the commit is awaited before the body is sent');
  assert.match(save, /active\.isContentEditable\) active\.blur\(\)/);
});

test('sow-489: Done editing says what is not saved', () => {
  assert.match(src, /unsaved\(\) \? 'Not saved yet\. Press Save draft to keep these changes\.'/);
});

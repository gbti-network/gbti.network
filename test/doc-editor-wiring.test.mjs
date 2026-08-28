// The WorkBench block editor's wiring, and the Preview page's edit gate.
//
// These are SOURCE assertions, which is a weaker instrument than a behavioural test and is chosen only because
// every one of these paths needs a live contenteditable and a Selection. Each assertion is therefore written to
// pin the exact property that broke, not merely that some related token is present: a guard that would still
// pass after the defect is reintroduced is worse than no guard, because it reads as coverage.
//
// The three defects pinned here, all reported against the live site on 2026-08-28:
//   1. bold, italic, inline code and the link panel were dead in the Visual editor
//   2. Backspace could not remove an empty block
//   3. the Preview page hid its Edit button unless the URL carried store= and path=
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const editor = fs.readFileSync(new URL('../client-ui/src/elements/gbti-doc-editor.mjs', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../src/pages/workbench/preview.astro', import.meta.url), 'utf8');

/** The body of a top-level 2-space-indented method, from its signature to the closing `  }`. */
function methodBody(src, signature) {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is gone, so this whole guard is measuring nothing`);
  const end = src.indexOf('\n  }', start);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);
  return src.slice(start, end);
}

test('the selection toolbar is constructed AFTER the first render, or it captures the inert stub forever', () => {
  // createSelectionToolbar resolves its host eagerly and returns an inert stub when the host is absent.
  // _render() is what creates .doc-blocks. Building the toolbar first therefore disabled all inline
  // formatting for the life of the element, and `this._seltb || ...` guaranteed it was never rebuilt.
  const body = methodBody(editor, '  connectedCallback() {');
  const render = body.indexOf('this._render()');
  const toolbar = body.indexOf('createSelectionToolbar(');
  assert.notEqual(render, -1, 'connectedCallback no longer renders');
  assert.notEqual(toolbar, -1, 'connectedCallback no longer builds the selection toolbar');
  assert.ok(render < toolbar,
    'createSelectionToolbar runs before this._render(), so .doc-blocks does not exist yet and the toolbar is inert');
});

test('Backspace in an empty block is handled, and emptiness is judged on the MODEL not innerHTML', () => {
  const body = methodBody(editor, "    this.$$('.ce[data-edit=\"text\"]').forEach((el) => el.addEventListener('keydown'");
  assert.match(body, /e\.key === 'Backspace'/,
    'the block keydown handler has no Backspace branch, so an empty block cannot be removed by keyboard');
  // Chrome leaves a bare <br> in a block the author has just cleared, so an innerHTML test reports that block
  // as non-empty at exactly the moment the author expects Backspace to remove it.
  // Comments are stripped first: the first version of this guard matched the word innerHTML inside the
  // explanatory comment in the source and failed against correct code, which is a check measuring prose.
  const code = body.replace(/^\s*\/\/.*$/gm, '');
  const branch = code.slice(code.indexOf("e.key === 'Backspace'"));
  assert.match(branch, /!String\(b\.text \|\| ''\)/,
    'the Backspace branch no longer judges emptiness on the block model');
  assert.ok(!/innerHTML/.test(branch.slice(0, branch.indexOf("e.key === 'Enter'"))),
    'the Backspace branch inspects innerHTML; a cleared block holding a bare <br> would not count as empty');
  assert.match(body, /isCollapsed/,
    'the Backspace branch does not require a collapsed selection, so it would fire while text is selected');
});

test('block removal has ONE implementation, shared by the X button and Backspace', () => {
  assert.match(editor, /_deleteBlock\(id, \{ focusPrev = false \} = \{\} \) ?\{|_deleteBlock\(id, \{ focusPrev = false \} = \{\}\) \{/,
    '_deleteBlock is gone or changed shape');
  assert.match(editor, /\[data-del\][\s\S]{0,160}this\._deleteBlock\(/,
    'the X button no longer routes through _deleteBlock, so the two removal paths can drift apart again');
});

test('Preview reveals Edit from the RESOLVED item path, not from raw URL parameters', () => {
  assert.match(preview, /const canEdit = Boolean\(itemPath\);/,
    'canEdit is not derived from itemPath');
  // The specific regression: gating on the query string made a perfectly editable draft read-only whenever
  // Preview was reached by a bookmark, history entry or typed address, none of which carry those parameters.
  assert.ok(!/const canEdit = store === 'repo'/.test(preview),
    'canEdit is gated on the raw store/path query parameters again');
});

test('Preview Save resolves identity through the cookie-aware selector, not the extension attribute alone', () => {
  // readMemberSignal reads only the extension content script's data-gbti-member attribute. Used alone it told a
  // member signed in by website cookie to sign in. Unhiding Edit without this fix hands over a broken button.
  assert.match(preview, /currentIdentity\(readMemberSignal\(\)\)/,
    'Preview Save no longer routes identity through currentIdentity, so a cookie-only member cannot save');
});

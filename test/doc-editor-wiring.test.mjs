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

// ---- the PREVIEW page's own editing surface -------------------------------------------------------------
// preview.astro implements editing separately from gbti-doc-editor. Both defects below were reported on the
// Preview surface on 2026-08-28, AFTER the equivalents had been fixed in the Visual editor, which is exactly
// why they are pinned separately: a fix to one surface says nothing about the other.

test('Preview makes every editable block contenteditable UP FRONT, not on click', () => {
  // The selection toolbar's editableOf only recognises a block already carrying contenteditable="true". With
  // the attribute set lazily in the click handler, dragging a selection across an untouched paragraph resolved
  // to null and no toolbar appeared, so the author had to click a block before they could select inside it.
  const wire = preview.slice(preview.indexOf('const wireBlocks ='), preview.indexOf('const wireEditing ='));
  assert.notEqual(wire.length, 0, 'wireBlocks is gone, so this guard measures nothing');
  const code = wire.replace(/^\s*\/\/.*$/gm, '');
  const eager = code.indexOf("el.setAttribute('contenteditable', 'true');");
  const click = code.indexOf("addEventListener('click'");
  assert.notEqual(eager, -1, 'no block is made contenteditable at wire time');
  assert.ok(click === -1 || eager < click,
    'contenteditable is still set only inside a click handler, so selection before click finds nothing');
});

test('both editing surfaces wire the shared member-only action to their own document model', () => {
  assert.match(editor, /onMemberSplit:\s*\(ce\)\s*=>/,
    'the document editor does not expose member-only placement from the shared toolbar');
  assert.match(editor, /splice\(at, 0, withId\(\{ type: 'members' \}\)\)/,
    'the document editor does not insert the canonical members block before the selected block');
  assert.match(preview, /onMemberSplit:\s*\(el: HTMLElement\)\s*=>/,
    'Preview does not expose member-only placement from the shared toolbar');
  assert.match(preview, /planMemberSplitInsert\(/,
    'Preview does not route member-only placement through the pure source planner');
});

test('both editing surfaces route dropped and pasted files through the shared image processor', () => {
  assert.match(editor, /processImageFile\(file, \{ usedNames:/,
    'the document editor does not process local images before staging them');
  assert.match(editor, /firstImageFile\(e\.clipboardData\)/,
    'the document editor does not accept pasted image files');
  assert.match(editor, /transferHasFiles\(e\.dataTransfer\)/,
    'the document editor does not distinguish file drops from block reordering');
  assert.match(preview, /processImageFile\(file, \{ usedNames \}\)/,
    'Preview does not process local images before staging them');
  assert.match(preview, /firstImageFile\(ev\.clipboardData\)/,
    'Preview does not accept pasted image files');
  assert.match(preview, /stageImage\(\{[\s\S]{0,300}itemPath,[\s\S]{0,100}item:/,
    'Preview does not stage processed bytes against the current draft');
});

test('both editing surfaces immediately preview processed bytes with a CSP-compatible data URL', () => {
  assert.match(editor, /processedImageDataUrl\(processed\.blob, dataBase64\)/,
    'the document editor does not retain an immediate processed-byte preview');
  assert.match(preview, /processedImageDataUrl\(processed\.blob, dataBase64\)/,
    'Preview does not retain an immediate processed-byte preview');
  assert.ok(!/createObjectURL\(processed\.blob\)/.test(editor),
    'the document editor still creates blob: previews blocked by production CSP');
  assert.ok(!/createObjectURL\(processed\.blob\)/.test(preview),
    'Preview still creates blob: previews blocked by production CSP');
});

test('Preview blur leaves contenteditable in place, or the surface returns to click-first', () => {
  const code = preview.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/blur[\s\S]{0,400}removeAttribute\('contenteditable'\)/.test(code),
    'the blur handler strips contenteditable again, undoing the eager attribute on first use');
});

test('Preview handles Backspace in an empty block, and routes it through the pure planner', () => {
  const code = preview.replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /ev\.key !== 'Backspace'/, 'Preview has no Backspace handling');
  assert.match(code, /isCollapsed/, 'the Backspace branch does not require a collapsed caret');
  assert.match(code, /planBlockDelete\(/,
    'the delete does not use the tested planner, so its line arithmetic is untested browser-only code');
});

test('Tab and Shift+Tab route list nesting through the shared DOM operation in both editors', () => {
  assert.match(editor, /e\.key !== 'Tab'/,
    'the document editor does not intercept Tab inside a list');
  assert.match(editor, /indentListSelection\(el, selection, \{ outdent: e\.shiftKey \}\)/,
    'the document editor does not route Tab and Shift+Tab through shared list nesting');
  assert.match(preview, /ev\.key === 'Tab'[\s\S]{0,500}indentListSelection\(el, sel, \{ outdent: ev\.shiftKey \}\)/,
    'Preview does not route Tab and Shift+Tab through shared list nesting');
  assert.match(preview, /commitIn\(doc, el, \{ preserveDom: true \}\)/,
    'Preview rebuilds the list after Tab and loses the caret instead of preserving the edited DOM');
});

test('the shared toolbar marks the current H2, H3, or paragraph control', () => {
  const toolbar = fs.readFileSync(new URL('../client-ui/src/selection-toolbar.mjs', import.meta.url), 'utf8');
  assert.match(toolbar, /classList\.toggle\('is-current', active\)/);
  assert.match(toolbar, /setAttribute\('aria-pressed', String\(active\)\)/);
});

// --- 2026-08-29: the block toolbar sat on top of the text it was meant to sit beside -----------------------
//
// Measured in a browser harness before the fix, not estimated: the toolbar was 225px wide, of which the
// "Turn into" <select> alone was 147px, while the text reserved 40px of right padding on paragraphs and NOTHING
// at all on headings. The controls therefore covered the words. The fix reserves a real right gutter (the thing
// the CSS comment had claimed since it was written) and shrinks the toolbar to five 24px icon controls, the
// type control carrying the block's current type as its icon so the <select>'s label is not simply lost.
//
// This guard is arithmetic, not decoration. It fails if a sixth control is added without widening the gutter,
// which is precisely how the overlap comes back.
const BT_PX = 24;      // .bt { width:24px }
const GAP_PX = 2;      // .blk-tools { gap:2px }
const PAD_PX = 2;      // .blk-tools { padding:2px }
const BORDER_PX = 1;   // .blk-tools { border:1px }

test('the block toolbar fits inside the gutter reserved for it', () => {
  const gutter = /--blk-gutter:\s*(\d+)px/.exec(editor);
  assert.ok(gutter, 'the --blk-gutter property is gone, so nothing reserves space for the toolbar');
  const tools = methodBody(editor, '_tools(b)').replace(/^\s*\/\/.*$/gm, '');
  const controls = (tools.match(/class="bt(?![\w-])/g) || []).length;
  assert.ok(controls >= 5, `expected the toolbar to still carry its controls, counted ${controls}`);
  const needed = controls * BT_PX + (controls - 1) * GAP_PX + PAD_PX * 2 + BORDER_PX * 2;
  assert.ok(Number(gutter[1]) >= needed,
    `--blk-gutter is ${gutter[1]}px but ${controls} controls need ${needed}px, so the toolbar overlaps the text`);
});

test('the toolbar reserves its space through the gutter, not through the old partial padding', () => {
  // 40px was a reservation for a 225px toolbar: far too small to work, and large enough to look deliberate.
  assert.ok(!/\.ce \{[^}]*padding:2px 40px/.test(editor),
    'the old 40px right padding is back alongside the gutter, so the space is reserved twice');
  assert.match(editor, /\.blk-tools \{[^}]*right:calc\(var\(--blk-gutter\)/,
    'the toolbar is not positioned into the gutter, so widening the gutter alone would not move it');
});

test('the type control is an icon button opening a palette, not the dropdown that caused the overlap', () => {
  // Comments are stripped first: the explanatory note above _tools mentions the old <select> by name, and
  // without this the guard matches that prose and fails on a file that is completely correct. This exact trap
  // is why the other guards in this file strip comments too.
  const tools = methodBody(editor, '_tools(b)').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/<select/.test(tools), 'the <select> is back; measured at 147px it cannot fit the gutter');
  assert.match(tools, /data-convert=/, 'the Turn into control is gone entirely');
  assert.match(editor, /_openConvert\(/, 'no _openConvert, so the type button opens nothing');
  // Conversion must stay in one place, or the palette and any other caller drift apart.
  assert.match(editor, /_convertBlock\(id, row\.dataset\.ck\)/, 'the palette does not route through _convertBlock');
});

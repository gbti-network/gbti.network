// sow-235: the Preview commits an edited block back into the Markdown source. Everything the rendered HTML cannot
// express (a table's column alignment, a fence's language, whether a list is ordered) has to survive the trip, so
// the block is rebuilt from its own source and only its text-bearing fields are replaced. These are the guards for
// that. Pure + node-safe (no DOM): readBlockDom is the thin browser half and is exercised in the browser pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBlockEdit, isEditableBlockTag, EDITABLE_BLOCK_TAGS, planBlockDelete, planBlockRetype, planImageInsert, planMemberSplitInsert } from '../client-ui/src/block-commit.mjs';
import { renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';

const CORPUS = [
  'A wrapped paragraph that the renderer',
  'joins back together with a space.',
  '',
  '## A heading',
  '',
  '> a quoted line',
  '',
  '- first item',
  '- second **bold** item',
  '',
  '1. ordered one',
  '2. ordered two',
  '',
  '| Name | Qty |',
  '| :--- | ---: |',
  '| a | 1 |',
  '',
  '```js',
  'const x = 1;',
  '```',
].join('\n');

// The whole design rests on this: a block's SOURCE range must parse to exactly one block of the type the renderer
// emitted. If the two parsers ever drift apart, every commit below is writing to the wrong shape, so this fails
// loudly rather than letting the corruption surface as a mangled table months later.
test('every rendered block re-parses to one block of its own type, and re-serializes exactly', () => {
  const lines = CORPUS.split('\n');
  const { html, blocks } = renderMarkdownWithBlocks(CORPUS);
  const tags = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*data-blk="(\d+)"/gi)].map((m) => [Number(m[2]), m[1].toUpperCase()]);
  const seen = [];
  for (const [n, tag] of tags) {
    const r = blocks[n];
    if (!r) continue;                       // the footnotes section carries a null range by design
    const src = lines.slice(r.start, r.end + 1).join('\n');
    const parsed = parseBlocks(src);
    assert.equal(parsed.length, 1, `<${tag}> at lines ${r.start + 1}-${r.end + 1} parsed to ${parsed.length} blocks`);
    assert.equal(serializeBlocks(parsed), src, `<${tag}> did not re-serialize to its own source`);
    seen.push(tag);
  }
  assert.deepEqual(seen, ['P', 'H2', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'PRE'], 'the corpus must exercise every editable tag');
  for (const tag of seen) assert.ok(isEditableBlockTag(tag), `${tag} should be editable`);
});

test('editing one list item leaves the others alone and keeps the bullet', () => {
  const src = '- first item\n- second **bold** item';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'list', items: ['first item', 'second *changed* item'] }),
    ['- first item', '- second *changed* item'],
  );
});

test('an ordered list keeps its numbering and renumbers cleanly', () => {
  const src = '1. ordered one\n2. ordered two';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'list', items: ['ordered one', 'ordered two', 'ordered three'] }),
    ['1. ordered one', '2. ordered two', '3. ordered three'],
  );
});

test('editing a table cell preserves the alignment row, which exists ONLY in the source', () => {
  const src = '| Name | Qty |\n| :--- | ---: |\n| a | 1 |';
  const out = applyBlockEdit(src, { kind: 'table', head: ['Name', 'Count'], rows: [['a', '2']] });
  assert.deepEqual(out, ['| Name | Count |', '| :--- | ---: |', '| a | 2 |']);
});

test('editing a fenced block preserves its language and does not transform the code', () => {
  const src = '```js\nconst x = 1;\n```';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'code', code: 'const x = 2; // **not** bold' }),
    ['```js', 'const x = 2; // **not** bold', '```'],
  );
});

test('a fence long enough to contain backticks is preserved', () => {
  const src = '````markdown\n```\nnested\n```\n````';
  const out = applyBlockEdit(src, { kind: 'code', code: '```\nstill nested\n```' });
  assert.equal(out[0], '````markdown');
  assert.equal(out[out.length - 1], '````');
});

test('a wrapped paragraph commits back as one line, matching how the renderer joins it', () => {
  const src = 'A wrapped paragraph that the renderer\njoins back together with a space.';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'paragraph', text: 'A wrapped paragraph, now edited and on one line.' }),
    ['A wrapped paragraph, now edited and on one line.'],
  );
});

test('a heading keeps its level and a quote keeps its marker', () => {
  assert.deepEqual(applyBlockEdit('#### deep heading', { kind: 'heading', text: 'still deep' }), ['#### still deep']);
  assert.deepEqual(applyBlockEdit('> a quoted line', { kind: 'quote', text: 'an edited quote' }), ['> an edited quote']);
});

test('a mismatched or unusable read commits NOTHING rather than guessing', () => {
  // The renderer falls back to a <p> for an unrecognized embed fence, so a paragraph read can land on a source
  // block that is not a paragraph. Writing it would destroy the fence.
  assert.equal(applyBlockEdit('```embed\nhttps://example.com/x\n```', { kind: 'paragraph', text: 'oops' }), null);
  assert.equal(applyBlockEdit('- a\n- b', { kind: 'paragraph', text: 'oops' }), null);   // wrong kind for the source
  assert.equal(applyBlockEdit('- a\n- b', { kind: 'list' }), null);                       // no items
  assert.equal(applyBlockEdit('a para\n\nanother para', { kind: 'paragraph', text: 'x' }), null); // range spans 2 blocks
  assert.equal(applyBlockEdit('a para', null), null);
});

test('hr and non-text blocks are not offered for editing', () => {
  for (const tag of ['HR', 'DIV', 'SECTION', 'IMG', 'IFRAME']) assert.ok(!isEditableBlockTag(tag), `${tag} must not be editable`);
  assert.ok(!EDITABLE_BLOCK_TAGS.has('HR'));
});

// planBlockDelete: which source lines a block DELETE removes. Reported 2026-08-28: in Preview edit mode an empty
// paragraph could not be removed with Backspace. Clicking away did dispose of it, because an empty commit writes
// [''] and markdown collapses the blank, so the machinery worked and only the keyboard path was missing.

test('a deleted block takes one blank separator with it, or the paragraphs either side fuse', () => {
  assert.deepEqual(planBlockDelete('A\n\nX\n\nB', { start: 2, end: 2 }), ['A', '', 'B']);
  // The join must still parse as two paragraphs, which is the whole point of taking the separator.
  assert.equal(planBlockDelete('A\n\nX\n\nB', { start: 2, end: 2 }).join('\n'), 'A\n\nB');
});

test('the LAST block takes the blank BEFORE it, since there is none after', () => {
  assert.deepEqual(planBlockDelete('A\n\nX', { start: 2, end: 2 }), ['A']);
});

test('a multi-line block (a list, a fence) is removed by its whole range', () => {
  assert.deepEqual(planBlockDelete('A\n\n- one\n- two\n\nB', { start: 2, end: 3 }), ['A', '', 'B']);
});

test('deleting the only remaining content is REFUSED, because there would be nowhere to put the caret', () => {
  assert.equal(planBlockDelete('X', { start: 0, end: 0 }), null);
  assert.equal(planBlockDelete('\n\nX\n\n', { start: 2, end: 2 }), null);
});

test('a range that does not fit the document is refused rather than guessed at', () => {
  assert.equal(planBlockDelete('A', { start: 5, end: 9 }), null);
  assert.equal(planBlockDelete('A\n\nB', { start: 2, end: 0 }), null, 'end before start');
  assert.equal(planBlockDelete('A', null), null);
  assert.equal(planBlockDelete('A', { start: 0 }), null, 'a half-built range must not be treated as line 0');
});

// planBlockRetype: a paragraph becomes a heading (and back), only through the explicit control, with the LEVEL
// coming from the control rather than the source. This is the deliberate exception to applyBlockEdit's "a heading
// keeps its level from the source" rule; the two live side by side on purpose.
test('a paragraph becomes a heading at the level the control names, keeping its text', () => {
  assert.deepEqual(planBlockRetype('Just some text', 'heading', 2), ['## Just some text']);
  assert.deepEqual(planBlockRetype('Just some text', 'heading', 3), ['### Just some text']);
});

test('a heading becomes a paragraph, dropping its hashes and keeping its text', () => {
  assert.deepEqual(planBlockRetype('### A sub heading', 'paragraph'), ['A sub heading']);
});

test('a heading re-levels, and the level is clamped to 1..6 with a falsy level falling back to 2', () => {
  assert.deepEqual(planBlockRetype('## Two', 'heading', 3), ['### Two']);
  assert.deepEqual(planBlockRetype('## Two', 'heading', 9), ['###### Two']);
  assert.deepEqual(planBlockRetype('## Two', 'heading', 0), ['## Two'], '0 is falsy, so it falls back to the default 2');
});

test('retype refuses anything that is not a paragraph or heading, and never a multi-block range', () => {
  assert.equal(planBlockRetype('- a\n- b', 'heading', 2), null, 'a list');
  assert.equal(planBlockRetype('> quoted', 'heading', 2), null, 'a quote');
  assert.equal(planBlockRetype('```\ncode\n```', 'paragraph'), null, 'a fence');
  assert.equal(planBlockRetype('A\n\nB', 'heading', 2), null, 'two blocks');
  assert.equal(planBlockRetype('one\nstill one', 'heading', 2), null, 'a multi-line paragraph cannot be one heading');
  assert.equal(planBlockRetype('text', 'list', 2), null, 'an unsupported target type');
});

// planImageInsert: add an image block AFTER a single anchor block, from an image already attached to the item. The
// anchor is preserved verbatim so the caller can splice the result over the block's range like any other commit.
test('an image is inserted after the anchor block, separated by a blank line', () => {
  assert.deepEqual(
    planImageInsert('A paragraph.', './images/hero.webp', 'A hero'),
    ['A paragraph.', '', '![A hero](./images/hero.webp)'],
  );
});

test('the anchor block is preserved verbatim, including a multi-line block', () => {
  assert.deepEqual(
    planImageInsert('- one\n- two', './images/x.png', ''),
    ['- one', '- two', '', '![](./images/x.png)'],
  );
});

test('image insert is refused on an empty ref or a multi-block range', () => {
  assert.equal(planImageInsert('A paragraph.', '', 'alt'), null, 'no ref');
  assert.equal(planImageInsert('A paragraph.', '   ', 'alt'), null, 'a whitespace-only ref');
  assert.equal(planImageInsert('A\n\nB', './images/x.png', ''), null, 'two blocks: no single anchor');
});

// The whole design rests on the inserted image round-tripping: the source line parseBlocks reads back as one image
// block, so after a re-render it is a real, separate block rather than fused into the paragraph above it.
test('the inserted image line re-parses to a single image block', () => {
  const next = planImageInsert('A paragraph.', './images/hero.webp', 'A hero');
  const blocks = parseBlocks(next.join('\n'));
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[1], { type: 'image', alt: 'A hero', url: './images/hero.webp' });
});

test('member-only starts at the selected anchor block and uses the canonical marker', () => {
  assert.deepEqual(
    planMemberSplitInsert('The first gated paragraph.'),
    ['<!-- members-only -->', '', 'The first gated paragraph.'],
  );
});

test('member-only preserves a multi-line anchor block verbatim', () => {
  assert.deepEqual(
    planMemberSplitInsert('- one\n- two'),
    ['<!-- members-only -->', '', '- one', '- two'],
  );
});

test('member-only refuses a multi-block range or an existing split', () => {
  assert.equal(planMemberSplitInsert('A\n\nB'), null);
  assert.equal(planMemberSplitInsert('<!-- members-only -->'), null);
});

test('the member-only insertion round-trips as a split followed by the original block', () => {
  const blocks = parseBlocks(planMemberSplitInsert('Gated.').join('\n'));
  assert.deepEqual(blocks.map((b) => b.type), ['members', 'paragraph']);
  assert.equal(blocks[1].text, 'Gated.');
});

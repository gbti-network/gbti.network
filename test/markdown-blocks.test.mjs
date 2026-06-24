// SOW-062 Phase 4: the Markdown <-> block round-trip for the in-house block editor. The repo stays the database,
// so parse->serialize must preserve the body, and the SOW-016 members-only marker must round-trip EXACTLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, serializeBlocks, MEMBERS_MARKER, emptyBlock } from '../client-ui/src/markdown-blocks.mjs';

test('parseBlocks classifies the core block types', () => {
  const md = '# Heading\n\npara line one\npara line two\n\n- a\n- b\n\n> quote\n\n![alt](url.png)';
  const b = parseBlocks(md);
  assert.deepEqual(b.map((x) => x.type), ['heading', 'paragraph', 'list', 'quote', 'image']);
  assert.equal(b[0].level, 1);
  assert.equal(b[0].text, 'Heading');
  assert.equal(b[1].text, 'para line one\npara line two');
  assert.deepEqual(b[2].items, ['a', 'b']);
  assert.equal(b[3].text, 'quote');
  assert.deepEqual([b[4].alt, b[4].url], ['alt', 'url.png']);
});

test('the members-only marker is a first-class block and round-trips EXACTLY (SOW-016)', () => {
  const md = 'Public intro.\n\n<!-- members-only -->\n\nPaid-only section.';
  const blocks = parseBlocks(md);
  assert.deepEqual(blocks.map((x) => x.type), ['paragraph', 'members', 'paragraph']);
  const out = serializeBlocks(blocks);
  assert.ok(out.includes(MEMBERS_MARKER));
  assert.equal(out, md);
});

test('serialize(parse(md)) round-trips a full document verbatim', () => {
  const md = [
    '# Title', '',
    'Intro with **bold** and a [link](https://x.com).', '',
    '## Subhead', '',
    '- one', '- two', '',
    '> a blockquote', '',
    '```js', 'const x = 1;', '```', '',
    MEMBERS_MARKER, '',
    'Members text.',
  ].join('\n');
  assert.equal(serializeBlocks(parseBlocks(md)), md);
});

test('code fence preserves language + body; ordered list renumbers', () => {
  const md = '```python\nprint(1)\nprint(2)\n```\n\n1. first\n2. second';
  const b = parseBlocks(md);
  assert.equal(b[0].type, 'code');
  assert.equal(b[0].lang, 'python');
  assert.equal(b[0].code, 'print(1)\nprint(2)');
  assert.equal(b[1].type, 'list');
  assert.equal(b[1].ordered, true);
  assert.equal(serializeBlocks(b), md);
});

test('round-trip is IDEMPOTENT across repeated edit cycles, and a mid-text marker is NOT a divider', () => {
  const md = [
    'Intro.', '', '<!-- members-only -->', '', '## Members', '', 'Secret one.', '',
    '<!-- members-only -->', '', 'Secret two.',
  ].join('\n');
  const once = serializeBlocks(parseBlocks(md));
  const twice = serializeBlocks(parseBlocks(once));
  assert.equal(once, twice); // editing + re-saving never drifts the body
  assert.equal((once.match(/<!-- members-only -->/g) || []).length, 2); // both markers survive verbatim
  // a marker that is NOT on its own line stays inline text (the Worker splits on the marker LINE), not a divider
  const inline = parseBlocks('text <!-- members-only --> more');
  assert.deepEqual(inline.map((b) => b.type), ['paragraph']);
});

test('empty + marker-only + bare-url embed', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks(MEMBERS_MARKER).map((x) => x.type), ['members']);
  assert.equal(serializeBlocks([]), '');
  const e = parseBlocks('https://youtu.be/abc');
  assert.deepEqual([e[0].type, e[0].url], ['embed', 'https://youtu.be/abc']);
  assert.equal(emptyBlock('heading').level, 2);
});

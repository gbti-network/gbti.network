// The Preview showed the Minecraft article's first table as a run of pipes (owner, 2026-11-02): the line above it,
// `<!-- sort: off -->` (sow-470's table-sort marker), was printed as text and the table rows were glued onto it.
// The site drops such a line and renders the table, and the Preview must agree with the page it previews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMarkdownWithBlocks } from '../client/src/markdown.mjs';

const TABLE = '| Server | Most used |\n|---|---|\n| Paper family | 26.3 |';

test('a table under the sort marker renders as a table, and the marker is not shown', () => {
  const html = renderMarkdown(`Intro.\n\n<!-- sort: off -->\n${TABLE}\n\nAfter.`);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /sort: off|&lt;!--/);
  assert.match(html, /<p>Intro\.<\/p>/);
  assert.match(html, /<p>After\.<\/p>/);
});

test('a comment line directly under a paragraph ends the paragraph rather than joining it', () => {
  const html = renderMarkdown(`One line.\n<!-- sort: on -->\n${TABLE}`);
  assert.match(html, /<p>One line\.<\/p>/);
  assert.match(html, /<table>/);
});

test('POSITIVE CONTROL: comment-like text inside a paragraph is still text', () => {
  const html = renderMarkdown('Type <!-- this --> inline to hide nothing.');
  assert.match(html, /&lt;!-- this --&gt;/);
});

test('in the block view the table keeps its own source range, so editing it does not touch the marker', () => {
  const src = `Intro.\n\n<!-- sort: off -->\n${TABLE}`;
  const { blocks } = renderMarkdownWithBlocks(src);
  const lines = src.split('\n');
  const table = blocks.find((b) => b && lines[b.start].startsWith('| Server'));
  assert.ok(table, 'the table is a block of its own');
  assert.equal(lines[table.start - 1], '<!-- sort: off -->');
});

// SOW-062 Phase 5d: the callout + embed body blocks render in BOTH the in-extension reader (client/src/markdown.mjs)
// and the static build (src/lib/remark-content-blocks.mjs), via the one shared embedUrl. No author HTML executes:
// callout bodies are escaped, and only a normalized provider URL becomes an iframe src.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { embedUrl } from '../client/src/video-embed.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';

test('reader: a callout fence renders a variant box with an escaped, inline-formatted body', () => {
  const html = renderMarkdown('```callout warning\nHeads up, see [docs](https://x.com).\n```');
  assert.match(html, /md-callout md-callout-warning/);
  assert.match(html, /<a href="https:\/\/x\.com"/); // inline link works inside the callout
  assert.doesNotMatch(html, /<pre>/); // it is NOT a code block
});

test('reader: an unknown or missing callout variant falls back to note', () => {
  assert.match(renderMarkdown('```callout\nx\n```'), /md-callout-note/);
  assert.match(renderMarkdown('```callout danger\nx\n```'), /md-callout-note/);
});

test('reader: an embed fence with a YouTube URL renders a sandboxed provider iframe', () => {
  const html = renderMarkdown('```embed\nhttps://youtu.be/dQw4w9WgXcQ\n```');
  assert.match(html, /<iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /sandbox=/);
});

test('reader: an embed fence with a non-video URL degrades to an escaped link, never an iframe', () => {
  const html = renderMarkdown('```embed\nhttps://example.com/page\n```');
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /<a href="https:\/\/example\.com\/page"/);
});

test('reader: a raw <iframe> typed as body text stays escaped (only the embed fence makes an iframe)', () => {
  const html = renderMarkdown('Look: <iframe src="https://evil"></iframe>');
  assert.match(html, /&lt;iframe/);
  assert.doesNotMatch(html, /<iframe /);
});

test('embedUrl normalizes YouTube + Vimeo forms and rejects everything else', () => {
  assert.equal(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://vimeo.com/123456'), 'https://player.vimeo.com/video/123456');
  assert.equal(embedUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://example.com'), null);
});

test('build: remarkContentBlocks turns callout/embed code nodes into html nodes, matching the reader', () => {
  const tree = { type: 'root', children: [
    { type: 'code', lang: 'callout', meta: 'tip', value: 'Nice **bold**' },
    { type: 'code', lang: 'embed', value: 'https://youtu.be/dQw4w9WgXcQ' },
    { type: 'code', lang: 'js', value: 'const callout = 1;' },
  ] };
  remarkContentBlocks()(tree);
  assert.equal(tree.children[0].type, 'html');
  assert.match(tree.children[0].value, /callout callout-tip/);
  assert.match(tree.children[0].value, /<strong>bold<\/strong>/); // inline parity with the reader
  assert.equal(tree.children[1].type, 'html');
  assert.match(tree.children[1].value, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(tree.children[2].type, 'code'); // a real code block is left untouched
});

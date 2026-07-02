// SOW-062 Phase 6: the inline presentation transform (Markdown <-> inline HTML) the WYSIWYG uses at the DOM
// boundary. b.text stays Markdown on the model; the editor renders it as inline HTML in a contenteditable and reads
// it back. This guards the md -> html -> md round-trip so opening + saving an existing post never corrupts inline
// formatting. Pure + node-safe (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineMdToHtml, inlineHtmlToMd } from '../client-ui/src/markdown-blocks.mjs';

const roundtrip = (md) => inlineHtmlToMd(inlineMdToHtml(md));

test('inline Markdown survives md -> html -> md', () => {
  for (const md of [
    'plain text',
    'has **bold** word',
    'has *italic* word',
    'has `code` span',
    'a [link](https://x.com) here',
    'bold **and** a [link](https://y.io) and `code`',
    '~~struck~~ out',
  ]) assert.equal(roundtrip(md), md);
});

test('md -> html emits real tags (not literal tokens)', () => {
  assert.equal(inlineMdToHtml('**b**'), '<strong>b</strong>');
  assert.equal(inlineMdToHtml('`c`'), '<code>c</code>');
  assert.equal(inlineMdToHtml('[t](u)'), '<a href="u">t</a>');
});

test('browser bold/italic variants (<b>/<i>) read back to Markdown', () => {
  assert.equal(inlineHtmlToMd('<b>x</b>'), '**x**');
  assert.equal(inlineHtmlToMd('<i>x</i>'), '*x*');
  assert.equal(inlineHtmlToMd('<div>a</div><div>b</div>'), '\na\nb'); // contenteditable soft lines
});

test('html-special characters in prose round-trip through the escape/unescape', () => {
  assert.equal(roundtrip('a < b && c > d'), 'a < b && c > d');
});

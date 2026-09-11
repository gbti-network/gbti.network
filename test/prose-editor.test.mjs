// The comment editor (owner, 2026-09-11): one prose surface backed by markdown, full width, a quiet header of
// controls. The block editor's compact mode it replaces was shipped the same day. What matters is that the surface
// reads back to the markdown it was filled from, so a comment survives an edit unchanged, and that what the
// browser leaves behind while typing (div-wrapped lines, stray <br>s, nested divs) reads back as the markdown the
// author meant. The read-back is DOM-free, so it is driven here through a parsed HTML tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromHtml } from 'hast-util-from-html';
import { toHtml as toHtmlRaw } from 'hast-util-to-html';
// A browser's innerHTML writes &lt; &gt; &amp; (named), where the serializer defaults to numeric references.
const toHtml = (n) => toHtmlRaw(n, { characterReferences: { useNamedReferences: true } });
import { domToMarkdown, editorHtmlFromMarkdown, PROSE_CONTROLS, commentBodyTooLong, COMMENT_MAX_BYTES } from '../client-ui/src/prose-editor-core.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// A parsed HTML tree wearing the DOM subset domToMarkdown reads: nodeType, tagName, childNodes, textContent,
// innerHTML, outerHTML, getAttribute. The same walker runs over real DOM nodes in the browser.
const adapt = (h) => {
  if (h.type === 'text') return { nodeType: 3, textContent: h.value };
  if (h.type !== 'element') return { nodeType: 8 };
  const props = h.properties || {};
  const cls = Array.isArray(props.className) ? props.className.join(' ') : (props.className || '');
  const attrs = { class: cls, 'data-embed-url': props.dataEmbedUrl || '', 'data-lang': props.dataLang || '', href: props.href || '' };
  return {
    nodeType: 1, tagName: h.tagName.toUpperCase(), childNodes: h.children.map(adapt),
    get textContent() { return toHtml(h.children).replace(/<[^>]+>/g, ''); },
    get innerHTML() { return toHtml(h.children); },
    get outerHTML() { return toHtml(h); },
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
  };
};
const surface = (html) => ({ nodeType: 1, tagName: 'DIV', childNodes: fromHtml(html, { fragment: true }).children.map(adapt) });
const roundTrip = (md) => domToMarkdown(surface(editorHtmlFromMarkdown(md)));

test('what the browser leaves while typing reads back as the markdown the author meant', () => {
  assert.equal(domToMarkdown(surface('<p>Hello <b>bold</b> and <i>it</i></p>')), 'Hello **bold** and *it*');
  assert.equal(domToMarkdown(surface('<div>one</div><div>two</div>')), 'one\n\ntwo', 'div-wrapped lines are paragraphs');
  assert.equal(domToMarkdown(surface('<p>one<br></p><div><br></div><p>two</p>')), 'one\n\ntwo', 'a trailing <br> and an empty line vanish');
  assert.equal(domToMarkdown(surface('plain <i>i</i> text<p>next</p>')), 'plain *i* text\n\nnext', 'bare text at the root is a paragraph');
  assert.equal(domToMarkdown(surface('<div><p>a</p><p>b</p></div>')), 'a\n\nb', 'a wrapping div recurses');
  assert.equal(domToMarkdown(surface('<p>a &lt; b &amp; c</p>')), 'a < b & c', 'entities decode');
  assert.equal(domToMarkdown(surface('<p>x</p>text with &lt;tag&gt; chars')), 'x\n\ntext with <tag> chars', 'angle brackets in bare text survive');
  assert.equal(domToMarkdown(surface('<p>see <a href="https://x.test" target="_blank" rel="noopener">here</a></p>')), 'see [here](https://x.test)', 'a renderer anchor reads back as a markdown link');
  assert.equal(domToMarkdown(surface('<p>Line one<br>Line two</p>')), 'Line one  \nLine two', 'a break inside a paragraph is a hard break');
});

test('quotes, lists and code blocks keep their shape, including what the browser nests', () => {
  assert.equal(domToMarkdown(surface('<blockquote>a<div>b</div></blockquote>')), '> a\n> b');
  assert.equal(domToMarkdown(surface('<blockquote>a</blockquote><blockquote>b</blockquote>')), '> a\n> b', 'the renderer draws one quote per line; they fuse back');
  assert.equal(domToMarkdown(surface('<blockquote>p1</blockquote><blockquote></blockquote><blockquote>p2</blockquote>')), '> p1\n>\n> p2', 'an empty quote line separates paragraphs');
  assert.equal(domToMarkdown(surface('<blockquote></blockquote><p>after</p>')), 'after', 'a lone empty quote is nothing');
  assert.equal(domToMarkdown(surface('<ul><li>one</li><li>two <b>b</b></li></ul>')), '- one\n- two **b**');
  assert.equal(domToMarkdown(surface('<ol><li>a</li><li>b</li></ol>')), '1. a\n2. b');
  assert.equal(domToMarkdown(surface('<ul><li>x<div>y</div></li><li>z<ul><li>n</li></ul></li></ul>')), '- x\n  y\n- z\n  - n', 'a nested div continues the item; a nested list indents');
  assert.equal(domToMarkdown(surface('<pre><code class="language-js" data-lang="js">let x = 1;\nlet y = 2;</code></pre>')), '```js\nlet x = 1;\nlet y = 2;\n```');
  assert.equal(domToMarkdown(surface('<pre>a<br>b<br></pre>')), '```\na\nb\n```', 'a browser inserts <br> per Enter in a pre; a trailing one is not a line');
  assert.equal(domToMarkdown(surface('<pre>if (a &lt; b) {}</pre>')), '```\nif (a < b) {}\n```');
  assert.equal(domToMarkdown(surface('<h2>Title</h2><hr><p>t</p>')), '## Title\n\n---\n\nt');
});

test('the video poster card reads back as its URL alone on a line', () => {
  const html = editorHtmlFromMarkdown('Intro\n\nhttps://www.youtube.com/watch?v=abc123DEF45\n\nOutro');
  assert.match(html, /class="md-embed md-embed-poster"/, 'the comment renderer draws the poster');
  assert.equal(domToMarkdown(surface(html)), 'Intro\n\nhttps://www.youtube.com/watch?v=abc123DEF45\n\nOutro');
  assert.equal(editorHtmlFromMarkdown(''), '<p><br></p>', 'an empty value gives the caret a home');
  assert.equal(domToMarkdown(surface('<p><br></p>')), '', 'and reads back as nothing');
});

test('every construct the comment vocabulary allows round-trips through the renderer unchanged', () => {
  const cases = [
    'Just a paragraph.',
    'Two\n\nparagraphs.',
    'Hello **bold** and *it* and `c` [l](https://x.test)',
    'https://www.youtube.com/watch?v=abc123DEF45',
    'Before\n\nhttps://youtu.be/abc123DEF45\n\nAfter',
    '> a quote\n> two lines',
    '> p1\n>\n> p2',
    '- one\n- two',
    '1. a\n2. b',
    '```js\nlet x = 1;\nlet y = "q";\n```',
    '```\nplain\n```',
    'Line one  \nLine two',
  ];
  for (const md of cases) assert.equal(roundTrip(md), md, JSON.stringify(md));
});

test('the header lists the nine controls in order, with a gap between inline and block', () => {
  assert.deepEqual(PROSE_CONTROLS.map((c) => (c ? c.act : '|')), ['bold', 'italic', 'code', 'link', '|', 'quote', 'ul', 'ol', 'codeblock', 'video']);
  assert.equal(COMMENT_MAX_BYTES, 8000);
  assert.equal(commentBodyTooLong('a'.repeat(8000)), false);
  assert.equal(commentBodyTooLong('a'.repeat(8001)), true);
  assert.equal(commentBodyTooLong('é'.repeat(4001)), true, 'bytes, not characters');
});

test('the element: full width, one surface, the header, plain-text paste, the shared link panel, video by URL', () => {
  const src = read('client-ui/src/elements/gbti-prose-editor.mjs');
  assert.ok(src.includes(':host { display: block; width: 100%;'), 'fills its container');
  assert.ok(!/--blk-gutter/.test(src), 'no tool gutter');
  assert.ok(src.includes('<div class="surface" contenteditable="true" data-surface'), 'one editable surface');
  assert.equal((src.match(/contenteditable="true"/g) || []).length, 1, 'and only one');
  assert.ok(src.includes('<div class="hdr" role="toolbar" aria-label="Formatting">${controls}</div>'), 'the header row');
  assert.ok(src.includes("const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';"), 'paste is plain text');
  assert.ok(src.includes("document.execCommand('insertText', false, t)"));
  assert.ok(src.includes('createSelectionToolbar({ root: this.root, host: () => this.$(\'[data-box]\'), editableOf: () => null,'), 'the toolbar module is used for its link panel only');
  assert.ok(src.includes('this._tb?.editLink(this._surface(), a);'), 'Link opens that panel');
  assert.ok(src.includes("if (!url || !embedUrl(url)) { input.classList.add('bad'); input.focus(); return; }"), 'a video needs a URL the relay can play');
  assert.ok(src.includes("card.setAttribute('contenteditable', 'false');"), 'a video card is atomic');
  assert.ok(src.includes('get value() { const s = this._surface(); return s ? domToMarkdown(s)'), 'value reads the surface back');
  assert.ok(src.includes('if (this._rendered) return;'), 'the shell survives a client re-render');
  assert.ok(src.split('\n').length <= 900);
});

test('the comment box mounts the prose editor; the block editor has no compact mode left; the registry knows the element', () => {
  const box = read('client-ui/src/elements/gbti-comment-box.mjs');
  assert.ok(box.includes("import './gbti-prose-editor.mjs';"));
  assert.ok(box.includes('<gbti-prose-editor data-editor></gbti-prose-editor>'));
  assert.ok(!box.includes('gbti-doc-editor'), 'the block editor is out of the comment box');
  assert.ok(box.includes("from '../prose-editor-core.mjs'"), 'the byte cap moved with the editor');
  assert.ok(box.includes("_fullRow(on) { this.style.flex = on ? '1 1 100%' : ''; this.style.width = on ? '100%' : ''; }"), 'an open form takes the whole row');
  assert.equal((box.match(/this\._fullRow\(false\);/g) || []).length, 2, 'the Edit link and the Write a comment button give it back');
  assert.ok(box.includes('    this._fullRow(true);\n    const visRow = '), 'the form opens full width');
  const doc = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.ok(!/compact/.test(doc), 'no compact mode');
  assert.ok(!/doc-editor-core/.test(doc));
  assert.ok(!fs.existsSync(new URL('../client-ui/src/doc-editor-core.mjs', import.meta.url)), 'doc-editor-core.mjs is gone');
  const reg = read('client-ui/src/index.mjs');
  assert.ok(reg.includes("import './elements/gbti-prose-editor.mjs';"));
});

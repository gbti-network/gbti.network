// A caption on an image (owner, 2026-09-11: "I need to be able to add a caption here at the toolbar level", on the
// Preview's image bar). Stored as the image's title, standard markdown: `![alt](./images/x.png "The caption"){full}`.
// A lone captioned image line renders as a figure with the caption strip under it, the layout classes on the
// figure so a float or full width carries the caption along; an inline titled image keeps its tooltip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { IMAGE_LINE_RE, parseImageLine, cleanCaption, imageTitleSuffix } from '../client/src/image-attrs.mjs';
import { renderMarkdown, renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { planImageCaption, planImageLayout, imageBlockOf } from '../client-ui/src/block-commit.mjs';
import { resolveMarkdownAssets } from '../client-ui/src/assets.mjs';
import { imageLayoutProseCss } from '../client-ui/src/image-layout-ui.mjs';
import { remarkContentBlocks, figureForCaptionedImage } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeStyleAllowlist } from '../src/lib/markdown-sanitize.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the line grammar: a title is the caption, with or without the layout suffix', () => {
  assert.ok(IMAGE_LINE_RE.test('![A](./images/x.png "The cams"){full}'));
  assert.deepEqual(parseImageLine('![A](./images/x.png "The cams"){full}'), { alt: 'A', url: './images/x.png', caption: 'The cams', layout: { width: 'full' } });
  assert.deepEqual(parseImageLine('![A](./images/x.png "The  cams ")'), { alt: 'A', url: './images/x.png', caption: 'The cams', layout: {} }, 'whitespace collapses');
  assert.deepEqual(parseImageLine('![A](./images/x.png)'), { alt: 'A', url: './images/x.png', caption: '', layout: {} }, 'no title, no caption');
  assert.equal(parseImageLine('![A](./images/x.png "cap"){banana}'), null, 'a foreign brace group still refuses the line');
  assert.equal(parseImageLine('![A](./images/x.png "cap") trailing'), null);
  assert.equal(cleanCaption('  say "hi"  there '), 'say hi there', 'double quotes go, so the line stays one group');
  assert.equal(imageTitleSuffix('The cams'), ' "The cams"');
  assert.equal(imageTitleSuffix('   '), '');
  assert.equal(imageTitleSuffix(undefined), '');
});

test('the client renderer: a lone captioned line is a figure, a plain one is unchanged, an inline one keeps its tooltip', () => {
  assert.equal(renderMarkdown('![A](./images/x.png "The cams"){full}'),
    '<figure class="img-full"><img src="./images/x.png" alt="A" loading="lazy"><figcaption>The cams</figcaption></figure>');
  assert.equal(renderMarkdown('![A](./images/x.png "a <b> & c")'),
    '<figure><img src="./images/x.png" alt="A" loading="lazy"><figcaption>a &lt;b&gt; &amp; c</figcaption></figure>', 'the caption is escaped');
  assert.equal(renderMarkdown('![A](./images/x.png){left wrap}'), '<p><img src="./images/x.png" alt="A" loading="lazy" class="img-left img-wrap"></p>', 'no caption: as before');
  assert.equal(renderMarkdown('Text ![A](./images/x.png "tip") more'), '<p>Text <img src="./images/x.png" alt="A" title="tip" loading="lazy"> more</p>');
  const r = renderMarkdownWithBlocks('p\n\n![A](./images/x.png "cap")\n\nq');
  assert.match(r.html, /<figure data-blk="1">/, 'the Preview stamps the figure as its own block');
  assert.deepEqual(r.blocks[1], { start: 2, end: 2 });
});

const site = (md) => unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStyleAllowlist).use(rehypeStringify).process(md).then(String);

test('the site chain: the figure with its classes and caption survives the sanitizer; a raw figure class does not', async () => {
  assert.equal(await site('![A](./images/x.png "The cams"){full}'),
    '<figure class="img-full"><img src="./images/x.png" alt="A"><figcaption>The cams</figcaption></figure>');
  assert.equal(await site('![A](./images/x.png "Side note"){left wrap}'),
    '<figure class="img-left img-wrap"><img src="./images/x.png" alt="A"><figcaption>Side note</figcaption></figure>');
  assert.equal(await site('![A](./images/x.png "plain")'), '<figure><img src="./images/x.png" alt="A"><figcaption>plain</figcaption></figure>');
  assert.equal(await site('![A](./images/x.png){full}'), '<p><img src="./images/x.png" alt="A" class="img-full"></p>', 'no caption, no figure');
  assert.equal(await site('Text ![A](./images/x.png "tip") more'), '<p>Text <img src="./images/x.png" alt="A" title="tip"> more</p>');
  const raw = await site('<figure class="evil img-full"><img src="./x.png"><figcaption>c</figcaption></figure>');
  assert.ok(!raw.includes('evil'), raw);
  assert.ok(raw.includes('<figure class="img-full">') && raw.includes('<figcaption>c</figcaption>'), raw);
});

test('figureForCaptionedImage (pure): only a lone titled image; the title and the classes move', () => {
  const p = { type: 'paragraph', children: [{ type: 'image', url: './x.png', alt: 'A', title: ' The  cams ', data: { hProperties: { className: ['img-full'] } } }] };
  const fig = figureForCaptionedImage(p);
  assert.equal(fig.type, 'figure');
  assert.deepEqual(fig.data, { hName: 'figure', hProperties: { className: ['img-full'] } });
  assert.equal(fig.children[0].title, null, 'the image no longer carries the title');
  assert.equal(fig.children[0].data.hProperties.className, undefined, 'nor the classes');
  assert.deepEqual(fig.children[1], { type: 'figcaption', data: { hName: 'figcaption' }, children: [{ type: 'text', value: 'The cams' }] });
  assert.equal(figureForCaptionedImage({ type: 'paragraph', children: [{ type: 'image', url: './x.png', alt: 'A' }] }), null, 'no title');
  assert.equal(figureForCaptionedImage({ type: 'paragraph', children: [{ type: 'text', value: 'x ' }, { type: 'image', url: './x.png', title: 't' }] }), null, 'not alone');
});

test('the block model round-trips a caption; the planners set, change and remove it', () => {
  const blocks = parseBlocks('![A](./images/x.png "The cams"){full}\n\n![B](./y.png)');
  assert.deepEqual(blocks[0], { type: 'image', alt: 'A', url: './images/x.png', caption: 'The cams', width: 'full' });
  assert.deepEqual(blocks[1], { type: 'image', alt: 'B', url: './y.png' }, 'no caption key without a title');
  assert.equal(serializeBlocks(blocks), '![A](./images/x.png "The cams"){full}\n\n![B](./y.png)');
  assert.deepEqual(planImageCaption('![A](./images/x.png){full}', 'The cams'), ['![A](./images/x.png "The cams"){full}']);
  assert.deepEqual(planImageCaption('![A](./images/x.png "old")', 'new "quoted"'), ['![A](./images/x.png "new quoted")']);
  assert.deepEqual(planImageCaption('![A](./images/x.png "old"){right}', ''), ['![A](./images/x.png){right}'], 'remove');
  assert.equal(planImageCaption('A paragraph.', 'x'), null);
  assert.deepEqual(planImageLayout('![A](./images/x.png "kept")', { width: 'full' }), ['![A](./images/x.png "kept"){full}'], 'a layout change keeps the caption');
  assert.deepEqual(imageBlockOf('![A](./images/x.png "c"){left}'), { type: 'image', alt: 'A', url: './images/x.png', caption: 'c', align: 'left' });
});

test('the asset resolver and the content validator see through a title', () => {
  const out = resolveMarkdownAssets('![a](./images/x.png "cap"){full} and ![b](./images/y.png)', 'members/u/posts/s/index.md');
  assert.match(out, /!\[a\]\(https:\/\/cdn\.jsdelivr\.net\/gh\/[^ ]+\/members\/u\/posts\/s\/images\/x\.png "cap"\)\{full\}/);
  assert.match(out, /!\[b\]\(https:\/\/cdn\.jsdelivr\.net\/gh\/[^ )]+\/members\/u\/posts\/s\/images\/y\.png\)/);
  const v = read('scripts/validate-content.mjs');
  const m = /const BODY_IMAGE_REF_RE = (\/.*\/g);/.exec(v);
  const re = new Function(`return ${m[1]}`)();
  const refs = [...'see ![](./images/x.png "cap") and ![](./images/y.png){full}'.matchAll(re)].map((x) => x[2]);
  assert.deepEqual(refs, ['./images/x.png', './images/y.png'], 'a captioned image is still checked for existence');
});

test('the Preview: a figure is an image block, the bar has a Caption control, the editor card has a caption field', () => {
  const bc = read('client-ui/src/block-commit.mjs');
  assert.ok(bc.includes("if (t === 'FIGURE')"), 'isImageBlockEl accepts a figure');
  const pv = read('src/pages/workbench/preview.astro');
  const a = pv.indexOf('if (isImageBlockEl(el)) { wireImageBlock(el); return; }');
  const b = pv.indexOf('if (!isEditableBlockTag(el.tagName)) return;');
  assert.ok(a > 0 && b > a, 'the image check runs before the editable-tag check, or a figure never gets the bar');
  assert.ok(pv.includes('captionOf: (el: HTMLElement) =>'), 'the bar reads the caption from the source');
  assert.ok(pv.includes("planImageCaption(before.join('\\n'), caption)"), 'and writes it through the splice path');
  const tb = read('client-ui/src/selection-toolbar.mjs');
  assert.ok(tb.includes('data-il="caption"'), 'a Caption button on the bar');
  assert.ok(tb.includes('data-ic-apply') && tb.includes('data-ic-remove') && tb.includes('data-ic-text'), 'the caption panel');
  assert.ok(tb.includes('imageTools.onCaption(target, '), 'Apply and Remove write through the host');
  const de = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.ok(de.includes('data-edit="caption"'), 'the editor card has a caption field');
  assert.ok(de.includes('<figcaption>${esc(b.caption)}</figcaption>'), 'and shows it under the image');
});

test('the figure rules are styled in the published prose and the shared client rules, in step', () => {
  const prose = read('src/components/blog/Prose.astro');
  const shared = imageLayoutProseCss('.prose-gbti');
  const rules = (css) => css.split('\n').map((l) => l.trim()).filter((l) => /(img|figure)\.img-/.test(l) && !l.startsWith('/*'));
  assert.deepEqual(rules(prose), rules(shared), 'Prose.astro and imageLayoutProseCss carry the same image and figure rules');
  for (const c of ['img-full', 'img-left', 'img-center', 'img-right']) assert.ok(prose.includes(`figure.${c}`), `Prose styles figure.${c}`);
  assert.ok(prose.includes('.prose-gbti figure.img-wrap.img-left:not(.img-full) { float: left;'));
  assert.ok(shared.includes('figcaption'), 'the reader and the members-only body get a caption strip');
});

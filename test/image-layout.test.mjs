// Image layout words ({full}, {left wrap}, {right}, {center} after an image line) and the pasted-image path in the
// WorkBench Preview (2026-09-11). The owner pasted a copied image into a paragraph and it vanished on "Done
// editing"; they also asked for full-width and alignment controls, with wrapping as an option. The words are
// parsed by three renderers through one module; the classes they become are allow-listed exactly; the Preview
// stages a pasted file and inserts it as its own block; the layout controls read and write the source line.
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
import {
  IMAGE_LAYOUT_WORDS, IMAGE_LAYOUT_CLASS_RE, parseImageLayout, normalizeImageLayout, imageLayoutSuffix,
  imageLayoutClasses, splitImageSuffix, parseImageLine, applyImageLayoutAction,
} from '../client/src/image-attrs.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks, inlineHtmlToMd } from '../client-ui/src/markdown-blocks.mjs';
import { planImageInsert, planImageLayout, imageBlockOf } from '../client-ui/src/block-commit.mjs';
import { imagePastePlan, pastedImageName } from '../client-ui/src/image-paste.mjs';
import {
  IMAGE_LAYOUT_GROUPS, imageLayoutButtonsHtml, imageLayoutPressed, imageLayoutDisabled, imageLayoutProseCss,
} from '../client-ui/src/image-layout-ui.mjs';
import { remarkContentBlocks, applyImageLayouts } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeStyleAllowlist } from '../src/lib/markdown-sanitize.mjs';
import { bioExcerpt } from '../src/lib/members-directory.mjs';

const CLASSES = ['img-full', 'img-left', 'img-center', 'img-right', 'img-wrap'];
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---- the words ------------------------------------------------------------------------------------------------

test('parseImageLayout: the closed vocabulary, and null for anything that is not layout', () => {
  assert.deepEqual(IMAGE_LAYOUT_WORDS, ['full', 'left', 'center', 'right', 'wrap']);
  assert.deepEqual(parseImageLayout(undefined), {}, 'no suffix is no layout, not a refusal');
  assert.deepEqual(parseImageLayout('full'), { width: 'full' });
  assert.deepEqual(parseImageLayout('left wrap'), { align: 'left', wrap: true });
  assert.deepEqual(parseImageLayout(' full  center '), { width: 'full', align: 'center' });
  assert.deepEqual(parseImageLayout('left left'), { align: 'left' }, 'a repeated word is harmless');
  assert.equal(parseImageLayout(''), null, 'empty braces are not layout');
  assert.equal(parseImageLayout('banana'), null, 'an unknown word means the braces are the author\'s text');
  assert.equal(parseImageLayout('full banana'), null, 'one unknown word spoils the whole group');
  assert.equal(parseImageLayout('left right'), null, 'two sides is a contradiction, not a choice');
  assert.equal(parseImageLayout('Full'), null, 'the words are lower-case');
});

test('imageLayoutSuffix: canonical order, and every combination round-trips through parseImageLayout', () => {
  assert.equal(imageLayoutSuffix({}), '');
  assert.equal(imageLayoutSuffix({ width: 'full', align: 'left', wrap: true }), '{full left wrap}');
  assert.equal(imageLayoutSuffix({ wrap: true, align: 'right' }), '{right wrap}', 'the input order does not matter');
  assert.equal(imageLayoutSuffix({ width: 'wide', align: 'middle', wrap: 'yes' }), '', 'garbage normalizes to nothing');
  for (const width of [undefined, 'full']) {
    for (const align of [undefined, 'left', 'center', 'right']) {
      for (const wrap of [undefined, true]) {
        const layout = normalizeImageLayout({ width, align, wrap });
        const suffix = imageLayoutSuffix(layout);
        const back = suffix ? parseImageLayout(suffix.slice(1, -1)) : {};
        assert.deepEqual(back, layout, `round trip of ${JSON.stringify(layout)} via ${suffix || '(none)'}`);
      }
    }
  }
});

test('imageLayoutClasses: img-wrap only beside a side, and every class passes the sanitizer regex', () => {
  assert.deepEqual(imageLayoutClasses({ width: 'full' }), ['img-full']);
  assert.deepEqual(imageLayoutClasses({ align: 'left', wrap: true }), ['img-left', 'img-wrap']);
  assert.deepEqual(imageLayoutClasses({ align: 'center', wrap: true }), ['img-center'], 'nothing to float to');
  assert.deepEqual(imageLayoutClasses({ wrap: true }), [], 'wrap alone is a no-op');
  assert.deepEqual(imageLayoutClasses({ width: 'full', align: 'right', wrap: true }), ['img-full', 'img-right', 'img-wrap']);
  for (const c of CLASSES) assert.ok(IMAGE_LAYOUT_CLASS_RE.test(c), c);
  for (const c of ['img-evil', 'img-full ', 'callout', 'img-wide', 'img-full img-left']) assert.ok(!IMAGE_LAYOUT_CLASS_RE.test(c), c);
});

test('applyImageLayoutAction: what one click means, and it never mutates its input', () => {
  const start = { width: 'full', align: 'left', wrap: true };
  const frozen = JSON.stringify(start);
  assert.deepEqual(applyImageLayoutAction(start, 'natural'), { align: 'left', wrap: true }, 'Natural clears the width and keeps the side');
  assert.deepEqual(applyImageLayoutAction({}, 'full'), { width: 'full' });
  assert.deepEqual(applyImageLayoutAction(start, 'center'), { width: 'full', align: 'center' }, 'Center drops wrap');
  assert.deepEqual(applyImageLayoutAction(start, 'right'), { width: 'full', align: 'right', wrap: true }, 'a side keeps wrap');
  assert.deepEqual(applyImageLayoutAction(start, 'wrap'), { width: 'full', align: 'left' }, 'Wrap toggles off');
  assert.deepEqual(applyImageLayoutAction({ align: 'right' }, 'wrap'), { align: 'right', wrap: true }, 'Wrap toggles on beside a side');
  assert.deepEqual(applyImageLayoutAction({ align: 'center' }, 'wrap'), { align: 'center' }, 'Wrap has nothing to float to');
  assert.deepEqual(applyImageLayoutAction({}, 'wrap'), {}, 'nor without any side');
  assert.deepEqual(applyImageLayoutAction(start, 'explode'), normalizeImageLayout(start), 'an unknown action changes nothing');
  assert.equal(JSON.stringify(start), frozen, 'the input object is untouched');
});

test('splitImageSuffix and parseImageLine: a valid group is consumed, anything else is left alone', () => {
  assert.deepEqual(splitImageSuffix('{full} and text'), { layout: { width: 'full' }, rest: ' and text' });
  assert.deepEqual(splitImageSuffix('{left wrap}'), { layout: { align: 'left', wrap: true }, rest: '' });
  assert.equal(splitImageSuffix('{banana} text'), null);
  assert.equal(splitImageSuffix(' {full}'), null, 'the group must begin the text');
  assert.equal(splitImageSuffix('plain'), null);
  assert.deepEqual(parseImageLine('![A](./images/x.png)'), { alt: 'A', url: './images/x.png', caption: '', layout: {} });
  assert.deepEqual(parseImageLine('![A](./images/x.png){right}  '), { alt: 'A', url: './images/x.png', caption: '', layout: { align: 'right' } });
  assert.equal(parseImageLine('![A](./images/x.png){banana}'), null, 'not an image line: the block parser reads a paragraph');
  assert.equal(parseImageLine('![A](./images/x.png) trailing'), null);
  assert.equal(parseImageLine('A paragraph.'), null);
});

// ---- the three renderers ---------------------------------------------------------------------------------------

test('the client renderer emits the classes for a layout suffix and prints a foreign one as text', () => {
  assert.match(renderMarkdown('![A](./images/x.png){left wrap}'), /<img src="\.\/images\/x\.png" alt="A" loading="lazy" class="img-left img-wrap">/);
  assert.match(renderMarkdown('![A](https://x.test/a.png){full}'), /class="img-full"/);
  const foreign = renderMarkdown('![A](./images/x.png){banana}');
  assert.ok(!/class=/.test(foreign), 'no class for a foreign group');
  assert.ok(/<\/img>|>\{banana\}/.test(foreign) || foreign.includes('{banana}'), 'the braces print as the author wrote them');
  assert.ok(!/class=/.test(renderMarkdown('![A](./images/x.png)')), 'no suffix, no class attribute at all');
});

test('the block parser reads the suffix into the image block and writes it back; a foreign group is a paragraph', () => {
  const blocks = parseBlocks('![A](./images/x.png){full right}\n\n![B](./y.png){nope}\n\n![C](./z.png)');
  assert.deepEqual(blocks[0], { type: 'image', alt: 'A', url: './images/x.png', width: 'full', align: 'right' });
  assert.deepEqual(blocks[1], { type: 'paragraph', text: '![B](./y.png){nope}' });
  assert.deepEqual(blocks[2], { type: 'image', alt: 'C', url: './z.png' }, 'no layout keys when there is no suffix');
  assert.equal(serializeBlocks(blocks), '![A](./images/x.png){full right}\n\n![B](./y.png){nope}\n\n![C](./z.png)');
  const one = parseBlocks('![A](./images/x.png){left wrap}');
  assert.equal(serializeBlocks(one), '![A](./images/x.png){left wrap}', 'exact round trip');
});

const site = (md) => unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStyleAllowlist).use(rehypeStringify).process(md).then(String);

test('the site chain: the suffix becomes an allow-listed class on the image and leaves the text', async () => {
  assert.equal(await site('![A](./images/x.png){full}'), '<p><img src="./images/x.png" alt="A" class="img-full"></p>');
  assert.equal(await site('![A](./images/x.png){left wrap} and text after'),
    '<p><img src="./images/x.png" alt="A" class="img-left img-wrap"> and text after</p>');
  assert.equal(await site('![A](./images/x.png){banana}'), '<p><img src="./images/x.png" alt="A">{banana}</p>');
  assert.equal(await site('![A](./images/x.png)'), '<p><img src="./images/x.png" alt="A"></p>');
});

test('the site chain: a raw <img> keeps only the five layout classes, nothing else', async () => {
  const out = await site('<img src="./x.png" class="img-evil"> <img src="./y.png" class="img-full"> <img src="./z.png" class="callout">');
  assert.ok(!out.includes('img-evil'), out);
  assert.ok(!out.includes('callout'), out);
  assert.ok(out.includes('class="img-full"'), out);
  const rule = (sanitizeSchema.attributes.img || []).find((a) => Array.isArray(a) && a[0] === 'className');
  assert.ok(rule, 'the img className rule is in the schema');
  assert.equal(String(rule[1]), String(IMAGE_LAYOUT_CLASS_RE), 'and it is the shared regex, not a copy that can drift');
});

test('applyImageLayouts (pure): the text node after the image is consumed or trimmed', () => {
  const p = { type: 'paragraph', children: [{ type: 'image', url: './x.png', alt: '' }, { type: 'text', value: '{right}' }] };
  applyImageLayouts(p);
  assert.equal(p.children.length, 1);
  assert.deepEqual(p.children[0].data.hProperties.className, ['img-right']);
  const q = { type: 'paragraph', children: [{ type: 'image', url: './x.png', alt: '' }, { type: 'text', value: '{banana} stays' }] };
  applyImageLayouts(q);
  assert.equal(q.children[1].value, '{banana} stays');
  assert.equal(q.children[0].data, undefined);
});

// ---- the read-back and the planners ---------------------------------------------------------------------------

test('inlineHtmlToMd reads an inline image back as markdown, preferring the stamped source ref', () => {
  assert.equal(inlineHtmlToMd('Hi <img data-ref="./images/x.png" src="https://cdn.test/x.png" alt="A [x]"> there'), 'Hi ![A x](./images/x.png) there');
  assert.equal(inlineHtmlToMd('<img src="https://x.test/a.png" alt="A">'), '![A](https://x.test/a.png)', 'a remote src with no stamp');
  assert.equal(inlineHtmlToMd('<img src="./images/x.png">'), '![](./images/x.png)', 'a relative src with no stamp');
  assert.equal(inlineHtmlToMd('Text <img src="data:image/png;base64,AAAA"> end'), 'Text  end', 'a data: image has nothing to store');
  assert.equal(inlineHtmlToMd('<img src="blob:https://gbti.network/abc">'), '');
  assert.equal(inlineHtmlToMd('<img src="javascript:alert(1)">'), '');
  assert.equal(inlineHtmlToMd('<img data-src="https://x.test/a.png">'), '', 'data-src is not src');
});

test('planImageInsert: an emptied anchor is replaced by the image rather than kept above it', () => {
  assert.deepEqual(planImageInsert('', './images/p.png', 'p'), ['![p](./images/p.png)']);
  assert.deepEqual(planImageInsert('  \n', './images/p.png', ''), ['![](./images/p.png)']);
  assert.deepEqual(planImageInsert('A paragraph.', './images/p.png', 'p'), ['A paragraph.', '', '![p](./images/p.png)'], 'a non-empty anchor is kept');
  assert.equal(planImageInsert('', '', 'p'), null, 'still no ref, no insert');
});

test('planImageLayout rewrites exactly one image block and refuses anything else', () => {
  assert.deepEqual(planImageLayout('![A](./images/x.png)', { width: 'full' }), ['![A](./images/x.png){full}']);
  assert.deepEqual(planImageLayout('![A](./images/x.png){full}', { align: 'left', wrap: true }), ['![A](./images/x.png){left wrap}']);
  assert.deepEqual(planImageLayout('![A](./images/x.png){left wrap}', {}), ['![A](./images/x.png)'], 'clearing the layout');
  assert.equal(planImageLayout('A paragraph.', { width: 'full' }), null, 'never over a paragraph');
  assert.equal(planImageLayout('![A](./x.png)\n\n![B](./y.png)', { width: 'full' }), null, 'never over two blocks');
  assert.deepEqual(imageBlockOf('![A](./images/x.png){right}'), { type: 'image', alt: 'A', url: './images/x.png', align: 'right' });
  assert.equal(imageBlockOf('- a list'), null);
});

// ---- the paste --------------------------------------------------------------------------------------------------

test('imagePastePlan: a file wins, a lone remote <img> is a remote insert, prose or nothing is not an image paste', () => {
  const file = { type: 'image/png', name: 'image.png' };
  assert.deepEqual(imagePastePlan({ files: [{ type: 'text/plain' }, file], getData: () => '<img src="https://x.test/a.png">' }), { kind: 'file', file });
  assert.deepEqual(imagePastePlan({ files: [], getData: (t) => (t === 'text/html' ? '<meta charset="utf-8"><img src="https://x.test/a.png" alt="An [alt] &amp; more">' : '') }),
    { kind: 'remote', url: 'https://x.test/a.png', alt: 'An alt & more' });
  assert.equal(imagePastePlan({ files: [], getData: (t) => (t === 'text/html' ? '<p>Hello <img src="https://x.test/a.png"></p>' : '') }), null, 'prose with a picture pastes as prose');
  assert.equal(imagePastePlan({ files: [], getData: (t) => (t === 'text/html' ? '<img src="data:image/png;base64,AAAA">' : '') }), null, 'a data: address is not remote');
  assert.equal(imagePastePlan({ files: [], getData: () => '' }), null);
  assert.equal(imagePastePlan({ files: [], getData: () => { throw new Error('no'); } }), null);
  assert.equal(imagePastePlan(null), null);
});

test('pastedImageName: a generic clipboard name gets a timestamp, a real name is kept, and both are made unique', () => {
  const at = new Date(2026, 8, 11, 14, 5, 9);
  assert.equal(pastedImageName({ name: 'image.png', type: 'image/png' }, [], at), 'pasted-20260911-140509.png');
  assert.equal(pastedImageName({ name: '', type: 'image/jpeg' }, [], at), 'pasted-20260911-140509.jpg', 'no name: the type decides, jpeg is jpg');
  assert.equal(pastedImageName({ name: 'Screenshot.PNG', type: 'image/png' }, [], at), 'pasted-20260911-140509.PNG'.replace('.PNG', '.png'));
  assert.equal(pastedImageName({ name: 'diagram.webp', type: 'image/webp' }, ['other.png'], at), 'diagram.webp');
  assert.equal(pastedImageName({ name: 'diagram.webp', type: 'image/webp' }, ['diagram.webp'], at), 'diagram-1.webp');
  assert.equal(pastedImageName({ name: 'image.png', type: 'image/png' }, ['pasted-20260911-140509.png'], at), 'pasted-20260911-140509-1.png');
});

// ---- the controls, the styles, and the wiring --------------------------------------------------------------------

test('the image controls: six actions in three groups, pressed and disabled states follow the layout', () => {
  assert.deepEqual(IMAGE_LAYOUT_GROUPS.flat().map((b) => b.action), ['natural', 'full', 'left', 'center', 'right', 'wrap']);
  const html = imageLayoutButtonsHtml({ align: 'left', wrap: true });
  assert.equal((html.match(/data-il="/g) || []).length, 6);
  assert.match(html, /data-il="natural"[^>]*aria-pressed="true"/);
  assert.match(html, /data-il="left"[^>]*aria-pressed="true"/);
  assert.match(html, /data-il="wrap"[^>]*aria-pressed="true"/);
  assert.ok(!/data-il="full"[^>]*aria-pressed/.test(html));
  const centered = imageLayoutButtonsHtml({ align: 'center' });
  assert.match(centered, /data-il="wrap"[^>]*disabled/, 'Wrap is offered but disabled without a side');
  assert.equal(imageLayoutPressed({ width: 'full' }, 'full'), true);
  assert.equal(imageLayoutPressed({ wrap: true }, 'wrap'), false, 'wrap without a side is not a state');
  assert.equal(imageLayoutDisabled({}, 'wrap'), true);
  assert.equal(imageLayoutDisabled({ align: 'right' }, 'wrap'), false);
  assert.equal(imageLayoutDisabled({}, 'full'), false);
});

test('the five classes are styled in the published prose, the extension reader and the members-only body, in step', () => {
  const prose = read('src/components/blog/Prose.astro');
  const shared = imageLayoutProseCss('.prose-gbti');
  for (const c of CLASSES) {
    assert.ok(prose.includes(`.prose-gbti img.${c}`) || prose.includes(`img.${c}`), `Prose.astro styles ${c}`);
    assert.ok(shared.includes(`img.${c}`), `the shared rules style ${c}`);
  }
  assert.ok(prose.includes('.prose-gbti { display: flow-root; }'), 'the published container contains a trailing float');
  assert.ok(shared.includes('.prose-gbti { display: flow-root; }'));
  // The published rules are kept by hand; the shared function is the reference. Compare the two rule by rule
  // so a change to one without the other reds here.
  const rules = (css) => css.split('\n').map((l) => l.trim()).filter((l) => /img\.img-/.test(l) && !l.startsWith('/*'));
  assert.deepEqual(rules(prose), rules(shared), 'Prose.astro and imageLayoutProseCss carry the same image rules');
  const reader = read('client-ui/src/elements/gbti-reader.mjs');
  const locked = read('client-ui/src/elements/gbti-locked-content.mjs');
  assert.ok(reader.includes("imageLayoutProseCss('.body')"), 'the reader scopes the shared rules to its body');
  assert.ok(locked.includes("imageLayoutProseCss('.unlocked')"), 'the members-only body scopes them to the unlocked body');
  assert.ok(locked.includes('.unlocked img { max-width: 100%; height: auto; border-radius: 10px; }'), 'and has an image rule to build on');
});

test('the Preview: the paste is intercepted, images carry their source ref, and image blocks get the bar', () => {
  const src = read('src/pages/workbench/preview.astro');
  assert.ok(src.includes("document.addEventListener('paste', (ev: ClipboardEvent) => {"), 'a paste listener');
  assert.ok(src.includes('imagePastePlan(ev.clipboardData)'), 'that asks the planner what was pasted');
  assert.ok(src.includes('ev.preventDefault();\n        void pasteImage('), 'and takes the paste over only for an image');
  assert.ok(src.includes('client.stageImage({ filename, dataBase64: dataUrl.split(\',\')[1] || \'\', itemPath, item: `${type}:${slug}` })'),
    'a file is staged under the same item key the editor uses');
  assert.ok(src.includes('stagedSrc[ref] = dataUrl'), 'the staged bytes feed the re-render');
  assert.ok(src.includes('planImageInsert((edited || before).join(\'\\n\'), ref, alt)'), 'and the image lands as its own block');
  assert.equal((src.match(/ data-ref="\$\{[pq]\}"/g) || []).length, 2, 'both render paths stamp data-ref beside the resolved src');
  assert.ok(src.includes('if (isImageBlockEl(el)) { wireImageBlock(el); return; }'), 'an image block is not made contenteditable');
  assert.ok(src.includes('seltb?.showImageTools(el)'), 'it shows the image bar instead');
  assert.ok(src.includes("planImageLayout(before.join('\\n'), layout)"), 'a bar click rewrites the source line through spliceBlock');
  assert.ok(src.includes('onRemove: (el: HTMLElement) => { void deleteIn(docOfEl(el), el); }'), 'Remove is the block delete');
  assert.equal((src.match(/createWorkbenchClient\(\{/g) || []).length, 1, 'one client construction, shared by Save and the paste');
});

test('the site lightbox stands aside for a click the Preview already handled', () => {
  // Found by the browser drive on 2026-09-11: the click that showed the image bar also opened the site's image
  // viewer over it. The lightbox's delegate now honours defaultPrevented, which is how the Preview marks its click.
  const lb = read('src/components/Lightbox.astro');
  const delegate = lb.slice(lb.indexOf("const el = e.target.closest('[data-lightbox], .prose-gbti img');") - 400, lb.indexOf("const el = e.target.closest('[data-lightbox], .prose-gbti img');"));
  assert.ok(delegate.includes('if (e.defaultPrevented) return;'), 'the prose-image delegate checks defaultPrevented first');
  const pv = read('src/pages/workbench/preview.astro');
  assert.ok(pv.includes("ev.preventDefault();\n          ensureToolbar();\n          seltb?.showImageTools(el);"), 'and the Preview marks its image click');
});

test('the selection toolbar offers the image bar, and the inert stub carries the same method', () => {
  const src = read('client-ui/src/selection-toolbar.mjs');
  assert.ok(src.includes('imageTools = null,'), 'opt-in');
  assert.ok(src.includes("showImageTools() {} };"), 'the stub keeps the shape');
  assert.ok(src.includes('showImageTools(el) { showImageTools(el); },'), 'the real one');
  assert.ok(src.includes('data-il="remove"'), 'Remove is on the bar');
  assert.ok(src.includes('applyImageLayoutAction(layoutOfEl(target), act)'), 'a click means what the shared rule says');
  assert.ok(src.includes("document.removeEventListener('mousedown', onDocDown, true)"), 'the outside-click listener is released on destroy');
});

test('the doc editor image card carries the same controls and writes the same words', () => {
  const src = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.ok(src.includes('<div class="imglay" data-imglay="${b._id}">${imageLayoutButtonsHtml(b)}</div>'), 'the row on the card');
  assert.ok(src.includes('applyImageLayoutAction(b, btn.dataset.il)'), 'a click applies the shared rule');
  assert.ok(src.includes('${IMAGE_LAYOUT_ROW_CSS}'), 'and the row is styled');
  const lines = src.split('\n').length;
  assert.ok(lines <= 900, `gbti-doc-editor.mjs is ${lines} lines; the cap is 900`);
});

test('an image with a layout suffix leaves a bio excerpt whole', () => {
  assert.equal(bioExcerpt('Before ![A](./images/x.png){full} after'), 'Before after');
  assert.equal(bioExcerpt('Before ![A](./images/x.png){left wrap} after'), 'Before after');
});

// ---- the follow-up (owner, 2026-09-11 night): a dropped file, and a copied image that arrives over the cap --------

test('fitImageFile: a file under the cap passes through untouched; one over it walks the ladder and becomes webp', async () => {
  const { fitImageFile, FIT_LADDER, IMAGE_MAX_BYTES } = await import('../client-ui/src/image-paste.mjs');
  assert.equal(IMAGE_MAX_BYTES, 1_048_576, 'the Worker gate and check-media cap');
  assert.deepEqual(FIT_LADDER.map((s) => s[0]), [1600, 1600, 1600, 1200, 1000, 800], 'edges step down after quality');
  const small = { name: 'photo.webp', type: 'image/webp', size: 174_000 };
  assert.deepEqual(await fitImageFile(small), { blob: small, name: 'photo.webp', reencoded: false });
  const tried = [];
  const encode = async (_f, edge, q) => { tried.push([edge, q]); return { size: tried.length < 3 ? 2_000_000 : 400_000, type: 'image/webp' }; };
  const big = { name: 'image.png', type: 'image/png', size: 3_000_000 };
  const out = await fitImageFile(big, { encode });
  assert.equal(out.name, 'image.webp');
  assert.equal(out.reencoded, true);
  assert.equal(out.blob.size, 400_000);
  assert.deepEqual(tried, [[1600, 0.9], [1600, 0.8], [1600, 0.7]], 'stops at the first step that fits');
  await assert.rejects(fitImageFile(big, { encode: async () => ({ size: 5_000_000 }) }), /over 1 MB even after shrinking/);
  await assert.rejects(fitImageFile(big, { encode: async () => null }), /over 1 MB/);
});

test('the Preview fits a pasted image before staging it and lands a dropped file the same way', () => {
  const src = read('src/pages/workbench/preview.astro');
  assert.ok(src.includes('const fit = await fitImageFile(plan.file);'), 'fit before staging');
  assert.ok(src.includes('const dataUrl = await fileToDataUrl(fit.blob);'), 'the fitted bytes are what is staged');
  assert.ok(src.includes("pastedImageName({ name: fit.name, type: fit.blob?.type || plan.file?.type }, taken)"), 'and named after the fit (a re-encode is .webp)');
  assert.ok(src.includes("document.addEventListener('dragover', (ev: DragEvent) => {"), 'dragover is cancelled so the drop is offered');
  assert.ok(src.includes("document.addEventListener('drop', (ev: DragEvent) => {"), 'a drop listener');
  assert.ok(src.includes('const plan = imagePastePlan(ev.dataTransfer);'), 'that asks the same planner');
  assert.ok(src.includes('void pasteImage(docOfEl(el), el, plan);\n      }, true);\n      // A dropped image file'), 'and lands through the same insert path');
});

// sow-495, 2026-11-08: the ```faq block (option A, "ruled rows", on the FAQ accordion canvas). The question stays in
// view when its answer opens, which a reveal cannot do. The block has to work in every layer that reads a fence: both
// renderers, the published page's sanitizer, cross-posts, the component checker, the agent catalog, the WorkBench
// block model and the shared stylesheet. The test that matters most is the footnote one: an answer carries numbered
// footnotes (the Minecraft article's short answers cite the Mojang manifest and Hypixel), and on the published page a
// marker inside a fence used to print as "[^2]" with its note dropped. The answers are now parsed as markdown.
//
// The module is imported as a namespace, so that against code without the block every case fails on an assertion
// rather than on a missing export (an import failure is a red that proves nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import * as blocks from '../client/src/content-blocks.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from '../src/lib/markdown-sanitize.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { COMPONENTS } from '../client/src/components-catalog.mjs';
import { dataBlocksToMarkdown } from '../clients/syndication/devto-body.mjs';

// The PUBLISHED pipeline, in astro.config.mjs order, as markdown-render.test.mjs builds it.
async function published(md) {
  const out = await unified()
    .use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
    .use(rehypeIframeHostAllowlist).use(rehypeStyleAllowlist).use(rehypeIdSafety)
    .use(rehypeStringify).process(md);
  return String(out);
}

const FAQ = [
  '```faq',
  'Q: What is the latest version of Minecraft Java?',
  'The latest release is 26.3. Mojang shipped it on 15 September 2026[^manifest].',
  '',
  'Q: Why do some servers still run **1.8**?',
  'The sources do not state a reason. Hypixel[^hypixel] said in 2018 that it was still optimized for 1.8.9.',
  '```',
].join('\n');
const INNER = FAQ.split('\n').slice(1, -1).join('\n');
const DOC = `Servers report to bStats.[^bstats]\n\n${FAQ}\n\nAfter the questions.\n\n[^bstats]: bStats.\n\n[^manifest]: Mojang manifest.\n\n[^hypixel]: Hypixel.\n`;

test('faq: is a known data block, and each "Q:" line starts a question whose answer is the lines under it', () => {
  assert.ok(blocks.DATA_BLOCKS.includes('faq'));
  assert.ok(blocks.KNOWN_FENCES.includes('faq'));
  const f = blocks.parseFaq(`stray line\n${INNER}`);
  assert.deepEqual(f.items.map((x) => x.q), ['What is the latest version of Minecraft Java?', 'Why do some servers still run **1.8**?']);
  assert.match(f.items[0].answer, /^The latest release is 26\.3\./);
  assert.deepEqual(f.lead, ['stray line']);
});

test('faq: renders one closed details row per question, the question kept in the summary', () => {
  const html = blocks.renderDataBlock('faq', INNER);
  assert.ok(html, 'faq renders');
  assert.equal((html.match(/<details class="gbti-faq-item">/g) || []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/, 'every answer starts closed');
  assert.match(html, /<summary class="gbti-faq-q"><span class="gbti-faq-q-text">What is the latest version of Minecraft Java\?<\/span><span class="gbti-faq-icon"><\/span><\/summary>/);
  assert.match(html, /<span class="gbti-faq-q-text">Why do some servers still run <strong>1\.8<\/strong>\?<\/span>/);
  assert.match(html, /<div class="gbti-faq-a"><p>The latest release is 26\.3\./);
  assert.equal(blocks.renderDataBlock('faq', 'no question here'), null);
  const bad = blocks.renderDataBlock('faq', 'Q: <img src=x onerror=alert(1)>\n<script>x</script> [a](javascript:alert(1))');
  assert.doesNotMatch(bad, /<img|<script|href="javascript/);
});

test('faq: on the published page an answer\'s footnote marker is a real footnote, numbered in reading order', async () => {
  const html = await published(DOC);
  assert.equal((html.match(/<details class="gbti-faq-item">/g) || []).length, 2, 'the sanitizer keeps the details class');
  assert.match(html, /<div class="gbti-faq">/);
  assert.match(html, /<summary class="gbti-faq-q">/);
  assert.match(html, /<div class="gbti-faq-a">/);
  assert.doesNotMatch(html, /\[\^(manifest|hypixel)\]/, 'no marker prints as text');
  // bStats is cited before the block, so it is 1; the two answers' notes are 2 and 3.
  assert.match(html, /September 2026<sup><a href="#user-content-fn-manifest"[^>]*>2<\/a><\/sup>/);
  assert.match(html, /Hypixel<sup><a href="#user-content-fn-hypixel"[^>]*>3<\/a><\/sup>/);
  assert.match(html, /<li id="user-content-fn-manifest">\s*<p>Mojang manifest\./, 'the note is listed with the others');
  assert.match(html, /<strong>1\.8<\/strong>/);
  // A label the page does not define stays text, as it would in any paragraph.
  assert.match(await published('```faq\nQ: One?\nPlain[^nope] answer.\n```\n'), /Plain\[\^nope\] answer\./);
  assert.doesNotMatch(await published('```faq\nQ: One?\n<script>alert(1)</script>Hi\n```\n'), /<script/);
});

test('faq: the WorkBench preview numbers an answer\'s footnote and lists it with the rest', () => {
  const html = renderMarkdown(DOC);
  assert.equal((html.match(/<details class="gbti-faq-item">/g) || []).length, 2);
  assert.match(html, /September 2026<sup class="md-fnref" data-fn="manifest"><a href="#fn-manifest" id="fnref-manifest">/);
  assert.match(html, /<li id="fn-manifest">Mojang manifest\./);
  assert.match(html, /<li id="fn-hypixel">Hypixel\./);
  assert.doesNotMatch(html, /\[\^(manifest|hypixel)\]/);
});

test('faq: cross-posts write every answer out under its question in bold', () => {
  assert.equal(blocks.dataBlockToMarkdown('faq', 'Q: One?\nFirst.\n\nQ: Two?\nSecond.'), '**One?**\n\nFirst.\n\n**Two?**\n\nSecond.');
  const devto = dataBlocksToMarkdown(`Before.\n\n${FAQ}\n\nAfter.`);
  assert.doesNotMatch(devto, /```faq/, 'no faq fence reaches dev.to as a code block');
  assert.match(devto, /\*\*What is the latest version of Minecraft Java\?\*\*\n\nThe latest release is 26\.3\./);
});

test('faq: the component checker names a stray line, an empty question, a missing answer and a marker in a question', () => {
  assert.deepEqual(blocks.checkComponentBlocks(FAQ), []);
  const w = blocks.checkComponentBlocks('```faq open\nIntro\nQ:\nQ: Has no answer?\nQ: Cited[^1]?\nYes.\n```').map((x) => x.message);
  assert.deepEqual(w, [
    'faq takes no options after its name (got "open")',
    'faq line "Intro" comes before the first "Q:" and belongs to no question; it is left out',
    'faq has a "Q:" line with no question after it; it is left out',
    'faq question "Has no answer?" has no answer under it',
    'faq question "Cited[^1]?" has a footnote marker, which shows as text in a question; put it in the answer',
  ]);
  assert.match(blocks.checkComponentBlocks('```faq\nJust text\n```')[0].message, /faq needs at least one question/);
});

test('faq: the agent catalog describes it, and its example renders with no warnings', () => {
  const c = COMPONENTS.find((x) => x.name === 'faq');
  assert.ok(c, 'list_components has faq');
  assert.equal(c.kind, 'fence');
  assert.deepEqual(blocks.checkComponentBlocks(c.example), []);
  assert.match(renderMarkdown(c.example), /<details class="gbti-faq-item">/);
});

test('faq: a WorkBench save writes the block back exactly as it was read', () => {
  const doc = `Before.\n\n${FAQ}\n\nAfter.`;
  assert.equal(serializeBlocks(parseBlocks(doc)), doc);
});

test('faq: the shared stylesheet styles every class the block emits, and hides the browser marker', () => {
  const css = blocks.dataBlocksCss('.x', { fg: 'F', soft: 'S', mute: 'M', line: 'L', line2: 'L2', rest: 'R', green: 'G', green700: 'G7', green700Solid: 'G7S', greenTint: 'GT', greenBorder: 'GB', surface: 'SU', card: 'C', mono: 'MO' });
  for (const cls of ['gbti-faq', 'gbti-faq-item', 'gbti-faq-q', 'gbti-faq-icon', 'gbti-faq-a']) {
    assert.match(css, new RegExp(`\\.x \\.${cls}[{:, ]`), `no rule for .${cls}`);
  }
  assert.match(css, /\.gbti-faq-q::-webkit-details-marker\{display:none\}/);
  assert.match(css, /\.gbti-faq-q\{[^}]*list-style:none/);
  assert.match(css, /\.gbti-faq-item\[open\] \.gbti-faq-icon::after\{transform:rotate\(0deg\)\}/, 'the plus becomes a minus when open');
});

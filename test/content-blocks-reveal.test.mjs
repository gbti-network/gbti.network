// sow-455: the ```reveal block (owner, 2026-10-13, option C on the formula reveal canvas, closed by default). A summary
// that always shows (weight bar, legend, note) and a body that opens on request, the same on the site, the WorkBench
// preview, the extension reader and cross-posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { parseWeights, parseReveal, renderDataBlock, dataBlockToMarkdown, dataBlocksCss, checkComponentBlocks } from '../client/src/content-blocks.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema } from '../src/lib/markdown-sanitize.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stripSiteOnlyFences } from '../clients/syndication/devto-body.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';

const site = async (md) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify).process(md));
const F = '```';
const INNER = [
  'weights: Focus 40, Volume 20, Reach 20, Engagement 20',
  'note: Then **× 0.75** for channels run by plugin or theme companies.',
  '---',
  '**Score = 100 × (0.4 × Focus + 0.2 × Volume + 0.2 × Reach + 0.2 × Engagement) × Seller**',
  '',
  '- **Focus:** share of 2026 videos about WordPress',
  '- **Volume:** WordPress videos posted in 2026',
  '',
  'Each is where the channel sits, from 0 to 1.',
].join('\n');
const REVEAL = `${F}reveal Show the full formula\n${INNER}\n${F}`;

test('parsers: weights in both forms, the label, the head and the body', () => {
  assert.deepEqual(parseWeights('Focus 40, Volume 20'), [{ name: 'Focus', n: 40 }, { name: 'Volume', n: 20 }]);
  assert.deepEqual(parseWeights('Focus: 40%, Two words 60 %'), [{ name: 'Focus', n: 40 }, { name: 'Two words', n: 60 }]);
  assert.equal(parseWeights('Focus forty'), null);
  assert.equal(parseWeights(''), null);
  const r = parseReveal(INNER, 'Show the full formula');
  assert.equal(r.label, 'Show the full formula');
  assert.equal(r.weights.length, 4);
  assert.match(r.note, /0\.75/);
  assert.ok(r.body.startsWith('**Score'));
  assert.equal(r.hasCut, true);
  assert.equal(parseReveal('---\nx').label, 'Show more');
});

test('HTML: weight bar, legend, note, a closed details with Show and Hide labels', () => {
  const html = renderDataBlock('reveal', INNER, 'Show the full formula');
  assert.match(html, /^<div class="gbti-reveal"><div class="gbti-reveal-weights"/);
  assert.deepEqual([...html.matchAll(/gbti-reveal-seg gbti-reveal-seg-(\d) gbti-bar-w-(\d+)/g)].map((m) => [m[1], m[2]]), [['1', '40'], ['2', '20'], ['3', '20'], ['4', '20']]);
  assert.match(html, /<span class="gbti-reveal-name">Engagement<\/span> <span class="gbti-reveal-pct">20%<\/span>/);
  assert.match(html, /<div class="gbti-reveal-note">Then <strong>× 0\.75<\/strong> for channels/);
  assert.match(html, /<details class="gbti-reveal-more"><summary class="gbti-reveal-toggle">/);
  assert.doesNotMatch(html, /<details[^>]* open/); // closed by default (owner, 2026-10-13)
  assert.match(html, /gbti-reveal-show">Show the full formula<.*gbti-reveal-hide">Hide the full formula</);
  assert.match(html, /<div class="gbti-reveal-body"><p><strong>Score = 100 × .*<\/strong><\/p><ul><li><strong>Focus:<\/strong> share/);
  assert.match(html, /<\/ul><p>Each is where the channel sits, from 0 to 1\.<\/p><\/div><\/details><\/div>$/);
  // widths always total 100, even for weights that do not divide evenly
  const odd = renderDataBlock('reveal', 'weights: A 1, B 1, C 1\n---\nx');
  assert.equal([...odd.matchAll(/gbti-bar-w-(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0), 100);
  assert.match(renderDataBlock('reveal', '---\nBody'), /gbti-reveal-show">Show more<.*gbti-reveal-hide">Show less</);
  assert.match(renderDataBlock('reveal', '---\nBody', 'Details'), /gbti-reveal-hide">Hide</);
  assert.equal(renderDataBlock('reveal', ''), null);
  assert.doesNotMatch(renderDataBlock('reveal', '---\n<script>x</script> [a](javascript:alert(1))'), /<script|href="javascript/);
});

test('body: lines indented under an item stay in that item, as its own paragraphs and nested list', () => {
  const body = ['- **Volume:** Counted.', '', '  Before reading, we cut:', '', '  - Footers.', '  - Links.', '', '  Only the start is read.', '- **Reach:** Views.', '', 'After.'].join('\n');
  const html = renderDataBlock('reveal', `---\n${body}`);
  assert.match(html, /<div class="gbti-reveal-body"><ul><li><strong>Volume:<\/strong> Counted\.<p>Before reading, we cut:<\/p><ul><li>Footers\.<\/li><li>Links\.<\/li><\/ul><p>Only the start is read\.<\/p><\/li><li><strong>Reach:<\/strong> Views\.<\/li><\/ul><p>After\.<\/p><\/div>/);
  // unindented text keeps the old behaviour: a blank line ends the list, an unindented item after it starts a new one
  assert.match(renderDataBlock('reveal', '---\n- a\n\n- b\n\nc'), /<ul><li>a<\/li><\/ul><ul><li>b<\/li><\/ul><p>c<\/p>/);
  assert.match(renderDataBlock('reveal', '---\n- a\nb'), /<ul><li>a<\/li><\/ul><p>b<\/p>/);
});

test('site: a nested list in the reveal body survives the sanitizer', async () => {
  const html = await site(`${F}reveal Show\n---\n- Top\n\n  - Inner\n${F}\n`);
  assert.match(html, /<li>Top<ul><li>Inner<\/li><\/ul><\/li>/);
});

test('site: the sanitizer keeps exactly the reveal classes and drops look-alikes', async () => {
  const html = await site(`Lead\n\n${REVEAL}\n`);
  for (const c of ['gbti-reveal', 'gbti-reveal-weights', 'gbti-reveal-seg gbti-reveal-seg-1 gbti-bar-w-40', 'gbti-reveal-legend', 'gbti-reveal-key', 'gbti-reveal-swatch', 'gbti-reveal-note', 'gbti-reveal-more', 'gbti-reveal-toggle', 'gbti-reveal-chev', 'gbti-reveal-show', 'gbti-reveal-hide', 'gbti-reveal-body']) {
    assert.match(html, new RegExp(`class="${c}[ "]`), `missing ${c}`);
  }
  assert.doesNotMatch(html, /<pre|language-reveal/);
  const evil = await site('<details class="gbti-reveal-morex"><summary class="evil">s</summary>b</details>\n\n<div class="gbti-revealx">y</div>\n');
  assert.doesNotMatch(evil, /gbti-reveal-morex|evil|gbti-revealx/);
});

test('preview and reader: the same HTML as the site module', () => {
  const html = renderMarkdown(`Lead\n\n${REVEAL}\n`);
  assert.ok(html.includes(renderDataBlock('reveal', INNER, 'Show the full formula')));
  assert.doesNotMatch(html, /language-reveal/);
});

test('cross-posts: written out open, no fence left', () => {
  const out = stripSiteOnlyFences(`Intro\n\n${REVEAL}\n\nAfter`);
  assert.match(out, /\*\*Focus\*\* 40% · \*\*Volume\*\* 20% · \*\*Reach\*\* 20% · \*\*Engagement\*\* 20%/);
  assert.match(out, /Then \*\*× 0\.75\*\*/);
  assert.match(out, /- \*\*Focus:\*\* share of 2026 videos about WordPress/);
  assert.doesNotMatch(out, /```|^---$/m);
  assert.equal(dataBlockToMarkdown('reveal', '---\nOnly body'), 'Only body');
});

test('the doc editor keeps the block on a round trip', () => {
  const md = ['Lead', REVEAL, 'After'].join('\n\n');
  assert.equal(serializeBlocks(parseBlocks(md)), md);
});

test('styles: a rule for every reveal class, and the open state swaps the label', () => {
  const css = dataBlocksCss('.p', { fg: 'a', soft: 'b', mute: 'c', line: 'd', line2: 'e', rest: 'f', green: 'g', green700: 'h', green700Solid: 'h2', greenTint: 'i', greenBorder: 'j', surface: 'k', card: 'n', mono: 'm' });
  for (const c of ['gbti-reveal', 'gbti-reveal-weights', 'gbti-reveal-seg', 'gbti-reveal-seg-1', 'gbti-reveal-seg-6', 'gbti-reveal-legend', 'gbti-reveal-key', 'gbti-reveal-swatch', 'gbti-reveal-name', 'gbti-reveal-pct', 'gbti-reveal-note', 'gbti-reveal-more', 'gbti-reveal-toggle', 'gbti-reveal-chev', 'gbti-reveal-show', 'gbti-reveal-hide', 'gbti-reveal-body']) {
    assert.ok(css.includes(`.${c}`), `no rule for ${c}`);
  }
  assert.match(css, /\.gbti-reveal-more\[open\] \.gbti-reveal-show,\.p \.gbti-reveal-more:not\(\[open\]\) \.gbti-reveal-hide\{display:none\}/);
});

test('validator: good reveal is quiet; bad weights, sums, stray lines and a missing body warn', () => {
  assert.deepEqual(checkComponentBlocks(REVEAL), []);
  const msgs = checkComponentBlocks([
    `${F}reveal\nweights: A forty\n---\nx\n${F}`,
    `${F}reveal\nweights: A 50, B 40\ncolour: red\n---\nx\n${F}`,
    `${F}reveal\nweights: A 10, B 10, C 10, D 10, E 10, F 10, G 40\n---\nx\n${F}`,
    `${F}reveal\nJust text\n${F}`,
    `${F}reveal\nnote: n\n---\n${F}`,
  ].join('\n\n')).map((x) => x.message).join('\n');
  assert.match(msgs, /weights "A forty" do not parse/);
  assert.match(msgs, /add up to 90, not 100/);
  assert.match(msgs, /line "colour: red" is not weights: or note:/);
  assert.match(msgs, /at most 6 weights \(got 7\)/);
  assert.match(msgs, /needs a line with ---/);
  assert.match(msgs, /nothing after ---/);
});

// 2026-11-05: ```callout <variant> small sets a callout in smaller type (the owner's calculation note under the pie in
// the Minecraft versions article). The flag has to survive every layer that reads a callout: both renderers, the
// published page's sanitizer, the WorkBench block model (a save must not drop it) and the component checker. The
// last test guards the defect found on the way: the WorkBench preview renders callouts with md- classes, and no Prose
// rule matched them, so every callout showed unstyled in the preview while the published page was fine.
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
import { renderMarkdown } from '../client/src/markdown.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from '../src/lib/markdown-sanitize.mjs';
import { parseBlocks, serializeBlocks, CALLOUT_VARIANTS } from '../client-ui/src/markdown-blocks.mjs';
import { checkComponentBlocks } from '../client/src/content-blocks.mjs';

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
const SMALL = '```callout info small\n**How it is calculated.** (a + b) / 2\n```';

test('callout small: the preview renderer keeps the variant and adds the small class', () => {
  assert.match(renderMarkdown(SMALL), /class="md-callout md-callout-info md-callout-small"/);
  assert.doesNotMatch(renderMarkdown('```callout info\nx\n```'), /md-callout-small/, 'no flag, no small class');
  assert.match(renderMarkdown('```callout danger small\nx\n```'), /md-callout md-callout-note md-callout-small/, 'an unknown variant is still note');
});

test('callout small: the published page keeps the variant, and the sanitizer keeps the class', async () => {
  const html = await published(SMALL);
  assert.match(html, /<div class="callout callout-info callout-small">/); // the sanitizer drops role="note" from every callout
  assert.match(html, /<strong>How it is calculated\.<\/strong>/);
  // Before the flag, "info small" was read as one unknown variant and the box fell back to note.
  assert.doesNotMatch(html, /callout-note/);
  assert.doesNotMatch(await published('```callout tip\nx\n```'), /callout-small/);
});

test('callout small: a WorkBench save round-trips the flag, and a plain callout gains nothing', () => {
  const [b] = parseBlocks(SMALL);
  assert.equal(b.type, 'callout');
  assert.equal(b.variant, 'info');
  assert.equal(b.small, true);
  assert.equal(serializeBlocks(parseBlocks(SMALL)), SMALL);
  const plain = '```callout warning\nx\n```';
  assert.equal('small' in parseBlocks(plain)[0], false);
  assert.equal(serializeBlocks(parseBlocks(plain)), plain);
});

test('callout small: the component checker accepts small and names any other option', () => {
  assert.deepEqual(checkComponentBlocks(SMALL), []);
  const w = checkComponentBlocks('```callout info big\nx\n```').map((x) => x.message);
  assert.deepEqual(w, ['callout option "big" is not known; only "small" is']);
  assert.match(checkComponentBlocks('```callout danger small\nx\n```')[0].message, /variant "danger"/);
});

test('the WorkBench preview styles every callout: each class the preview renderer emits has a Prose rule', () => {
  const css = fs.readFileSync(new URL('../src/components/blog/Prose.astro', import.meta.url), 'utf8');
  const has = (sel) => new RegExp(`\\.prose-gbti \\.${sel}[\\s,:{]`).test(css);
  assert.ok(has('md-callout'), 'the box itself');
  assert.ok(has('md-callout-small'), 'the small size');
  assert.ok(CALLOUT_VARIANTS.length >= 4);
  for (const v of CALLOUT_VARIANTS) assert.ok(has(`md-callout-${v}`), `the ${v} variant`);
});

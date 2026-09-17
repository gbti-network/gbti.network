// sow-353 (owner, 2026-09-16): "on single col mobile view the sidebar arrives after the article content, not
// before", extended by the owner to the other detail pages ("Fix any issues with phone as well"). A one-column
// grid stacks its children in SOURCE order, so each sidebar has to follow the content in the source, and the
// two-column page then places it back beside the content by grid position. Both halves are pinned here for the
// project and prompt pages (the article half lives in test/article-page.test.mjs): a sidebar moved back above
// the content, or a desktop rule that loses its placement, would each pass the other half alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = src('src/styles/gbti-v3.css');

// The positions of several markers, asserted to appear in the given order and each exactly once.
function assertOrder(text, markers, label) {
  const at = markers.map((m) => {
    const i = text.indexOf(m);
    assert.ok(i >= 0, `${label}: "${m}" is missing`);
    assert.equal(text.indexOf(m, i + 1), -1, `${label}: "${m}" appears more than once`);
    return i;
  });
  for (let k = 1; k < at.length; k++) {
    assert.ok(at[k] > at[k - 1], `${label}: expected "${markers[k]}" after "${markers[k - 1]}"; got ${JSON.stringify(at)}`);
  }
}

// The body of the one @media block that opens with the given query, up to its closing brace at column 0.
function mediaBlock(query) {
  const i = css.indexOf(`@media ${query} {\n`);
  assert.ok(i >= 0, `no @media ${query} block`);
  return css.slice(i, css.indexOf('\n}\n', i));
}

test('project page: the column, then the rail, then the closing sections', () => {
  const page = src('src/pages/projects/[slug].astro');
  assertOrder(page, ['<div class="pd-col">', '<article id="pd-overview"', '<aside class="pd-rail">', '<DigestSubscribe', '</aside>', '<div class="pd-close">', '<ContentFooter type="project"'], 'projects/[slug].astro');
});

test('project page: the two-column page places the rail by position, on either side', () => {
  assert.match(css, /\n\.pd-grid \{[^}]*gap: 0 30px;/, 'no row gap between the column and the closing sections');
  assert.match(css, /\n\.pd-rail \{ grid-column: 1; grid-row: 1 \/ span 2; \}/);
  assert.match(css, /\n\.pd-col, \.pd-close \{ grid-column: 2; \}/);
  assert.match(css, /\n\.pd-grid\[data-side="right"\] \.pd-rail \{ grid-column: 2; \}/);
  assert.match(css, /\n\.pd-grid\[data-side="right"\] :is\(\.pd-col, \.pd-close\) \{ grid-column: 1; \}/);
  assert.match(css, /\n\.pd-col, \.pd-close \{ min-width: 0; max-width: 660px; \}/);
  // The narrow-desktop tier restates the gap, so it must keep the zero row gap too.
  assert.match(mediaBlock('(max-width: 1023px)'), /\.pd-grid \{[^}]*gap: 0 clamp\(/);
  // `order` was how the right-side variant used to swap tracks; with placement by position it would fight it.
  assert.doesNotMatch(css, /\.pd-(rail|col) \{ order:/);
});

test('project page: a phone drops the placement and stacks the rail as blocks, not a sideways strip', () => {
  const phone = mediaBlock('(hover: none) and (pointer: coarse) and (max-width: 560px), (max-width: 479px)');
  assert.match(phone, /\.pd-rail, \.pd-col, \.pd-close,\n\s*\.pd-grid\[data-side="right"\] \.pd-rail, \.pd-grid\[data-side="right"\] :is\(\.pd-col, \.pd-close\) \{ grid-column: auto; grid-row: auto; \}/);
  assert.match(phone, /\.pd-rail \{ position: static; \}/);
  // The strip clipped the digest form and the partner card once they joined the rail.
  assert.doesNotMatch(phone, /\.pd-rail \{[^}]*(flex-direction: row|overflow-x)/);
  assert.doesNotMatch(phone, /\.pd-block \{[^}]*border-top: 0/);
});

test('project page: the favorites block renders only when it has names', () => {
  const page = src('src/pages/projects/[slug].astro');
  assert.match(page, /\{favoritedBy\('project', d\.slug, aliasSlugsOf\(d\)\)\.length > 0 && \(\n\s*<div class="pd-block">\n\s*<FavoritedBy type="project"/);
  // The condition must match the component's own, or the block could render empty or hide real names.
  assert.match(src('src/components/FavoritedBy.astro'), /const usernames = favoritedBy\(type, slug, aliases\);/);
});

test('prompt page: the prompt, then the aside, then the discussion', () => {
  const page = src('src/pages/prompts/[slug].astro');
  assertOrder(page, ['<div class="detail-main">', '<div class="prompt-block"', '<aside class="detail-aside flex col g20">', '</aside>', '<div class="detail-close">', '<ContentFooter type="prompt"'], 'prompts/[slug].astro');
  assert.match(page, /\.detail-grid \{ display: grid; gap: 0 clamp\(20px, 3vw, 32px\);/);
  assert.match(page, /\.detail-aside \{ grid-column: 2; grid-row: 1 \/ span 2; \}/);
  assert.match(page, /\.detail-close \{ grid-column: 1; min-width: 0; \}/);
  assert.match(page, /@media \(max-width: 600px\) \{[\s\S]*?\.detail-aside, \.detail-close \{ grid-column: auto; grid-row: auto; \}/);
  // The old rule moved the aside ABOVE the prompt on a phone; the WorkBench preview reads the same stylesheet.
  assert.doesNotMatch(css, /\.detail-aside \{ order:/);
});

test('WorkBench preview and its harness fixture put the rail after the column', () => {
  assertOrder(src('src/pages/workbench/preview.astro'), ['<div class="pd-col">', '<article id="pd-overview">', '<aside class="pd-rail">'], 'preview.astro');
  assertOrder(src('scripts/fixtures/preview-skeleton.html'), ['<div class="pd-col" data-h-col>', '<aside class="pd-rail" data-h-rail>'], 'preview-skeleton.html');
});

test('extension page illustration: the search text truncates on one line', () => {
  const page = src('src/pages/extension/index.astro');
  assert.match(page, /<span class="bw-url bw-url-search">[\s\S]*?<span class="bw-url-text">Search the network or paste a link<\/span><\/span>/);
  assert.match(page, /\.bw-url-text \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
});

// With the sidebar above the closing sections on a phone, its digest signup would repeat the closing block's one
// panel later. The sidebar copy is hidden only in each page's one-column block; the closing block's copy is the
// reason that is safe, so it is pinned too.
test('phone: the sidebar digest signup gives way to the closing block\'s, on articles, projects and prompts', () => {
  assert.match(src('src/components/ContentFooter.astro'), /\n<DigestSubscribe variant="inline"/);
  assert.match(src('src/components/blog/ArticleJournal.astro'), /<div class="rail-digest">\n\s*<DigestSubscribe variant="rail"/);
  assert.match(src('src/pages/projects/[slug].astro'), /<div class="pd-block rail-digest">\n\s*<DigestSubscribe variant="rail"/);
  const prompt = src('src/pages/prompts/[slug].astro');
  assert.match(prompt, /<div class="card rail-digest" style="padding:22px">\n\s*<DigestSubscribe variant="rail"/);
  assert.match(prompt, /@media \(max-width: 600px\) \{[^@]*?\.rail-digest \{ display: none; \}/);
  // Two blocks share the article query (the Editorial grid's comes first); the Journal one holds .art-j-grid.
  const q = '@media (hover: none) and (pointer: coarse) and (max-width: 640px), (max-width: 479px) {\n';
  const journal = css.slice(css.indexOf(q, css.indexOf('.art-j-grid {')), css.indexOf('\n}\n', css.indexOf(q, css.indexOf('.art-j-grid {'))));
  assert.match(journal, /\.art-j-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(journal, /\.art-j-rail \.rail-digest \{ display: none; \}/);
  assert.match(mediaBlock('(hover: none) and (pointer: coarse) and (max-width: 560px), (max-width: 479px)'), /\.pd-rail \.rail-digest \{ display: none; \}/);
  // Hidden anywhere else, a desktop reader would lose the sidebar signup.
  assert.equal(css.match(/\.rail-digest \{ display: none; \}/g).length, 2);
});

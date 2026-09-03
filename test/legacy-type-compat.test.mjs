// sow-196 follow-up (2026-09-03): the `product` -> `project` rename deliberately RETAINED the old name
// at every boundary that reads persisted state, forked content, or a URL somebody already published.
//
// Four of those retentions were silently destroyed by the rename pass itself. A bulk replace of
// 'product' -> 'project' was applied to lines that already carried BOTH names, turning each legacy value
// into a duplicate of its replacement:
//
//   ['post', 'product', 'prompt']            -> ['post', 'project', 'project', 'prompt']
//   ['/products/', '/projects/']             -> ['/projects/', '/projects/']        (a self-redirect)
//
// NOTHING reported it. A duplicate inside an array is legal JavaScript, a duplicate in a Zod enum is a
// legal enum, and a self-redirect is a legal _redirects line. The full suite stayed green, the build
// stayed green, and every explanatory comment saying the legacy value must be kept was left intact
// beside the code that no longer kept it.
//
// These assertions are deliberately about the RETENTION, not about the rename. Each one fails if the
// legacy name is dropped again, whether by a bulk replace or by someone tidying up what looks like a
// redundant entry. What breaks in each case is named on the assertion, because a rule stated as a
// design rationale gets traded away and a rule stated as a consequence does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonicalType } from '../membership/content-types.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// Pull a bracketed list of string literals off a matched line, so the assertion is about the parsed
// VALUES rather than a substring of source text. A substring check passes on a line that mentions
// 'products' inside a comment, which is exactly how the broken state read.
function listOn(text, anchorRe, label) {
  const line = text.split('\n').find((l) => anchorRe.test(l));
  assert.ok(line, `${label}: anchor ${anchorRe} matched no line (the check is broken, not the subject)`);
  const inner = /\[([^\]]*)\]/.exec(line);
  assert.ok(inner, `${label}: no bracketed list on the matched line`);
  return [...inner[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

test('/feeds/products/ is served by a 301 and NOT built, so the legacy URL has one canonical page', () => {
  // The route source is getStaticPaths, not the FEED_NARROWS constant (which nothing reads). Building a
  // page here would be actively worse than the redirect: Cloudflare serves a static file ahead of
  // _redirects, so the working 301 would stop firing and the legacy URL would become duplicate content.
  const astro = read('src/pages/feeds/[narrow].astro');
  const narrows = [...astro.matchAll(/params: \{ narrow: '([^']+)' \}/g)].map((m) => m[1]);
  assert.ok(narrows.length >= 5, `only ${narrows.length} narrows parsed; the parse is wrong, so the assertions below would pass vacuously`);
  assert.ok(narrows.includes('projects'), 'the projects feed route must exist');
  assert.ok(!narrows.includes('products'), '/feeds/products/ must NOT be built; it is a 301 to /feeds/projects/');
  assert.deepEqual(
    narrows.filter((n, i) => narrows.indexOf(n) !== i),
    [],
    'duplicate narrow in getStaticPaths. A bulk rename over a line carrying BOTH names produces exactly this, and Astro does not complain.',
  );
});

test('the project collection still globs the legacy products/ folders, or a fork loses every item silently', () => {
  const pats = listOn(read('src/content.config.ts'), /loader: glob\(\{ base: '\.', pattern: \['members\/\*\/projects/, 'project glob');
  for (const want of [
    'members/*/projects/**/*.md',
    'house/projects/**/*.{md,mdx}',
    'members/*/products/**/*.md',
    'house/products/**/*.{md,mdx}',
  ]) {
    assert.ok(pats.includes(want), `project collection glob lost ${want}. An unmigrated fork or a branch cut before the rename loses every project with no error anywhere.`);
  }
});

test('the comment schema still accepts targetType: product, or a legacy comment breaks the build', () => {
  const types = listOn(read('src/content.config.ts'), /targetType: z\.enum\(/, 'comment targetType');
  assert.ok(
    types.includes('product'),
    'comment targetType dropped "product". A comment written by a pre-rename client fails collection validation, which fails the whole BUILD, not just that item.',
  );
  assert.ok(types.includes('project'), 'comment targetType must still carry the current name');
  // And the alias has to actually resolve, or accepting the value achieves nothing on read.
  assert.equal(canonicalType('product'), 'project');
});

test('the redirect generator emits a /products/ SOURCE, never a self-redirect', () => {
  const gen = read('scripts/gen-redirects.mjs');
  for (const want of ["'/products/', '/projects/'", "'/feeds/products/', '/feeds/projects/'", "'/products-index.json', '/projects-index.json'"]) {
    assert.ok(gen.includes(want), `gen-redirects lost the pair ${want}. Regenerating drops a live 301 and, if the source was renamed in place, replaces it with a redirect to itself.`);
  }
  assert.ok(
    !/\['(\/[^']*)', '\1'\]/.test(gen),
    'gen-redirects contains a redirect whose source equals its destination',
  );
});

test('the committed _redirects carries the legacy collection routes and no self-redirect', () => {
  const rows = read('public/_redirects')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/));

  assert.ok(rows.length > 50, `only ${rows.length} rules parsed; the parse is wrong, so the assertions below would pass vacuously`);

  const dest = (from) => rows.find((r) => r[0] === from)?.[1];
  assert.equal(dest('/products/'), '/projects/');
  assert.equal(dest('/feeds/products/'), '/feeds/projects/');
  assert.equal(dest('/products-index.json'), '/projects-index.json');
  // The two SOW-022 applet URLs predate the rename and are the oldest live /products/ links we have.
  assert.equal(dest('/products/js-animate-hue/'), '/utilities/js-animate-hue/');
  assert.equal(dest('/products/email-signature-generator/'), '/utilities/email-signature-generator/');

  const self = rows.filter((r) => r[0] === r[1]);
  assert.deepEqual(self, [], `self-redirect(s) in public/_redirects: ${JSON.stringify(self)}`);
});

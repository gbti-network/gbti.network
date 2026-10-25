// Every content type that can carry contributors must SHOW them.
//
// WHAT WENT WRONG. `contributors` has been on posts, projects and prompts all along, and the revenue model reads
// it (scripts/lib/collaboration-gather.mjs lists all three in TYPE_DIR), but only the article page passed the
// credit set to ContentMeta. So on a prompt or a project a contributor could be credited in the file, counted
// for payout, and invisible to every reader. Found on the first prepared listing, where GBTI authored the item
// and the credit landed in the frontmatter and nowhere else. Nothing was red, because nothing looked.
//
// The page list is DERIVED from the schema rather than written down here: a fourth content type that carries
// contributors and forgets to render them should fail this, and a hand-written list of three pages would not
// notice it existed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** The detail page for each content type, by the collection name used in src/content.config.ts. */
const DETAIL_PAGE = Object.freeze({
  post: 'src/pages/articles/[slug].astro',
  project: 'src/pages/projects/[slug].astro',
  prompt: 'src/pages/prompts/[slug].astro',
});

/** The collections whose schema includes `contributors`, read from the config rather than assumed. */
function collectionsWithContributors(src) {
  // Each collection body is `type: z.literal('<name>')` ... and `contributors,` somewhere inside it.
  const names = [...src.matchAll(/z\.literal\('([a-z]+)'\)/g)].map((m) => m[1]);
  const out = [];
  for (const name of new Set(names)) {
    const at = src.indexOf(`z.literal('${name}')`);
    // Look forward to the next literal declaration, so each window is one schema.
    const rest = src.slice(at + 1);
    const nextAt = rest.search(/z\.literal\('[a-z]+'\)/);
    const body = nextAt === -1 ? rest : rest.slice(0, nextAt);
    if (/^\s*contributors,\s*$/m.test(body)) out.push(name);
  }
  return out;
}

test('every content type that can carry contributors renders them in its credit line', () => {
  const config = read('src/content.config.ts');
  const carriers = collectionsWithContributors(config);

  // A control: if this finds nothing, the parse broke and the loop below would pass vacuously.
  assert.ok(carriers.length >= 3, `expected several contributor-carrying types, found ${carriers.join(', ') || 'none'}`);
  for (const t of ['post', 'project', 'prompt']) {
    assert.ok(carriers.includes(t), `${t} should carry contributors; the schema parse may have drifted`);
  }

  for (const type of carriers) {
    const page = DETAIL_PAGE[type];
    assert.ok(page, `${type} carries contributors but this test knows no detail page for it; add one`);
    const src = read(page);
    assert.match(src, /avatarStack\(\{/,
      `${page} builds no credit set, so a contributor on a ${type} would be invisible to readers`);
    // Passed onward to whatever renders the byline. The article page hands it to its Layout, which forwards it
    // to ContentMeta; the other two pass it to ContentMeta directly. Both are "the byline receives it", so this
    // asserts the handoff rather than one component's name. The first version matched only the direct form and
    // failed on the article page, which has worked correctly all along.
    assert.match(src, /\bstack=\{stack\}/,
      `${page} builds a credit set but never passes it on, so the byline renders a single author avatar`);
    assert.match(src, new RegExp(`targetType: '${type}'`),
      `${page} should build its credit set for its own type`);
  }
});

test('a prompt and a project credit line names the makers, not the commenters', () => {
  // avatarStack adds commenters only when given a targetSlug. An article's credit line is a conversation; a
  // prompt's is a statement of who built the thing, so these two omit it on purpose. Asserted so that a later
  // copy-paste from the article page does not quietly move commenters into these bylines.
  for (const page of [DETAIL_PAGE.project, DETAIL_PAGE.prompt]) {
    const src = read(page);
    const call = src.slice(src.indexOf('avatarStack({'));
    const end = call.indexOf('});');
    assert.ok(end > 0, `${page}: could not read the avatarStack call`);
    const args = call.slice(0, end);
    assert.ok(!/targetSlug/.test(args), `${page} passes targetSlug, which pulls commenters into the byline`);
    assert.ok(!/comments:/.test(args), `${page} passes comments, which pulls commenters into the byline`);
  }
});

// sow-246: the Mode B teaser gate had no test. `isStub` is the sole decision, in eight consumers, between a
// locked body and the item's own markdown, and it had zero references under test/. These drive the four
// frontmatter shapes through all four predicates and assert the whole tuple each time, because a test that
// checks one predicate per shape would pass while the shape it never asked about regressed.
//
// MUTATION-CHECKED before commit (the SOW's rule): with isStub forced to `false` the Mode B case below dies;
// with hasPublicPage forced to ignore the stub the Mode B page case dies; both restored.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPublic, hasPublicPage, isStub, isListed } from '../src/lib/content-gating.mjs';

const entry = (data) => ({ data });
const tuple = (e) => ({ isPublic: isPublic(e), hasPublicPage: hasPublicPage(e), isStub: isStub(e), isListed: isListed(e) });

test('a PUBLIC published item: full page, listed, not a stub', () => {
  assert.deepEqual(tuple(entry({ status: 'published', visibility: 'public' })), { isPublic: true, hasPublicPage: true, isStub: false, isListed: true });
});

test('MODE A (members, no stub): no public page, not listed, not public, not a stub', () => {
  assert.deepEqual(tuple(entry({ status: 'published', visibility: 'members' })), { isPublic: false, hasPublicPage: false, isStub: false, isListed: false });
  assert.deepEqual(tuple(entry({ status: 'published', visibility: 'members', publicStub: false })), { isPublic: false, hasPublicPage: false, isStub: false, isListed: false });
});

test('MODE B (members + publicStub): a page and a listing as a locked card, a stub, never fully public', () => {
  // This is the case the SOW is about: the one mode the guard did not guard.
  assert.deepEqual(tuple(entry({ status: 'published', visibility: 'members', publicStub: true })), { isPublic: false, hasPublicPage: true, isStub: true, isListed: true });
});

test('a DRAFT gets nothing public, whatever its visibility or stub flag', () => {
  for (const data of [
    { status: 'draft', visibility: 'public' },
    { status: 'draft', visibility: 'members' },
    { status: 'draft', visibility: 'members', publicStub: true },
  ]) {
    const t = tuple(entry(data));
    assert.equal(t.isPublic, false, JSON.stringify(data));
    assert.equal(t.hasPublicPage, false, JSON.stringify(data));
    assert.equal(t.isListed, false, JSON.stringify(data));
  }
  // isStub is a shape question, not a publication one: a draft members stub is still "a stub" for the
  // renderers, which never see a draft because hasPublicPage already excluded it from the build.
  assert.equal(isStub(entry({ status: 'draft', visibility: 'members', publicStub: true })), true);
});

test('publicStub on a PUBLIC item is inert: not a stub, and the page is the full page', () => {
  assert.deepEqual(tuple(entry({ status: 'published', visibility: 'public', publicStub: true })), { isPublic: true, hasPublicPage: true, isStub: false, isListed: true });
});

test('the stub flag is strictly boolean true: a string "true" or a 1 does not open a page for a members item', () => {
  for (const publicStub of ['true', 1, 'yes']) {
    const t = tuple(entry({ status: 'published', visibility: 'members', publicStub }));
    assert.equal(t.hasPublicPage, false, String(publicStub));
    assert.equal(t.isStub, false, String(publicStub));
  }
});

test('a missing or malformed entry fails closed', () => {
  for (const e of [null, undefined, {}, { data: null }]) {
    assert.deepEqual(tuple(e), { isPublic: false, hasPublicPage: false, isStub: false, isListed: false });
  }
});

// ---------------------------------------------------------------------------------------------------------
// The consumer census. A test that proves the helper while a component reads `publicStub` by hand is the
// proxy failure this project has hit before, so every known consumer is pinned to reach the decision through
// the helper, and a new hand-rolled read of the flag anywhere under src/ is caught.
// ---------------------------------------------------------------------------------------------------------
const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('every known consumer reaches the Mode B decision through isStub, and the article page hands it to its layouts', () => {
  const direct = [
    'src/components/blog/ArticleTeaser.astro',
    'src/components/projects/ProjectCard.astro',
    'src/components/projects/ProjectDirectory.astro',
    'src/components/prompts/PromptCard.astro',
    'src/pages/projects/[slug].astro',
    'src/pages/prompts/[slug].astro',
  ];
  for (const p of direct) assert.match(read(p), /import \{[^}]*\bisStub\b[^}]*\} from '\.\.\/\.\.\/lib\/content'/, `${p} imports isStub from lib/content`);
  assert.match(read('src/lib/feed-items.ts'), /import \{[^}]*\bisStub\b[^}]*\} from '\.\/content'/);
  const article = read('src/pages/articles/[slug].astro');
  assert.match(article, /import \{[^}]*\bisStub as isStubFn\b[^}]*\} from '\.\.\/\.\.\/lib\/content'/);
  assert.match(article, /isStub=\{stub\}/, 'the article page resolves once and hands the boolean to its layout');
  for (const p of ['src/components/blog/ArticleCard.astro', 'src/components/blog/ArticleEditorial.astro', 'src/components/blog/ArticleJournal.astro']) {
    assert.match(read(p), /isStub: boolean;/, `${p} takes the resolved boolean as a prop`);
    assert.match(read(p), /\{isStub \? <LockedBody/, `${p} renders the locked body on the prop`);
  }
});

test('no component or page under src/ reads publicStub by hand', () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(astro|ts|mjs)$/.test(e.name)) out.push(p); } return out; };
  const files = [...walk(path.join(root, 'src/components')), ...walk(path.join(root, 'src/pages'))];
  assert.ok(files.length > 50, 'the walk found the tree');
  const offenders = files.filter((p) => /\.publicStub\b|publicStub\s*===/.test(fs.readFileSync(p, 'utf8')));
  assert.deepEqual(offenders.map((p) => path.relative(root, p)), [], 'the flag is read only inside content-gating.mjs');
});

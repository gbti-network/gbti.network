// sow-287: a category link filters to the category it names. The guard reads built HTML, so these tests build a
// small fake dist rather than rendering components.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categoryLinksIn, checkCategoryLinks, loadCategoryLabels } from '../scripts/check-category-links.mjs';

const LABELS = { devops: 'DevOps', react: 'React', ai: 'AI', skill: 'Skill' };

function fakeDist(pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-catlinks-'));
  for (const [rel, html] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), html);
  }
  return dir;
}

const railLink = (key, text) => `<div class="art-tags"><a class="art-tag" href="/feeds/?cat=${key}">${text}</a></div>`;
const cardChip = (key, text) => `<a href="/prompts/?cat=${key}" class="kbadge"><span class="dot"></span>${text}</a>`;

test('categoryLinksIn reads the key and the visible text, decoding entities and dropping inner markup', () => {
  const html = `${cardChip('skill', 'Skill')}<a href="/feeds/?tag=react">react</a><a class="x" href="/articles/?q=1&amp;cat=devops">Dev&#79;ps</a>`;
  assert.deepEqual(categoryLinksIn(html), [{ key: 'skill', text: 'Skill' }, { key: 'devops', text: 'DevOps' }]);
});

test('a link reading its own category passes, and one reading a different category fails, naming both', () => {
  const ok = fakeDist({ 'articles/a/index.html': railLink('react', 'React'), 'index.html': cardChip('skill', 'Skill') });
  assert.deepEqual(checkCategoryLinks({ distDir: ok, labels: LABELS }).errors, []);

  const bad = fakeDist({ 'articles/a/index.html': railLink('devops', 'React'), 'index.html': cardChip('ai', 'Skill') });
  const { errors } = checkCategoryLinks({ distDir: bad, labels: LABELS });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /articles\/a\/index\.html: a link reading "React" filters to \?cat=devops \("DevOps"\)/);
  assert.match(errors[1], /index\.html: a link reading "Skill" filters to \?cat=ai \("AI"\)/);
});

test('a path label ("DevOps › React") names more than one category and is not held to one key', () => {
  const dist = fakeDist({
    'articles/a/index.html': railLink('react', 'React'),
    'articles/b/index.html': '<p class="eyebrow"><a href="/articles/?cat=devops">DevOps › React</a></p>',
    'index.html': cardChip('skill', 'Skill'),
  });
  const { errors, checked } = checkCategoryLinks({ distDir: dist, labels: LABELS });
  assert.deepEqual(errors, []);
  assert.deepEqual(checked, { articlePages: 1, elsewhere: 1 });
});

test('a build with no category link on an article page, or none elsewhere, fails rather than passing on nothing', () => {
  const noRail = fakeDist({ 'articles/a/index.html': '<p>no rail</p>', 'index.html': cardChip('skill', 'Skill') });
  assert.match(checkCategoryLinks({ distDir: noRail, labels: LABELS }).errors.join('\n'), /no category link was checked on any article page/);
  const noCards = fakeDist({ 'articles/a/index.html': railLink('react', 'React'), 'index.html': '<p>no cards</p>' });
  assert.match(checkCategoryLinks({ distDir: noCards, labels: LABELS }).errors.join('\n'), /no category link was checked outside the article pages/);
});

test('loadCategoryLabels walks nested children and falls back to the key for a node with no label', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-catlabels-'));
  fs.mkdirSync(path.join(root, 'house'));
  fs.writeFileSync(path.join(root, 'house/taxonomy.yml'), 'tree:\n  devops:\n    label: DevOps\n    children:\n      frameworks:\n        label: Frameworks\n        children:\n          react:\n            label: React\n  misc: {}\n');
  assert.deepEqual(loadCategoryLabels(root), { devops: 'DevOps', frameworks: 'Frameworks', react: 'React', misc: 'misc' });
});

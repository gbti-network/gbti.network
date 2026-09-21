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

/** A throwaway root carrying one or both vocabulary files. */
function labelRoot({ taxonomy, topics }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-catlabels-'));
  fs.mkdirSync(path.join(root, 'house'));
  if (taxonomy !== undefined) fs.writeFileSync(path.join(root, 'house/taxonomy.yml'), taxonomy);
  if (topics !== undefined) fs.writeFileSync(path.join(root, 'house/topics.yml'), topics);
  return root;
}
const TAXONOMY = 'tree:\n  devops:\n    label: DevOps\n    children:\n      frameworks:\n        label: Frameworks\n        children:\n          react:\n            label: React\n  misc: {}\n';

test('loadCategoryLabels walks nested children and falls back to the key for a node with no label', () => {
  const root = labelRoot({ taxonomy: TAXONOMY, topics: 'topics: {}\n' });
  assert.deepEqual(loadCategoryLabels(root).labels, { devops: 'DevOps', frameworks: 'Frameworks', react: 'React', misc: 'misc' });
});

// sow-382: ?cat= answers for BOTH vocabularies, so this guard reads both or it rejects 13 links that name a
// category which is real and simply lives in the other file.
test('sow-382: the share topic vocabulary is merged in, so a topic-only key is a known label', () => {
  const root = labelRoot({ taxonomy: TAXONOMY, topics: 'topics:\n  music: { label: Music }\n  bare-one: {}\n' });
  const { labels, conflicts } = loadCategoryLabels(root);
  assert.equal(labels.music, 'Music', 'a key only the topic list defines still has its label');
  assert.equal(labels.react, 'React', 'and the taxonomy is untouched');
  assert.equal(labels['bare-one'], 'bare-one', 'a topic with no label falls back to its key, as the taxonomy does');
  assert.deepEqual(conflicts, []);
});

test('sow-382: a key the two files label DIFFERENTLY is a conflict, not a silent pick', () => {
  // "The label for this key" stops having one answer. Picking a side would leave this guard passing while a
  // reader is shown the other word.
  const root = labelRoot({ taxonomy: TAXONOMY, topics: 'topics:\n  react: { label: ReactJS }\n' });
  const { labels, conflicts } = loadCategoryLabels(root);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /react.*React.*ReactJS/);
  assert.equal(labels.react, 'React', 'the taxonomy value is left in place rather than overwritten');
});

test('sow-382: the SAME label in both files is not a conflict', () => {
  // 20 keys are in both today and all 20 agree, which is what makes one merged map honest.
  const root = labelRoot({ taxonomy: TAXONOMY, topics: 'topics:\n  react: { label: React }\n' });
  assert.deepEqual(loadCategoryLabels(root).conflicts, []);
});

test('sow-382: a MISSING topic file is reported, not read as an empty vocabulary', () => {
  // Empty would drop every topic-only key and make this guard reject the links that name them, which reads
  // as the links being wrong rather than the file being gone.
  const root = labelRoot({ taxonomy: TAXONOMY });
  const { conflicts } = loadCategoryLabels(root);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /house\/topics\.yml is missing/);
});

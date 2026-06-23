// SOW-054 Phase 1: the followed-topic -> news-category map core. Pure parse/resolve/validate + an integration
// test that the real house/topic-map.yml stays valid against the live taxonomy primaries + news categories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import yaml from 'js-yaml';
import { topicMapFromParsed, newsCategoriesForTopics, validateTopicMap } from '../membership/topic-map.mjs';
import { CATEGORY_NAMES } from '../workers/news/config/categories.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const load = (p) => yaml.load(fs.readFileSync(path.join(ROOT, p), 'utf8'));

test('topicMapFromParsed: accepts the topics wrapper, bare arrays, and the {newsCategories} form', () => {
  assert.deepEqual(topicMapFromParsed({ topics: { ai: ['AI/ML'] } }), { ai: ['AI/ML'] });
  assert.deepEqual(topicMapFromParsed({ ai: ['AI/ML'] }), { ai: ['AI/ML'] }); // no wrapper
  assert.deepEqual(topicMapFromParsed({ topics: { ai: { newsCategories: ['AI/ML'] } } }), { ai: ['AI/ML'] });
});

test('topicMapFromParsed: trims, de-dupes, and drops malformed entries; empty/garbage -> {}', () => {
  assert.deepEqual(topicMapFromParsed({ topics: { ai: [' AI/ML ', 'AI/ML', 7, ''] } }), { ai: ['AI/ML'] });
  assert.deepEqual(topicMapFromParsed({ topics: { ai: 'nope', devops: ['DevOps/Cloud'] } }), { ai: [], devops: ['DevOps/Cloud'] });
  assert.deepEqual(topicMapFromParsed(null), {});
  assert.deepEqual(topicMapFromParsed('x'), {});
  assert.deepEqual(topicMapFromParsed([]), {});
});

test('topicMapFromParsed is idempotent (a clean map maps to itself)', () => {
  const clean = { ai: ['AI/ML'], devops: ['DevOps/Cloud'] };
  assert.deepEqual(topicMapFromParsed(clean), clean);
});

test('newsCategoriesForTopics: de-dupes across topics, keeps order, ignores unknown topics', () => {
  const map = { ai: ['AI/ML'], imagegen: ['AI/ML'], devops: ['DevOps/Cloud', 'Open Source'] };
  assert.deepEqual(newsCategoriesForTopics(['ai', 'imagegen'], map), ['AI/ML']); // dedup
  assert.deepEqual(newsCategoriesForTopics(['devops', 'ai'], map), ['DevOps/Cloud', 'Open Source', 'AI/ML']); // order
  assert.deepEqual(newsCategoriesForTopics(['nope'], map), []); // unknown topic
  assert.deepEqual(newsCategoriesForTopics([], map), []);
  assert.deepEqual(newsCategoriesForTopics('x', map), []); // non-array topics
  // accepts a RAW parsed-YAML map too (the topics wrapper)
  assert.deepEqual(newsCategoriesForTopics(['ai'], { topics: { ai: ['AI/ML'] } }), ['AI/ML']);
});

test('validateTopicMap: flags an unknown topic and an unknown news category', () => {
  const opts = { taxonomyPrimaries: ['ai', 'devops'], newsCategories: ['AI/ML', 'DevOps/Cloud'] };
  assert.deepEqual(validateTopicMap({ topics: { ai: ['AI/ML'] } }, opts), []); // valid
  const errs = validateTopicMap({ topics: { ai: ['AI/ML'], nope: ['AI/ML'], devops: ['Bogus'] } }, opts);
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => /"nope" is not a top-level category/.test(e)));
  assert.ok(errs.some((e) => /maps to "Bogus", which is not a news category/.test(e)));
});

// Integration: the real house/topic-map.yml must stay valid against the live vocabularies (catches drift when a
// taxonomy primary is renamed or a news category is removed).
test('the real house/topic-map.yml is valid against the live taxonomy primaries + news categories', () => {
  const taxonomy = load('house/taxonomy.yml');
  const primaries = Object.keys((taxonomy && taxonomy.tree) || {});
  const parsed = load('house/topic-map.yml');
  const errs = validateTopicMap(parsed, { taxonomyPrimaries: primaries, newsCategories: CATEGORY_NAMES });
  assert.deepEqual(errs, [], `house/topic-map.yml has validation errors:\n${errs.join('\n')}`);
  // and it actually resolves SOME news categories (a smoke check that the map is not empty/broken)
  assert.ok(newsCategoriesForTopics(['ai'], parsed).includes('AI/ML'));
});

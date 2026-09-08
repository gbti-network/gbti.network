// sow-149: every news category has a branded banner, and the mapping that picks one can never 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';

import { CATEGORIES } from '../workers/signup/news/config/categories.mjs';
import { newsCategorySlug, newsFeatureImage, NEWS_CATEGORY_SLUGS, GENERIC_FEATURE_IMAGE } from '../client-ui/src/news-feature-image.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = ROOT + 'public/brand/feature/news/';

test('slugs: lowercase, punctuation runs collapse to one dash, nothing dangling', () => {
  assert.equal(newsCategorySlug('AI/ML'), 'ai-ml');
  assert.equal(newsCategorySlug('Business/Funding'), 'business-funding');
  assert.equal(newsCategorySlug('Programming Languages'), 'programming-languages');
  assert.equal(newsCategorySlug('  Web  Dev! '), 'web-dev');
  assert.equal(newsCategorySlug(''), '');
  assert.equal(newsCategorySlug(null), '');
});

test('the slug list is exactly the news worker\'s category list, in its order', () => {
  // The generator and the fallback both key off this list; a category added to the worker without an image
  // must fail HERE, not as a 404 on the feed.
  assert.deepEqual([...NEWS_CATEGORY_SLUGS], CATEGORIES.map((c) => newsCategorySlug(c.name)));
});

test('a known category gets its own banner; anything else gets the generic one', () => {
  assert.equal(newsFeatureImage('Security'), '/brand/feature/news/security.png');
  assert.equal(newsFeatureImage('AI/ML'), '/brand/feature/news/ai-ml.png');
  assert.equal(newsFeatureImage('Quantum'), GENERIC_FEATURE_IMAGE, 'a category the generator never saw');
  assert.equal(newsFeatureImage(''), GENERIC_FEATURE_IMAGE);
  assert.equal(newsFeatureImage(undefined), GENERIC_FEATURE_IMAGE);
  assert.equal(newsFeatureImage('Energy', { base: 'https://gbti.network/' }), 'https://gbti.network/brand/feature/news/energy.png', 'an absolute URL for the extension');
});

test('one committed PNG per category, each a real file under the size norm for the brand family', () => {
  assert.ok(existsSync(DIR), 'public/brand/feature/news/ exists');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, CATEGORIES.length, `one banner per category; have ${files.join(', ')}`);
  for (const c of CATEGORIES) {
    const p = DIR + newsCategorySlug(c.name) + '.png';
    assert.ok(existsSync(p), `${c.name} has ${p}`);
    const size = statSync(p).size;
    assert.ok(size > 5_000 && size < 120_000, `${c.name}: ${size} bytes is a rendered banner, not a stub or a bloat`);
    const head = readFileSync(p).subarray(0, 24); // the PNG signature + IHDR: width at 16, height at 20
    assert.equal(head.readUInt32BE(16) + 'x' + head.readUInt32BE(20), '1200x630', `${c.name} is the family's 1200x630 canvas`);
  }
  assert.ok(existsSync(ROOT + 'public' + GENERIC_FEATURE_IMAGE), 'the generic last resort still exists');
});
